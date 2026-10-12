/** Leaf module shared by the terrain and survey chunk painters (no render imports, so no cycles). */

/** Chunk side in tiles. */
export const CHUNK = 16;

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
