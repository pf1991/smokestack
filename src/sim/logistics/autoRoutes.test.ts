import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { stateHash } from '../hash';
import { deserialize, runDays, runTicks, serialize } from '../simulation';
import { atPrices } from '../society/economy';
import { buildRoad, demolishBuilding, lPath, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, GameState, RouteStop, SimContext, Vehicle } from '../types';
import { assignVehicle, buyTruck, createRoute, updateRoute, vehiclePrice, vehiclesTick } from '../vehicles';
import {
  AUTO_BACKLOG_DAYS, AUTO_JOB_CAP, AUTO_MIN_JOB, AUTO_RESERVE, autoRoutesDay, departAuto, DIST_BIAS,
  MIN_LOAD_MAX_WAIT_TICKS,
} from './autoRoutes';
import { autoSizeRoutesMonth } from './autoSize';

const forest = (s: GameState, x: number, y: number) => {
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s.map.tiles[(y + dy) * s.map.width + x + dx].terrain = 'forest';
};
const centre = (b: Building) => {
  const { w, h } = BUILDINGS[b.typeId].size;
  return { x: b.pos.x + w / 2, y: b.pos.y + h / 2 };
};
const dist = (a: Building, b: Building) => {
  const p = centre(a);
  const q = centre(b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
};
const tick = (ctx: SimContext, n = 1) => {
  for (let i = 0; i < n; i++) {
    ctx.state.tick++;
    vehiclesTick(ctx);
  }
};
const cargo = (v: Vehicle) => Object.values(v.cargo).reduce((a, q) => a + q, 0);
const trucksOf = (s: GameState, routeId: number) => Object.values(s.vehicles).filter((v) => v.routeId === routeId);

/** camp (2,8) → sawmill (12,7) → furniture factory (22,7), road along y=10, as in spec §6.2. */
function chain(mode: 'auto' | 'manual' = 'auto') {
  const s = testState();
  const ctx = testCtx(s);
  forest(s, 2, 8);
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
  const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
  const factory = must(placeBuilding(ctx, 'player', 'furniture_factory', { x: 22, y: 7 }));
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 26, y: 10 })));
  const stops: RouteStop[] = [
    { buildingId: camp.id, load: ['wood'], unload: [] },
    { buildingId: mill.id, load: ['lumber'], unload: ['wood'] },
    { buildingId: factory.id, load: [], unload: ['lumber'] },
  ];
  const route = must(createRoute(ctx, 'player', 'Chain', stops));
  if (mode === 'auto') must(updateRoute(ctx, route.id, { mode: 'auto' }));
  s.companies.player.money = 1e7;
  return { s, ctx, camp, mill, factory, route };
}

/** camp (14,8) between mill A (8,7) and mill B (x, 7): stops [camp, B, A]. */
function fork(bx = 19) {
  const s = testState();
  const ctx = testCtx(s);
  forest(s, 14, 8);
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 14, y: 8 }));
  const millA = must(placeBuilding(ctx, 'player', 'sawmill', { x: 8, y: 7 }));
  const millB = must(placeBuilding(ctx, 'player', 'sawmill', { x: bx, y: 7 }));
  must(buildRoad(ctx, 'player', lPath({ x: 6, y: 10 }, { x: 30, y: 10 })));
  const route = must(createRoute(ctx, 'player', 'Fork', [
    { buildingId: camp.id, load: ['wood'], unload: [] },
    { buildingId: millB.id, load: [], unload: ['wood'] },
    { buildingId: millA.id, load: [], unload: ['wood'] },
  ]));
  must(updateRoute(ctx, route.id, { mode: 'auto' }));
  s.companies.player.money = 1e7;
  return { s, ctx, camp, millA, millB, route };
}

/** Ticks until `pred`, failing after `max` ticks. */
function until(ctx: SimContext, pred: () => boolean, max = 2000): number {
  for (let i = 1; i <= max; i++) {
    tick(ctx);
    if (pred()) return i;
  }
  throw new Error('condition never met');
}

