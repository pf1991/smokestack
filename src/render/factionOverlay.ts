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

/** Test hook: forget cached fills and legend. */
export function resetFactionCaches(): void {
  fills.clear();
  fillsStamp = '';
  legendStamp = '';
  chromeStamp = '';
  lastMap = null;
}

/** Opinion deviations from 50 are stretched this much so a typical 35..65 spread fills the ramp. */
const OPINION_GAIN = 3;
const stretched = (op: number): string => opinionColor(Math.max(0, Math.min(100, 50 + (op - 50) * OPINION_GAIN)));
/** The legend's end labels: the opinions that reach the ends of the stretched ramp. */
const RAMP_LABELS = ['35', '50', '65'] as const;

const LEGEND_W = 168;
const ROW_H = 18;

/** Screen y of the top edge of the bottom chrome (toolbar, ticker), or null while it is not in the page. */
export function measureChromeTop(viewH: number): number | null {
  if (typeof document === 'undefined') return null;
  let top = viewH;
  let found = false;
  for (const el of document.querySelectorAll<HTMLElement>('.toolbar, .hud-ticker')) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) {
      found = true;
      if (b.top < top) top = b.top;
    }
  }
  return found ? top : null;
}

type LegendSurface = { canvas: CanvasImageSource & { width: number; height: number }; g: CanvasRenderingContext2D };
let makeSurface = (w: number, h: number): LegendSurface | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  return g ? { canvas, g } : null;
};

/** Test hook: replaces how the offscreen legend surface is made. */
export function setLegendSurfaceFactory(f: (w: number, h: number) => LegendSurface | null): void {
  makeSurface = f;
}

/** How many times the legend has been painted (tests). */
export let legendRenders = 0;

function paintLegend(ctx: CanvasRenderingContext2D, year: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(239,228,200,0.92)';
  ctx.strokeStyle = '#7a5a2a';
  ctx.lineWidth = 1;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.font = 'italic 12px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2e2418';
  ctx.fillText(mode === 'mayor' ? 'Mayors by faction' : `${factionName(mode, year)} opinion`, 8, 12);
  if (mode === 'mayor') {
    FACTION_IDS.forEach((f, i) => {
      const cy = 26 + i * ROW_H + ROW_H / 2 - 2;
      ctx.fillStyle = FACTIONS[f].color;
      ctx.fillRect(8, cy - 6, 14, 12);
      ctx.fillStyle = '#2e2418';
      ctx.fillText(factionName(f, year), 30, cy);
    });
    return;
  }
  const bx = 12;
  const bw = w - 24;
  const by = 22;
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, opinionColor(0));
  grad.addColorStop(0.5, opinionColor(50));
  grad.addColorStop(1, opinionColor(100));
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw, 10);
  ctx.fillStyle = '#2e2418';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(RAMP_LABELS[0], bx, by + 13);
  ctx.textAlign = 'center';
  ctx.fillText(RAMP_LABELS[1], bx + bw / 2, by + 13);
  ctx.textAlign = 'right';
  ctx.fillText(RAMP_LABELS[2], bx + bw, by + 13);
}

/** Height of the faction legend while the overlay is on (0 when off), so other legends stack above it. */
export function factionLegendHeight(): number {
  if (!factionOverlay.enabled) return 0;
  return mode === 'mayor' ? FACTION_IDS.length * ROW_H + 26 : ROW_H + 32;
}

let legendStamp = '';
let legendSurface: LegendSurface | null = null;
let legendH = 0;
let legendDpr = 1;
let chromeStamp = '';
let chromeTopY = 0;
let lastMap: object | null = null;

/** Draws the legend from its offscreen copy, repainting it only when mode, year or viewport change. */
function drawLegend(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, month: number): void {
  const year = state.date.year;
  const cs = `${cam.viewW}x${cam.viewH}|${month}`;
  if (cs !== chromeStamp) {
    const t = measureChromeTop(cam.viewH);
    chromeTopY = t ?? cam.viewH;
    if (t !== null) chromeStamp = cs;
  }
  const dpr = typeof window === 'undefined' ? 1 : Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const stamp = `${mode}|${year}|${dpr}`;
  if (stamp !== legendStamp) {
    legendStamp = stamp;
    legendH = mode === 'mayor' ? FACTION_IDS.length * ROW_H + 26 : ROW_H + 32;
    legendDpr = dpr;
    legendSurface = makeSurface(Math.ceil(LEGEND_W * dpr), Math.ceil(legendH * dpr));
    if (legendSurface) {
      legendSurface.g.scale(dpr, dpr);
      paintLegend(legendSurface.g, year, LEGEND_W, legendH);
      legendRenders++;
    }
  }
  const y = chromeTopY - legendH - 10;
  if (legendSurface) {
    ctx.drawImage(legendSurface.canvas, 0, 0, LEGEND_W * legendDpr, legendH * legendDpr, 12, y, LEGEND_W, legendH);
  } else {
    // no offscreen canvas available: paint straight onto the map
    ctx.save();
    ctx.translate(12, y);
    paintLegend(ctx, year, LEGEND_W, legendH);
    ctx.restore();
  }
}

/** Tints each town's urban disc by its mayor's faction or by one faction's opinion, with a legend. */
export const factionOverlay: Overlay = {
  id: 'factions',
  enabled: false,
  draw(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
    if (!factionOverlay.enabled) return;
    const month = monthIndex(state);
    const stamp = `${month}|${mode}`;
    // a new game (new map object) or a new month or mode invalidates every cached fill
    if (stamp !== fillsStamp || state.map !== lastMap) {
      fills.clear();
      fillsStamp = stamp;
      lastMap = state.map;
    }
    drawLegend(ctx, state, cam, month);
    ctx.globalAlpha = mode === 'mayor' ? MAYOR_ALPHA : OPINION_ALPHA;
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    for (const c of state.cities) {
      let fill = fills.get(c.id);
      if (fill === undefined) {
        fill = mode === 'mayor' ? FACTIONS[c.politics.mayor.faction].color : stretched(c.opinion[mode]);
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
if (import.meta.env.DEV && typeof location !== 'undefined') {
  const p = new URLSearchParams(location.search).get('overlay');
  if (p === 'factions' || p?.startsWith('factions:')) {
    factionOverlay.enabled = true;
    const f = p.slice('factions:'.length) as FactionId;
    if (FACTION_IDS.includes(f)) mode = f;
  }
}
