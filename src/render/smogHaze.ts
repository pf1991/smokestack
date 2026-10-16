/**
 * Diorama smog haze: soft brown-grey veils over polluted ground, drawn above buildings, vehicles
 * and smoke and below the overlays, the atmosphere grade (so night darkens it) and the night lights.
 *
 * Per chunk the haze is rebuilt at most once per game day: the tile pollution field is sampled
 * every half tile, broken into blobs by two octaves of seeded value noise, written into a tiny
 * ImageData, scaled up to quarter resolution with smoothing and a blur (on a padded scratch
 * surface, so chunk seams match), then upscaled once more to a half-resolution display surface.
 * Only chunks in view are rebuilt, at most REBUILDS_PER_FRAME per frame; stale chunks keep drawing
 * yesterday's haze until their turn. Display surfaces are pooled and reused.
 *
 * Drift is purely cosmetic: the haze sways along the wind with a real-time phase.
 */
import { POLLUTION_CAP } from '../sim/pollution';
import type { GameState } from '../sim/types';
import { TILE, visibleTileRange } from './camera';
import { CHUNK, hash } from './chunk';
import type { Camera } from './constants';

/** Haze opacity for a tile pollution value: a gentle curve so faint smog stays faint. */
export function hazeAlpha(pollution: number): number {
  const k = Math.max(0, pollution) / POLLUTION_CAP;
  return Math.min(0.45, k ** 0.7 * 0.6);
}

/** Above this share of the cap the haze thickens toward HEAVY_MAX; below it, it is hazeAlpha × noise. */
const HEAVY_FROM = 0.3;
const HEAVY_SPAN = 0.4;
const HEAVY_MAX = 0.68;

/**
 * Baked haze opacity at pollution p with blob noise n in [0, 1]. Faint smog (under 30% of the cap)
 * is hazeAlpha broken into clumps and gaps. A heavy district (≈40% of the cap and up) closes the
 * gaps and thickens past hazeAlpha's 0.45 ceiling, so it reads as clearly hazy, never opaque.
 */
export function hazeDensity(p: number, n: number): number {
  const t = (Math.max(0, p) / POLLUTION_CAP - HEAVY_FROM) / HEAVY_SPAN;
  const heavy = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const clumps = (0.5 + 1.1 * n) * (1 - heavy) + (0.85 + 0.5 * n) * heavy;
  return Math.min(HEAVY_MAX, hazeAlpha(p) * clumps * (1 + 0.45 * heavy));
}

export type HazeSurface = { canvas: CanvasImageSource & { width: number; height: number }; g: CanvasRenderingContext2D };

/** The haze is baked (blurred) at 1/QUARTER of world resolution... */
const QUARTER = 4;
/** ...then upscaled once, with smoothing, to a display surface at 1/HALF resolution. */
const HALF = 2;
/** Field samples per tile side. */
const SPT = 2;
/** Tiles of neighbouring chunks sampled around each chunk so blobs and blur cross seams. */
const MARGIN = 3;
const CHUNK_PX = CHUNK * TILE;
/** Baked (blurred) haze side, quarter resolution. */
const BAKE = CHUNK_PX / QUARTER;
/**
 * Display surface side. Each frame it is drawn WITHOUT smoothing: a bilinear upscale of every
 * haze chunk costs about a fifth of a software-rendered frame, a nearest-neighbour one almost
 * nothing, and the haze is smooth enough that its 2-world-px cells never show.
 */
const SURF = CHUNK_PX / HALF;
const FIELD = (CHUNK + MARGIN * 2) * SPT;
const SCRATCH = ((CHUNK + MARGIN * 2) * TILE) / QUARTER;
const PAD_PX = (MARGIN * TILE) / QUARTER;
const BLUR_PX = 5;
/** Below this the baked alpha byte is zero: a chunk with nothing above it is "clean". */
const MIN_BYTE = 3;
/** Drift: the haze sways DRIFT_TILES/2 either way along the wind, one cycle every DRIFT_MS of real time. */
const DRIFT_MS = 11000;
const DRIFT_TILES = 1;
/** Surfaces kept for chunks out of view before the least recently drawn is recycled. */
const SURFACE_CAP = 64;

interface HazeChunk {
  day: number;
  surf: HazeSurface | null;
  lastUsed: number;
}

const defaultSurface = (w: number, h: number): HazeSurface | null => {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  } else return null;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  return g ? { canvas: canvas as HazeSurface['canvas'], g } : null;
};

