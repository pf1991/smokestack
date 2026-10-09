export interface RngHolder {
  rngState: number;
}

/** mulberry32: advances s.rngState and returns a float in [0, 1). */
export function random(s: RngHolder): number {
  const next = (s.rngState + 0x6d2b79f5) | 0;
  s.rngState = next;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max], both inclusive. */
export function randInt(s: RngHolder, min: number, max: number): number {
  return min + Math.floor(random(s) * (max - min + 1));
}

export function pick<T>(s: RngHolder, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[randInt(s, 0, arr.length - 1)];
}

export function chance(s: RngHolder, p: number): boolean {
  return random(s) < p;
}
