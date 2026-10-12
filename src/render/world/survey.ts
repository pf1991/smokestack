/**
 * Survey-regime overlays for the world renderer: the per-frame ink symbols drawn over the cached
 * survey chunks (owner-coloured building squares, vehicle dots, landmark map symbols), the
 * paper-friendly night grade, and the italic city names on the overlay canvas.
 */
import { BUILDINGS } from '../../data/buildings';
import type { LandmarkId } from '../../data/landmarks';
import type { Building, City, GameState } from '../../sim/types';
import { TILE, type Camera } from '../camera';
import { LANDMARK_PX } from '../landmarks';
import { ownerColor } from '../sprites';
import { INK, PAPER, cityLabelFont, cityLabelSize } from '../survey';
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

interface CityLabel {
  x: number;
  y: number;
  text: string;
  font: string;
  size: number;
  /** measured text width, filled on first draw */
  width: number;
}

/**
 * Per-renderer cache of city labels, biggest city first. `invalidate()` it when populations or
 * names may have changed (month end, a new game); it rebuilds on the next draw.
 */
export class CityLabelCache {
  private cities: readonly City[] | null = null;
  labels: CityLabel[] = [];
  private placed: ScreenRect[] = [];

  invalidate(): void {
    this.cities = null;
  }

  /** Labels for `cities`, rebuilt only after invalidate() or when the city array changes. */
  get(cities: readonly City[]): CityLabel[] {
    if (this.cities !== cities || this.labels.length !== cities.length) {
      this.cities = cities;
      this.labels = [...cities]
        .sort((a, b) => b.population - a.population || a.id - b.id)
        .map((c) => ({
          x: (c.center.x + 0.5) * TILE,
          y: (c.center.y + 0.5) * TILE,
          text: c.population >= 20000 ? c.name.toUpperCase() : c.name,
          font: cityLabelFont(c.population),
          size: cityLabelSize(c.population),
          width: -1,
        }));
    }
    return this.labels;
  }

  /** Scratch list of label boxes placed this frame (reused). */
  scratch(): ScreenRect[] {
    this.placed.length = 0;
    return this.placed;
  }
}

/**
 * City names in screen space at `alpha`: italic serif, sized by population, centred on the city
 * with a paper halo. Bigger cities claim space first; a label that would overlap a bigger one or
 * any `avoid` rect (HUD bar, toolbar, ticker) is skipped.
 */
export function drawCityLabels(g: Ctx, state: GameState, cam: Camera, alpha: number, avoid: readonly ScreenRect[], cache: CityLabelCache): void {
  if (alpha <= 0) return;
  const labels = cache.get(state.cities);
  const placed = cache.scratch();
  g.save();
  g.globalAlpha = alpha;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (const l of labels) {
    const sx = (l.x - cam.x) * cam.zoom;
    const sy = (l.y - cam.y) * cam.zoom;
    if (sx < -200 || sy < -50 || sx > cam.viewW + 200 || sy > cam.viewH + 50) continue;
    g.font = l.font;
    if (l.width < 0) l.width = g.measureText(l.text).width + 8;
    const box = { x: sx - l.width / 2, y: sy - l.size * 0.7, w: l.width, h: l.size * 1.4 };
    if (avoid.some((a) => overlaps(a, box)) || placed.some((p) => overlaps(p, box))) continue;
    placed.push(box);
    g.strokeStyle = 'rgba(239,228,200,0.9)';
    g.lineWidth = Math.max(3, l.size * 0.28);
    g.strokeText(l.text, sx, sy);
    g.fillStyle = '#2e2418';
    g.fillText(l.text, sx, sy);
  }
  g.restore();
}

/**
 * Watches each city's urban disc (centre and radius) so month end only dirties the survey chunks
 * whose town tint can actually have changed. `update` calls `dirty` with the tile bounding box of
 * every disc that appeared, vanished or changed (covering both the old and the new extent).
 */
export class UrbanWatch {
  private discs = new Map<number, { x: number; y: number; r: number }>();

  constructor(cities: readonly City[]) {
    this.reset(cities);
  }

  reset(cities: readonly City[]): void {
    this.discs.clear();
    for (const c of cities) this.discs.set(c.id, { x: c.center.x, y: c.center.y, r: c.urbanRadius });
  }

  update(cities: readonly City[], dirty: (x0: number, y0: number, x1: number, y1: number) => void): void {
    const seen = new Set<number>();
    const box = (d: { x: number; y: number; r: number }) => dirty(d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r);
    for (const c of cities) {
      seen.add(c.id);
      const old = this.discs.get(c.id);
      const now = { x: c.center.x, y: c.center.y, r: c.urbanRadius };
      if (old && old.x === now.x && old.y === now.y && old.r === now.r) continue;
      if (old) box(old);
      box(now);
      this.discs.set(c.id, now);
    }
    for (const [id, d] of this.discs) {
      if (seen.has(id)) continue;
      box(d);
      this.discs.delete(id);
    }
  }
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