describe('the job board (spec §6.2)', () => {
  it('scores jobs qty × basePrice / (distance + 8) and sorts them by score', () => {
    const { s, ctx, camp, mill, factory, route } = chain();
    camp.output.wood = 50;
    mill.output.lumber = 30;
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs).toEqual([
      { from: 1, to: 2, good: 'lumber', qty: 30, score: (30 * GOODS.lumber.basePrice) / (dist(mill, factory) + DIST_BIAS) },
      { from: 0, to: 1, good: 'wood', qty: 50, score: (50 * GOODS.wood.basePrice) / (dist(camp, mill) + DIST_BIAS) },
    ]);
    // jobs under AUTO_MIN_JOB units are dropped; fractions are not whole units
    mill.output.lumber = AUTO_MIN_JOB - 0.5;
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs!.map((j) => j.good)).toEqual(['wood']);
    // qty is bounded by the room at the drop
    mill.input.wood = 100;
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs![0].qty).toBe(20);
  });

  it('breaks equal scores by from, then to', () => {
    const { s, ctx, camp, millA, millB, route } = fork();
    expect(dist(camp, millA)).toBe(dist(camp, millB));
    camp.output.wood = 50;
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs!.map((j) => [j.from, j.to])).toEqual([[0, 1], [0, 2]]);
  });

  it(`caps the board at ${AUTO_JOB_CAP} jobs`, () => {
    const s = testState({ width: 60 });
    const ctx = testCtx(s);
    must(buildRoad(ctx, 'player', lPath({ x: 1, y: 10 }, { x: 58, y: 10 })));
    const stops: RouteStop[] = [];
    for (let i = 0; i < 9; i++) {
      const w = must(placeBuilding(ctx, 'player', 'warehouse', { x: 1 + i * 6, y: 7 }));
      w.input.wood = i % 2 === 0 ? 10 : 0;
      // 5 sources × 4 drops (pool-to-pool jobs are never made)
      stops.push({ buildingId: w.id, load: i % 2 === 0 ? ['wood'] : [], unload: i % 2 === 0 ? [] : ['wood'] });
    }
    const route = must(createRoute(ctx, 'player', 'Pool', stops));
    must(updateRoute(ctx, route.id, { mode: 'auto' }));
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs).toHaveLength(AUTO_JOB_CAP);
  });

  it('subtracts cargo promised to trucks heading for a pickup', () => {
    const { s, ctx, camp, route } = chain();
    camp.output.wood = 50;
    const v = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    expect(departAuto(s, v, s.routes[route.id])).toBe(0);
    expect(v.job).toEqual({ kind: 'collect', from: 0, to: 1, good: 'wood', qty: v.capacity });
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs![0].qty).toBe(50 - v.capacity);
  });

  it('counts a backlog day when yesterday left a job of a truck load untaken', () => {
    const { s, ctx, camp, route } = chain();
    must(buyTruck(ctx, 'player', route.id));
    camp.output.wood = 50;
    autoRoutesDay(ctx); // the first board: nothing was left from yesterday
    expect(s.routes[route.id].stats?.backlogDays ?? 0).toBe(0);
    autoRoutesDay(ctx);
    autoRoutesDay(ctx);
    expect(s.routes[route.id].stats!.backlogDays).toBe(2);
  });

  it('a manual route without auto-sizing gets no board and no stats', () => {
    const { s, ctx, camp, route } = chain('manual');
    camp.output.wood = 50;
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs).toBeUndefined();
    expect(s.routes[route.id].stats).toBeUndefined();
  });
});

