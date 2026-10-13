import type { Overlay } from './overlays';
import { TILE } from './camera';
import type { Camera } from './constants';
import type { GameState } from '../sim/types';
import { FACTIONS, FACTION_IDS, factionName, type FactionId } from '../data/factions';

/** What the overlay paints: each town's mayor faction, or one faction's opinion of the player. */
export type FactionMode = 'mayor' | FactionId;

const LOW = [0xb0, 0x3a, 0x2e] as const;
const MID = [0x9a, 0x91, 0x84] as const;
const HIGH = [0x3f, 0x8f, 0x5a] as const;
const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/** Red (0) through grey (50) to green (100), interpolated linearly in RGB. */
export function opinionColor(op: number): string {
  const v = Math.max(0, Math.min(100, op));
  const [a, b, t] = v <= 50 ? [LOW, MID, v / 50] : [MID, HIGH, (v - 50) / 50];
  return `#${[0, 1, 2].map((i) => hex2(Math.round(a[i] + (b[i] - a[i]) * t))).join('')}`;
}

const MAYOR_ALPHA = 0.3;
const OPINION_ALPHA = 0.4;
const monthIndex = (s: GameState): number => s.date.year * 12 + (s.date.month - 1);

let mode: FactionMode = 'mayor';
/** disc fill per city id, valid for one (month, mode); cleared when either changes */
const fills = new Map<number, string>();
let fillsStamp = '';

export function getFactionMode(): FactionMode {
  return mode;
}

export function setFactionMode(m: FactionMode): void {
  mode = m;
}

/** Items for the HUD selector, in display order. */
export function factionModes(year: number): { value: FactionMode; label: string }[] {
  return [
    { value: 'mayor', label: 'Mayors' },
    ...FACTION_IDS.map((f) => ({ value: f as FactionMode, label: factionName(f, year) })),
  ];
}

/** Screen y of the top edge of the bottom chrome (toolbar, ticker), or the view bottom outside a browser. */
function chromeTop(viewH: number): number {
  let top = viewH;
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll<HTMLElement>('.toolbar, .hud-ticker')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && b.top < top) top = b.top;
    }
  }
  return top;
}

function drawLegend(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
  const year = state.date.year;
  const rows = mode === 'mayor' ? FACTION_IDS.length : 1;
  const rowH = 18;
  const w = 168;
  const h = rows * rowH + (mode === 'mayor' ? 26 : 32);
  const x = 12;
  const y = chromeTop(cam.viewH) - h - 10;
  ctx.fillStyle = 'rgba(239,228,200,0.92)';
  ctx.strokeStyle = '#7a5a2a';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = 'italic 12px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2e2418';
  ctx.fillText(mode === 'mayor' ? 'Mayors by faction' : `${factionName(mode, year)} opinion`, x + 8, y + 12);
  if (mode === 'mayor') {
    FACTION_IDS.forEach((f, i) => {
      const cy = y + 26 + i * rowH + rowH / 2 - 2;
      ctx.fillStyle = FACTIONS[f].color;
      ctx.fillRect(x + 8, cy - 6, 14, 12);
      ctx.fillStyle = '#2e2418';
      ctx.fillText(factionName(f, year), x + 30, cy);
    });
    return;
  }
  const bx = x + 12;
  const bw = w - 24;
  const by = y + 22;
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, opinionColor(0));
  grad.addColorStop(0.5, opinionColor(50));
  grad.addColorStop(1, opinionColor(100));
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw, 10);
  ctx.fillStyle = '#2e2418';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0', bx, by + 13);
  ctx.textAlign = 'center';
  ctx.fillText('50', bx + bw / 2, by + 13);
  ctx.textAlign = 'right';
  ctx.fillText('100', bx + bw, by + 13);
}

/** Tints each town's urban disc by its mayor's faction or by one faction's opinion, with a legend. */
export const factionOverlay: Overlay = {
  id: 'factions',
  enabled: false,
  draw(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
    if (!factionOverlay.enabled) return;
    const stamp = `${monthIndex(state)}|${mode}`;
    if (stamp !== fillsStamp) {
      fills.clear();
      fillsStamp = stamp;
    }
    drawLegend(ctx, state, cam);
    ctx.globalAlpha = mode === 'mayor' ? MAYOR_ALPHA : OPINION_ALPHA;
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    for (const c of state.cities) {
      let fill = fills.get(c.id);
      if (fill === undefined) {
        fill = mode === 'mayor' ? FACTIONS[c.politics.mayor.faction].color : opinionColor(c.opinion[mode]);
        fills.set(c.id, fill);
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc((c.center.x + 0.5) * TILE, (c.center.y + 0.5) * TILE, c.urbanRadius * TILE, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

// dev-only hook: `?overlay=factions` or `?overlay=factions:<factionId>` starts with the overlay on
try {
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const p = new URLSearchParams(location.search).get('overlay');
    if (p !== null && (p === 'factions' || p.startsWith('factions:'))) {
      factionOverlay.enabled = true;
      const f = p.slice('factions:'.length) as FactionId;
      if (p.startsWith('factions:') && FACTION_IDS.includes(f)) mode = f;
    }
  }
} catch {
  /* no location (tests) */
}
