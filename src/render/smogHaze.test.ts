import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/state';
import { POLLUTION_CAP } from '../sim/pollution';
import type { Camera } from './constants';
import { SmogHaze, hazeAlpha, type HazeSurface } from './smogHaze';

/** A context that records method calls; createImageData hands back a real pixel buffer. */
function mockCtx(calls: string[] = []): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(props, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return (..._a: unknown[]) => void calls.push(String(k));
    },
    set: (t, k, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

const surfaces = (made: { n: number }) => (w: number, h: number): HazeSurface => {
  made.n++;
  return { canvas: { width: w, height: h } as unknown as HazeSurface['canvas'], g: mockCtx() };
};

describe('hazeAlpha', () => {
  it('is 0 when clean and 0.45 at the cap', () => {
    expect(hazeAlpha(0)).toBe(0);
    expect(hazeAlpha(POLLUTION_CAP)).toBe(0.45);
  });

  it('never decreases', () => {
    let prev = -1;
    for (let p = 0; p <= POLLUTION_CAP; p += 0.5) {
      const a = hazeAlpha(p);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});

describe('SmogHaze cache', () => {
  function pollutedGame() {
    const state = createGame({ seed: 7 });
    for (const t of state.map.tiles) t.pollution = 0;
    // a smoky district in the top-left chunks
    for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) state.map.tiles[y * state.map.width + x].pollution = 60;
    return state;
  }
  const cam: Camera = { x: 0, y: 0, zoom: 2, viewW: 1024, viewH: 1024 };

  it('rebuilds chunks in view once, then only when the day changes', () => {
    const state = pollutedGame();
    const made = { n: 0 };
    const haze = new SmogHaze(surfaces(made));
    const calls: string[] = [];
    const ctx = mockCtx(calls);
    // enough frames for the per-frame budget to cover every chunk in view
    for (let i = 0; i < 20; i++) haze.draw(ctx, state, cam, 1, i * 16);
    const first = haze.rebuilds;
    expect(first).toBeGreaterThan(0);
    expect(calls).toContain('drawImage');
    for (let i = 0; i < 20; i++) haze.draw(ctx, state, cam, 1, 400 + i * 16);
    expect(haze.rebuilds).toBe(first); // same day: nothing rebuilt
    state.date.hour = (state.date.hour + 5) % 24;
    for (let i = 0; i < 20; i++) haze.draw(ctx, state, cam, 1, 800 + i * 16);
    expect(haze.rebuilds).toBe(first); // a new hour is not a new day
    state.date.day = (state.date.day % 30) + 1;
    for (let i = 0; i < 20; i++) haze.draw(ctx, state, cam, 1, 1200 + i * 16);
    expect(haze.rebuilds).toBe(first * 2); // new day: each chunk in view once more
    const surfacesMade = made.n;
    state.date.day = (state.date.day % 30) + 1;
    for (let i = 0; i < 20; i++) haze.draw(ctx, state, cam, 1, 1600 + i * 16);
    expect(made.n).toBe(surfacesMade); // canvases are reused
  });

  it('caps chunk rebuilds per frame', () => {
    const state = pollutedGame();
    const haze = new SmogHaze(surfaces({ n: 0 }));
    haze.draw(mockCtx(), state, { ...cam, zoom: 0.5, viewW: 4096, viewH: 4096 }, 1, 0);
    expect(haze.rebuilds).toBeLessThanOrEqual(SmogHaze.REBUILDS_PER_FRAME);
  });

  it('draws nothing in the survey regime or over clean land', () => {
    const state = pollutedGame();
    const haze = new SmogHaze(surfaces({ n: 0 }));
    const calls: string[] = [];
    haze.draw(mockCtx(calls), state, cam, 0, 0);
    expect(calls).toEqual([]);
    expect(haze.rebuilds).toBe(0);
    for (const t of state.map.tiles) t.pollution = 0;
    const c2: string[] = [];
    for (let i = 0; i < 20; i++) haze.draw(mockCtx(c2), state, cam, 1, i * 16);
    expect(c2).not.toContain('drawImage');
  });
});
