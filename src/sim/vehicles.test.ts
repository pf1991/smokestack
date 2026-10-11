import { describe, it, expect } from 'vitest';
import type { GameEvent } from '../core/events';
import { BUILDINGS } from '../data/buildings';
import { accessTiles, buildRoad, demolishBuilding, lPath, placeBuilding, removeRoad } from './state';
import { findPath, roadPassable } from './pathfinding';
import { testCtx, testState } from './testkit';
import type { Building, GameState, SimContext, Terrain, Vehicle } from './types';
import { deserialize, serialize } from './simulation';
import {
  assignVehicle,
  buyTruck,
  createRoute,
  deleteRoute,
  insertStop,
  sellVehicle,
  TRUCK,
  tripsLast30,
  updateRoute,
  vehicleMaintenanceMonth,
  vehiclesTick,
} from './vehicles';

const tile = (s: GameState, x: number, y: number) => s.map.tiles[y * s.map.width + x];
const setTerrain = (s: GameState, x0: number, y0: number, w: number, h: number, t: Terrain) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tile(s, x, y).terrain = t;
};

/** Advances the clock one tick and runs the vehicle system (what Task 17's stepTick will do). */
function tick(ctx: SimContext, n = 1): void {
  for (let i = 0; i < n; i++) {
    ctx.state.tick++;
    vehiclesTick(ctx);
  }
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/**
 * Road along y=10 from x=2 to x=14. Lumber camp at (2,8) (access (2,10),(3,10)); sawmill at (12,7)
 * (access (12,10)..(14,10)). Camp's first access tile (2,10) is exactly 10 tiles from (12,10).
 */
function world() {
  const s = testState();
  const ctx = testCtx(s);
  setTerrain(s, 2, 8, 2, 2, 'forest');
  setTerrain(s, 20, 8, 2, 2, 'forest');
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
  const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
  const camp2 = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 20, y: 8 }));
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 21, y: 10 })));
  return { s, ctx, camp, mill, camp2 };
}

function woodRoute(ctx: SimContext, from: Building, to: Building) {
  return must(
    createRoute(ctx, 'player', 'Wood run', [
      { buildingId: from.id, load: ['wood'], unload: [] },
      { buildingId: to.id, load: [], unload: ['wood'] },
    ]),
  );
}

function tickUntil(ctx: SimContext, pred: () => boolean, max = 500): number {
  for (let i = 1; i <= max; i++) {
    tick(ctx);
    if (pred()) return i;
  }
  throw new Error('condition never met');
}

describe('routes', () => {
  it('validates stops', () => {
    const { ctx, camp, mill } = world();
    expect(createRoute(ctx, 'player', 'x', [{ buildingId: camp.id, load: [], unload: [] }])).toEqual({
      ok: false,
      error: 'A route needs at least two stops',
    });
    expect(
      createRoute(ctx, 'rival', 'x', [
        { buildingId: camp.id, load: [], unload: [] },
        { buildingId: mill.id, load: [], unload: [] },
      ]),
    ).toEqual({ ok: false, error: 'Not your building' });
    const s2 = testState();
    const ctx2 = testCtx(s2);
    setTerrain(s2, 2, 8, 2, 2, 'forest');
    const a = must(placeBuilding(ctx2, 'player', 'lumber_camp', { x: 2, y: 8 }));
    const b = must(placeBuilding(ctx2, 'player', 'sawmill', { x: 12, y: 7 }));
    expect(
      createRoute(ctx2, 'player', 'x', [
        { buildingId: a.id, load: [], unload: [] },
        { buildingId: b.id, load: [], unload: [] },
      ]),
    ).toEqual({ ok: false, error: 'Stop has no road access' });
  });

  it('colours by id from a palette and charges for trucks', () => {
    const { s, ctx, camp, mill } = world();
    const r = woodRoute(ctx, camp, mill);
    expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
    const before = s.companies.player.money;
    const v = must(buyTruck(ctx, 'player', r.id));
    expect(s.companies.player.money).toBe(before - TRUCK.cost);
    expect(v.pos).toEqual({ x: 2, y: 10 });
    expect(v.capacity).toBe(20);
    must(sellVehicle(ctx, v.id));
    expect(s.companies.player.money).toBe(before - TRUCK.cost / 2);
    expect(s.vehicles[v.id]).toBeUndefined();
    s.companies.player.money = 100;
    expect(buyTruck(ctx, 'player', r.id)).toEqual({ ok: false, error: 'Not enough money' });
  });

  it('maintenance and deleteRoute', () => {
    const { s, ctx, camp, mill } = world();
    const r = woodRoute(ctx, camp, mill);
    must(buyTruck(ctx, 'player', r.id));
    must(buyTruck(ctx, 'player', r.id));
    const m0 = s.companies.player.money;
    vehicleMaintenanceMonth(ctx);
    expect(s.companies.player.money).toBe(m0 - 2 * TRUCK.maintenance);
    must(deleteRoute(ctx, r.id));
    expect(s.routes[r.id]).toBeUndefined();
    expect(Object.keys(s.vehicles)).toHaveLength(0);
    expect(s.companies.player.money).toBe(m0 - 300 + TRUCK.cost);
  });
});

