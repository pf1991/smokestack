import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/state';
import type { Camera } from './constants';
import { factionOverlay, opinionColor, setFactionMode } from './factionOverlay';

function mockCtx() {
  const calls: string[] = [];
  const texts: string[] = [];
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      return (...a: unknown[]) => {
        calls.push(String(k));
        if (k === 'fillText') texts.push(String(a[0]));
      };
    },
    set: (t, k, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls, texts };
}
const cam: Camera = { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 };

describe('factionOverlay', () => {
  it('opinionColor hits the three anchors', () => {
    expect(opinionColor(0)).toBe('#b03a2e');
    expect(opinionColor(50)).toBe('#9a9184');
    expect(opinionColor(100)).toBe('#3f8f5a');
  });

  it('draws nothing when disabled', () => {
    const { g, calls } = mockCtx();
    factionOverlay.enabled = false;
    factionOverlay.draw(g, createGame({ seed: 7 }), cam);
    expect(calls).toEqual([]);
  });

  it('draws one disc per city plus the legend', () => {
    const state = createGame({ seed: 7 });
    const { g, calls, texts } = mockCtx();
    factionOverlay.enabled = true;
    setFactionMode('mayor');
    factionOverlay.draw(g, state, cam);
    expect(calls.filter((c) => c === 'arc').length).toBe(state.cities.length);
    expect(texts).toContain('Workers');
    const m = mockCtx();
    setFactionMode('workers');
    factionOverlay.draw(m.g, state, cam);
    expect(m.texts).toEqual(expect.arrayContaining(['0', '50', '100']));
    setFactionMode('mayor');
    factionOverlay.enabled = false;
  });
});