describe('picking a job (spec §6.3)', () => {
  it('an empty truck takes the top job and loads only its good', () => {
    const s = testState();
    const ctx = testCtx(s);
    const store = must(placeBuilding(ctx, 'player', 'warehouse', { x: 2, y: 7 }));
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
    const factory = must(placeBuilding(ctx, 'player', 'furniture_factory', { x: 22, y: 7 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 26, y: 10 })));
    const route = must(createRoute(ctx, 'player', 'Pool', [
      { buildingId: store.id, load: ['wood', 'lumber'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
      { buildingId: factory.id, load: [], unload: ['lumber'] },
    ]));
    must(updateRoute(ctx, route.id, { mode: 'auto' }));
    store.input.wood = 50;
    store.input.lumber = 50;
    const v = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    expect(s.routes[route.id].jobs![0]).toMatchObject({ from: 0, to: 2, good: 'lumber', qty: 50 });
    until(ctx, () => cargo(v) > 0);
    expect(v.cargo).toEqual({ lumber: v.capacity });
    expect(store.input.wood).toBe(50);
    expect(s.routes[route.id].jobs![0].qty).toBe(50 - v.capacity);
    expect(v.job).toEqual({ kind: 'deliver', from: 0, to: 2, good: 'lumber', qty: v.capacity }); // no longer promised
    // and it carries the lumber to the factory
    until(ctx, () => (factory.input.lumber ?? 0) > 0);
    expect(factory.input.lumber).toBe(v.capacity);
  });

  it('a loaded truck heads for the nearest stop with room; with no room anywhere, the nearest that unloads', () => {
    const { s, millA, millB, route, ctx } = fork(22);
    expect(dist(s.buildings[route.stops[0].buildingId], millA)).toBeLessThan(dist(s.buildings[route.stops[0].buildingId], millB));
    const v = must(buyTruck(ctx, 'player', route.id));
    v.cargo = { wood: 20 };
    const r = s.routes[route.id];
    expect(departAuto(s, v, r)).toBe(2); // mill A, the nearer one
    v.stopIndex = 0;
    millA.input.wood = 120; // full
    expect(departAuto(s, v, r)).toBe(1);
    v.stopIndex = 0;
    millB.input.wood = 120;
    expect(departAuto(s, v, r)).toBe(2); // nowhere has room: wait at the nearest unloading stop
    v.stopIndex = 2;
    expect(departAuto(s, v, r)).toBe('wait'); // already there
    expect(v.job ?? null).toBeNull();
  });

  it('cargo with no room anywhere waits at the nearest unloading stop, then unloads when room appears', () => {
    const { s, ctx, camp, millA, millB, route } = fork(22);
    millA.input.wood = 120;
    millB.input.wood = 120;
    camp.output.wood = 0;
    const v = must(buyTruck(ctx, 'player', route.id));
    v.cargo = { wood: 20 };
    until(ctx, () => v.stopIndex === 2 && v.state === 'loading');
    const at = { ...v.pos };
    tick(ctx, 24 * 3);
    expect(v.state).toBe('loading');
    expect(v.pos).toEqual(at);
    expect(v.cargo).toEqual({ wood: 20 });
    millA.input.wood = 100; // room for 20
    tick(ctx, 25);
    expect(v.cargo).toEqual({});
    expect(millA.input.wood).toBe(120);
    expect(s.routes[route.id]).toBeDefined();
  });

  it('with no job the truck stays put and rechecks after 24 ticks', () => {
    const { s, ctx, camp, route } = chain();
    const v = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    until(ctx, () => v.state === 'loading');
    tick(ctx, 6); // the dwell ends: no job, so it waits
    expect(v.state).toBe('loading');
    expect(v.waitTicks).toBe(24);
    const at = { ...v.pos };
    tick(ctx, 23);
    expect(v.pos).toEqual(at);
    camp.output.wood = 50;
    autoRoutesDay(ctx);
    tick(ctx, 1); // the recheck finds the job at its own stop and loads in place
    expect(v.cargo).toEqual({ wood: v.capacity });
    expect(v.pos).toEqual(at);
    expect(s.routes[route.id].jobs![0].qty).toBe(50 - v.capacity);
  });

  it('over 360 days, empty departures only head for a pickup that had a job when chosen', () => {
    const { s, ctx, camp, mill, factory, route } = chain();
    for (let i = 0; i < 3; i++) must(buyTruck(ctx, 'player', route.id));
    const trucks = trucksOf(s, route.id);
    let loaded = 0;
    let empty = 0;
    let autoLoaded = 0;
    for (let day = 0; day < 360; day++) {
      camp.output.wood = (camp.output.wood ?? 0) + 30;
      const w = Math.floor(mill.input.wood ?? 0);
      mill.input.wood = (mill.input.wood ?? 0) - w;
      mill.output.lumber = (mill.output.lumber ?? 0) + w / 2;
      factory.input.lumber = 0;
      for (let t = 0; t < 24; t++) {
        const before = trucks.map((v) => [v.state, v.stopIndex] as const);
        tick(ctx);
        trucks.forEach((v, k) => {
          if (before[k][0] !== 'loading' || v.state === 'loading') return;
          if (cargo(v) > 0) autoLoaded++;
          // utilisation counts departures from stops that load something
          const counts = s.routes[route.id].stops[before[k][1]].load.length > 0;
          if (cargo(v) > 0) loaded += counts ? 1 : 0;
          else {
            empty += counts ? 1 : 0;
            expect(v.job, 'an empty departure carries a job').toBeTruthy();
            expect(v.job!.from).toBe(v.stopIndex);
          }
        });
      }
      autoRoutesDay(ctx);
    }
    expect(loaded).toBeGreaterThan(100);
    expect(empty).toBeGreaterThan(0);
    expect(s.routes[route.id].stats).toMatchObject({ loaded, empty });
    expect(s.logistics.stats.autoLoaded.player).toBe(autoLoaded);
  });

  it('removing a stop mid-job drops its jobs at the next rebuild without throwing', () => {
    const { s, ctx, camp, mill, factory, route } = chain();
    camp.output.wood = 60;
    mill.output.lumber = 60;
    const a = must(buyTruck(ctx, 'player', route.id));
    const b = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    for (const v of [a, b]) expect(departAuto(s, v, s.routes[route.id])).not.toBe('wait');
    expect(a.job).toBeTruthy();
    expect(b.job).toBeTruthy();
    must(updateRoute(ctx, route.id, {
      stops: [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: factory.id, load: [], unload: ['lumber'] },
      ],
    }));
    expect(() => autoRoutesDay(ctx)).not.toThrow();
    expect(s.routes[route.id].jobs).toEqual([]); // the factory takes no wood; the sawmill is gone
    for (const v of [a, b]) expect(v.job ?? null).toBeNull();
    expect(() => {
      for (let d = 0; d < 5; d++) {
        tick(ctx, 24);
        autoRoutesDay(ctx);
      }
    }).not.toThrow();
  });

  it('switching to manual or reassigning a truck drops its job; the counters go at the month end', () => {
    const { s, ctx, camp, route } = chain();
    camp.output.wood = 60;
    const a = must(buyTruck(ctx, 'player', route.id));
    const b = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    departAuto(s, a, s.routes[route.id]);
    departAuto(s, b, s.routes[route.id]);
    const other = must(createRoute(ctx, 'player', 'Other', s.routes[route.id].stops));
    must(assignVehicle(ctx, b.id, other.id));
    expect(b.job ?? null).toBeNull();
    expect(a.job).toBeTruthy();
    must(updateRoute(ctx, route.id, { mode: 'manual' }));
    expect(a.job ?? null).toBeNull();
    expect(s.routes[route.id].jobs).toBeUndefined();
    autoSizeRoutesMonth(ctx);
    expect(s.routes[route.id].stats).toBeUndefined();
  });

  it('a stop that loads and unloads the same good (a pool) is not a drop for what was just loaded there', () => {
    const s = testState();
    const ctx = testCtx(s);
    const store = must(placeBuilding(ctx, 'player', 'warehouse', { x: 2, y: 7 }));
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 16, y: 10 })));
    const route = must(createRoute(ctx, 'player', 'Pool', [
      { buildingId: store.id, load: ['wood'], unload: ['wood'] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    must(updateRoute(ctx, route.id, { mode: 'auto' }));
    store.input.wood = 50;
    must(buyTruck(ctx, 'player', route.id));
    for (let d = 0; d < 10; d++) {
      tick(ctx, 24);
      autoRoutesDay(ctx);
    }
    expect(mill.input.wood ?? 0).toBeGreaterThanOrEqual(40);
    expect(store.input.wood).toBeLessThanOrEqual(10);
    expect(s.routes[route.id].stats!.loaded).toBeGreaterThan(0);
  });

  it('two pool warehouses never pass goods between them', () => {
    const s = testState();
    const ctx = testCtx(s);
    const w1 = must(placeBuilding(ctx, 'player', 'warehouse', { x: 2, y: 7 }));
    const w2 = must(placeBuilding(ctx, 'player', 'warehouse', { x: 8, y: 7 }));
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 20, y: 7 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 24, y: 10 })));
    const route = must(createRoute(ctx, 'player', 'Pools', [
      { buildingId: w1.id, load: ['wood'], unload: ['wood'] },
      { buildingId: w2.id, load: ['wood'], unload: ['wood'] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    must(updateRoute(ctx, route.id, { mode: 'auto' }));
    w1.input.wood = 50;
    w2.input.wood = 50;
    for (let i = 0; i < 2; i++) must(buyTruck(ctx, 'player', route.id));
    let prev = [50, 50];
    for (let d = 0; d < 20; d++) {
      for (let t = 0; t < 24; t++) {
        tick(ctx);
        const now = [w1.input.wood ?? 0, w2.input.wood ?? 0];
        expect(now[0]).toBeLessThanOrEqual(prev[0]); // a pool only ever gives
        expect(now[1]).toBeLessThanOrEqual(prev[1]);
        prev = now;
      }
      mill.input.wood = 0; // the mill saws it all
      autoRoutesDay(ctx);
      for (const j of s.routes[route.id].jobs!) expect(j.to).toBe(2);
    }
    expect(prev[0] + prev[1]).toBeLessThan(100);
  });

  it('demolishing a stop mid-job drops the route\'s jobs and runs on', () => {
    const { s, ctx, camp, mill, route } = chain();
    camp.output.wood = 60;
    mill.output.lumber = 60;
    const a = must(buyTruck(ctx, 'player', route.id));
    const b = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    departAuto(s, a, s.routes[route.id]);
    departAuto(s, b, s.routes[route.id]);
    expect(a.job).toBeTruthy();
    must(demolishBuilding(ctx, mill.id));
    expect(a.job ?? null).toBeNull();
    expect(b.job ?? null).toBeNull();
    expect(s.routes[route.id].jobs).toEqual([]);
    expect(() => {
      for (let d = 0; d < 5; d++) {
        tick(ctx, 24);
        autoRoutesDay(ctx);
      }
    }).not.toThrow();
    for (const j of s.routes[route.id].jobs!) expect(j.from < 2 && j.to < 2).toBe(true);
  });

  it('cutting a route to one stop idles its trucks', () => {
    const { s, ctx, camp, route } = chain();
    camp.output.wood = 60;
    const v = must(buyTruck(ctx, 'player', route.id));
    autoRoutesDay(ctx);
    tick(ctx, 30);
    must(updateRoute(ctx, route.id, { stops: [{ buildingId: camp.id, load: ['wood'], unload: [] }] }));
    expect(() => autoRoutesDay(ctx)).not.toThrow();
    expect(s.routes[route.id].jobs).toEqual([]);
    tick(ctx, 30);
    expect(v.state).toBe('idle');
  });

  it('a save at a mid-day tick reloads and runs 30 days exactly like an uninterrupted game', () => {
    const { s, ctx, camp, mill, route } = chain();
    camp.output.wood = 200;
    mill.output.lumber = 60;
    for (let i = 0; i < 3; i++) must(buyTruck(ctx, 'player', route.id));
    runTicks(ctx, 24 * 5 + 7);
    expect(s.routes[route.id].jobs!.length).toBeGreaterThan(0);
    expect(trucksOf(s, route.id).some((v) => v.job || cargo(v) > 0)).toBe(true);
    const r = deserialize(serialize(s));
    if (!r.ok) throw new Error(r.error);
    const loaded: SimContext = { state: r.value.state, bus: new EventBus() };
    runDays(ctx, 30);
    runDays(loaded, 30);
    expect(stateHash(loaded.state)).toBe(stateHash(s));
  });
});

