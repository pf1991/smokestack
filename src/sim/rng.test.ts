import { describe, expect, it } from 'vitest';
import { chance, pick, randInt, random } from './rng';

describe('rng', () => {
  it('same seed same sequence', () => {
    const a = { rngState: 42 };
    const b = { rngState: 42 };
    const sa = Array.from({ length: 100 }, () => random(a));
    const sb = Array.from({ length: 100 }, () => random(b));
    expect(sa).toEqual(sb);
    expect(a.rngState).toBe(b.rngState);
  });

  it('different seeds differ', () => {
    expect(random({ rngState: 1 })).not.toBe(random({ rngState: 2 }));
  });

  it('values in [0,1)', () => {
    const s = { rngState: 123 };
    for (let i = 0; i < 10000; i++) {
      const v = random(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('randInt inclusive bounds', () => {
    const s = { rngState: 7 };
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) seen.add(randInt(s, 1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('pick and chance', () => {
    const s = { rngState: 99 };
    for (let i = 0; i < 100; i++) expect(['a', 'b']).toContain(pick(s, ['a', 'b']));
    expect(chance(s, 0)).toBe(false);
    expect(chance(s, 1)).toBe(true);
  });

  it('pick on empty array throws', () => {
    expect(() => pick({ rngState: 1 }, [])).toThrow();
  });
});
