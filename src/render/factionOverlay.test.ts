import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/state';
import type { Camera } from './constants';
import { factionOverlay, legendRenders, opinionColor, resetFactionCaches, setFactionMode, setLegendSurfaceFactory } from './factionOverlay';

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
    expect(texts).toEqual([]); // the legend is drawn separately, after the post effects
    factionOverlay.drawLegend!(g, state, cam);
    expect(texts).toContain('Workers');
    const m = mockCtx();
    setFactionMode('workers');
    factionOverlay.drawLegend!(m.g, state, cam);
    expect(m.texts).toEqual(expect.arrayContaining(['35', '50', '65']));
    setFactionMode('mayor');
    factionOverlay.enabled = false;
  });

  it('caches fills per month and rebuilds on a new month, mode or game', () => {
    const state = createGame({ seed: 7 });
    factionOverlay.enabled = true;
    resetFactionCaches();
    setFactionMode('mayor');
    const fillStyles = (st: typeof state): unknown[] => {
      const styles: unknown[] = [];
      const m = mockCtx();
      const g = new Proxy(m.g, {
        get: (t, k) => (k === 'fill' ? () => styles.push((t as unknown as Record<string, unknown>).fillStyle) : (t as unknown as Record<string | symbol, unknown>)[k]),
        set: (t, k, v) => { (t as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
      });
      factionOverlay.draw(g, st, cam);
      return styles;
    };
    const first = fillStyles(state);
    state.cities[0].politics.mayor.faction = state.cities[0].politics.mayor.faction === 'church' ? 'baron' : 'church';
    expect(fillStyles(state)).toEqual(first); // same month: cached
    state.date.month = (state.date.month % 12) + 1;
    expect(fillStyles(state)).not.toEqual(first); // new month: rebuilt
    const before = fillStyles(state);
    const other = createGame({ seed: 7 });
    other.date = { ...state.date };
    const cur: string = state.cities[0].politics.mayor.faction;
    other.cities[0].politics.mayor.faction = cur === 'workers' ? 'oldmoney' : 'workers';
    expect(fillStyles(other)).not.toEqual(before); // new game, same month and mode
    factionOverlay.enabled = false;
  });

  it('paints the legend once per stamp, not per frame', () => {
    const state = createGame({ seed: 7 });
    factionOverlay.enabled = true;
    setLegendSurfaceFactory((w, h) => ({ canvas: { width: w, height: h } as unknown as HTMLCanvasElement, g: mockCtx().g }));
    resetFactionCaches();
    setFactionMode('mayor');
    const { g } = mockCtx();
    const n = legendRenders;
    factionOverlay.drawLegend!(g, state, cam);
    factionOverlay.drawLegend!(g, state, cam);
    factionOverlay.drawLegend!(g, state, cam);
    expect(legendRenders).toBe(n + 1);
    setFactionMode('workers');
    factionOverlay.drawLegend!(g, state, cam);
    expect(legendRenders).toBe(n + 2);
    setFactionMode('mayor');
    factionOverlay.enabled = false;
  });
});
