import { describe, expect, it } from 'vitest';
import { placeBuilding } from '../sim/state';
import { must, testCtx, testState } from '../sim/testkit';
import type { GameState } from '../sim/types';
import { protestSite } from '../sim/society/escalation';
import { drawMarchers, drawPickets, marcherCount, MAX_MARCHERS, MAX_PICKETS, MIN_MARCHERS, MIN_PICKETS, PATH_TILES, picketCount, picketPath, Protesters, protestRoute } from './protesters';
import { dateToDays } from '../sim/clock';

/** A context that records every method call and accepts any property write. */
function mockCtx(): { g: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get: (t, k) => (k in t ? t[k] : (..._args: unknown[]) => { calls.push(String(k)); }),
    set: (t, k, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

const count = (calls: string[], name: string) => calls.filter((c) => c === name).length;
const ALL = { x0: 0, y0: 0, x1: 999, y1: 999 };

/** Two towns with streets, a player sawmill by each (in the zone, beside a street). */
function scene(): GameState {
  const ctx = testCtx(testState({ width: 100, height: 60, money: 1e7, streets: true, cities: [{ x: 20, y: 20 }, { x: 70, y: 30 }] }));
  must(placeBuilding(ctx, 'player', 'sawmill', { x: 29, y: 19 }));
  must(placeBuilding(ctx, 'player', 'sawmill', { x: 79, y: 29 }));
  // a street beside each site
  for (const [x0, y] of [[27, 21], [77, 31]]) for (let x = x0; x < x0 + 6; x++) ctx.state.map.tiles[y * 100 + x].road = true;
  return ctx.state;
}

describe('protesters', () => {
  it('5–9 marchers per town, fixed per town', () => {
    const state = scene();
    for (const c of state.cities) {
      const n = marcherCount(c);
      expect(n).toBeGreaterThanOrEqual(MIN_MARCHERS);
      expect(n).toBeLessThanOrEqual(MAX_MARCHERS);
      expect(marcherCount(c)).toBe(n);
    }
  });

  it('the route walks road tiles from the site, at most PATH_TILES long', () => {
    const state = scene();
    const path = protestRoute(state, protestSite(state, state.cities[0])!);
    expect(path.length).toBeGreaterThan(1);
    expect(path.length).toBeLessThanOrEqual(PATH_TILES);
    for (const p of path) expect(state.map.tiles[p.y * 100 + p.x].road).toBe(true);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y)).toBe(1);
  });

  it('draws one batch per tier-3+ town: the same calls whatever the marcher count', () => {
    const a = mockCtx();
    drawMarchers(a.g, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], 5, 0, 1234);
    const b = mockCtx();
    drawMarchers(b.g, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], 9, 0, 1234);
    expect(count(a.calls, 'fill')).toBe(4);
    expect(count(a.calls, 'stroke')).toBe(2);
    expect(count(b.calls, 'fill')).toBe(4);
    expect(count(b.calls, 'stroke')).toBe(2);
    expect(count(b.calls, 'rect')).toBeGreaterThan(count(a.calls, 'rect'));

    const state = scene();
    const p = new Protesters();
    const none = mockCtx();
    p.draw(none.g, state, ALL, 0);
    expect(none.calls).toEqual([]);
    state.cities[0].smog.tier = 3;
    const one = mockCtx();
    p.draw(one.g, state, ALL, 0);
    expect(count(one.calls, 'fill')).toBe(4);
    state.cities[1].smog.tier = 4;
    const two = mockCtx();
    p.draw(two.g, state, ALL, 0);
    expect(count(two.calls, 'fill')).toBe(8);
    expect(count(two.calls, 'save')).toBe(2);
    // a town out of view is culled
    const culled = mockCtx();
    p.draw(culled.g, state, { x0: 0, y0: 0, x1: 45, y1: 59 }, 0);
    expect(count(culled.calls, 'fill')).toBe(4);
  });

  it('caches the route per town per month', () => {
    const state = scene();
    state.cities[0].smog.tier = 3;
    const p = new Protesters();
    const r1 = p.route(state, state.cities[0]);
    expect(p.route(state, state.cities[0])).toBe(r1);
    state.date.month = state.date.month === 12 ? 1 : state.date.month + 1;
    expect(p.route(state, state.cities[0])).not.toBe(r1);
  });

  it('nothing to draw without a player polluter in the zone', () => {
    const ctx = testCtx(testState({ width: 60, height: 60, streets: true, cities: [{ x: 20, y: 20 }] }));
    ctx.state.cities[0].smog.tier = 3;
    const m = mockCtx();
    new Protesters().draw(m.g, ctx.state, ALL, 0);
    expect(m.calls).toEqual([]);
  });
});

describe('strike pickets', () => {
  it('3–5 per striking works, fixed per building', () => {
    const state = scene();
    const seen = new Set<number>();
    for (let id = 1; id < 60; id++) {
      const n = picketCount({ ...Object.values(state.buildings)[0], id });
      expect(n).toBeGreaterThanOrEqual(MIN_PICKETS);
      expect(n).toBeLessThanOrEqual(MAX_PICKETS);
      seen.add(n);
    }
    expect(seen.size).toBe(3);
  });

  it('stand on the access road tile (and the next road tile along)', () => {
    const state = scene();
    const mill = Object.values(state.buildings)[0];
    const path = picketPath(state, mill);
    expect(path.length).toBeGreaterThanOrEqual(1);
    for (const p of path) expect(state.map.tiles[p.y * state.map.width + p.x].road).toBe(true);
  });

  it('are drawn only at works on strike', () => {
    const state = scene();
    const [a, b] = Object.values(state.buildings);
    const today = dateToDays(state.date);
    const idle = mockCtx();
    drawPickets(idle.g, state, [a, b], 0);
    expect(idle.calls).toEqual([]);
    a.strike = { until: today + 30, reason: 'Pay and hours', since: today, cityId: 0, open: false };
    const one = mockCtx();
    drawPickets(one.g, state, [a, b], 0);
    expect(count(one.calls, 'fill')).toBe(4);
    // an ended strike draws nothing
    a.strike.until = today;
    const none = mockCtx();
    drawPickets(none.g, state, [a, b], 0);
    expect(none.calls).toEqual([]);
  });
});
