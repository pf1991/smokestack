import { TILE, type Camera, visibleTileRange } from './camera';
import type { GameMap, Terrain, Tile } from '../sim/types';

export const CHUNK = 16;
const CHUNK_PX = CHUNK * TILE;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;

/** Seeded integer hash of (x, y, seed, salt) -> uint32. Deterministic, no Math.random. */
export function hash(x: number, y: number, seed: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

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
  hills: [140, 140, 80],
  mountain: [128, 126, 124],
};

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
  surface: Surface;
  dirty: boolean;
  winter: boolean;
  oil: boolean;
  drawn: boolean;
}

export class TerrainRenderer {
  private chunks = new Map<number, Chunk>();
  private cols: number;

  constructor(
    private map: GameMap,
    private seed: number,
  ) {
    this.cols = Math.ceil(map.width / CHUNK);
  }

  invalidateTile(x: number, y: number): void {
    // Neighbouring tiles' edges / tree overhangs depend on this tile too.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;
        const c = this.chunks.get(Math.floor(ty / CHUNK) * this.cols + Math.floor(tx / CHUNK));
        if (c) c.dirty = true;
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
    ctx.imageSmoothingEnabled = false;

    const cx0 = Math.floor(r.x0 / CHUNK);
    const cx1 = Math.floor(r.x1 / CHUNK);
    const cy0 = Math.floor(r.y0 / CHUNK);
    const cy1 = Math.floor(r.y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * this.cols + cx;
        let ch = this.chunks.get(key);
        if (!ch) {
          ch = { surface: makeSurface(CHUNK_PX, CHUNK_PX), dirty: true, winter, oil: opts.oilVisible, drawn: false };
          this.chunks.set(key, ch);
        }
        if (ch.dirty || !ch.drawn || ch.winter !== winter || ch.oil !== opts.oilVisible) {
          ch.winter = winter;
          ch.oil = opts.oilVisible;
          ch.dirty = false;
          ch.drawn = true;
          this.renderChunk(ch, cx, cy);
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
    // Pass 2: forest crowns (include a 1-tile ring so overhangs cross chunk seams).
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
    const v = (h01(tx, ty, s, 1) - 0.5) * 16 + (h01(tx >> 2, ty >> 2, s, 2) - 0.5) * 14;
    ctx.fillStyle = rgb(base[0] + v, base[1] + v, base[2] + v * 0.8);
    ctx.fillRect(0, 0, TILE, TILE);

    switch (terr) {
      case 'water':
        this.drawWaterTile(ctx, tx, ty);
        return;
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
        this.edgeStrips(ctx, tx, ty, (t) => t === 'grass' || t === 'sand' || t === 'hills', 'rgba(20,50,25,0.4)', 4);
        this.sandFringe(ctx, tx, ty);
        break;
      case 'hills':
        this.drawHills(ctx, tx, ty);
        this.sandFringe(ctx, tx, ty);
        break;
      case 'mountain':
        this.drawMountain(ctx, tx, ty, winter);
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

  private drawHills(ctx: Ctx, tx: number, ty: number): void {
    const s = this.seed;
    const ox = h01(tx, ty, s, 40) * 10 - 5;
    const oy = h01(tx, ty, s, 41) * 8 - 4;
    // soft mounds with light top-left, dark bottom-right contour
    for (let i = 0; i < 3; i++) {
      const cx = 16 + ox + (i - 1) * 7;
      const cy = 18 + oy + (i % 2) * 3;
      const rad = 11 - i * 2;
      ctx.fillStyle = 'rgba(70,60,30,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx + 1.5, cy + 2, rad, rad * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(150 + i * 10, 150 + i * 9, 88 + i * 6);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, rad * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(95,85,45,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad * 0.62, rad * 0.36, 0, 0.3, Math.PI * 1.2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(235,235,170,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy - 1, rad * 0.85, rad * 0.5, 0, Math.PI * 1.05, Math.PI * 1.75);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(90,120,60,0.55)';
      ctx.fillRect(Math.floor(h01(tx, ty, s, 50 + i * 2) * 30), Math.floor(h01(tx, ty, s, 51 + i * 2) * 30), 2, 2);
    }
  }

  private drawMountain(ctx: Ctx, tx: number, ty: number, winter: boolean): void {
    const s = this.seed;
    ctx.fillStyle = 'rgb(104,100,98)';
    ctx.fillRect(0, 0, TILE, TILE);
    const peaks = 1 + (h01(tx, ty, s, 60) > 0.55 ? 1 : 0);
    for (let p = 0; p < peaks; p++) {
      const px = peaks === 1 ? 16 + (h01(tx, ty, s, 61) - 0.5) * 6 : 10 + p * 12;
      const h = 17 + h01(tx, ty, s, 62 + p) * 9 - (peaks === 2 ? 3 : 0);
      const half = 13 - (peaks === 2 ? 3 : 0);
      const baseY = 29 - p * 2;
      const topY = baseY - h;
      // lit left face / shaded right face
      ctx.fillStyle = 'rgb(150,146,142)';
      ctx.beginPath();
      ctx.moveTo(px, topY);
      ctx.lineTo(px - half, baseY);
      ctx.lineTo(px + 1, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgb(86,82,84)';
      ctx.beginPath();
      ctx.moveTo(px, topY);
      ctx.lineTo(px + half, baseY);
      ctx.lineTo(px + 1, baseY);
      ctx.closePath();
      ctx.fill();
      // ridges
      ctx.strokeStyle = 'rgba(60,56,58,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, topY + 4);
      ctx.lineTo(px - 2, baseY - 4);
      ctx.moveTo(px + 3, topY + 8);
      ctx.lineTo(px + 6, baseY - 2);
      ctx.stroke();
      // snow cap (jagged)
      const capH = Math.max(5, h * 0.38) + (winter ? 3 : 0);
      ctx.fillStyle = 'rgb(246,248,252)';
      ctx.beginPath();
      ctx.moveTo(px, topY);
      const capW = (capH / h) * half;
      ctx.lineTo(px - capW, topY + capH);
      ctx.lineTo(px - capW * 0.5, topY + capH - 2);
      ctx.lineTo(px - capW * 0.1, topY + capH + 1);
      ctx.lineTo(px + capW * 0.35, topY + capH - 2);
      ctx.lineTo(px + capW, topY + capH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(160,180,210,0.6)';
      ctx.beginPath();
      ctx.moveTo(px, topY);
      ctx.lineTo(px + capW, topY + capH);
      ctx.lineTo(px + capW * 0.35, topY + capH - 2);
      ctx.lineTo(px + 1, topY + capH * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    // foot shadow so neighbouring mountains read as a range
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 29, TILE, 3);
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
