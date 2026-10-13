import type { Overlay } from './overlays';
import { TILE, visibleTileRange } from './camera';
import type { Camera } from './constants';
import type { GameState } from '../sim/types';
import { POLLUTION_CAP } from '../sim/pollution';
import { ChromeTop, factionLegendHeight } from './factionOverlay';

const MAX_ALPHA = 0.7;

/** Brown (low) to yellow (high) smog colour for pollution 0..POLLUTION_CAP. */
function smogColor(p: number, alpha: number): string {
  const k = Math.min(1, p / POLLUTION_CAP);
  const r = Math.round(110 + 130 * k);
  const g = Math.round(60 + 140 * k);
  const b = Math.round(20 + 10 * k);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** The heat map's fill for pollution p (the legend ramp uses the same mapping). */
const heatFill = (p: number): string => smogColor(p, Math.min(1, p / POLLUTION_CAP) * MAX_ALPHA + 0.04);

// ---------------------------------------------------------------- legend (faction overlay style)

const LEGEND_W = 168;
const LEGEND_H = 50;
const RAMP_LABELS = ['Clean', 'Hazy', 'Choking'] as const;

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
export function setSmogLegendSurfaceFactory(f: (w: number, h: number) => LegendSurface | null): void {
  makeSurface = f;
}

let renders = 0;
/** How many times the legend has been painted (tests). */
export function smogLegendRenders(): number {
  return renders;
}

let legendSurface: LegendSurface | null = null;
let legendDpr = 0;
const chrome = new ChromeTop();

/** Test hook: forget the cached legend and chrome measurement. */
export function resetSmogLegend(): void {
  legendSurface = null;
  legendDpr = 0;
  chrome.reset();
}

function paintLegend(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(239,228,200,0.92)';
  ctx.strokeStyle = '#7a5a2a';
  ctx.lineWidth = 1;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.font = 'italic 12px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2e2418';
  ctx.fillText('Smog', 8, 12);
  const bx = 12;
  const bw = w - 24;
  const by = 22;
  // the ramp over the legend's paper, exactly as the heat map tints the ground
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  for (const k of [0, 0.25, 0.5, 0.75, 1]) grad.addColorStop(k, heatFill(k * POLLUTION_CAP));
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw, 10);
  ctx.strokeStyle = 'rgba(122,90,42,0.6)';
  ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, 11);
  ctx.fillStyle = '#2e2418';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(RAMP_LABELS[0], bx, by + 13);
  ctx.textAlign = 'center';
  ctx.fillText(RAMP_LABELS[1], bx + bw / 2, by + 13);
  ctx.textAlign = 'right';
  ctx.fillText(RAMP_LABELS[2], bx + bw, by + 13);
}

/** Blits the legend from its offscreen copy (painted once per device pixel ratio). */
function drawLegend(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
  const chromeTopY = chrome.get(cam.viewW, cam.viewH, state.date.year * 12 + state.date.month);
  const dpr = typeof window === 'undefined' ? 1 : Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  if (dpr !== legendDpr) {
    legendDpr = dpr;
    legendSurface = makeSurface(Math.ceil(LEGEND_W * dpr), Math.ceil(LEGEND_H * dpr));
    if (legendSurface) {
      legendSurface.g.scale(dpr, dpr);
      paintLegend(legendSurface.g, LEGEND_W, LEGEND_H);
      renders++;
    }
  }
  // stacked above the faction legend when both overlays are on
  const below = factionLegendHeight();
  const y = chromeTopY - LEGEND_H - 10 - (below > 0 ? below + 8 : 0);
  if (legendSurface) {
    ctx.drawImage(legendSurface.canvas, 0, 0, LEGEND_W * legendDpr, LEGEND_H * legendDpr, 12, y, LEGEND_W, LEGEND_H);
  } else {
    // no offscreen canvas available: paint straight onto the map
    ctx.save();
    ctx.translate(12, y);
    paintLegend(ctx, LEGEND_W, LEGEND_H);
    ctx.restore();
  }
}

/** Translucent brown-to-yellow heat map over polluted tiles in view, with a Clean / Hazy / Choking legend. */
export const pollutionOverlay: Overlay = {
  id: 'pollution',
  enabled: false,
  draw(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
    const { map } = state;
    const r = visibleTileRange(cam, map);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const p = map.tiles[y * map.width + x].pollution;
        if (p < 0.5) continue;
        ctx.fillStyle = heatFill(p);
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  },
  drawLegend,
};

// dev-only hook: `?smog=1` starts with the overlay on
try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('smog') === '1') pollutionOverlay.enabled = true;
} catch {
  /* no location (tests) */
}
