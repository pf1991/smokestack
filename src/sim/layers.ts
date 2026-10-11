import type { GameState } from './types';

export type LayerId = string;

/** The layer `id`, created zero-filled (width*height) on first use. */
export function layer(state: GameState, id: LayerId): number[] {
  let l = state.layers[id];
  if (!l) {
    l = new Array<number>(state.map.width * state.map.height).fill(0);
    state.layers[id] = l;
  }
  return l;
}

/** Value at (x, y); 0 out of bounds or for a missing layer. Never creates a layer. */
export function layerAt(state: GameState, id: LayerId, x: number, y: number): number {
  const { width, height } = state.map;
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return state.layers[id]?.[y * width + x] ?? 0;
}

/** Rounds to 3 decimals; a run of k>=2 zeros becomes `-1, k`. Layers hold non-negative values only. */
export function packLayer(a: number[]): number[] {
  for (const x of a) if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new Error('bad layer value');
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = Math.round(a[i] * 1000) / 1000;
    if (v === 0) {
      let k = 1;
      while (i + k < a.length && Math.round(a[i + k] * 1000) / 1000 === 0) k++;
      if (k >= 2) out.push(-1, k);
      else out.push(0);
      i += k;
    } else {
      out.push(v);
      i++;
    }
  }
  return out;
}

/** Inverse of packLayer. Throws Error('bad layer') on a wrong decoded length or malformed data. */
export function unpackLayer(p: number[], n: number): number[] {
  if (!Array.isArray(p)) throw new Error('bad layer');
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('bad layer');
    if (v === -1) {
      const k = p[++i];
      if (!Number.isInteger(k) || k < 2 || out.length + k > n) throw new Error('bad layer');
      for (let j = 0; j < k; j++) out.push(0);
    } else if (v < 0) {
      throw new Error('bad layer');
    } else {
      if (out.length >= n) throw new Error('bad layer');
      out.push(v);
    }
  }
  if (out.length !== n) throw new Error('bad layer');
  return out;
}
