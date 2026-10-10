import { describe, expect, it } from 'vitest';
import { niceTicks } from './charts';

describe('niceTicks', () => {
  it('covers 0..97 with nice steps', () => {
    expect(niceTicks(0, 97, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('includes zero for a symmetric signed range', () => {
    expect(niceTicks(-1000, 1000, 4)).toContain(0);
  });

  it('handles a negative-only range', () => {
    const ticks = niceTicks(-950, -120, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-950);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(-120);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(new Set(steps.map((s) => Math.round(s * 1e6))).size).toBe(1);
  });
});
