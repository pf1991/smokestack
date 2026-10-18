import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { BUILD_MS, constructionStage, drawConstruction } from './construction';

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

describe('drawConstruction', () => {
  it('reveals the bottom half of the sprite at reveal 0.5', () => {
    const g = {
      drawImage: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      fillStyle: '', globalAlpha: 1,
    };
    const sprite = {} as CanvasImageSource;
    drawConstruction(g as unknown as CanvasRenderingContext2D, sprite, 10, 20, 64, 100, { scaffold: 1, reveal: 0.5, done: false });
    expect(g.drawImage).toHaveBeenCalledTimes(1);
    expect(g.drawImage).toHaveBeenCalledWith(sprite, 0, 50, 64, 50, 10, 70, 64, 50);
  });
  it('stops the scaffold at scaffoldH above the sprite bottom', () => {
    const g = {
      drawImage: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      fillStyle: '', globalAlpha: 1,
    };
    drawConstruction(g as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, 10, 20, 64, 100, { scaffold: 1, reveal: 0, done: false }, 60);
    // poles start at the scaffold top: y + h - 60
    expect(g.fillRect).toHaveBeenCalledWith(10, 60, 3, 60);
  });
  it('draws scaffold poles over a fully revealed sprite for an upgrade in progress', () => {
    const g = {
      drawImage: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      fillStyle: '', globalAlpha: 1,
    };
    drawConstruction(g as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, 10, 20, 64, 100, { scaffold: 1, reveal: 1, done: false });
    expect(g.drawImage).toHaveBeenCalledTimes(1);
    // four poles, full height, and the planks between them
    expect(g.fillRect).toHaveBeenCalledWith(10, 20, 3, 100);
    expect(g.fillRect).toHaveBeenCalledWith(71, 20, 3, 100);
    expect(g.fillRect.mock.calls.length).toBeGreaterThan(4);
  });
});
