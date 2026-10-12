import { hash } from '../terrain';

export type Dir = 'N' | 'E' | 'S' | 'W';
export type Surface = HTMLCanvasElement | OffscreenCanvas;
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type TileRange = { x0: number; y0: number; x1: number; y1: number };

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export const SPRITE_MARGIN = 2;

export const h01 = (x: number, y: number, seed: number, salt: number): number => hash(x, y, seed, salt) / 4294967296;
export const bitCount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

export function makeSurface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export interface ChunkMeta {
  /** flat [x, y, variant, lit] per house */
  houses: number[];
  /** flat [worldX, worldY] per street lamp */
  lamps: number[];
  empty: boolean;
}
