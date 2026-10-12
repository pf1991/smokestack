/**
 * Survey-map painter: the zoomed-out regime (render/regime.ts) draws the world as a hand-tinted
 * engraved survey map of c. 1900. One chunk at a time, into a cached surface (render/terrain.ts):
 * paper with a faint grain, a watercolour wash per terrain, 45° hatching on hills and cross-hatching
 * on mountains, stippled trees, water-lining and an ink coastline, a rose town-block tint, dashed
 * ink roads and double-line rails. Everything random comes from the seeded `hash`, so a chunk that
 * redraws is pixel-identical (no shimmer). No images are blitted.
 */
import type { GameMap, Terrain, Tile } from '../sim/types';
import { CHUNK, hash } from './terrain';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Survey surface px per tile at its native scale (zoom 0.5 shows it 1:1). */
export const SURVEY_TILE_PX = 16;

export const PAPER = '#efe4c8';
export const INK = '#4a3d2c';
/** Watercolour wash per terrain. */
export const WASH: Record<Terrain, string> = {
  grass: '#cfd9a8',
  forest: '#a9bf8a',
  hills: '#d8c39a',
  mountain: '#c2b39b',
  sand: '#ecdcab',
  water: '#a9c6cf',
};
/** Built-up areas: the rose tint old town plans used for blocks. */
const TOWN_WASH = 'rgba(196,112,92,0.30)';
const TOWN_HATCH = 'rgba(150,70,58,0.30)';
const TREE_INK = '#56683f';
const WATER_INK = 'rgba(52,92,112,';
/** Paper grain amplitude: ±2% lightness. */
const GRAIN = 0.02;
/** Hatch line spacing in surface px at native scale. */
const HATCH = 4;

const PRIORITY: Record<Terrain, number> = { water: -1, sand: 0, grass: 1, forest: 2, hills: 3, mountain: 4 };

const h01 = (x: number, y: number, seed: number, salt: number): number => hash(x, y, seed, salt) / 4294967296;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const WASH_RGB = Object.fromEntries(Object.entries(WASH).map(([k, v]) => [k, hexRgb(v)])) as Record<Terrain, [number, number, number]>;

const PAPER_RGB = hexRgb(PAPER);
/** Each wash as laid on the paper at 88% opacity (opaque, so layered washes do not mix). */
const WASH_ON_PAPER = Object.fromEntries(
  Object.entries(WASH_RGB).map(([k, c]) => [k, `rgb(${c.map((v, i) => Math.round(v * 0.88 + PAPER_RGB[i] * 0.12)).join(',')})`]),
) as Record<Terrain, string>;

