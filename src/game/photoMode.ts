/**
 * Photo mode: pauses the game, hides the interface, frames the view with a vignette and a period
 * caption, and exports the view as a captioned PNG.
 */
import { screenToTile } from '../render/camera';
import { eraName } from '../sim/eras';
import { citiesNear } from '../sim/spatial';
import type { GameState, Speed, Vec2 } from '../sim/types';
import { h } from '../ui/dom';
import '../ui/photoMode.css';
import type { GameController } from './controller';

const CITY_RADIUS = 25;
const FALLBACK_CITY = 'The Valley';
const CAPTION_FONT = "Georgia, 'Times New Roman', serif";

function seasonOf(month: number): string {
  if (month >= 3 && month <= 5) return 'Spring';
  if (month >= 6 && month <= 8) return 'Summer';
  if (month >= 9 && month <= 11) return 'Autumn';
  return 'Winter';
}

function nearestCityName(state: GameState, center: Vec2): string {
  const radius = Math.max(0, Math.min(CITY_RADIUS, 100));
  let best: string = FALLBACK_CITY;
  let bestD = Infinity;
  for (const c of citiesNear(state, center, radius)) {
    const d = (c.center.x - center.x) ** 2 + (c.center.y - center.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c.name;
    }
  }
  return best;
}

/** "<City>, <Season> <Year> — <Era name>" for the view centred on `center` (tiles). */
export function photoCaption(state: GameState, center: Vec2): string {
  const { year, month } = state.date;
  return `${nearestCityName(state, center)}, ${seasonOf(month)} ${year} — ${eraName(year)}`;
}

function filenameFor(year: number, city: string): string {
  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'valley';
  return `smokestack-${year}-${slug}.png`;
}

function centerTile(game: GameController): Vec2 {
  const cam = game.camera;
  return screenToTile(cam, cam.viewW / 2, cam.viewH / 2);
}

/** Draws the same vignette and caption the overlay shows, scaled to `w` x `h` device pixels. */
function drawFrame(g: CanvasRenderingContext2D, w: number, hgt: number, caption: string): void {
  const grad = g.createRadialGradient(w / 2, hgt / 2, Math.min(w, hgt) * 0.3, w / 2, hgt / 2, Math.hypot(w, hgt) / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(20,12,6,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, hgt);
  const px = Math.max(16, Math.round(hgt * 0.03));
  g.font = `${px}px ${CAPTION_FONT}`;
  g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = px * 0.15;
  g.shadowOffsetY = 1;
  g.fillStyle = '#f3e7c9';
  g.fillText(caption, px * 1.4, hgt - px * 1.2);
}

export function enterPhotoMode(game: GameController): () => void {
  const prevSpeed: Speed = game.state.speed;
  game.setSpeed(0);

  const caption = photoCaption(game.state, centerTile(game));
  const vignette = h('div', { class: 'photo-vignette' });
  const captionEl = h('div', { class: 'photo-caption' }, caption);

  let done = false;
  const exit = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('photo-mode');
    vignette.remove();
    captionEl.remove();
    bar.remove();
    game.setSpeed(prevSpeed);
  };

  const toast = (message: string, tone: 'good' | 'bad' | 'info') =>
    game.ctx.bus.emit({ type: 'toast', message, tone });

  const doExport = (): void => {
    const src = game.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext('2d');
    if (g) {
      g.drawImage(src, 0, 0);
      g.drawImage(game.overlay, 0, 0, out.width, out.height);
      drawFrame(g, out.width, out.height, caption);
    }
    out.toBlob((blob) => {
      if (!blob) {
        toast('Export failed', 'bad');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFor(game.state.date.year, caption.split(',')[0]);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Photo saved', 'good');
    }, 'image/png');
  };

  // capture phase: Esc leaves photo mode only, and never reaches the pause-menu handler
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      exit();
    }
  }

  const bar = h('div', { class: 'photo-bar' },
    h('button', { class: 'photo-export', onClick: doExport }, 'Export'),
    h('button', { class: 'photo-exit', onClick: exit }, 'Exit'));

  document.body.classList.add('photo-mode');
  document.body.append(vignette, captionEl);
  game.uiRoot.appendChild(bar);
  window.addEventListener('keydown', onKey, true);
  game.addDisposer(exit);
  return exit;
}
