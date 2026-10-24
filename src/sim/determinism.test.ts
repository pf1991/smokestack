import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { runAutoplay } from '../game/autoplay';
import { packState, unpackState } from '../game/saves';
import { stateHash } from './hash';
import { deserialize, runDays, runTicks, serialize } from './simulation';
import { buyHubTruck } from './logistics/hubs';
import { assign, hire, refreshMarket } from './logistics/managers';
import { buildRoad, lPath, placeBuilding } from './state';
import { must, testCtx, testState } from './testkit';
import { createGame } from './state';
import type { SimContext } from './types';

function start(seed: number): SimContext {
  const ctx = { state: createGame({ seed }), bus: new EventBus() };
  const r = runAutoplay(ctx);
  expect(r.ok ? 'ok' : r.error).toBe('ok');
  return ctx;
}

function run(seed: number, days: number): string {
  const ctx = start(seed);
  runDays(ctx, days);
  return stateHash(ctx.state);
}

describe('determinism', () => {
  it('stateHash is 8 hex digits and ignores speed', () => {
    const state = createGame({ seed: 7 });
    const h = stateHash(state);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(stateHash({ ...state, speed: 8 })).toBe(h);
  });

  it('two runs of the same seed hash equal; another seed differs', () => {
    const a = run(7, 720);
    expect(run(7, 720)).toBe(a);
    expect(run(8, 720)).not.toBe(a);
  });

  it('save → load → continue matches an uninterrupted run', () => {
    const a = start(7);
    runDays(a, 720);

    const b = start(7);
    runDays(b, 360);
    // the save carries a populated layer: towns have raised landmarks by now
    expect(b.state.cities.some((c) => c.landmarks.length > 0)).toBe(true);
    expect(b.state.layers.landmark?.some((v) => v > 0)).toBe(true);
    // ...and politics state: opinions have moved off the defaults and the drivers' bookkeeping is filled
    expect(b.state.cities.some((c) => c.opinion.workers !== 50 || c.opinion.reformers !== 50 || c.opinion.baron !== 35)).toBe(true);
    expect(b.state.politics.track.primed).toBe(true);
    expect(b.state.politics.track.buildings.length).toBeGreaterThan(0);
    expect(Object.values(b.state.politics.track.near).some((ids) => ids.length > 0)).toBe(true);
    const loaded = unpackState(packState(b.state));
    expect(loaded.ok ? 'ok' : loaded.error).toBe('ok');
    if (!loaded.ok) return;
    const c: SimContext = { state: loaded.value, bus: new EventBus() };
    runDays(c, 360);

    expect(c.state.politics).toEqual(a.state.politics);
    expect(c.state.cities.map((x) => x.opinion)).toEqual(a.state.cities.map((x) => x.opinion));
    expect(stateHash(c.state)).toBe(stateHash(a.state));
  });

  it('a hub saved and loaded mid-trip, then 30 days, matches an uninterrupted run', () => {
    const make = (): SimContext => {
      const s = testState({ width: 60, height: 30, money: 1e8 });
      const ctx = testCtx(s);
      refreshMarket(s, 1900);
      must(buildRoad(ctx, 'player', lPath({ x: 2, y: 12 }, { x: 58, y: 12 })));
      const hub = must(placeBuilding(ctx, 'player', 'warehouse', { x: 30, y: 9 }));
      const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 36, y: 9 }));
      const factory = must(placeBuilding(ctx, 'player', 'furniture_factory', { x: 24, y: 9 }));
      mill.output.lumber = 60;
      hub.input.lumber = 40;
      factory.input.lumber = 0;
      must(buyHubTruck(ctx, 'player', hub.id));
      must(buyHubTruck(ctx, 'player', hub.id));
      const m = must(hire(ctx, 'player', s.logistics.market[0].id));
      m.skills = { ...m.skills, logistics: 5 };
      s.logistics.rev++;
      must(assign(ctx, 'player', m.id, hub.id));
      return ctx;
    };
    const a = make();
    runTicks(a, 50); // day 3: both trucks are on the road to the factory
    expect(Object.values(a.state.vehicles).some((v) => v.job && v.state === 'moving')).toBe(true);
    const loaded = deserialize(serialize(a.state));
    expect(loaded.ok ? 'ok' : loaded.error).toBe('ok');
    if (!loaded.ok) return;
    const b: SimContext = { state: loaded.value.state, bus: new EventBus() };
    runDays(a, 30);
    runDays(b, 30);
    expect(a.state.logistics.stats.hubJobs.player).toBeGreaterThan(2);
    expect(stateHash(b.state)).toBe(stateHash(a.state));
  });
});
