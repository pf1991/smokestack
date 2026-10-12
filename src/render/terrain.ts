import { TILE, type Camera, visibleTileRange } from './camera';
import type { GameMap, Terrain, Tile } from '../sim/types';
import { CHUNK, hash } from './chunk';
import { PAPER, SURVEY_TILE_PX, paintSurveyChunk } from './survey';

export { CHUNK, hash };

const CHUNK_PX = CHUNK * TILE;
const MAX_RENDERS_PER_FRAME = 4;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;

/** hash scaled to [0, 1) */
function h01(x: number, y: number, seed: number, salt = 0): number {
  return hash(x, y, seed, salt) / 4294967296;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

const BASE: Record<Terrain, [number, number, number]> = {
  water: [38, 98, 150],
  sand: [222, 201, 140],
  grass: [104, 156, 70],
  forest: [58, 110, 52],
  hills: [138, 148, 82],
  mountain: [92, 88, 86],
};

const PRIORITY: Record<Terrain, number> = { water: -1, sand: 0, grass: 1, forest: 2, hills: 3, mountain: 4 };

export function isWinter(month: number): boolean {
  return month === 12 || month === 1 || month === 2;
}

function makeSurface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

interface Chunk {
  /** 'diorama' surface: the painted terrain (null until first drawn) */
  surface: Surface | null;
  dirty: boolean;
  winter: boolean;
  oil: boolean;
  drawn: boolean;
  /** 'survey' surface: the engraved map (render/survey.ts), at `surveyPx` px per tile */
  survey: Surface | null;
  surveyDirty: boolean;
  surveyPx: number;
  /** drawSurvey frame this chunk's survey surface was last drawn (LRU) */
  surveyUsed: number;
}

export type ChunkKind = 'survey' | 'diorama';

/**
 * Survey surface px per tile for a zoom: 16 (native) up to zoom 0.75, 32 up to 1.1, then 48, which
 * is screen scale at the blend midpoint (1.5) so the cross-fade blits its survey layer unscaled.
 */
export function surveyTilePx(zoom: number): number {
  return zoom <= 0.75 ? SURVEY_TILE_PX : zoom <= 1.1 ? SURVEY_TILE_PX * 2 : SURVEY_TILE_PX * 3;
}

/** Minimum survey surface cap; raised per frame to 2 × visible chunks + 8 so the visible set fits. */
const MIN_SURVEY_CAP = 16;

export class TerrainRenderer {
  private chunks = new Map<number, Chunk>();
  private cols: number;
  private frame = 0;
  private surveyCount = 0;
  private surveyCap = MIN_SURVEY_CAP;

  constructor(
    private map: GameMap,
    private seed: number,
  ) {
    this.cols = Math.ceil(map.width / CHUNK);
  }

  /** Marks every cached chunk overlapping tiles [x0..x1] × [y0..y1] (clamped to the map) stale. */
  invalidateRect(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.floor(Math.max(0, x0) / CHUNK);
    const cy0 = Math.floor(Math.max(0, y0) / CHUNK);
    const cx1 = Math.floor(Math.min(this.map.width - 1, x1) / CHUNK);
    const cy1 = Math.floor(Math.min(this.map.height - 1, y1) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunks.get(cy * this.cols + cx);
        if (c) c.dirty = c.surveyDirty = true;
      }
    }
  }

  /** Marks both surface kinds stale over the bounding box of `tiles` plus a 1-tile margin. */
  invalidateAround(tiles: readonly { x: number; y: number }[]): void {
    if (tiles.length === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x);
      y1 = Math.max(y1, t.y);
    }
    this.invalidateRect(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  }

  /** Marks every cached chunk of `kind` stale (both kinds when omitted). */
  invalidateAll(kind?: ChunkKind): void {
    for (const c of this.chunks.values()) {
      if (kind !== 'survey') c.dirty = true;
      if (kind !== 'diorama') c.surveyDirty = true;
    }
  }

  invalidateTile(x: number, y: number): void {
    // Neighbouring tiles' edges / tree overhangs depend on this tile too.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;
        const c = this.chunks.get(Math.floor(ty / CHUNK) * this.cols + Math.floor(tx / CHUNK));
        if (c) c.dirty = c.surveyDirty = true;
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    timeMs: number,
    opts: { oilVisible: boolean; month: number },
  ): void {
    const winter = isWinter(opts.month);
    const r = visibleTileRange(cam, this.map);
    if (r.x1 < r.x0 || r.y1 < r.y0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = cam.zoom < 1;

    let budget = MAX_RENDERS_PER_FRAME;
    const cx0 = Math.floor(r.x0 / CHUNK);
    const cx1 = Math.floor(r.x1 / CHUNK);
    const cy0 = Math.floor(r.y0 / CHUNK);
    const cy1 = Math.floor(r.y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * this.cols + cx;
        let ch = this.chunks.get(key);
        const stale = !ch || ch.dirty || !ch.drawn || ch.winter !== winter || ch.oil !== opts.oilVisible;
        if (stale && budget > 0) {
          if (!ch) {
            ch = this.newChunk(key);
          }
          budget--;
          ch.surface ??= makeSurface(CHUNK_PX, CHUNK_PX);
          ch.winter = winter;
          ch.oil = opts.oilVisible;
          ch.dirty = false;
          ch.drawn = true;
          this.renderChunk(ch, cx, cy);
        }
        if (!ch || !ch.drawn) {
          // over budget and nothing cached yet: flat placeholder until a later frame
          const fx = Math.floor((cx * CHUNK_PX - cam.x) * cam.zoom);
          const fy = Math.floor((cy * CHUNK_PX - cam.y) * cam.zoom);
          ctx.fillStyle = winter ? '#dfe8ee' : '#68a046';
          ctx.fillRect(fx, fy, Math.ceil(CHUNK_PX * cam.zoom) + 1, Math.ceil(CHUNK_PX * cam.zoom) + 1);
          continue;
        }
        const sx = Math.floor((cx * CHUNK_PX - cam.x) * cam.zoom);
        const sy = Math.floor((cy * CHUNK_PX - cam.y) * cam.zoom);
        const ex = Math.floor(((cx + 1) * CHUNK_PX - cam.x) * cam.zoom);
        const ey = Math.floor(((cy + 1) * CHUNK_PX - cam.y) * cam.zoom);
        ctx.drawImage(ch.surface as CanvasImageSource, sx, sy, ex - sx, ey - sy);
      }
    }

    this.drawWaterShimmer(ctx, cam, timeMs, r);
    ctx.restore();
  }

  private newChunk(key: number): Chunk {
    const ch: Chunk = { surface: null, dirty: true, winter: false, oil: false, drawn: false, survey: null, surveyDirty: true, surveyPx: 0, surveyUsed: 0 };
    this.chunks.set(key, ch);
    return ch;
  }

  /**
   * Draws the survey-map surfaces of the visible chunks (render/survey.ts) at `alpha`, rendering at
   * most MAX_RENDERS_PER_FRAME stale ones per frame (stale ones keep showing until redrawn). Survey
   * surfaces are capped (least recently drawn evicted first) separately from the diorama ones.
   */
  drawSurvey(ctx: CanvasRenderingContext2D, cam: Camera, alpha: number): void {
    const r = visibleTileRange(cam, this.map);
    if (r.x1 < r.x0 || r.y1 < r.y0 || alpha <= 0) return;
    this.frame++;
    const z = cam.zoom;
    const tilePx = surveyTilePx(z);
    const cx0 = Math.floor(r.x0 / CHUNK);
    const cx1 = Math.floor(r.x1 / CHUNK);
    const cy0 = Math.floor(r.y0 / CHUNK);
    const cy1 = Math.floor(r.y1 / CHUNK);
    this.surveyCap = Math.max(MIN_SURVEY_CAP, 2 * (cx1 - cx0 + 1) * (cy1 - cy0 + 1) + 8);
    // the cap shrinks when zooming in: drop surplus surfaces (never ones drawn this frame)
    while (this.surveyCount > this.surveyCap && this.evictSurvey());
    ctx.save();
    ctx.globalAlpha = alpha;
    let budget = MAX_RENDERS_PER_FRAME;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * this.cols + cx;
        const ch = this.chunks.get(key) ?? this.newChunk(key);
        if ((ch.surveyDirty || ch.surveyPx !== tilePx) && budget > 0) {
          budget--;
          if (!ch.survey || ch.surveyPx !== tilePx) {
            if (!ch.survey) {
              if (this.surveyCount >= this.surveyCap) this.evictSurvey();
              this.surveyCount++;
            }
            ch.survey = makeSurface(CHUNK * tilePx, CHUNK * tilePx);
          }
          const g = (ch.survey as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null;
          if (g) paintSurveyChunk(g, this.map, cx, cy, this.seed, tilePx);
          ch.surveyPx = tilePx;
          ch.surveyDirty = false;
        }
        ch.surveyUsed = this.frame;
        // partial edge chunks: the surface holds only the tiles inside the map
        const w = Math.min(CHUNK, this.map.width - cx * CHUNK);
        const h = Math.min(CHUNK, this.map.height - cy * CHUNK);
        const sp = ch.surveyPx;
        if (ch.survey && sp === TILE * z) {
          // surface already at screen scale: an unscaled, unsmoothed blit (much cheaper in software)
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(ch.survey as CanvasImageSource, Math.round((cx * CHUNK_PX - cam.x) * z), Math.round((cy * CHUNK_PX - cam.y) * z));
          continue;
        }
        const sx = Math.floor((cx * CHUNK_PX - cam.x) * z);
        const sy = Math.floor((cy * CHUNK_PX - cam.y) * z);
        const ex = Math.floor(((cx * CHUNK + w) * TILE - cam.x) * z);
        const ey = Math.floor(((cy * CHUNK + h) * TILE - cam.y) * z);
        if (!ch.survey) {
          ctx.fillStyle = PAPER;
          ctx.fillRect(sx, sy, ex - sx, ey - sy);
          continue;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(ch.survey as CanvasImageSource, 0, 0, w * sp, h * sp, sx, sy, ex - sx, ey - sy);
      }
    }
    ctx.restore();
  }

  /** Drops the least recently drawn survey surface not drawn this frame (it re-renders on demand). */
  private evictSurvey(): boolean {
    let worst: Chunk | null = null;
    for (const c of this.chunks.values()) {
      if (!c.survey || c.surveyUsed >= this.frame) continue;
      if (!worst || c.surveyUsed < worst.surveyUsed) worst = c;
    }
    if (!worst) return false;
    worst.survey = null;
    worst.surveyPx = 0;
    worst.surveyDirty = true;
    this.surveyCount--;
    return true;
  }

  // ---------------------------------------------------------------- water

  private drawWaterShimmer(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    t: number,
    r: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const z = cam.zoom;
    ctx.lineWidth = Math.max(1, Math.round(z));
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        if (this.map.tiles[ty * this.map.width + tx].terrain !== 'water') continue;
        for (let i = 0; i < 2; i++) {
          const phase = h01(tx, ty, this.seed, 100 + i) * 6.283;
          const speed = 0.0004 + h01(tx, ty, this.seed, 110 + i) * 0.0004;
          const a = Math.sin(t * speed + phase); // -1..1
          const alpha = (a * 0.5 + 0.5) * 0.35;
          if (alpha < 0.06) continue;
          const lx = 4 + h01(tx, ty, this.seed, 120 + i) * 12 + a * 3;
          const ly = 6 + i * 14 + h01(tx, ty, this.seed, 130 + i) * 6;
          const len = 6 + h01(tx, ty, this.seed, 140 + i) * 8;
          const wx = (tx * TILE + lx - cam.x) * z;
          const wy = (ty * TILE + ly - cam.y) * z;
          ctx.strokeStyle = `rgba(210,235,255,${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(Math.round(wx), Math.round(wy));
          ctx.lineTo(Math.round(wx + len * z * 0.5), Math.round(wy - z));
          ctx.lineTo(Math.round(wx + len * z), Math.round(wy));
          ctx.stroke();
        }
      }
    }
  }

  // ---------------------------------------------------------------- chunks

  private tile(x: number, y: number): Tile | undefined {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return undefined;
    return this.map.tiles[y * this.map.width + x];
  }

  private terrainAt(x: number, y: number): Terrain | undefined {
    return this.tile(x, y)?.terrain;
  }

  private renderChunk(ch: Chunk, cx: number, cy: number): void {
    if (!ch.surface) return;
    const ctx = (ch.surface as HTMLCanvasElement).getContext('2d') as Ctx | null;
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
    const tx0 = cx * CHUNK;
    const ty0 = cy * CHUNK;
    const tx1 = Math.min(this.map.width, tx0 + CHUNK);
    const ty1 = Math.min(this.map.height, ty0 + CHUNK);

    // Pass 1: ground, edges, per-tile details.
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const tile = this.tile(tx, ty)!;
        ctx.save();
        ctx.translate((tx - tx0) * TILE, (ty - ty0) * TILE);
        this.drawGround(ctx, tx, ty, tile, ch.winter);
        ctx.restore();
      }
    }
    // Pass 2: hill mounds, then mountain peaks (row-sorted), both over a 1-tile ring so they cross seams.
    for (let ty = ty0 - 1; ty <= ty1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1; tx++) {
        if (this.terrainAt(tx, ty) === 'hills') this.drawMounds(ctx, (tx - tx0) * TILE, (ty - ty0) * TILE, tx, ty, ch.winter);
      }
    }
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1; tx++) {
        if (this.terrainAt(tx, ty) === 'mountain') this.drawPeaks(ctx, (tx - tx0) * TILE, (ty - ty0) * TILE, tx, ty, ch.winter);
      }
    }
    // Pass 2b: forest crowns.
    for (let ty = ty0 - 1; ty <= ty1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1; tx++) {
        const t = this.tile(tx, ty);
        if (!t || t.terrain !== 'forest') continue;
        this.drawTrees(ctx, (tx - tx0) * TILE, (ty - ty0) * TILE, tx, ty, ch.winter);
      }
    }
    // Pass 3: deposits on top.
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const t = this.tile(tx, ty)!;
        if (!t.deposit) continue;
        if (t.deposit === 'oil' && !ch.oil) continue;
        this.drawDeposit(ctx, (tx - tx0) * TILE, (ty - ty0) * TILE, tx, ty, t.deposit);
      }
    }
  }

  private drawGround(ctx: Ctx, tx: number, ty: number, tile: Tile, winter: boolean): void {
    const s = this.seed;
    const terr = tile.terrain;
    const base = BASE[terr];
    // soft per-tile colour variation, smoothed a bit by blending with a coarse hash
    const v = (h01(tx, ty, s, 1) - 0.5) * 4 + (h01(tx >> 2, ty >> 2, s, 2) - 0.5) * 3;
    ctx.fillStyle = rgb(base[0] + v, base[1] + v, base[2] + v * 0.8);
    ctx.fillRect(0, 0, TILE, TILE);

    if (terr === 'water') {
      this.drawWaterTile(ctx, tx, ty);
      this.roundCoast(ctx, tx, ty, true, winter);
      return;
    }
    if (terr === 'mountain') {
      for (let i = 0; i < 40; i++) {
        const k = h01(tx, ty, s, 500 + i);
        ctx.fillStyle = k < 0.5 ? 'rgba(60,56,56,0.35)' : 'rgba(140,134,130,0.3)';
        ctx.fillRect(Math.floor(h01(tx, ty, s, 560 + i) * 8) * 4, Math.floor(h01(tx, ty, s, 620 + i) * 8) * 4, 4, 4);
      }
      this.softenRockEdges(ctx, tx, ty, winter);
    } else {
      this.blendNeighbours(ctx, tx, ty, terr);
      this.scree(ctx, tx, ty);
    }

    switch (terr) {
      case 'sand':
        for (let i = 0; i < 10; i++) {
          const x = h01(tx, ty, s, 10 + i * 2) * TILE;
          const y = h01(tx, ty, s, 11 + i * 2) * TILE;
          ctx.fillStyle = i % 2 ? 'rgba(255,245,200,0.5)' : 'rgba(170,140,80,0.35)';
          ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
        }
        this.edgeStrips(ctx, tx, ty, (t) => t === 'water', 'rgba(120,98,58,0.38)', 5);
        break;
      case 'grass':
        for (let i = 0; i < 14; i++) {
          const x = Math.floor(h01(tx, ty, s, 10 + i * 3) * (TILE - 2));
          const y = Math.floor(h01(tx, ty, s, 11 + i * 3) * (TILE - 3));
          const k = h01(tx, ty, s, 12 + i * 3);
          ctx.fillStyle = k < 0.5 ? 'rgba(52,110,38,0.5)' : k < 0.85 ? 'rgba(160,205,100,0.45)' : 'rgba(240,230,120,0.7)';
          if (k < 0.85) ctx.fillRect(x, y, 1, 3);
          else ctx.fillRect(x, y, 2, 2);
        }
        this.sandFringe(ctx, tx, ty);
        break;
      case 'forest':
        // mossy undergrowth
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = 'rgba(30,70,30,0.4)';
          ctx.fillRect(Math.floor(h01(tx, ty, s, 20 + i * 2) * 30), Math.floor(h01(tx, ty, s, 21 + i * 2) * 30), 3, 2);
        }
        this.sandFringe(ctx, tx, ty);
        break;
      case 'hills':
        this.sandFringe(ctx, tx, ty);
        break;
      case 'mountain':
        break;
    }

    if (winter && (terr === 'grass' || terr === 'forest' || terr === 'hills')) {
      ctx.fillStyle = terr === 'forest' ? 'rgba(238,244,250,0.5)' : 'rgba(240,246,252,0.78)';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(h01(tx, ty, s, 300 + i * 2) * 28);
        const y = Math.floor(h01(tx, ty, s, 301 + i * 2) * 28);
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.8)' : 'rgba(170,190,215,0.35)';
        ctx.fillRect(x, y, 4, 2);
      }
    }
    if (terr !== 'mountain') this.roundCoast(ctx, tx, ty, false, winter);
  }

  /** Ground colour of `terr` as it reads on the map (snow-covered in winter where it snows). */
  private groundTone(terr: Terrain, winter: boolean, alpha = 1): string {
    const b = BASE[terr];
    const snowy = winter && (terr === 'grass' || terr === 'forest' || terr === 'hills');
    const mix = (c: number, w: number) => Math.round(snowy ? c * 0.22 + w * 0.78 : c);
    return `rgba(${mix(b[0], 240)},${mix(b[1], 246)},${mix(b[2], 252)},${alpha})`;
  }

  /** Smooth 1-D value noise in [0, 1) along a world-pixel coordinate (continuous across tiles). */
  private noise1(u: number, salt: number, period = 9): number {
    const i = Math.floor(u / period);
    const f = u / period - i;
    const t = f * f * (3 - 2 * f);
    return h01(i, salt, this.seed, 800) * (1 - t) + h01(i + 1, salt, this.seed, 800) * t;
  }

  /**
   * Rounds the corners of coastlines so diagonal shores read as curves instead of staircases (most
   * visible zoomed out). On water tiles, a corner whose two side neighbours are land gets a quarter
   * disc of beach; on land tiles, a corner whose two side neighbours are water is cut away to water.
   */
  private roundCoast(ctx: Ctx, tx: number, ty: number, isWater: boolean, winter: boolean): void {
    const corners: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const isW = (t: Terrain | undefined) => t === 'water';
    // a corner is rounded when both side neighbours are the "other" kind (land for water, water for land)
    const rounds = (dx: number, dy: number) => {
      const a = this.terrainAt(tx, ty + dy);
      const b = this.terrainAt(tx + dx, ty);
      return a !== undefined && b !== undefined && isW(a) !== isWater && isW(b) !== isWater;
    };
    // one-tile islands and ponds would turn into four-pointed stars: keep their bites small
    const many = corners.filter(([dx, dy]) => rounds(dx, dy)).length >= 3;
    for (const [dx, dy] of corners) {
      const a = this.terrainAt(tx, ty + dy);
      const b = this.terrainAt(tx + dx, ty);
      if (a === undefined || b === undefined) continue;
      const px = dx < 0 ? 0 : TILE;
      const py = dy < 0 ? 0 : TILE;
      const r = many ? 9 : 14 + h01(tx, ty, this.seed, 820 + (dy + 1) * 2 + (dx + 1)) * 4;
      // angles of the quarter disc inside this tile
      const a0 = dx < 0 ? (dy < 0 ? 0 : -Math.PI / 2) : dy < 0 ? Math.PI / 2 : Math.PI;
      const arc = (rad: number) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, rad, a0, a0 + Math.PI / 2);
        ctx.closePath();
        ctx.fill();
      };
      if (isWater) {
        if (a === 'water' || b === 'water') continue;
        // shallows hugging the new curve, then the beach itself, then its wet rim
        ctx.fillStyle = 'rgba(120,200,215,0.22)';
        arc(r + 9);
        ctx.fillStyle = 'rgba(120,200,215,0.3)';
        arc(r + 4);
        const bothSand = a === 'sand' && b === 'sand';
        ctx.fillStyle = 'rgba(150,120,70,0.45)';
        arc(r + 1.5);
        ctx.fillStyle = bothSand ? this.groundTone('sand', false) : winter && a !== 'sand' && b !== 'sand' ? 'rgb(236,240,244)' : 'rgb(226,208,150)';
        arc(r);
      } else {
        if (a !== 'water' || b !== 'water') continue;
        const terr = this.terrainAt(tx, ty)!;
        // a beach band along the new curve (sand tiles are beach already), then the water bite
        if (terr !== 'sand') {
          ctx.fillStyle = winter ? 'rgb(236,240,244)' : 'rgb(226,208,150)';
          arc(r + 6);
        }
        ctx.fillStyle = 'rgba(150,120,70,0.45)';
        arc(r + 1.5);
        const w = BASE.water;
        ctx.fillStyle = rgb(w[0], w[1], w[2]);
        arc(r);
        ctx.fillStyle = 'rgba(120,200,215,0.45)';
        arc(r);
        ctx.fillStyle = rgb(w[0], w[1], w[2]);
        arc(r - 7);
        ctx.fillStyle = 'rgba(120,200,215,0.2)';
        arc(r - 7);
      }
    }
  }

  /**
   * Mountain tiles are a square of bare rock; where the range meets lower land, eat into that square
   * with the neighbour's ground in a wavy band (continuous along the edge) and round off convex
   * corners, so the range ends in an irregular foot instead of a block.
   */
  private softenRockEdges(ctx: Ctx, tx: number, ty: number, winter: boolean): void {
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const lower: (Terrain | null)[] = dirs.map(([dx, dy]) => {
      const t = this.terrainAt(tx + dx, ty + dy);
      return t !== undefined && t !== 'mountain' && t !== 'water' ? t : null;
    });
    for (let i = 0; i < 4; i++) {
      const n = lower[i];
      if (!n) continue;
      const along = i === 0 || i === 2 ? tx * TILE : ty * TILE;
      for (let k = 0; k < TILE; k += 2) {
        const u = along + k;
        const depth = 3 + this.noise1(u, i * 31 + (i === 0 || i === 2 ? ty : tx) * 7) * 9 + this.noise1(u, 97 + i, 3) * 3;
        ctx.fillStyle = this.groundTone(n, winter);
        this.edgeRect(ctx, i, k, Math.round(depth));
        // a dark crumb line where the rock starts
        ctx.fillStyle = 'rgba(70,66,64,0.35)';
        const d = Math.round(depth);
        if (i === 0) ctx.fillRect(k, d, 2, 1);
        else if (i === 2) ctx.fillRect(k, TILE - d - 1, 2, 1);
        else if (i === 3) ctx.fillRect(d, k, 1, 2);
        else ctx.fillRect(TILE - d - 1, k, 1, 2);
      }
    }
    // convex corners: both side neighbours are lower land
    const pairs: [number, number, number, number][] = [[0, 3, 0, 0], [0, 1, TILE, 0], [2, 3, 0, TILE], [2, 1, TILE, TILE]];
    for (const [v, hz, px, py] of pairs) {
      const n = lower[v] ?? lower[hz];
      if (!lower[v] || !lower[hz] || !n) continue;
      const r = 12 + h01(tx, ty, this.seed, 840 + v * 4 + hz) * 8;
      const sx = px === 0 ? 1 : -1;
      const sy = py === 0 ? 1 : -1;
      ctx.fillStyle = this.groundTone(n, winter);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + sx * r, py);
      ctx.quadraticCurveTo(px + sx * r * 0.35, py + sy * r * 0.35, px, py + sy * r);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Water tile: depth shading + lighter shallows towards neighbouring land. */
  private drawWaterTile(ctx: Ctx, tx: number, ty: number): void {
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const grad = (x0: number, y0: number, x1: number, y1: number): void => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(120,200,215,0.7)');
      g.addColorStop(1, 'rgba(120,200,215,0)');
      ctx.fillStyle = g;
    };
    for (let i = 0; i < 4; i++) {
      const t = this.terrainAt(tx + dirs[i][0], ty + dirs[i][1]);
      if (t === undefined || t === 'water') continue;
      const w = 12;
      if (i === 0) { grad(0, 0, 0, w); ctx.fillRect(0, 0, TILE, w); }
      if (i === 2) { grad(0, TILE, 0, TILE - w); ctx.fillRect(0, TILE - w, TILE, w); }
      if (i === 3) { grad(0, 0, w, 0); ctx.fillRect(0, 0, w, TILE); }
      if (i === 1) { grad(TILE, 0, TILE - w, 0); ctx.fillRect(TILE - w, 0, w, TILE); }
    }
    // diagonal-only land corners
    const corners: [number, number, number, number][] = [[-1, -1, 0, 0], [1, -1, TILE, 0], [-1, 1, 0, TILE], [1, 1, TILE, TILE]];
    for (const [dx, dy, px, py] of corners) {
      const t = this.terrainAt(tx + dx, ty + dy);
      if (t === undefined || t === 'water') continue;
      const g = ctx.createRadialGradient(px, py, 0, px, py, 12);
      g.addColorStop(0, 'rgba(120,200,215,0.6)');
      g.addColorStop(1, 'rgba(120,200,215,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TILE, TILE);
    }
  }

  /** A wavy sand strip along edges adjoining water, drawn on non-sand land. */
  private sandFringe(ctx: Ctx, tx: number, ty: number): void {
    const s = this.seed;
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) {
      if (this.terrainAt(tx + dirs[i][0], ty + dirs[i][1]) !== 'water') continue;
      for (let k = 0; k < TILE; k += 2) {
        const depth = 4 + Math.floor(h01(tx * 32 + k, ty, s, 400 + i) * 4);
        const wet = 2;
        ctx.fillStyle = 'rgb(226,208,150)';
        this.edgeRect(ctx, i, k, depth);
        ctx.fillStyle = 'rgba(150,120,70,0.45)';
        this.edgeRect(ctx, i, k, wet);
      }
    }
  }

  /** 2px-wide slice at position k along edge i with the given depth from the edge. */
  private edgeRect(ctx: Ctx, edge: number, k: number, depth: number): void {
    if (edge === 0) ctx.fillRect(k, 0, 2, depth);
    else if (edge === 2) ctx.fillRect(k, TILE - depth, 2, depth);
    else if (edge === 3) ctx.fillRect(0, k, depth, 2);
    else ctx.fillRect(TILE - depth, k, depth, 2);
  }

  private edgeStrips(
    ctx: Ctx,
    tx: number,
    ty: number,
    pred: (t: Terrain) => boolean,
    color: string,
    depth: number,
  ): void {
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      const t = this.terrainAt(tx + dirs[i][0], ty + dirs[i][1]);
      if (t === undefined || !pred(t)) continue;
      for (let k = 0; k < TILE; k += 2) {
        this.edgeRect(ctx, i, k, depth - 1 + Math.floor(h01(tx * 32 + k, ty, this.seed, 420 + i) * 3));
      }
    }
  }

  /** Blend a jittered gradient from each edge/corner towards lower-priority neighbours' colours. */
  private blendNeighbours(ctx: Ctx, tx: number, ty: number, terr: Terrain): void {
    const pr = PRIORITY[terr];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = this.terrainAt(tx + dx, ty + dy);
        if (n === undefined || n === 'water' || PRIORITY[n] >= pr) continue;
        const b = BASE[n];
        const depth = 8 + h01(tx, ty, this.seed, 600 + (dy + 1) * 3 + dx + 1) * 5;
        const c0 = `rgba(${b[0]},${b[1]},${b[2]},0.85)`;
        const c1 = `rgba(${b[0]},${b[1]},${b[2]},0)`;
        if (dx && dy) {
          const px = dx < 0 ? 0 : TILE;
          const py = dy < 0 ? 0 : TILE;
          const g = ctx.createRadialGradient(px, py, 0, px, py, depth);
          g.addColorStop(0, c0);
          g.addColorStop(1, c1);
          ctx.fillStyle = g;
          ctx.fillRect(dx < 0 ? 0 : TILE - depth, dy < 0 ? 0 : TILE - depth, depth, depth);
        } else {
          const x0 = dx > 0 ? TILE : 0;
          const y0 = dy > 0 ? TILE : 0;
          const x1 = dx < 0 ? depth : dx > 0 ? TILE - depth : 0;
          const y1 = dy < 0 ? depth : dy > 0 ? TILE - depth : 0;
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, c0);
          g.addColorStop(1, c1);
          ctx.fillStyle = g;
          if (dx) ctx.fillRect(dx < 0 ? 0 : TILE - depth, 0, depth, TILE);
          else ctx.fillRect(0, dy < 0 ? 0 : TILE - depth, TILE, depth);
        }
      }
    }
  }

  /** Rocky scree fading out from adjoining mountain tiles. */
  private scree(ctx: Ctx, tx: number, ty: number): void {
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) {
      if (this.terrainAt(tx + dirs[i][0], ty + dirs[i][1]) !== 'mountain') continue;
      const d = 14 + h01(tx, ty, this.seed, 650 + i) * 6;
      const [x0, y0, x1, y1] = [[0, 0, 0, d], [TILE, 0, TILE - d, 0], [0, TILE, 0, TILE - d], [0, 0, d, 0]][i];
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(98,93,88,0.75)');
      g.addColorStop(1, 'rgba(98,93,88,0)');
      ctx.fillStyle = g;
      if (i === 0) ctx.fillRect(0, 0, TILE, d);
      else if (i === 2) ctx.fillRect(0, TILE - d, TILE, d);
      else if (i === 3) ctx.fillRect(0, 0, d, TILE);
      else ctx.fillRect(TILE - d, 0, d, TILE);
      for (let k = 0; k < 6; k++) {
        const t = h01(tx, ty, this.seed, 660 + i * 8 + k) * TILE;
        const o = h01(tx, ty, this.seed, 700 + i * 8 + k) * d * 0.7;
        const [px, py] = i === 0 ? [t, o] : i === 2 ? [t, TILE - o] : i === 3 ? [o, t] : [TILE - o, t];
        ctx.fillStyle = k % 2 ? 'rgba(70,66,64,0.7)' : 'rgba(160,154,148,0.6)';
        ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2);
      }
    }
  }

  /**
   * Soft hill mounds that vary in size, so hills read as rolling country rather than a repeated
   * pattern: each tile picks a size class (from a fine and a coarse hash, so sizes come in patches):
   * one broad swell (radius 17-23), a pair of mid mounds (11-17) or a cluster of three hummocks
   * (7-11). Mounds may overhang tile edges by less than a tile.
   */
  private drawMounds(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, winter: boolean): void {
    const s = this.seed;
    const size = h01(tx, ty, s, 45) * 0.6 + h01(tx >> 1, ty >> 1, s, 46) * 0.4;
    const [n, rMin, rSpan] = size > 0.66 ? [1, 17, 6] : size > 0.36 ? [2, 11, 6] : [3, 7, 4];
    const base = BASE.hills;
    const mounds: { cx: number; cy: number; rad: number; flat: number; j: number }[] = [];
    for (let i = 0; i < n; i++) {
      const spread = n === 1 ? 8 : 20;
      mounds.push({
        cx: ox + 16 - spread / 2 + h01(tx, ty, s, 41 + i * 5) * spread,
        cy: oy + 18 - spread / 2.5 + h01(tx, ty, s, 42 + i * 5) * (spread * 0.8),
        rad: rMin + h01(tx, ty, s, 43 + i * 5) * rSpan,
        flat: 0.5 + h01(tx, ty, s, 47 + i * 5) * 0.2,
        j: (h01(tx, ty, s, 44 + i * 5) - 0.5) * 12,
      });
    }
    mounds.sort((p, q) => p.cy - q.cy); // nearer (lower) mounds overlap farther ones
    for (const { cx, cy, rad, flat, j } of mounds) {
      const tone = (d: number): string => {
        const c = [base[0] + j + d, base[1] + j + d, base[2] + j * 0.6 + d * 0.6];
        return winter ? rgb(c[0] * 0.25 + 240 * 0.75, c[1] * 0.25 + 245 * 0.75, c[2] * 0.25 + 250 * 0.75) : rgb(c[0], c[1], c[2]);
      };
      const ry = rad * flat;
      ctx.fillStyle = winter ? 'rgba(120,140,170,0.12)' : 'rgba(40,40,15,0.22)';
      ctx.beginPath();
      ctx.ellipse(cx + 3, cy + 3, rad, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tone(9); // NW highlight crescent
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tone(0);
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + 1.5, rad * 0.92, ry * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** One mountain peak per tile; wide enough that neighbours overlap into ranges. */
  private drawPeaks(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, winter: boolean): void {
    const s = this.seed;
    const px = ox + 16 + (h01(tx, ty, s, 61) - 0.5) * 16;
    const baseY = oy + 18 + h01(tx, ty, s, 60) * 14;
    const h = 24 + h01(tx, ty, s, 62) * 10;
    const half = 18 + h01(tx, ty, s, 63) * 4;
    const topY = baseY - h;
    const tx0 = px + (h01(tx, ty, s, 64) - 0.5) * 6;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(px + 4, baseY + 1, half, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(138,132,128)';
    ctx.beginPath();
    ctx.moveTo(tx0, topY);
    ctx.lineTo(px - half, baseY);
    ctx.lineTo(px + 1, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(76,72,74)';
    ctx.beginPath();
    ctx.moveTo(tx0, topY);
    ctx.lineTo(px + half, baseY);
    ctx.lineTo(px + 1, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(55,52,54,0.5)';
    for (let i = 0; i < 5; i++) {
      const t = 0.3 + h01(tx, ty, s, 65 + i) * 0.65;
      const y = topY + h * t;
      const w = half * t;
      const x = tx0 + (h01(tx, ty, s, 70 + i) - 0.3) * w;
      ctx.fillRect(Math.round(x), Math.round(y), 2 + (i % 3), 1);
    }
    const capH = Math.max(7, h * 0.4) + (winter ? 4 : 0);
    const capW = (capH / h) * half;
    ctx.fillStyle = 'rgb(246,248,252)';
    ctx.beginPath();
    ctx.moveTo(tx0, topY);
    ctx.lineTo(tx0 - capW, topY + capH);
    ctx.lineTo(tx0 - capW * 0.5, topY + capH - 3);
    ctx.lineTo(tx0 - capW * 0.1, topY + capH + 1);
    ctx.lineTo(tx0 + capW * 0.35, topY + capH - 3);
    ctx.lineTo(tx0 + capW, topY + capH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(150,172,205,0.65)';
    ctx.beginPath();
    ctx.moveTo(tx0, topY);
    ctx.lineTo(tx0 + capW, topY + capH);
    ctx.lineTo(tx0 + capW * 0.35, topY + capH - 3);
    ctx.lineTo(tx0 + 1, topY + capH * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  private drawTrees(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, winter: boolean): void {
    const s = this.seed;
    const n = 3 + (hash(tx, ty, s, 70) % 2);
    // sort-by-y so lower trees overlap upper ones
    const trees: { x: number; y: number; r: number; k: number }[] = [];
    for (let i = 0; i < n; i++) {
      const gx = i % 2;
      const gy = i >> 1;
      trees.push({
        x: 8 + gx * 16 + (h01(tx, ty, s, 71 + i * 3) - 0.5) * 8 + (n === 3 && i === 2 ? 8 : 0),
        y: 9 + gy * 14 + (h01(tx, ty, s, 72 + i * 3) - 0.5) * 6,
        r: 7 + h01(tx, ty, s, 73 + i * 3) * 3,
        k: h01(tx, ty, s, 90 + i),
      });
    }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) {
      const cx = ox + t.x;
      const cy = oy + t.y;
      // shadow
      ctx.fillStyle = 'rgba(10,30,15,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + t.r * 0.9, t.r * 0.95, t.r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // trunk
      ctx.fillStyle = 'rgb(84,58,36)';
      ctx.fillRect(Math.round(cx) - 1, Math.round(cy + t.r * 0.4), 2, 4);
      // crown
      const dark = 40 + t.k * 30;
      ctx.fillStyle = rgb(dark * 0.55, 80 + t.k * 36, dark * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(dark * 0.8, 112 + t.k * 40, dark * 0.8);
      ctx.beginPath();
      ctx.arc(cx - t.r * 0.25, cy - t.r * 0.3, t.r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(190,230,130,0.4)';
      ctx.fillRect(Math.round(cx - t.r * 0.5), Math.round(cy - t.r * 0.6), 2, 2);
      if (winter) {
        ctx.fillStyle = 'rgba(248,251,255,0.9)';
        ctx.beginPath();
        ctx.arc(cx - 1, cy - t.r * 0.35, t.r * 0.62, Math.PI * 0.95, Math.PI * 2.05);
        ctx.fill();
      }
    }
  }

  private drawDeposit(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, kind: string): void {
    const s = this.seed;
    if (kind === 'oil') {
      const cx = ox + 16 + (h01(tx, ty, s, 200) - 0.5) * 6;
      const cy = oy + 17 + (h01(tx, ty, s, 201) - 0.5) * 6;
      ctx.fillStyle = 'rgba(8,8,14,0.9)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11, 7, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,30,45,0.95)';
      ctx.beginPath();
      ctx.ellipse(cx - 2, cy - 1, 7, 4, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,90,200,0.55)';
      ctx.fillRect(Math.round(cx - 6), Math.round(cy - 3), 4, 1);
      ctx.fillStyle = 'rgba(70,170,160,0.5)';
      ctx.fillRect(Math.round(cx - 1), Math.round(cy - 1), 3, 1);
      return;
    }
    const iron = kind === 'iron_ore';
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = ox + 6 + h01(tx, ty, s, 210 + i * 3) * 20;
      const y = oy + 8 + h01(tx, ty, s, 211 + i * 3) * 18;
      const r = 3 + h01(tx, ty, s, 212 + i * 3) * 2.5;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + 1.5, y + r * 0.7, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = iron ? 'rgb(150,66,46)' : 'rgb(30,30,34)';
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 0.5);
      ctx.lineTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.3, y - r);
      ctx.lineTo(x + r, y - r * 0.1);
      ctx.lineTo(x + r * 0.8, y + r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = iron ? 'rgb(205,110,80)' : 'rgb(78,78,90)';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.3, y - r);
      ctx.lineTo(x + r * 0.1, y - r * 0.1);
      ctx.lineTo(x - r * 0.7, y);
      ctx.closePath();
      ctx.fill();
      if (!iron) {
        ctx.fillStyle = 'rgba(210,210,230,0.8)';
        ctx.fillRect(Math.round(x - 1), Math.round(y - r * 0.6), 1, 1);
      }
    }
  }
}