describe('vehiclesTick', () => {
  it('round trip delivers wood to sawmill', () => {
    const { ctx, camp, mill } = world();
    camp.output.wood = 40;
    const r = woodRoute(ctx, camp, mill);
    must(buyTruck(ctx, 'player', r.id));
    tick(ctx, 120);
    expect(mill.input.wood ?? 0).toBeGreaterThan(0);
    expect(camp.output.wood).toBeLessThan(40);
    expect((mill.input.wood ?? 0) + (camp.output.wood ?? 0)).toBeLessThanOrEqual(40);
  });

  it('respects capacity 20', () => {
    const { ctx, camp, mill } = world();
    camp.output.wood = 55;
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading');
    expect(v.cargo.wood).toBe(20);
    expect(camp.output.wood).toBe(35);
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === 1);
    expect(mill.input.wood).toBe(20);
    expect(v.cargo.wood ?? 0).toBe(0);
  });

  it('splits capacity evenly between goods in whole units', () => {
    const { ctx, camp, mill } = world();
    camp.output.wood = 50;
    camp.output.coal = 50;
    const r = must(
      createRoute(ctx, 'player', 'mix', [
        { buildingId: camp.id, load: ['wood', 'coal'], unload: [] },
        { buildingId: mill.id, load: [], unload: [] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading');
    expect(v.cargo).toEqual({ wood: 10, coal: 10 });
  });

  it('does not unload goods building rejects', () => {
    const { ctx, camp, camp2 } = world();
    camp.output.wood = 30;
    const r = woodRoute(ctx, camp, camp2);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === 1);
    expect(v.cargo.wood).toBe(20);
    expect(camp2.input.wood).toBeUndefined();
  });

  it('stuck truck recovers when road restored', () => {
    const { ctx, camp, mill } = world();
    const events: GameEvent[] = [];
    ctx.bus.on('vehicleStuck', (e) => events.push(e));
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'moving' && v.stopIndex === 1);
    must(removeRoad(ctx, 'player', [{ x: 8, y: 10 }]));
    tickUntil(ctx, () => v.state === 'stuck');
    tick(ctx, 72);
    expect(v.state).toBe('stuck');
    expect(events).toEqual([{ type: 'vehicleStuck', vehicleId: v.id }]);
    must(buildRoad(ctx, 'player', [{ x: 8, y: 10 }]));
    tick(ctx, 24);
    expect(v.state).toBe('moving');
    expect(v.stuckNotified).toBe(false);
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === 1);
    expect(events).toHaveLength(1);
  });

  it('memoised paths follow a new shortcut road', () => {
    const { s, ctx, camp, mill } = world();
    // cut the straight road and detour around the gap via y=12
    must(removeRoad(ctx, 'player', [{ x: 8, y: 10 }]));
    must(buildRoad(ctx, 'player', [...lPath({ x: 7, y: 10 }, { x: 7, y: 12 }), ...lPath({ x: 7, y: 12 }, { x: 9, y: 12 }), { x: 9, y: 11 }]));
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    // two full round trips on the detour (every leg planned, then re-planned from the memo)
    for (let trip = 0; trip < 4; trip++) {
      const stop = v.stopIndex;
      tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === stop, 1000);
      tickUntil(ctx, () => v.state === 'moving', 1000);
      expect(v.path.some((p) => p.y === 12)).toBe(true);
    }
    must(buildRoad(ctx, 'player', [{ x: 8, y: 10 }]));
    const stop = v.stopIndex;
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === stop, 1000);
    tickUntil(ctx, () => v.state === 'moving', 1000);
    expect(v.path.some((p) => p.y === 12)).toBe(false);
    const target = s.buildings[r.stops[v.stopIndex].buildingId];
    expect(v.path).toEqual(findPath(s.map, v.path[0], accessTiles(s, target), roadPassable));
  });

  it('vehicle idles when route drops below two stops', () => {
    const { s, ctx, camp, mill, camp2 } = world();
    const r = must(
      createRoute(ctx, 'player', 'tri', [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: mill.id, load: [], unload: ['wood'] },
        { buildingId: camp2.id, load: ['wood'], unload: [] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', r.id));
    tick(ctx, 10);
    must(demolishBuilding(ctx, camp2.id));
    tick(ctx, 3);
    expect(v.state).not.toBe('idle');
    must(demolishBuilding(ctx, mill.id));
    expect(() => tick(ctx, 30)).not.toThrow();
    expect(v.state).toBe('idle');
    expect(v.path).toEqual([]);
    const pos = { ...v.pos };
    tick(ctx, 5);
    expect(v.pos).toEqual(pos);

    // updateRoute: back to two stops resumes; dropping to one idles again
    const mill2 = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 11 }));
    must(
      updateRoute(ctx, r.id, {
        stops: [
          { buildingId: camp.id, load: ['wood'], unload: [] },
          { buildingId: mill2.id, load: [], unload: ['wood'] },
        ],
      }),
    );
    expect(v.state).not.toBe('idle');
    tick(ctx, 2);
    expect(v.state).not.toBe('idle');
    must(updateRoute(ctx, r.id, { stops: [{ buildingId: camp.id, load: [], unload: [] }] }));
    tick(ctx);
    expect(v.state).toBe('idle');
    expect(s.routes[r.id].stops).toHaveLength(1);
  });

  it('travel speed', () => {
    const { ctx, camp, mill } = world();
    const r = woodRoute(ctx, camp, mill);
    const v: Vehicle = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'moving' && v.stopIndex === 1 && v.path.length > 0);
    expect(v.path.length - 1).toBe(10);
    const ticks = tickUntil(ctx, () => v.state === 'loading');
    expect(ticks).toBe(20);
    expect(v.pos).toEqual({ x: 12, y: 10 });
  });

  it('sets prevPos before moving and stays JSON-clean', () => {
    const { s, ctx, camp, mill } = world();
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'moving' && v.stopIndex === 1 && v.path.length > 0);
    tick(ctx);
    const p = { ...v.pos };
    tick(ctx);
    expect(v.prevPos).toEqual(p);
    expect(v.pos.x - v.prevPos.x).toBeCloseTo(0.5);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('demolishing an earlier stop while loading moves on instead of reloading', () => {
    const { ctx, camp, mill, camp2 } = world();
    camp.output.wood = 100;
    const r = must(
      createRoute(ctx, 'player', 'tri', [
        { buildingId: camp2.id, load: [], unload: [] },
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: mill.id, load: [], unload: ['wood'] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === 1);
    expect(v.cargo.wood).toBe(20);
    must(demolishBuilding(ctx, camp2.id));
    expect(v.stopIndex).toBe(0); // still the camp, re-indexed
    tickUntil(ctx, () => v.state !== 'loading');
    expect(v.state).toBe('moving');
    expect(v.stopIndex).toBe(1);
    expect(v.path[v.path.length - 1]).toEqual({ x: 12, y: 10 });
    tickUntil(ctx, () => v.state === 'loading');
    expect(v.stopIndex).toBe(1);
    expect(mill.input.wood).toBe(20);
    expect(camp.output.wood).toBe(80);
  });

  it('an unchanged stop edited while loading moves on instead of reloading', () => {
    const { ctx, camp, mill } = world();
    camp.output.wood = 100;
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading');
    must(updateRoute(ctx, r.id, { stops: [...r.stops, { buildingId: camp.id, load: [], unload: [] }] }));
    tickUntil(ctx, () => v.state !== 'loading');
    expect(v.stopIndex).toBe(1);
    expect(v.path[v.path.length - 1]).toEqual({ x: 12, y: 10 });
  });

  it('demolishing the stop a truck is loading at', () => {
    const { ctx, camp, mill, camp2 } = world();
    camp.output.wood = 100;
    const r = must(
      createRoute(ctx, 'player', 'tri', [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: mill.id, load: [], unload: ['wood'] },
        { buildingId: camp2.id, load: [], unload: [] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === 1);
    expect(() => must(demolishBuilding(ctx, mill.id))).not.toThrow();
    expect(v.stopIndex).toBe(1); // now camp2, which took the mill's place
    tickUntil(ctx, () => v.state !== 'loading');
    tickUntil(ctx, () => v.state === 'loading');
    expect(v.stopIndex).toBe(1);
    expect(v.pos).toEqual({ x: 20, y: 10 });
  });

  it('conservation: goods are never created or destroyed', () => {
    const { s, ctx, camp, mill } = world();
    const cap = BUILDINGS.sawmill.storage;
    camp.output.wood = cap + 40;
    const r = woodRoute(ctx, camp, mill);
    for (let i = 0; i < 3; i++) must(buyTruck(ctx, 'player', r.id));
    const total = () => {
      let n = (camp.output.wood ?? 0) + (camp.input.wood ?? 0) + (mill.input.wood ?? 0) + (mill.output.wood ?? 0);
      for (const v of Object.values(s.vehicles)) n += v.cargo.wood ?? 0;
      return n;
    };
    for (let i = 0; i < 500; i++) {
      tick(ctx);
      expect(total()).toBe(cap + 40);
    }
    expect(mill.input.wood).toBe(cap);
  });

  it('buyTruck refuses foreign and mismatched routes', () => {
    const { s, ctx, camp, mill } = world();
    const r = woodRoute(ctx, camp, mill);
    expect(buyTruck(ctx, 'rival', r.id)).toEqual({ ok: false, error: 'Not your route' });
    s.routes[r.id].kind = 'train';
    expect(buyTruck(ctx, 'player', r.id)).toEqual({ ok: false, error: 'Wrong vehicle for this route' });
  });

  it('unloading is limited by storageLeft; the truck keeps the rest', () => {
    const { ctx, camp, mill } = world();
    camp.output.wood = 20;
    const cap = BUILDINGS.sawmill.storage;
    mill.input.wood = cap - 10;
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading' && v.stopIndex === 1);
    expect(mill.input.wood).toBe(cap);
    expect(v.cargo.wood).toBe(10);
  });

  it('re-plans around a removed road when a detour exists', () => {
    const { ctx, camp, mill } = world();
    must(buildRoad(ctx, 'player', [{ x: 7, y: 11 }, { x: 7, y: 12 }, { x: 8, y: 12 }, { x: 9, y: 12 }, { x: 9, y: 11 }]));
    const events: GameEvent[] = [];
    ctx.bus.on('vehicleStuck', (e) => events.push(e));
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'moving' && v.stopIndex === 1 && v.path.length > 0);
    must(removeRoad(ctx, 'player', [{ x: 8, y: 10 }]));
    for (let i = 0; i < 40 && !(v.state === 'loading' && v.stopIndex === 1); i++) {
      tick(ctx);
      expect(v.state).not.toBe('stuck');
    }
    expect(v.state).toBe('loading');
    expect(v.stopIndex).toBe(1);
    expect(events).toEqual([]);
  });

  it('determinism: identical runs give identical JSON', () => {
    const run = () => {
      const { s, ctx, camp, mill } = world();
      camp.output.wood = 45;
      camp.output.coal = 7;
      const r = must(
        createRoute(ctx, 'player', 'mix', [
          { buildingId: camp.id, load: ['wood', 'coal'], unload: [] },
          { buildingId: mill.id, load: [], unload: ['wood', 'coal'] },
        ]),
      );
      must(buyTruck(ctx, 'player', r.id));
      tick(ctx, 37);
      must(buyTruck(ctx, 'player', r.id));
      tick(ctx, 300);
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('fractional stock loads whole units only', () => {
    const { ctx, camp, mill } = world();
    camp.output.wood = 18.5;
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'loading');
    expect(v.cargo.wood).toBe(18);
    expect(camp.output.wood).toBe(0.5);
  });

  it('a stuck truck that goes idle forgets its stuck notice', () => {
    const { ctx, camp, mill } = world();
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    tickUntil(ctx, () => v.state === 'moving' && v.stopIndex === 1);
    must(removeRoad(ctx, 'player', [{ x: 8, y: 10 }]));
    tickUntil(ctx, () => v.state === 'stuck');
    expect(v.stuckNotified).toBe(true);
    must(updateRoute(ctx, r.id, { stops: [r.stops[0]] }));
    tick(ctx);
    expect(v.state).toBe('idle');
    expect(v.stuckNotified).toBe(false);
  });
});

describe('assignVehicle', () => {
  it('assignVehicle moves a truck between routes', () => {
    const { s, ctx, camp, mill, camp2 } = world();
    const a = woodRoute(ctx, camp, mill);
    const b = woodRoute(ctx, camp2, mill);
    const v = must(buyTruck(ctx, 'player', a.id));
    tick(ctx, 5);
    const oldPath = v.path;
    must(assignVehicle(ctx, v.id, b.id));
    expect(v.routeId).toBe(b.id);
    expect(v.stopIndex).toBe(0);
    expect(v.path).toEqual([]);
    expect(v.path).not.toBe(oldPath);
    expect(v.state).toBe('moving');
    expect(s.vehicles[v.id]).toBe(v);
    // cargo from the old route would never be unloaded on the new one
    v.cargo = { wood: 20 };
    must(assignVehicle(ctx, v.id, a.id));
    expect(v.cargo).toEqual({});
    v.cargo = { wood: 5 };
    must(assignVehicle(ctx, v.id, a.id)); // same route: keeps its load
    expect(v.cargo).toEqual({ wood: 5 });
    must(assignVehicle(ctx, v.id, null));
    expect(v.routeId).toBeNull();
    expect(v.state).toBe('idle');
    tick(ctx, 2);
    expect(v.state).toBe('idle');
  });

  it('assignVehicle rejects wrong kind / foreign route', () => {
    const { s, ctx, camp, mill } = world();
    const a = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', a.id));
    s.routes[900] = { id: 900, ownerId: 'rival', name: 'x', color: '#000', stops: [], kind: 'truck' };
    s.routes[901] = { id: 901, ownerId: 'player', name: 'line', color: '#000', stops: [], kind: 'train' };
    expect(assignVehicle(ctx, 999, a.id)).toEqual({ ok: false, error: 'No such vehicle' });
    expect(assignVehicle(ctx, v.id, 12345)).toEqual({ ok: false, error: 'No such route' });
    expect(assignVehicle(ctx, v.id, 900)).toEqual({ ok: false, error: 'Not your route' });
    expect(assignVehicle(ctx, v.id, 901)).toEqual({ ok: false, error: 'Trucks cannot run rail lines' });
    s.vehicles[v.id].kind = 'train';
    expect(assignVehicle(ctx, v.id, a.id)).toEqual({ ok: false, error: 'Trains only run on rail lines' });
    expect(v.routeId).toBe(a.id);
  });

  it('old save without trips30 loads', () => {
    const { s, ctx, camp, mill } = world();
    const v = must(buyTruck(ctx, 'player', woodRoute(ctx, camp, mill).id));
    delete v.trips30;
    const back = must(deserialize(serialize(s)));
    expect(tripsLast30(back, back.vehicles[v.id])).toBe(0);
  });

  it('counts completed unloads over the last 30 days only', () => {
    const { s, ctx, camp, mill } = world();
    camp.output.wood = 100;
    const v = must(buyTruck(ctx, 'player', woodRoute(ctx, camp, mill).id));
    tickUntil(ctx, () => tripsLast30(s, v) === 1, 400);
    expect(JSON.parse(JSON.stringify(v)).trips30).toHaveLength(1);
    s.tick += 30 * 24 + 1;
    expect(tripsLast30(s, v)).toBe(0);
  });
});
describe('insertStop', () => {
  it('keeps vehicles heading for their stop when a stop is inserted before it', () => {
    const { s, ctx, camp, mill, camp2 } = world();
    const r = woodRoute(ctx, camp, mill);
    const v = must(buyTruck(ctx, 'player', r.id));
    v.stopIndex = 1;
    tick(ctx, 3);
    const path = v.path;
    must(insertStop(ctx, r.id, 0, { buildingId: camp2.id, load: ['wood'], unload: [] }));
    expect(s.routes[r.id].stops.map((x) => x.buildingId)).toEqual([camp.id, camp2.id, mill.id]);
    expect(v.stopIndex).toBe(2);
    expect(s.routes[r.id].stops[v.stopIndex].buildingId).toBe(mill.id);
    expect(v.path).toBe(path); // same target building: path untouched
    const w = must(buyTruck(ctx, 'player', r.id));
    expect(w.stopIndex).toBe(0);
    must(insertStop(ctx, r.id, 0, { buildingId: mill.id, load: [], unload: [] }));
    expect(w.stopIndex).toBe(0);
    expect(insertStop(ctx, r.id, 9, { buildingId: mill.id, load: [], unload: [] }).ok).toBe(false);
  });
});
