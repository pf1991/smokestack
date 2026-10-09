import type { GameMap, Tile, Vec2 } from './types';

export type Passable = (tile: Tile, x: number, y: number) => boolean;

export const roadPassable: Passable = (tile) => tile.road;
export const railPassable: Passable = (tile) => tile.rail;
export const roadBuildable: Passable = (tile) =>
  tile.terrain !== 'mountain' && tile.buildingId === null && (tile.cityId === null || tile.road);
export const waterAvoidingCost = (tile: Tile): number => (tile.terrain === 'water' ? 8 : 1);

/** A* with 4-way moves. Returns tiles from `from` to the first target reached (inclusive), or null. */
export function findPath(
  map: GameMap,
  from: Vec2,
  targets: Vec2[],
  passable: Passable,
  stepCost?: (tile: Tile) => number,
): Vec2[] | null {
  const { width: w, height: h, tiles } = map;
  const inb = (v: Vec2) => v.x >= 0 && v.y >= 0 && v.x < w && v.y < h;
  if (!inb(from)) return null;
  const tx: number[] = [];
  const ty: number[] = [];
  const isTarget = new Uint8Array(w * h);
  const start = from.y * w + from.x;
  for (const t of targets) {
    if (!inb(t)) continue;
    const i = t.y * w + t.x;
    if (i !== start && !passable(tiles[i], t.x, t.y)) continue;
    if (isTarget[i]) continue;
    isTarget[i] = 1;
    tx.push(t.x);
    ty.push(t.y);
  }
  if (tx.length === 0) return null;

  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heur = (x: number, y: number): number => {
    let best = Infinity;
    for (let k = 0; k < tx.length; k++) {
      const d = Math.abs(x - tx[k]) + Math.abs(y - ty[k]);
      if (d < best) best = d;
    }
    return best;
  };

  // binary min-heap on f, parallel arrays
  const heapIdx: number[] = [];
  const heapF: number[] = [];
  const push = (idx: number, f: number) => {
    let i = heapIdx.length;
    heapIdx.push(idx);
    heapF.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapIdx[i] = heapIdx[p];
      heapF[i] = heapF[p];
      i = p;
    }
    heapIdx[i] = idx;
    heapF[i] = f;
  };
  const pop = (): number => {
    const top = heapIdx[0];
    const li = heapIdx.pop() as number;
    const lf = heapF.pop() as number;
    const len = heapIdx.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lf) break;
        heapIdx[i] = heapIdx[c];
        heapF[i] = heapF[c];
        i = c;
      }
      heapIdx[i] = li;
      heapF[i] = lf;
    }
    return top;
  };

  g[start] = 0;
  push(start, heur(from.x, from.y));
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  while (heapIdx.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (isTarget[cur]) {
      const path: Vec2[] = [];
      for (let c = cur; c !== -1; c = cameFrom[c]) path.push({ x: c % w, y: (c / w) | 0 });
      return path.reverse();
    }
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const tile = tiles[ni];
      if (!passable(tile, nx, ny)) continue;
      // clamp to >= 1 so the Manhattan heuristic stays admissible
      const ng = g[cur] + (stepCost ? Math.max(1, stepCost(tile)) : 1);
      if (ng < g[ni]) {
        g[ni] = ng;
        cameFrom[ni] = cur;
        const hn = heur(nx, ny);
        push(ni, ng + hn + hn * 1e-4); // tie-break toward the goal
      }
    }
  }
  return null;
}
