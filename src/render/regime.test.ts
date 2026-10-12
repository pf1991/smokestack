import { describe, expect, it } from 'vitest';
import { regimeBlend } from './regime';

describe('regimeBlend', () => {
  it('is 0 (survey) when zoomed out and 1 (diorama) when zoomed in', () => {
    expect(regimeBlend(0.5)).toBe(0);
    expect(regimeBlend(1)).toBe(0);
    expect(regimeBlend(1.3)).toBe(0);
    expect(regimeBlend(1.5)).toBe(0.5);
    expect(regimeBlend(1.7)).toBe(1);
    expect(regimeBlend(2)).toBe(1);
    expect(regimeBlend(3)).toBe(1);
  });

  it('is monotonic and continuous across the blend band', () => {
    let prev = regimeBlend(0.5);
    for (let z = 0.5; z <= 3; z += 0.01) {
      const b = regimeBlend(z);
      expect(b).toBeGreaterThanOrEqual(prev);
      expect(b - prev).toBeLessThan(0.05);
      prev = b;
    }
  });
});
