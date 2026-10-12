import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import { testState } from '../../sim/testkit';
import { WorldRenderer } from './index';
import { UrbanWatch } from './survey';

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
