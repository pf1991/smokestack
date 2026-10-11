import { describe, it, expect } from 'vitest';
import type { GameEvent } from '../core/events';
import { dateToDays } from './clock';
import { maintenanceMonth } from './production';
import { buildRail, buyTrain, ensureRailLink, RAIL_COST, RAIL_UPKEEP, removeRail, stationAccess, TRAIN } from './rail';
import { findPath, railPassable } from './pathfinding';
import { buildRoad, demolishBuilding, lPath, placeBuilding } from './state';
import { must, testCtx, testState } from './testkit';
import type { GameState, SimContext, Terrain } from './types';
import { buyTruck, createRoute, vehicleMaintenanceMonth, vehiclesTick } from './vehicles';

const tile = (s: GameState, x: number, y: number) => s.map.tiles[y * s.map.width + x];
const setTerrain = (s: GameState, x0: number, y0: number, w: number, h: number, t: Terrain) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tile(s, x, y).terrain = t;
};

function tick(ctx: SimContext, n = 1): void {
  for (let i = 0; i < n; i++) {
    ctx.state.tick++;
    vehiclesTick(ctx);
  }
}

function tickUntil(ctx: SimContext, cond: () => boolean, max = 2000): number {
  for (let i = 0; i < max; i++) {
    if (cond()) return i;
    tick(ctx);
  }
  throw new Error('condition never met');
}

/**
 * Station A at (2,5) and station B at (26,5) (3×2 each), joined by a rail line along y=7 from
 * x=2 to x=28. A's first rail access tile is (2,7); B's nearest is (26,7), 24 tiles away.
 */
function line() {
  const s = testState();
  const ctx = testCtx(s);
  const a = must(placeBuilding(ctx, 'player', 'train_station', { x: 2, y: 5 }));
  const b = must(placeBuilding(ctx, 'player', 'train_station', { x: 26, y: 5 }));
  must(buildRail(ctx, 'player', lPath({ x: 2, y: 7 }, { x: 28, y: 7 })));
  return { s, ctx, a, b };
}

function coalRun(ctx: SimContext, aId: number, bId: number) {
  return must(
    createRoute(
      ctx,
      'player',
      'Coal line',
      [
        { buildingId: aId, load: ['coal'], unload: [] },
        { buildingId: bId, load: [], unload: ['coal'] },
      ],
      'train',
    ),
  );
}

