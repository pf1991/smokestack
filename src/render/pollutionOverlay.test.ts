import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/state';
import type { Camera } from './constants';
import { pollutionOverlay, resetSmogLegend, setSmogLegendSurfaceFactory, smogLegendRenders } from './pollutionOverlay';

function mockCtx() {
  const calls: string[] = [];
  const texts: string[] = [];
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get: (t, k) => {
      if (k in t) return t[k];
      return (...a: unknown[]) => {
        calls.push(String(k));
        if (k === 'fillText') texts.push(String(a[0]));
        if (k === 'createLinearGradient') return { addColorStop: () => undefined };
      };
    },
    set: (t, k, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls, texts };
}
const cam: Camera = { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 };

describe('pollutionOverlay legend', () => {
  it('paints the Clean / Hazy / Choking ramp once into a cache and blits it every frame', () => {
    const state = createGame({ seed: 7 });
    const legend = mockCtx();
    setSmogLegendSurfaceFactory((w, h) => ({ canvas: { width: w, height: h } as unknown as HTMLCanvasElement, g: legend.g }));
    resetSmogLegend();
    pollutionOverlay.enabled = true;
    try {
      const before = smogLegendRenders();
      const frames = [mockCtx(), mockCtx(), mockCtx()];
      for (const f of frames) pollutionOverlay.draw(f.g, state, cam);
      expect(smogLegendRenders() - before).toBe(1);
      expect(legend.texts).toEqual(expect.arrayContaining(['Clean', 'Hazy', 'Choking']));
      for (const f of frames) {
        expect(f.calls).not.toContain('createLinearGradient');
        expect(f.calls).toContain('drawImage');
      }
    } finally {
      pollutionOverlay.enabled = false;
    }
  });
});
