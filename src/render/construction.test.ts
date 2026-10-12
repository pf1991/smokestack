import { describe, it, expect } from 'vitest';
import { BUILD_MS, constructionStage } from './construction';

describe('constructionStage', () => {
  it('starts empty', () => {
    expect(constructionStage(0)).toEqual({ scaffold: 0, reveal: 0, done: false });
  });
  it('reveals halfway at 900 ms', () => {
    expect(constructionStage(900).reveal).toBe(0.5);
  });
  it('is done at BUILD_MS', () => {
    expect(BUILD_MS).toBe(1400);
    expect(constructionStage(1400).done).toBe(true);
    expect(constructionStage(1399).done).toBe(false);
  });
  it('reveal never decreases', () => {
    let prev = 0;
    for (let t = 0; t <= 1400; t += 50) {
      const r = constructionStage(t).reveal;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
  it('scaffold goes 0 -> 1 -> 0 continuously at 600, 1200, 1400', () => {
    for (const b of [600, 1200, 1400]) {
      const a = constructionStage(b - 0.001).scaffold;
      const c = constructionStage(b).scaffold;
      expect(Math.abs(a - c)).toBeLessThan(0.001);
    }
    expect(constructionStage(600).scaffold).toBe(1);
    expect(constructionStage(1200).scaffold).toBe(1);
    expect(constructionStage(1400).scaffold).toBe(0);
  });
  it('reveal is continuous at 600 and 1200', () => {
    expect(constructionStage(600 - 0.001).reveal).toBe(0);
    expect(constructionStage(1200 - 0.001).reveal).toBeCloseTo(1, 3);
    expect(constructionStage(1200).reveal).toBe(1);
  });
});
