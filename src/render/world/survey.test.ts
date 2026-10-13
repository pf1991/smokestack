import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import { testState } from '../../sim/testkit';
import { WorldRenderer } from './index';
import { FACTIONS } from '../../data/factions';
import { CityLabelCache, UrbanWatch, drawCityLabels } from './survey';

/** A canvas whose 2D context accepts every call, so the renderer can be built under jsdom. */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  return { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
}

const monthEnd = (bus: EventBus) => bus.emit({ type: 'monthEnd', date: { year: 1900, month: 5, day: 1, hour: 0 } });

describe('survey invalidation', () => {
  it('a monthEnd with no city change leaves the survey surfaces clean', () => {
    const state = testState({ cities: [{ x: 10, y: 10 }, { x: 30, y: 20 }] });
    const r = new WorldRenderer(fakeCanvas(), state);
    const bus = new EventBus();
    r.attachEffects(bus);
    const terrain = (r as unknown as { terrain: { invalidateRect: () => void; invalidateAll: () => void } }).terrain;
    const rect = vi.spyOn(terrain, 'invalidateRect');
    const all = vi.spyOn(terrain, 'invalidateAll');
    monthEnd(bus);
    bus.emit({ type: 'ownershipChanged', from: 'player', to: 'rival' });
    expect(rect).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();

    // a city whose urban radius grows dirties just its disc's bounding box (plus a margin)
    state.cities[0].urbanRadius += 1;
    monthEnd(bus);
    const rad = state.cities[0].urbanRadius;
    expect(rect).toHaveBeenCalledTimes(2); // old and new extent
    expect(rect).toHaveBeenLastCalledWith(10 - rad - 1, 10 - rad - 1, 10 + rad + 1, 10 + rad + 1);
    expect(all).not.toHaveBeenCalled();
  });
});

describe('UrbanWatch', () => {
  it('reports discs that appear, change or vanish, and nothing otherwise', () => {
    const cities = testState({ cities: [{ x: 5, y: 5 }] }).cities;
    const w = new UrbanWatch(cities);
    const dirty = vi.fn();
    w.update(cities, dirty);
    expect(dirty).not.toHaveBeenCalled();
    const r = cities[0].urbanRadius;
    w.update([], dirty);
    expect(dirty).toHaveBeenCalledWith(5 - r, 5 - r, 5 + r, 5 + r);
    dirty.mockClear();
    w.update(cities, dirty);
    expect(dirty).toHaveBeenCalledTimes(1);
  });
});

describe('city label mayor dot', () => {
  it('takes its colour from the current mayor faction', () => {
    const state = testState({ cities: [{ x: 10, y: 10 }] });
    const cache = new CityLabelCache();
    const fills: unknown[] = [];
    const props: Record<string | symbol, unknown> = {};
    const g = new Proxy(props, {
      get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 40 });
        if (k === 'fill') return () => fills.push(t.fillStyle);
        return () => undefined;
      },
      set: (t, k, v) => { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const cam = { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 };
    state.cities[0].politics.mayor.faction = 'church';
    drawCityLabels(g, state, cam, 1, [], cache);
    state.cities[0].politics.mayor.faction = 'baron';
    drawCityLabels(g, state, cam, 1, [], cache);
    expect(fills).toEqual([FACTIONS.church.color, FACTIONS.baron.color]);
  });
});

describe('city label protest fist', () => {
  it('counts the fist in the label box, so HUD avoidance and collisions see it', () => {
    const state = testState({ cities: [{ x: 10, y: 10 }] });
    const cache = new CityLabelCache();
    const texts: number[] = [];
    const props: Record<string | symbol, unknown> = {};
    const g = new Proxy(props, {
      get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 40 });
        if (k === 'fillText') return (_s: string, x: number) => texts.push(x);
        return () => undefined;
      },
      set: (t, k, v) => { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const cam = { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 };
    drawCityLabels(g, state, cam, 1, [], cache);
    expect(texts).toHaveLength(1);
    // a HUD rect starting just past the plain label's box (text centre + 20 px of text + 4 px pad)
    const tx = texts[0];
    const y = (10 + 0.5) * 32;
    const hud = [{ x: tx + 26, y: y - 50, w: 100, h: 100 }];
    drawCityLabels(g, state, cam, 1, hud, cache);
    expect(texts).toHaveLength(2);
    state.cities[0].smog.tier = 3;
    drawCityLabels(g, state, cam, 1, hud, cache);
    expect(texts).toHaveLength(2);
  });
});
