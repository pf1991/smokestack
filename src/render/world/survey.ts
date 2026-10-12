/**
 * Survey-regime overlays for the world renderer: the per-frame ink symbols drawn over the cached
 * survey chunks (owner-coloured building squares, vehicle dots, landmark map symbols), the
 * paper-friendly night grade, and the italic city names on the overlay canvas.
 */
import { BUILDINGS } from '../../data/buildings';
import type { LandmarkId } from '../../data/landmarks';
import type { Building, GameState } from '../../sim/types';
import { TILE, type Camera } from '../camera';
import { LANDMARK_PX } from '../landmarks';
import { ownerColor } from '../sprites';
import { INK, PAPER, cityLabelFont } from '../survey';
import type { Dir, TileRange } from './shared';
import { SPRITE_MARGIN } from './shared';
import { vehiclePose } from './vehicles';

type Ctx = CanvasRenderingContext2D;

/** Landmark map symbol: drawn centred on (0, 0) at size `s` (screen-px scale already applied). */
function landmarkSymbol(g: Ctx, id: LandmarkId, s: number, lw: number): void {
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = lw;
  g.beginPath();
  switch (id) {
    case 'church': {
      // cross on a small disc: the old "church with tower" sign
      g.arc(0, s * 0.25, s * 0.28, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(0, s * 0.25);
      g.lineTo(0, -s * 0.75);
      g.moveTo(-s * 0.3, -s * 0.42);
      g.lineTo(s * 0.3, -s * 0.42);
      g.lineWidth = lw * 1.6;
      g.stroke();
      return;
    }
    case 'town_hall': {
      // five-point star
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s * 0.62 : s * 0.26;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      return;
    }
    case 'grand_station': {
      // filled bar with a paper slot: the railway station block
      g.rect(-s * 0.6, -s * 0.28, s * 1.2, s * 0.56);
      g.fill();
      g.fillStyle = PAPER;
      g.fillRect(-s * 0.4, -s * 0.06, s * 0.8, s * 0.12);
      return;
    }
    case 'library': {
      // open book
      g.moveTo(0, -s * 0.25);
      g.lineTo(-s * 0.6, -s * 0.4);
      g.lineTo(-s * 0.6, s * 0.35);
      g.lineTo(0, s * 0.5);
      g.lineTo(s * 0.6, s * 0.35);
      g.lineTo(s * 0.6, -s * 0.4);
      g.closePath();
      g.fill();
      g.beginPath();
      g.strokeStyle = PAPER;
      g.moveTo(0, -s * 0.2);
      g.lineTo(0, s * 0.42);
      g.stroke();
      return;
    }
    case 'stadium': {
      // double oval
      g.ellipse(0, 0, s * 0.7, s * 0.45, 0, 0, Math.PI * 2);
      g.lineWidth = lw * 1.4;
      g.stroke();
      g.beginPath();
      g.ellipse(0, 0, s * 0.36, s * 0.18, 0, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case 'skyscraper': {
      // tall obelisk
      g.moveTo(-s * 0.22, s * 0.55);
      g.lineTo(-s * 0.16, -s * 0.55);
      g.lineTo(0, -s * 0.8);
      g.lineTo(s * 0.16, -s * 0.55);
      g.lineTo(s * 0.22, s * 0.55);
      g.closePath();
      g.fill();
      return;
    }
  }
}

/**
 * Ink symbols in world space (the caller has applied the camera scale/translate): an owner-coloured
 * square per building, a map symbol per landmark, a dot per vehicle. Sizes are in screen px.
 */
export function drawSurveySymbols(
  g: Ctx,
  state: GameState,
  buildings: readonly Building[],
  r: TileRange,
  vehicleDir: Map<number, Dir>,
  alpha: number,
  zoom: number,
): void {
  const px = 1 / zoom; // one screen px in world units
  g.save();
  const a0 = g.globalAlpha;
  g.lineJoin = 'miter';
  // buildings: filled owner square with an ink frame, a little inset from the footprint
  for (const b of buildings) {
    const def = BUILDINGS[b.typeId];
    if (!def) continue;
    const inset = Math.min(6, TILE * 0.2);
    const x = b.pos.x * TILE + inset;
    const y = b.pos.y * TILE + inset;
    const w = def.size.w * TILE - inset * 2;
    const h = def.size.h * TILE - inset * 2;
    g.fillStyle = ownerColor(b.ownerId);
    g.globalAlpha = a0 * (b.status === 'halted' ? 0.4 : 0.9); // hand-tinted: a little paper shows through
    g.fillRect(x, y, w, h);
    g.globalAlpha = a0;
    g.strokeStyle = INK;
    g.lineWidth = 1.2 * px;
    g.strokeRect(x, y, w, h);
  }
  // landmarks: a paper disc behind each symbol so it reads over the town tint
  const s = 13 * px;
  for (const city of state.cities) {
    for (const l of city.landmarks) {
      if (l.pos.x + 1 < r.x0 - 1 || l.pos.x > r.x1 + 1 || l.pos.y + 1 < r.y0 - 1 || l.pos.y > r.y1 + 1) continue;
      g.save();
      g.translate(l.pos.x * TILE + LANDMARK_PX / 2, l.pos.y * TILE + LANDMARK_PX / 2);
      g.fillStyle = 'rgba(239,228,200,0.85)';
      g.beginPath();
      g.arc(0, 0, s * 0.95, 0, Math.PI * 2);
      g.fill();
      landmarkSymbol(g, l.id, s, 1 * px);
      g.restore();
    }
  }
  // vehicles: owner-coloured dots with an ink ring
  const rad = 2.6 * px;
  g.lineWidth = 1 * px;
  g.strokeStyle = INK;
  for (const id in state.vehicles) {
    const v = state.vehicles[id];
    if (v.pos.x < r.x0 - SPRITE_MARGIN || v.pos.x > r.x1 + SPRITE_MARGIN || v.pos.y < r.y0 - SPRITE_MARGIN || v.pos.y > r.y1 + SPRITE_MARGIN) continue;
    const p = vehiclePose(vehicleDir, v, alpha);
    g.fillStyle = ownerColor(v.ownerId);
    g.beginPath();
    g.arc(p.x, p.y, v.kind === 'train' ? rad * 1.35 : rad, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.restore();
}

/**
 * Night on the paper map: a paper sheet does not turn deep blue, so the survey gets only a faint
 * warm "lamplight" multiply (max 22% at full night) instead of the diorama's blue night grade.
 */
export function applySurveyNight(g: Ctx, w: number, h: number, light: number): void {
  const k = Math.min(1, Math.max(0, (1 - light) / 0.75));
  if (k <= 0) return;
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgba(150,118,80,${(0.22 * k).toFixed(3)})`;
  g.fillRect(0, 0, w, h);
  g.restore();
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: ScreenRect, b: ScreenRect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * City names in screen space at `alpha`: italic serif, sized by population, centred on the city
 * with a paper halo. Bigger cities claim space first; a label that would overlap a bigger one or
 * any `avoid` rect (HUD bar, toolbar, ticker) is skipped.
 */
export function drawCityLabels(g: Ctx, state: GameState, cam: Camera, alpha: number, avoid: readonly ScreenRect[]): void {
  if (alpha <= 0) return;
  const cities = [...state.cities].sort((a, b) => b.population - a.population || a.id - b.id);
  const placed: ScreenRect[] = [];
  g.save();
  g.globalAlpha = alpha;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (const c of cities) {
    const sx = ((c.center.x + 0.5) * TILE - cam.x) * cam.zoom;
    const sy = ((c.center.y + 0.5) * TILE - cam.y) * cam.zoom;
    if (sx < -200 || sy < -50 || sx > cam.viewW + 200 || sy > cam.viewH + 50) continue;
    g.font = cityLabelFont(c.population);
    const size = parseInt(/(\d+)px/.exec(g.font)?.[1] ?? '12', 10);
    const text = c.population >= 20000 ? c.name.toUpperCase() : c.name;
    const w = g.measureText(text).width + 8;
    const box = { x: sx - w / 2, y: sy - size * 0.7, w, h: size * 1.4 };
    if (avoid.some((a) => overlaps(a, box)) || placed.some((p) => overlaps(p, box))) continue;
    placed.push(box);
    g.strokeStyle = 'rgba(239,228,200,0.9)';
    g.lineWidth = Math.max(3, size * 0.28);
    g.strokeText(text, sx, sy);
    g.fillStyle = '#2e2418';
    g.fillText(text, sx, sy);
  }
  g.restore();
}

/** Screen rects of the HUD chrome that labels must not cover (empty outside a browser). */
export function hudRects(): ScreenRect[] {
  if (typeof document === 'undefined') return [];
  const out: ScreenRect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.hud-bar, .toolbar, .hud-ticker')) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) out.push({ x: b.left, y: b.top, w: b.width, h: b.height });
  }
  return out;
}