const dayIndex = (s: GameState): number => (s.date.year * 12 + s.date.month - 1) * 30 + s.date.day - 1;
const smooth = (t: number): number => t * t * (3 - 2 * t);

export class SmogHaze {
  static readonly REBUILDS_PER_FRAME = 2;
  /** chunk rebuilds so far (tests and profiling) */
  rebuilds = 0;
  private chunks = new Map<number, HazeChunk>();
  private pool: HazeSurface[] = [];
  private live = 0;
  private field: HazeSurface | null = null;
  private scratch: HazeSurface | null = null;
  private image: ImageData | null = null;
  private lastMap: object | null = null;
  private frame = 0;
  /** chunks drawn this frame and their keys, reused every frame */
  private readonly visible: HazeChunk[] = [];
  private readonly keys: number[] = [];

  constructor(private readonly makeSurface: (w: number, h: number) => HazeSurface | null = defaultSurface) {}

  /** Draws the haze over the diorama at `blend` (0 survey .. 1 diorama); ctx is in screen space. */
  draw(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, blend: number, nowMs: number): void {
    if (blend <= 0) return;
    if (state.map !== this.lastMap) {
      this.reset();
      this.lastMap = state.map;
    }
    this.frame++;
    const { map } = state;
    const r = visibleTileRange(cam, map);
    if (r.x1 < r.x0 || r.y1 < r.y0) return;
    const cols = Math.ceil(map.width / CHUNK);
    const today = dayIndex(state);
    // drift reaches DRIFT_TILES/2 either side, so chunks just outside the view may slide into it
    const reach = Math.ceil(DRIFT_TILES);
    const cx0 = Math.floor(Math.max(0, r.x0 - reach) / CHUNK);
    const cy0 = Math.floor(Math.max(0, r.y0 - reach) / CHUNK);
    const cx1 = Math.floor(Math.min(map.width - 1, r.x1 + reach) / CHUNK);
    const cy1 = Math.floor(Math.min(map.height - 1, r.y1 + reach) / CHUNK);
    let budget = SmogHaze.REBUILDS_PER_FRAME;
    const visible = this.visible;
    const keys = this.keys;
    visible.length = 0;
    keys.length = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * cols + cx;
        let c = this.chunks.get(key);
        if (!c) {
          c = { day: -1, surf: null, lastUsed: 0 };
          this.chunks.set(key, c);
        }
        c.lastUsed = this.frame;
        if (c.day !== today && budget > 0) {
          budget--;
          this.rebuild(c, state, cx, cy, today);
        }
        if (c.surf) {
          visible.push(c);
          keys.push(key);
        }
      }
    }
    if (visible.length === 0) return;

    const { windX, windY } = state.weather;
    const z = cam.zoom;
    // a slow sway downwind and back (one layer: a two-layer flow-map cross-fade cost ~20% fps)
    const shift = Math.sin(((nowMs % DRIFT_MS) / DRIFT_MS) * Math.PI * 2) * 0.5 * DRIFT_TILES * TILE;
    const ox = windX * shift;
    const oy = windY * shift;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = blend;
    for (let i = 0; i < visible.length; i++) {
      const surf = visible[i].surf!;
      const cx = keys[i] % cols;
      const cy = (keys[i] - cx) / cols;
      const sx = (cx * CHUNK_PX + ox - cam.x) * z;
      const sy = (cy * CHUNK_PX + oy - cam.y) * z;
      // whole-pixel edges so neighbouring chunks meet without hairline seams
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.floor(sx + CHUNK_PX * z);
      const y1 = Math.floor(sy + CHUNK_PX * z);
      ctx.drawImage(surf.canvas, 0, 0, SURF, SURF, x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  /** Forgets every chunk (a new map); surfaces go back to the pool. */
  reset(): void {
    for (const c of this.chunks.values()) if (c.surf) this.release(c);
    this.chunks.clear();
  }

  private release(c: HazeChunk): void {
    if (c.surf) this.pool.push(c.surf);
    c.surf = null;
    this.live--;
  }

  private acquire(): HazeSurface | null {
    if (this.live >= SURFACE_CAP) {
      // recycle the surface drawn longest ago (never one in view: those were marked this frame)
      let worst: HazeChunk | null = null;
      for (const c of this.chunks.values()) if (c.surf && c.lastUsed < this.frame && (!worst || c.lastUsed < worst.lastUsed)) worst = c;
      if (worst) {
        this.release(worst);
        worst.day = -1;
      }
    }
    const s = this.pool.pop() ?? this.makeSurface(SURF, SURF);
    if (s) this.live++;
    return s;
  }

  private rebuild(c: HazeChunk, state: GameState, cx: number, cy: number, today: number): void {
    this.rebuilds++;
    c.day = today;
    if (!this.field) this.field = this.makeSurface(FIELD, FIELD);
    if (!this.scratch) this.scratch = this.makeSurface(SCRATCH, SCRATCH);
    const field = this.field;
    const scratch = this.scratch;
    if (!field || !scratch) return;
    if (!this.image) this.image = field.g.createImageData(FIELD, FIELD);
    const img = this.image;
    if (!this.paintField(img.data, state, cx, cy)) {
      if (c.surf) this.release(c);
      return;
    }
    const surf = c.surf ?? (c.surf = this.acquire());
    if (!surf) return;
    field.g.putImageData(img, 0, 0);
    const sg = scratch.g;
    sg.save();
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, SCRATCH, SCRATCH);
    sg.imageSmoothingEnabled = true;
    sg.imageSmoothingQuality = 'high';
    sg.filter = `blur(${BLUR_PX}px)`;
    sg.drawImage(field.canvas, 0, 0, FIELD, FIELD, 0, 0, SCRATCH, SCRATCH);
    sg.restore();
    const g = surf.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SURF, SURF);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(scratch.canvas, PAD_PX, PAD_PX, BAKE, BAKE, 0, 0, SURF, SURF);
  }

  /**
   * Fills `data` (FIELD × FIELD RGBA) with the chunk's haze: colour and alpha from the bilinear
   * pollution field, broken into blobs by seeded value noise. Returns false when it is all clear.
   */
  private paintField(data: Uint8ClampedArray, state: GameState, cx: number, cy: number): boolean {
    const { map, seed } = state;
    const W = map.width;
    const H = map.height;
    const tiles = map.tiles;
    const tx0 = cx * CHUNK - MARGIN;
    const ty0 = cy * CHUNK - MARGIN;
    const pAt = (x: number, y: number): number => {
      const xi = x < 0 ? 0 : x >= W ? W - 1 : x;
      const yi = y < 0 ? 0 : y >= H ? H - 1 : y;
      return tiles[yi * W + xi].pollution;
    };
    let any = false;
    for (let j = 0; j < FIELD; j++) {
      // sample centre in tile units; tile centres sit at i + 0.5
      const v = ty0 + (j + 0.5) / SPT - 0.5;
      const vy = Math.floor(v);
      const fy = v - vy;
      for (let i = 0; i < FIELD; i++) {
        const u = tx0 + (i + 0.5) / SPT - 0.5;
        const ux = Math.floor(u);
        const fx = u - ux;
        const p = (pAt(ux, vy) * (1 - fx) + pAt(ux + 1, vy) * fx) * (1 - fy) + (pAt(ux, vy + 1) * (1 - fx) + pAt(ux + 1, vy + 1) * fx) * fy;
        const o = (j * FIELD + i) * 4;
        if (p <= 0) {
          data[o + 3] = 0;
          continue;
        }
        // billows a few tiles across with finer curls inside: dense clumps and thin gaps
        const n = 0.6 * valueNoise(u, v, 3.5, seed, 71) + 0.4 * valueNoise(u, v, 1.5, seed, 73);
        const byte = Math.min(255, Math.round(hazeDensity(p, n) * 255));
        if (byte < MIN_BYTE) {
          data[o + 3] = 0;
          continue;
        }
        any = true;
        // brown-grey: thin haze a pale ash, thick smog an ochre brown
        const k = Math.min(1, p / POLLUTION_CAP);
        data[o] = 170 - 40 * k;
        data[o + 1] = 162 - 58 * k;
        data[o + 2] = 148 - 84 * k;
        data[o + 3] = byte;
      }
    }
    return any;
  }
}

/** Smooth value noise in [0, 1] on a lattice of `cell` tiles, seeded per world position (no Math.random). */
function valueNoise(u: number, v: number, cell: number, seed: number, salt: number): number {
  const x = u / cell;
  const y = v / cell;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const sx = smooth(x - xi);
  const sy = smooth(y - yi);
  const h = (a: number, b: number): number => hash(a, b, seed, salt) / 4294967296;
  const top = h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx;
  const bot = h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx;
  return top * (1 - sy) + bot * sy;
}
