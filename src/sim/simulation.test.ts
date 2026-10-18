import { describe, it, expect } from 'vitest';
import { EventBus, type GameEvent } from '../core/events';
import { BUILDINGS } from '../data/buildings';
import { deserialize, runDays, runTicks, SAVE_VERSION, serialize, stepTick } from './simulation';
import { SYSTEMS, type SimSystem } from './systems';
import { accessTiles, buildRoad, createGame, findPlacement, lPath, placeBuilding } from './state';
import { connectToRoads, must, testCtx, testState } from './testkit';
import type { Building, BuildingTypeId, GameState, SimContext, Vec2 } from './types';
import { buyTruck, createRoute } from './vehicles';

function withSpy<T>(spy: SimSystem, fn: () => T): T {
  SYSTEMS.push(spy);
  try {
    return fn();
  } finally {
    SYSTEMS.splice(SYSTEMS.indexOf(spy), 1);
  }
}

function collect(ctx: SimContext): GameEvent[] {
  const events: GameEvent[] = [];
  ctx.bus.onAny((e) => events.push(e));
  return events;
}

describe('stepTick', () => {
  it('SYSTEMS are seeded in the documented order', () => {
    expect(SYSTEMS.map((s) => s.id).slice(0, 5)).toEqual(['vehicles', 'production', 'retail', 'upkeep', 'finance']);
  });

  it('the clock stops after victory', () => {
    const ctx = testCtx();
    ctx.state.date = { year: 2001, month: 1, day: 1, hour: 0 };
    const tick = ctx.state.tick;
    stepTick(ctx);
    expect(ctx.state.date).toEqual({ year: 2001, month: 1, day: 1, hour: 0 });
    expect(ctx.state.tick).toBe(tick);
  });

  it('month boundary fires systems once', () => {
    const ctx = testCtx();
    const counts = { tick: 0, day: 0, month: 0, year: 0 };
    const spy: SimSystem = {
      id: 'spy',
      onTick: () => counts.tick++,
      onDay: () => counts.day++,
      onMonth: () => counts.month++,
      onYear: () => counts.year++,
    };
    withSpy(spy, () => runDays(ctx, 30));
    expect(counts).toEqual({ tick: 720, day: 30, month: 1, year: 0 });
    expect(ctx.state.date).toEqual({ year: 1900, month: 5, day: 1, hour: 8 });
    expect(ctx.state.tick).toBe(720);
  });

  it('day and month systems see the ending period; events follow', () => {
    const ctx = testCtx();
    const seen: string[] = [];
    const spy: SimSystem = {
      id: 'spy',
      onDay: (c) => seen.push(`day ${c.state.date.month}/${c.state.date.day}`),
      onMonth: (c) => seen.push(`month ${c.state.date.year}/${c.state.date.month}`),
      onYear: (c) => seen.push(`year ${c.state.date.year}`),
    };
    const events = collect(ctx);
    withSpy(spy, () => runDays(ctx, 360));
    expect(seen[0]).toBe('day 4/1');
    expect(seen).toContain('month 1900/4');
    expect(seen.indexOf('year 1900')).toBe(seen.indexOf('month 1900/12') + 1);
    expect(seen.at(-1)).toBe('month 1901/3');
    expect(seen.filter((s) => s.startsWith('month')).length).toBe(12);
    const dayStarts = events.filter((e) => e.type === 'dayStart');
    expect(dayStarts.length).toBe(360);
    expect(dayStarts[0]).toEqual({ type: 'dayStart', date: { year: 1900, month: 4, day: 2, hour: 0 } });
    const monthEnds = events.filter((e) => e.type === 'monthEnd');
    expect(monthEnds.length).toBe(12);
    expect(monthEnds[0]).toEqual({ type: 'monthEnd', date: { year: 1900, month: 4, day: 30, hour: 23 } });
    expect(events.filter((e) => e.type === 'yearEnd')).toEqual([{ type: 'yearEnd', year: 1900 }]);
    expect(ctx.state.date).toEqual({ year: 1901, month: 4, day: 1, hour: 8 });
  });

  it('month-end ledger entries land in the month that ended', () => {
    const ctx = testCtx(testState({ cities: [{ x: 30, y: 20 }] }));
    const s = ctx.state;
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 2, y: 2 }));
    const afterBuild = s.companies.player.money;
    runDays(ctx, 30);
    const apr = s.companies.player.ledger.find((m) => m.year === 1900 && m.month === 4);
    expect(apr?.expense.maintenance).toBe(BUILDINGS.sawmill.maintenance);
    expect(apr?.cashEnd).toBe(afterBuild - BUILDINGS.sawmill.maintenance);
    // assets are valued at the month-end price index (the economy system steps before finance closes)
    // and the company's own treasury shares count at the month-end price (state.ts wealth)
    const l = s.exchange.listings.player;
    expect(apr?.netWorthEnd).toBeCloseTo(apr!.cashEnd + Math.round(BUILDINGS.sawmill.cost * 0.5 * s.economy.priceIndex) + l.holders.player * l.history[0], 6);
    expect(s.companies.player.ledger.find((m) => m.month === 5)?.expense.maintenance ?? 0).toBe(0);
  });

  it('player bankruptcy ends the game once', () => {
    const ctx = testCtx(testState({ money: -1000 }));
    const events = collect(ctx);
    runDays(ctx, 30 * 7);
    const over = events.filter((e) => e.type === 'gameOver');
    expect(over).toEqual([{ type: 'gameOver', reason: 'Bankrupt' }]);
    expect(ctx.state.speed).toBe(0);
  });

  it('victory on 1 Jan 2001', () => {
    const ctx = testCtx();
    ctx.state.date = { year: 2000, month: 12, day: 30, hour: 22 };
    const events = collect(ctx);
    stepTick(ctx);
    expect(events.some((e) => e.type === 'victory')).toBe(false);
    stepTick(ctx);
    expect(ctx.state.date).toEqual({ year: 2001, month: 1, day: 1, hour: 0 });
    expect(events.filter((e) => e.type === 'victory')).toEqual([{ type: 'victory', reason: 'The century is over' }]);
    expect(ctx.state.speed).toBe(0);
  });

  it('runTicks advances n ticks', () => {
    const ctx = testCtx();
    runTicks(ctx, 25);
    expect(ctx.state.tick).toBe(25);
    expect(ctx.state.date).toEqual({ year: 1900, month: 4, day: 2, hour: 9 });
  });
});

