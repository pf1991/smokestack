import { describe, expect, it } from 'vitest';
import { niceTicks } from './charts';

describe('niceTicks', () => {
  it('covers 0..97 with nice steps', () => {
    expect(niceTicks(0, 97, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('includes zero for a symmetric signed range', () => {
    expect(niceTicks(-1000, 1000, 4)).toContain(0);
  });

  it('keeps ticks distinct when min equals max', () => {
    const ticks = niceTicks(5, 5, 4);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks.length).toBeGreaterThan(1);
    const big = niceTicks(300000, 300000, 4);
    expect(new Set(big).size).toBe(big.length);
  });

  it('returns [0] for non-finite input', () => {
    expect(niceTicks(Number.NaN, 10, 4)).toEqual([0]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY, 4)).toEqual([0]);
  });

  it('handles a negative-only range', () => {
    const ticks = niceTicks(-950, -120, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-950);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(-120);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(new Set(steps.map((s) => Math.round(s * 1e6))).size).toBe(1);
  });
});