function tone([r, g, b]: [number, number, number], k: number): string {
  // k > 0 lightens toward white, k < 0 darkens
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/**
 * Paints survey chunk (cx, cy) with its top-left at (0, 0), `tilePx` surface px per tile
 * (default SURVEY_TILE_PX). Line spacing and widths scale with tilePx so the map keeps the same
 * look in world units at either surface resolution.
 */
export function paintSurveyChunk(g: CanvasRenderingContext2D | Ctx, map: GameMap, cx: number, cy: number, seed: number, tilePx = SURVEY_TILE_PX): void {
  const T = tilePx;
  const u = T / SURVEY_TILE_PX;
  const tx0 = cx * CHUNK;
  const ty0 = cy * CHUNK;
  const tx1 = Math.min(map.width, tx0 + CHUNK);
  const ty1 = Math.min(map.height, ty0 + CHUNK);
  const W = (tx1 - tx0) * T;
  const H = (ty1 - ty0) * T;
  const tileAt = (x: number, y: number): Tile | undefined =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? undefined : map.tiles[y * map.width + x];
  // terrain priority with the map edge clamped, so contours run straight off the map
  const prio = (x: number, y: number): number =>
    PRIORITY[map.tiles[Math.min(map.height - 1, Math.max(0, y)) * map.width + Math.min(map.width - 1, Math.max(0, x))].terrain];
  // surface px of a tile's top-left
  const px = (x: number) => (x - tx0) * T;
  const py = (y: number) => (y - ty0) * T;

  /**
   * Marching squares over tile centres: adds to the current path the region where `inside(x, y)`
   * holds, with 45° chamfers instead of tile steps (one polygon per cell, walked corner, edge
   * midpoint, corner...). With `edges`, collects the contour segments too. Covers a 1-tile ring
   * around the chunk so strokes and fills continue across seams.
   */
  const region = (inside: (x: number, y: number) => boolean, edges?: number[]): boolean => {
    let any = false;
    for (let j = ty0 - 2; j <= ty1; j++) {
      for (let i = tx0 - 2; i <= tx1; i++) {
        const a = inside(i, j);
        const b = inside(i + 1, j);
        const c = inside(i + 1, j + 1);
        const d = inside(i, j + 1);
        if (!a && !b && !c && !d) continue;
        any = true;
        const X0 = px(i) + T / 2;
        const Y0 = py(j) + T / 2;
        const X1 = X0 + T;
        const Y1 = Y0 + T;
        const XM = X0 + T / 2;
        const YM = Y0 + T / 2;
        if (a && b && c && d) {
          g.rect(X0, Y0, T, T);
          continue;
        }
        // boundary walk: corner a, mid ab, corner b, mid bc, corner c, mid cd, corner d, mid da
        const pts: number[] = [];
        const mids: boolean[] = [];
        const push = (on: boolean, x: number, y: number, mid: boolean) => {
          if (!on) return;
          pts.push(x, y);
          mids.push(mid);
        };
        push(a, X0, Y0, false);
        push(a !== b, XM, Y0, true);
        push(b, X1, Y0, false);
        push(b !== c, X1, YM, true);
        push(c, X1, Y1, false);
        push(c !== d, XM, Y1, true);
        push(d, X0, Y1, false);
        push(d !== a, X0, YM, true);
        g.moveTo(pts[0], pts[1]);
        for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
        g.closePath();
        if (edges) {
          const n = mids.length;
          for (let k = 0; k < n; k++) {
            const k2 = (k + 1) % n;
            if (mids[k] && mids[k2]) edges.push(pts[k * 2], pts[k * 2 + 1], pts[k2 * 2], pts[k2 * 2 + 1]);
          }
        }
      }
    }
    return any;
  };
  const strokeEdges = (e: number[]): void => {
    g.beginPath();
    for (let k = 0; k < e.length; k += 4) {
      g.moveTo(e[k], e[k + 1]);
      g.lineTo(e[k + 2], e[k + 3]);
    }
    g.stroke();
  };
  /** Global 45° hatch lines (x + y = c, or x − y = c when `anti`) over the whole surface, world-anchored. */
  const hatchAll = (step: number, anti: boolean): void => {
    const ox = tx0 * T;
    const oy = ty0 * T;
    g.beginPath();
    if (!anti) {
      for (let c = Math.ceil((ox + oy) / step) * step; c <= ox + oy + W + H; c += step) {
        const s = c - ox - oy; // local x + y
        g.moveTo(Math.max(0, s - H), Math.min(H, s));
        g.lineTo(Math.min(W, s), Math.max(0, s - W));
      }
    } else {
      for (let c = Math.ceil((ox - oy - H) / step) * step; c <= ox - oy + W; c += step) {
        const s = c - ox + oy; // local x − y
        g.moveTo(Math.max(0, s), Math.max(0, s) - s);
        g.lineTo(Math.min(W, s + H), Math.min(W, s + H) - s);
      }
    }
    g.stroke();
  };

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.setLineDash([]);
  g.globalAlpha = 1;
  g.beginPath();
  g.rect(0, 0, W, H);
  g.clip();

  // 1. paper, then the water wash under everything (washes are laid on at 88%, so paper shows through)
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.fillStyle = WASH_ON_PAPER.water;
  g.fillRect(0, 0, W, H);

  // 2. watercolour washes, layered by priority with chamfered (marching-squares) edges, each with
  //    a darker rim of pooled pigment just inside its edge
  const coast: number[] = [];
  for (const t of ['sand', 'grass', 'forest', 'hills', 'mountain'] as const) {
    const p = PRIORITY[t];
    const edges: number[] = [];
    g.beginPath();
    if (!region((x, y) => prio(x, y) >= p, t === 'sand' ? coast : edges)) continue;
    g.fillStyle = WASH_ON_PAPER[t];
    g.fill();
    if (t === 'sand') continue;
    g.save();
    g.clip();
    g.strokeStyle = tone(WASH_RGB[t], -0.16);
    g.globalAlpha = 0.7;
    g.lineWidth = 2.6 * u;
    strokeEdges(edges);
    g.restore();
  }

  // 3. watercolour blotches (pigment that dried unevenly) and paper grain (±2% in 4-px cells),
  //    both anchored to the world so seams match
  for (let y = ty0 - 1; y <= ty1; y += 2) {
    for (let x = tx0 - 1; x <= tx1; x += 2) {
      const bx = x & ~1;
      const by = y & ~1;
      const v = h01(bx, by, seed, 701) - 0.5;
      g.fillStyle = v > 0 ? `rgba(255,250,235,${(v * 0.16).toFixed(3)})` : `rgba(110,90,60,${(-v * 0.10).toFixed(3)})`;
      g.beginPath();
      g.arc(px(bx) + T * (0.6 + h01(bx, by, seed, 704) * 0.8), py(by) + T * (0.6 + h01(bx, by, seed, 705) * 0.8), T * (1 + h01(bx, by, seed, 706) * 0.6), 0, Math.PI * 2);
      g.fill();
    }
  }
  const cell = 4 * u;
  const per = T / cell;
  for (let y = ty0 * per; y < ty1 * per; y++) {
    for (let x = tx0 * per; x < tx1 * per; x++) {
      const v = h01(x, y, seed, 703) - 0.5; // -0.5..0.5
      if (Math.abs(v) < 0.2) continue;
      const a = (Math.abs(v) * 2 * GRAIN * 2).toFixed(3); // at most ~2% over the base
      g.fillStyle = v > 0 ? `rgba(255,252,240,${a})` : `rgba(74,61,44,${a})`;
      g.fillRect(x * cell - tx0 * T, y * cell - ty0 * T, cell, cell);
    }
  }

  // 4. relief: 45° hatching on hills, cross-hatching on mountains, clipped to the washes
  const step = HATCH * u;
  g.lineCap = 'butt';
  g.save();
  g.beginPath();
  if (region((x, y) => prio(x, y) >= PRIORITY.hills)) {
    g.clip();
    g.lineWidth = 0.8 * u;
    g.strokeStyle = 'rgba(110,82,46,0.40)';
    hatchAll(step, false);
    g.restore();
    g.save();
    g.beginPath();
    if (region((x, y) => prio(x, y) >= PRIORITY.mountain)) {
      g.clip();
      g.lineWidth = 0.8 * u;
      g.strokeStyle = 'rgba(74,61,44,0.45)';
      hatchAll(step, true);
      // heavier strokes every third line give the engraved, ridged look
      g.lineWidth = 1.1 * u;
      g.strokeStyle = 'rgba(74,61,44,0.30)';
      hatchAll(step * 3, false);
    }
  }
  g.restore();

  // 5. town blocks: a rose wash plus fine hatching on built-up land (streets stay paper)
  const isBlock = (x: number, y: number): boolean => {
    const t = tileAt(x, y);
    return !!t && t.cityId !== null && t.terrain !== 'water' && !t.road && !t.rail;
  };
  g.beginPath();
  let anyTown = false;
  for (let y = ty0; y < ty1; y++) {
    for (let x = tx0; x < tx1; x++) {
      if (!isBlock(x, y)) continue;
      // neighbouring block tiles merge into one block; it sits a little back from streets and edges
      const i = 1.5 * u;
      const l = isBlock(x - 1, y) ? 0 : i;
      const r = isBlock(x + 1, y) ? 0 : i;
      const t = isBlock(x, y - 1) ? 0 : i;
      const b = isBlock(x, y + 1) ? 0 : i;
      g.rect(px(x) + l, py(y) + t, T - l - r, T - t - b);
      anyTown = true;
    }
  }
  if (anyTown) {
    g.save();
    g.fillStyle = TOWN_WASH;
    g.fill('nonzero');
    g.clip();
    g.strokeStyle = TOWN_HATCH;
    g.lineWidth = 0.7 * u;
    hatchAll(3 * u, true);
    g.restore();
  }

  // 6. stippled trees: small ink dots, clipped to the forest wash
  g.save();
  g.beginPath();
  if (region((x, y) => prio(x, y) >= PRIORITY.forest)) {
    g.clip();
    g.fillStyle = TREE_INK;
    g.beginPath();
    for (let y = ty0 - 1; y <= ty1; y++) {
      for (let x = tx0 - 1; x <= tx1; x++) {
        if (tileAt(x, y)?.terrain !== 'forest' || isBlock(x, y)) continue;
        const n = 4 + (hash(x, y, seed, 710) % 3);
        for (let i = 0; i < n; i++) {
          const sx = px(x) + (0.1 + h01(x, y, seed, 711 + i) * 0.8) * T;
          const sy = py(y) + (0.1 + h01(x, y, seed, 721 + i) * 0.8) * T;
          const r = (0.8 + h01(x, y, seed, 731 + i) * 0.6) * u;
          g.moveTo(sx + r, sy);
          g.arc(sx, sy, r, 0, Math.PI * 2);
        }
      }
    }
    g.fill();
  }
  g.restore();

  // 7. water-lining: fading ripple lines following the shore (outermost first), then the 1 px ink
  //    coastline on the chamfered land edge
  if (coast.length > 0) {
    g.save();
    g.beginPath();
    region((x, y) => prio(x, y) < PRIORITY.sand);
    g.clip();
    g.lineCap = 'round';
    for (let k = 3; k >= 1; k--) {
      const d = k * 3 * u;
      g.strokeStyle = `${WATER_INK}${(0.52 - k * 0.13).toFixed(2)})`;
      g.lineWidth = 2 * d + 0.8 * u;
      strokeEdges(coast);
      g.strokeStyle = WASH_ON_PAPER.water;
      g.lineWidth = 2 * d - 0.8 * u;
      strokeEdges(coast);
    }
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1, 0.9 * u);
    strokeEdges(coast);
  }

  // 8. roads: dashed ink in the country, solid in town; then 9. rails as a double line
  const arms = (x: number, y: number, layer: 'road' | 'rail'): void => {
    const C = T / 2;
    const X = px(x) + C;
    const Y = py(y) + C;
    const has = (dx: number, dy: number) => tileAt(x + dx, y + dy)?.[layer] === true;
    let n = 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      if (!has(dx, dy)) continue;
      n++;
      g.moveTo(X, Y);
      g.lineTo(X + dx * C, Y + dy * C);
    }
    if (n === 0) { g.moveTo(X - C * 0.6, Y); g.lineTo(X + C * 0.6, Y); }
  };
  for (const urban of [false, true]) {
    g.strokeStyle = INK;
    g.lineWidth = (urban ? 1.1 : 1.2) * u;
    g.setLineDash(urban ? [] : [3 * u, 2 * u]);
    g.beginPath();
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        const t = map.tiles[y * map.width + x];
        if (t.road && (t.cityId !== null) === urban) arms(x, y, 'road');
      }
    }
    g.stroke();
  }
  g.setLineDash([]);
  g.beginPath();
  for (let y = ty0; y < ty1; y++) {
    for (let x = tx0; x < tx1; x++) if (map.tiles[y * map.width + x].rail) arms(x, y, 'rail');
  }
  g.lineCap = 'square';
  g.strokeStyle = INK;
  g.lineWidth = 3.2 * u;
  g.stroke();
  g.strokeStyle = PAPER;
  g.lineWidth = 1.2 * u;
  g.stroke();

  g.restore();
}

/** Italic serif city label font, sized 12/15/19/24 px at populations 0 / 5k / 20k / 50k. */
export function cityLabelFont(population: number): string {
  const px = population >= 50000 ? 24 : population >= 20000 ? 19 : population >= 5000 ? 15 : 12;
  return `italic ${px}px Georgia, 'Times New Roman', serif`;
}