// ---------------------------------------------------------------------------
// scripted chain helpers

interface Chain {
  ctx: SimContext;
  cityId: number;
  buildings: Building[];
  moneyAfterConstruction: number;
}

/** lumber_camp → sawmill → furniture_factory → store near the city closest to a placeable forest. */
function buildFurnitureChain(seed: number, trucksPerLeg = 2): Chain {
  const state = createGame({ seed, companyName: 'Test Co.', rival: false });
  const ctx: SimContext = { state, bus: new EventBus() };
  let city = state.cities[0];
  let campPos: Vec2 | null = null;
  let best = Infinity;
  for (const c of state.cities) {
    const p = findPlacement(state, 'player', 'lumber_camp', c.center, 30);
    // Euclidean distance from the town's edge (urbanRadius is a Euclidean disc): bigger towns push
    // industry further out, which is not a worse site
    const d = p ? Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.urbanRadius : Infinity;
    if (p && d < best) {
      best = d;
      city = c;
      campPos = p;
    }
  }
  if (!campPos) throw new Error('no forest for a lumber camp');
  const place = (typeId: BuildingTypeId, near: Vec2): Building => {
    const pos = findPlacement(state, 'player', typeId, near, 30);
    if (!pos) throw new Error(`no placement for ${typeId}`);
    const b = must(placeBuilding(ctx, 'player', typeId, pos));
    must(connectToRoads(ctx, b));
    return b;
  };
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', campPos));
  must(connectToRoads(ctx, camp));
  // factories between the camp and the city
  const mid = { x: Math.round((campPos.x + city.center.x) / 2), y: Math.round((campPos.y + city.center.y) / 2) };
  const mill = place('sawmill', mid);
  const factory = place('furniture_factory', mid);
  const store = place('store', city.center);
  const legs: [Building, Building, string][] = [
    [camp, mill, 'wood'],
    [mill, factory, 'lumber'],
    [factory, store, 'furniture'],
  ];
  for (const [from, to, good] of legs) {
    const route = must(
      createRoute(ctx, 'player', `${good} run`, [
        { buildingId: from.id, load: [good], unload: [] },
        { buildingId: to.id, load: [], unload: [good] },
      ]),
    );
    for (let i = 0; i < trucksPerLeg; i++) must(buyTruck(ctx, 'player', route.id));
  }
  return { ctx, cityId: city.id, buildings: [camp, mill, factory, store], moneyAfterConstruction: state.companies.player.money };
}

function sum(state: GameState, kind: 'income' | 'expense', cat: 'sales' | 'maintenance' | 'vehicles'): number {
  return state.companies.player.ledger.reduce((a, m) => a + (m[kind][cat] ?? 0), 0);
}

describe('testkit connectToRoads', () => {
  it('lays a road from the building to the nearest road', () => {
    const ctx = testCtx();
    must(buildRoad(ctx, 'player', lPath({ x: 0, y: 20 }, { x: 39, y: 20 })));
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 10, y: 5 }));
    expect(accessTiles(ctx.state, mill)).toEqual([]);
    const r = must(connectToRoads(ctx, mill));
    expect(r.built).toBe(12); // from the row below the 3×3 footprint (y=8) down to y=19; y=20 is road
    expect(accessTiles(ctx.state, mill).length).toBeGreaterThan(0);
    expect(must(connectToRoads(ctx, mill))).toEqual({ built: 0, cost: 0 });
  });
});