describe('smart waits (manual routes, D10)', () => {
  function line(minLoad: number) {
    const { s, ctx, camp, mill } = chain('manual');
    const route = must(createRoute(ctx, 'player', 'Wood', [
      { buildingId: camp.id, load: ['wood'], unload: [], minLoad },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    return { s, ctx, camp, mill, route };
  }

  it('minLoad 1 holds a truck until it is full', () => {
    const { s, ctx, camp, route } = line(1);
    expect(s.routes[route.id].stops[0].minLoad).toBe(1);
    camp.output.wood = 5;
    const v = must(buyTruck(ctx, 'player', route.id));
    until(ctx, () => v.state === 'loading');
    expect(cargo(v)).toBe(5);
    let ticks = 0;
    while (v.state === 'loading') {
      if (ticks % 24 === 0) camp.output.wood = (camp.output.wood ?? 0) + 5;
      tick(ctx);
      ticks++;
      expect(ticks).toBeLessThan(24 * 10);
    }
    expect(cargo(v)).toBe(v.capacity);
    expect(v.dwell ?? 0).toBe(0); // reset on departure
  });

  it(`minLoad 1 gives up after ${MIN_LOAD_MAX_WAIT_TICKS} ticks (10 days)`, () => {
    const { ctx, camp, route } = line(1);
    camp.output.wood = 5;
    const v = must(buyTruck(ctx, 'player', route.id));
    until(ctx, () => v.state === 'loading');
    const waited = until(ctx, () => v.state !== 'loading', 400);
    expect(waited).toBe(6 + MIN_LOAD_MAX_WAIT_TICKS);
    expect(cargo(v)).toBe(5);
    expect(v.dwell ?? 0).toBe(0);
  });

  it('a reassignment or a mode switch starts the smart wait afresh', () => {
    const { s, ctx, camp, route } = line(1);
    camp.output.wood = 5;
    const v = must(buyTruck(ctx, 'player', route.id));
    until(ctx, () => (v.dwell ?? 0) > 0);
    must(updateRoute(ctx, route.id, { mode: 'auto' }));
    expect(v.dwell ?? 0).toBe(0);
    must(updateRoute(ctx, route.id, { mode: 'manual' }));
    until(ctx, () => (v.dwell ?? 0) > 0);
    must(assignVehicle(ctx, v.id, must(createRoute(ctx, 'player', 'Other', s.routes[route.id].stops)).id));
    expect(v.dwell ?? 0).toBe(0);
  });

  it('minLoad 0 leaves at once, as before', () => {
    const { ctx, camp, route } = line(0);
    camp.output.wood = 5;
    const v = must(buyTruck(ctx, 'player', route.id));
    until(ctx, () => v.state === 'loading');
    expect(until(ctx, () => v.state !== 'loading')).toBe(6);
  });

  it('updateRoute accepts only 0, 0.5 or 1', () => {
    const { ctx, camp, mill, route } = line(0);
    const stops = (minLoad: number): RouteStop[] => [
      { buildingId: camp.id, load: ['wood'], unload: [], minLoad },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ];
    expect(updateRoute(ctx, route.id, { stops: stops(0.5) }).ok).toBe(true);
    expect(ctx.state.routes[route.id].stops[0].minLoad).toBe(0.5);
    expect(updateRoute(ctx, route.id, { stops: stops(0.3) }).ok).toBe(false);
  });
});

describe('auto-sizing (spec §6.4)', () => {
  function sized(trucks: number, maxTrucks = 3) {
    const w = chain();
    for (let i = 0; i < trucks; i++) must(buyTruck(w.ctx, 'player', w.route.id));
    must(updateRoute(w.ctx, w.route.id, { autoSize: { on: true, maxTrucks } }));
    return w;
  }
  const busy = { loaded: 9, empty: 1, backlogDays: 12 };
  const reserve = (s: GameState) => atPrices(s, AUTO_RESERVE);

  it('buys one truck at u = 0.9 with 12 backlog days, then resets the counters', () => {
    const { s, ctx, route } = sized(1);
    s.routes[route.id].stats = { ...busy };
    const money = s.companies.player.money;
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(2);
    expect(money - s.companies.player.money).toBe(vehiclePrice(s, 'truck'));
    expect(s.routes[route.id].stats).toMatchObject({ loaded: 0, empty: 0, backlogDays: 0 });
  });

  it(`buys nothing with fewer than ${AUTO_BACKLOG_DAYS} backlog days or u ≤ 0.85`, () => {
    const { s, ctx, route } = sized(1);
    s.routes[route.id].stats = { loaded: 9, empty: 1, backlogDays: AUTO_BACKLOG_DAYS - 1 };
    autoSizeRoutesMonth(ctx);
    s.routes[route.id].stats = { loaded: 85, empty: 15, backlogDays: 20 };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(1);
  });

  it('sells the oldest truck (lowest builtYear, then lowest id) at u = 0.5', () => {
    const { s, ctx, route } = sized(3);
    const [a, b, c] = trucksOf(s, route.id);
    a.builtYear = 1900;
    b.builtYear = 1898;
    c.builtYear = 1898;
    s.routes[route.id].stats = { loaded: 5, empty: 5, backlogDays: 0 };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id).map((v) => v.id)).toEqual([a.id, c.id]);
  });

  for (const mode of ['manual', 'auto'] as const) {
    it(`a busy 2-stop ${mode} route grows its fleet: return legs from an unload-only stop are not waste`, () => {
      const { s, ctx, camp, mill } = chain();
      const route = must(createRoute(ctx, 'player', 'Wood', [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: mill.id, load: [], unload: ['wood'] },
      ]));
      must(updateRoute(ctx, route.id, { mode, autoSize: { on: true, maxTrucks: 4 } }));
      for (let i = 0; i < 2; i++) must(buyTruck(ctx, 'player', route.id));
      for (let d = 0; d < 30; d++) {
        camp.output.wood = 120;
        mill.input.wood = 0;
        tick(ctx, 24);
        autoRoutesDay(ctx);
      }
      expect(s.routes[route.id].stats!.empty).toBe(0);
      autoSizeRoutesMonth(ctx);
      expect(s.routes[route.id].stats!.last).toBe(100);
      expect(trucksOf(s, route.id)).toHaveLength(3);
    });
  }

  it('never sells the last truck', () => {
    const { s, ctx, route } = sized(1);
    s.routes[route.id].stats = { loaded: 0, empty: 10, backlogDays: 0 };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(1);
  });

  it('never exceeds maxTrucks, clamped to 1–20', () => {
    const { s, ctx, route } = sized(2, 2);
    s.routes[route.id].stats = { ...busy };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(2);
    must(updateRoute(ctx, route.id, { autoSize: { on: true, maxTrucks: 50 } }));
    expect(s.routes[route.id].autoSize).toEqual({ on: true, maxTrucks: 20 });
    must(updateRoute(ctx, route.id, { autoSize: { on: true, maxTrucks: 0 } }));
    expect(s.routes[route.id].autoSize).toEqual({ on: true, maxTrucks: 1 });
  });

  it('never buys below the reserve', () => {
    const { s, ctx, route } = sized(1);
    const price = vehiclePrice(s, 'truck');
    s.companies.player.money = price + reserve(s) - 1;
    s.routes[route.id].stats = { ...busy };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(1);
    s.companies.player.money = price + reserve(s);
    s.routes[route.id].stats = { ...busy };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(2);
    expect(s.companies.player.money).toBe(reserve(s));
  });

  it('buys nothing for a company with negative cash', () => {
    const { s, ctx, route } = sized(1);
    s.companies.player.money = -1000;
    s.routes[route.id].stats = { ...busy };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(1);
  });

  it('leaves a route with auto-sizing off alone', () => {
    const { s, ctx, route } = chain();
    must(buyTruck(ctx, 'player', route.id));
    s.routes[route.id].stats = { ...busy };
    autoSizeRoutesMonth(ctx);
    expect(trucksOf(s, route.id)).toHaveLength(1);
  });
});