describe('railways', () => {
  it('rail crosses road but not water', () => {
    const s = testState();
    const ctx = testCtx(s);
    must(buildRoad(ctx, 'player', lPath({ x: 10, y: 2 }, { x: 10, y: 20 })));
    const before = s.companies.player.money;
    const r = must(buildRail(ctx, 'player', lPath({ x: 5, y: 10 }, { x: 15, y: 10 })));
    expect(r).toEqual({ built: 11, cost: 11 * RAIL_COST });
    expect(s.companies.player.money).toBe(before - 11 * RAIL_COST);
    expect(s.companies.player.railTiles).toBe(11);
    // level crossing: the road tile keeps its road and gains rail
    expect(tile(s, 10, 10).road).toBe(true);
    expect(tile(s, 10, 10).rail).toBe(true);
    expect(tile(s, 10, 10).railOwner).toBe('player');

    // water (and mountain) anywhere on the path: nothing is built, nothing is charged
    setTerrain(s, 8, 14, 1, 1, 'water');
    setTerrain(s, 8, 18, 1, 1, 'mountain');
    const snapshot = JSON.stringify(s);
    expect(buildRail(ctx, 'player', lPath({ x: 5, y: 14 }, { x: 15, y: 14 }))).toEqual({ ok: false, error: 'Cannot build rail there' });
    expect(buildRail(ctx, 'player', lPath({ x: 5, y: 18 }, { x: 15, y: 18 }))).toEqual({ ok: false, error: 'Cannot build rail there' });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('rail refuses when unaffordable and leaves state unchanged', () => {
    const s = testState({ money: 1000 });
    const ctx = testCtx(s);
    const snapshot = JSON.stringify(s);
    expect(buildRail(ctx, 'player', lPath({ x: 1, y: 1 }, { x: 4, y: 1 }))).toEqual({ ok: false, error: 'Not enough money' });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('existing rail is free and buildings block rail', () => {
    const { s, ctx } = line();
    const money = s.companies.player.money;
    expect(must(buildRail(ctx, 'player', [{ x: 5, y: 7 }]))).toEqual({ built: 0, cost: 0 });
    expect(s.companies.player.money).toBe(money);
    expect(buildRail(ctx, 'player', [{ x: 3, y: 5 }])).toEqual({ ok: false, error: 'Cannot build rail there' });
  });

  it('stationAccess lists the rail tiles next to the station', () => {
    const { s, a } = line();
    expect(stationAccess(s, a)).toEqual([{ x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }]);
  });

  it('train hauls 120 between stations', () => {
    const { s, ctx, a, b } = line();
    a.input.coal = 200;
    const route = coalRun(ctx, a.id, b.id);
    const money = s.companies.player.money;
    const train = must(buyTrain(ctx, 'player', route.id));
    expect(s.companies.player.money).toBe(money - TRAIN.cost);
    expect(train.kind).toBe('train');
    expect(train.capacity).toBe(120);
    expect(train.pos).toEqual({ x: 2, y: 7 });
    tickUntil(ctx, () => train.state === 'loading' && train.stopIndex === 1);
    expect(b.input.coal).toBe(120);
    expect(a.input.coal).toBe(80);
    expect(train.cargo).toEqual({});
  });

  it('train moves 1 tile per tick', () => {
    const { ctx, a, b } = line();
    const route = coalRun(ctx, a.id, b.id);
    const train = must(buyTrain(ctx, 'player', route.id));
    tickUntil(ctx, () => train.state === 'loading' && train.stopIndex === 0);
    tickUntil(ctx, () => train.state === 'moving');
    const ticks = tickUntil(ctx, () => train.state === 'loading');
    expect(ticks).toBe(24);
  });

  it('truck route can stop at station', () => {
    const s = testState();
    const ctx = testCtx(s);
    setTerrain(s, 2, 8, 2, 2, 'forest');
    const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
    const station = must(placeBuilding(ctx, 'player', 'train_station', { x: 12, y: 8 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 14, y: 10 })));
    camp.output.wood = 40;
    const route = must(
      createRoute(ctx, 'player', 'Feeder', [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: station.id, load: [], unload: ['wood'] },
      ]),
    );
    const truck = must(buyTruck(ctx, 'player', route.id));
    tickUntil(ctx, () => truck.state === 'loading' && truck.stopIndex === 1);
    expect(station.input.wood).toBe(20);
  });

  it('train route rejects non-station stop', () => {
    const { s, ctx, a } = line();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 10, y: 4 }));
    must(buildRail(ctx, 'player', lPath({ x: 10, y: 3 }, { x: 12, y: 3 })));
    expect(createRoute(ctx, 'player', 'Bad', [
      { buildingId: a.id, load: [], unload: [] },
      { buildingId: mill.id, load: [], unload: [] },
    ], 'train')).toEqual({ ok: false, error: 'Trains only stop at train stations' });
    // a station without track next to it
    const lonely = must(placeBuilding(ctx, 'player', 'train_station', { x: 20, y: 20 }));
    expect(createRoute(ctx, 'player', 'Bad', [
      { buildingId: a.id, load: [], unload: [] },
      { buildingId: lonely.id, load: [], unload: [] },
    ], 'train')).toEqual({ ok: false, error: 'Station has no rail access' });
    expect(Object.keys(s.routes)).toHaveLength(0);
  });

  it('buyTrain refuses truck routes and buyTruck refuses train routes', () => {
    const { ctx, a, b } = line();
    const route = coalRun(ctx, a.id, b.id);
    expect(buyTruck(ctx, 'player', route.id)).toEqual({ ok: false, error: 'Wrong vehicle for this route' });
    const s2 = testState({ money: 1000 });
    const ctx2 = testCtx(s2);
    expect(buyTrain(ctx2, 'player', 999)).toEqual({ ok: false, error: 'No such route' });
  });

  it('rail upkeep charged', () => {
    const ctx = testCtx();
    ctx.state.companies.player.railTiles = 10;
    maintenanceMonth(ctx);
    expect(ctx.state.companies.player.ledger.at(-1)?.expense.maintenance).toBe(10 * RAIL_UPKEEP);
    expect(RAIL_UPKEEP).toBe(10);
  });

  it('train maintenance is $1,200 a month', () => {
    const { s, ctx, a, b } = line();
    must(buyTrain(ctx, 'player', coalRun(ctx, a.id, b.id).id));
    const before = s.companies.player.ledger.at(-1)?.expense.vehicles ?? 0;
    vehicleMaintenanceMonth(ctx);
    expect(s.companies.player.ledger.at(-1)?.expense.vehicles).toBe(before + 1200);
  });

  it('rail removed under a moving train: stuck once, recovers when rebuilt', () => {
    const { s, ctx, a, b } = line();
    const events: GameEvent[] = [];
    ctx.bus.on('vehicleStuck', (e) => events.push(e));
    const train = must(buyTrain(ctx, 'player', coalRun(ctx, a.id, b.id).id));
    tickUntil(ctx, () => train.state === 'moving' && train.pos.x >= 5);
    must(removeRail(ctx, 'player', [{ x: 15, y: 7 }]));
    expect(tile(s, 15, 7).rail).toBe(false);
    expect(s.companies.player.railTiles).toBe(26);
    tickUntil(ctx, () => train.state === 'stuck');
    tick(ctx, 60);
    expect(train.state).toBe('stuck');
    expect(events).toHaveLength(1);
    must(buildRail(ctx, 'player', [{ x: 15, y: 7 }]));
    tickUntil(ctx, () => train.state === 'moving', 25);
    tickUntil(ctx, () => train.state === 'loading' && train.stopIndex === 1);
  });

  it('removeRail refuses track under a train and other companies’ track', () => {
    const { s, ctx, a, b } = line();
    const train = must(buyTrain(ctx, 'player', coalRun(ctx, a.id, b.id).id));
    expect(removeRail(ctx, 'player', [train.pos])).toEqual({ ok: false, error: 'A train is on that track' });
    expect(removeRail(ctx, 'rival', [{ x: 10, y: 7 }])).toEqual({ ok: false, error: 'Not your rail' });
    expect(tile(s, 10, 7).rail).toBe(true);
  });

  it('demolishing a station stop idles the train without throwing', () => {
    const { s, ctx, a, b } = line();
    const train = must(buyTrain(ctx, 'player', coalRun(ctx, a.id, b.id).id));
    tickUntil(ctx, () => train.state === 'moving' && train.pos.x >= 8);
    must(demolishBuilding(ctx, b.id));
    expect(() => tick(ctx, 50)).not.toThrow();
    expect(train.state).toBe('idle');
    expect(Object.values(s.routes)[0].stops).toHaveLength(1);
  });

  it('rail strike halts trains until it ends', () => {
    const { s, ctx, a, b } = line();
    const train = must(buyTrain(ctx, 'player', coalRun(ctx, a.id, b.id).id));
    tickUntil(ctx, () => train.state === 'moving' && train.pos.x >= 5);
    s.flags.railStrikeUntil = dateToDays(s.date) + 1;
    const x = train.pos.x;
    tick(ctx, 10);
    expect(train.pos.x).toBe(x);
    s.flags.railStrikeUntil = dateToDays(s.date);
    tick(ctx, 1);
    expect(train.pos.x).toBeGreaterThan(x);
  });

  it('state with rails and trains survives a JSON round trip', () => {
    const { s, ctx, a, b } = line();
    must(buyTrain(ctx, 'player', coalRun(ctx, a.id, b.id).id));
    tick(ctx, 5);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('ensureRailLink builds a connecting line across a road (level crossing) and refuses across water', () => {
    const s = testState({ width: 50 });
    const ctx = testCtx(s);
    // a north–south road splits the map between the two stations
    must(buildRoad(ctx, 'player', lPath({ x: 20, y: 0 }, { x: 20, y: 29 })));
    const a = must(placeBuilding(ctx, 'rival', 'train_station', { x: 4, y: 10 }));
    const b = must(placeBuilding(ctx, 'rival', 'train_station', { x: 36, y: 12 }));
    const money = s.companies.rival.money;
    const r = must(ensureRailLink(ctx, 'rival', a, b, 50000));
    expect(r.built).toBeGreaterThan(25);
    expect(s.companies.rival.money).toBe(money - r.cost);
    expect(r.cost).toBe(r.built * RAIL_COST);
    expect(r.tiles).toHaveLength(r.built);
    expect(s.companies.rival.railTiles).toBe(r.built);
    const from = stationAccess(s, a);
    const to = stationAccess(s, b);
    expect(from.length).toBeGreaterThan(0);
    expect(to.length).toBeGreaterThan(0);
    expect(findPath(s.map, from[0], to, railPassable)).not.toBeNull();
    // the line crosses the road: one road tile now also carries rival track, and the road survives
    const crossings = s.map.tiles.filter((t) => t.road && t.rail);
    expect(crossings.length).toBeGreaterThanOrEqual(1);
    expect(crossings.every((t) => t.railOwner === 'rival')).toBe(true);
    for (let y = 0; y < 30; y++) expect(tile(s, 20, y).road).toBe(true);
    // already linked: free no-op
    expect(must(ensureRailLink(ctx, 'rival', a, b, 50000))).toEqual({ built: 0, cost: 0, tiles: [] });

    // a river (bridged by the road) between two new stations: no track can be laid, nothing changes
    const s2 = testState({ width: 50 });
    const ctx2 = testCtx(s2);
    setTerrain(s2, 24, 0, 2, 30, 'water');
    must(buildRoad(ctx2, 'rival', lPath({ x: 0, y: 20 }, { x: 49, y: 20 })));
    const c = must(placeBuilding(ctx2, 'rival', 'train_station', { x: 4, y: 10 }));
    const d = must(placeBuilding(ctx2, 'rival', 'train_station', { x: 36, y: 12 }));
    const snapshot = JSON.stringify(s2);
    expect(ensureRailLink(ctx2, 'rival', c, d)).toEqual({ ok: false, error: 'No rail can link these stations' });
    expect(JSON.stringify(s2)).toBe(snapshot);
  });

  it('ensureRailLink refuses when the track would break the reserve', () => {
    const s = testState({ width: 50, rivalMoney: 100000 });
    const ctx = testCtx(s);
    const a = must(placeBuilding(ctx, 'rival', 'train_station', { x: 4, y: 10 }));
    const b = must(placeBuilding(ctx, 'rival', 'train_station', { x: 36, y: 12 }));
    const snapshot = JSON.stringify(s);
    expect(ensureRailLink(ctx, 'rival', a, b, 50000)).toEqual({ ok: false, error: 'Not enough money' });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