describe('saves', () => {
  it('deterministic replay', () => {
    const a = buildFurnitureChain(9, 1);
    const b = buildFurnitureChain(9, 1);
    runDays(a.ctx, 720);
    runDays(b.ctx, 720);
    expect(serialize(a.ctx.state)).toBe(serialize(b.ctx.state));
  });

  it('round-trip save', () => {
    const { ctx } = buildFurnitureChain(9, 1);
    runDays(ctx, 45);
    const json = serialize(ctx.state);
    const r = deserialize(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.applied).toEqual([]); // current version: nothing migrated
    expect(r.value.state).toEqual(ctx.state);
    expect(serialize(r.value.state)).toBe(json);
    // the loaded game continues exactly like the original
    const loaded: SimContext = { state: r.value.state, bus: new EventBus() };
    runDays(ctx, 30);
    runDays(loaded, 30);
    expect(serialize(loaded.state)).toBe(serialize(ctx.state));
  });

  it('rejects garbage and wrong versions', () => {
    const good = JSON.parse(serialize(testState())) as Record<string, unknown>;
    const variant = (patch: (o: Record<string, unknown>) => void): string => {
      const o = structuredClone(good);
      patch(o);
      return JSON.stringify(o);
    };
    const corrupted = { ok: false, error: 'Save file is corrupted' };
    const incomplete = { ok: false, error: 'Save file is incomplete' };
    expect(SAVE_VERSION).toBe(8);
    expect(deserialize('{')).toEqual(corrupted);
    expect(deserialize('')).toEqual(corrupted);
    expect(deserialize('null')).toEqual(corrupted);
    expect(deserialize('42')).toEqual(corrupted);
    expect(deserialize('[1,2]')).toEqual(corrupted);
    expect(deserialize(variant((o) => (o.version = 99)))).toEqual({ ok: false, error: 'Save from a newer version of SMOKESTACK' });
    expect(deserialize(variant((o) => (o.version = 1)))).toEqual({ ok: false, error: 'Save from SMOKESTACK I cannot be loaded in this version' });
    expect(deserialize(variant((o) => delete o.version))).toEqual(corrupted);
    expect(deserialize(variant((o) => delete o.map))).toEqual(incomplete);
    expect(deserialize(variant((o) => ((o.map as Record<string, unknown>).tiles = 'x')))).toEqual(incomplete);
    expect(deserialize(variant((o) => delete (o.companies as Record<string, unknown>).player))).toEqual(incomplete);
    expect(deserialize(variant((o) => delete (o.companies as Record<string, unknown>).rival))).toEqual(incomplete);
    expect(deserialize(variant((o) => ((o.map as Record<string, unknown>).tiles = [])))).toEqual(incomplete);
    expect(deserialize(variant((o) => delete o.date))).toEqual(incomplete);
    expect(deserialize(variant((o) => ((o.date as Record<string, unknown>).year = '1900')))).toEqual(incomplete);
    expect(deserialize(variant((o) => (o.buildings = null)))).toEqual(incomplete);
    expect(deserialize(variant((o) => delete o.vehicles))).toEqual(incomplete);
    expect(deserialize(variant((o) => (o.routes = [])))).toEqual(incomplete);
    expect(deserialize(variant((o) => (o.cities = {})))).toEqual(incomplete);
    expect(deserialize(variant((o) => delete o.politics))).toEqual(incomplete);
    expect(deserialize(variant((o) => delete o.weather))).toEqual(incomplete);
    expect(deserialize(variant(() => undefined)).ok).toBe(true);
  });
});

describe('headless chain', () => {
  it('headless chain earns money', () => {
    const { ctx, cityId, moneyAfterConstruction } = buildFurnitureChain(42, 2);
    const state = ctx.state;
    const moneyStart = 300000;
    const vehiclePurchases = sum(state, 'expense', 'vehicles');
    const roadsBuilt = state.companies.player.roadTiles;
    let furnitureSold = 0;
    ctx.bus.on('sale', (e) => {
      if (e.goodId === 'furniture' && e.ownerId === 'player') furnitureSold += e.qty;
    });
    const t0 = Date.now();
    runDays(ctx, 365);
    const ms = Date.now() - t0;
    const sales = sum(state, 'income', 'sales');
    const maintenance = sum(state, 'expense', 'maintenance') + sum(state, 'expense', 'vehicles') - vehiclePurchases;
    const moneyEnd = state.companies.player.money;
    console.log(
      `[headless chain] seed 42 city=${state.cities[cityId].name} money start=$${moneyStart} ` +
        `afterConstruction=$${moneyAfterConstruction} (roads built=${roadsBuilt}) end=$${moneyEnd} furnitureSold=${furnitureSold} ` +
        `salesRevenue=$${sales} maintenance(buildings+roads+trucks)=$${maintenance} runDays(365)=${ms}ms`,
    );
    expect(sales).toBeGreaterThan(0);
    expect(state.cities[cityId].market.furniture?.sold30 ?? 0).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
    // stretch: the chain pays for its own running costs over its first year
    expect(moneyEnd).toBeGreaterThan(moneyAfterConstruction);
  });
});
