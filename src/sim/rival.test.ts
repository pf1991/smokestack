import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { BUILDINGS } from '../data/buildings';
import { connectToRoads, roadCost } from './roads';
import { canTakeover, chainFor, MAX_STALL_MONTHS, maxRivalChains, netWorth, RIVAL_RESERVE, rivalChainCount, rivalMonth, rivalTaunt, takeover, TAUNTS } from './rival';
import { runDays, serialize } from './simulation';
import { buildRoad, createGame, lPath, placeBuilding } from './state';
import { must, testCtx, testState } from './testkit';
import type { SimContext } from './types';
import { buyTruck, createRoute } from './vehicles';

function rivalGame(seed = 7): SimContext {
  return { state: createGame({ seed, companyName: 'Acme Works', rival: true }), bus: new EventBus() };
}

/** Records the rival's cash right after every construction spend it makes. */
function watchReserve(ctx: SimContext): { low: number[] } {
  const low: number[] = [];
  const check = () => {
    const m = ctx.state.companies.rival.money;
    if (m < RIVAL_RESERVE) low.push(m);
  };
  ctx.bus.on('buildingPlaced', (e) => {
    if (e.building.ownerId === 'rival') check();
  });
  ctx.bus.on('roadChanged', (e) => {
    const { map } = ctx.state;
    if (e.tiles.some((p) => map.tiles[p.y * map.width + p.x].roadOwner === 'rival')) check();
  });
  return { low };
}

describe('chainFor', () => {
  it('chainFor furniture', () => {
    const s = testState();
    expect(chainFor('furniture', s)).toEqual(['lumber_camp', 'sawmill', 'furniture_factory']);
  });

  it('builds multi-input chains from extractor to factory', () => {
    const s = testState();
    expect(chainFor('cheese', s)).toEqual(['dairy_farm', 'creamery']);
    const tools = chainFor('tools', s);
    expect(tools[tools.length - 1]).toBe('toolworks');
    expect(tools.filter((t) => t === 'mine')).toHaveLength(2);
    expect(tools).toContain('steel_mill');
    expect(tools).toContain('sawmill');
    expect(tools.indexOf('steel_mill')).toBeGreaterThan(tools.indexOf('mine'));
  });

  it('returns [] for locked goods', () => {
    expect(chainFor('cars', testState())).toEqual([]);
  });
});

describe('roads.connectToRoads', () => {
  it('charges the given owner and fails cleanly when unaffordable', () => {
    const ctx = testCtx(testState({ rivalMoney: 30000 }));
    must(buildRoad(ctx, 'player', lPath({ x: 0, y: 20 }, { x: 39, y: 20 })));
    const mill = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 10, y: 5 }));
    const before = serialize(ctx.state);
    const r = connectToRoads(ctx, mill, { owner: 'rival', reserve: 25000 });
    expect(r).toEqual({ ok: false, error: 'Not enough money' });
    expect(serialize(ctx.state)).toBe(before);
    const money = ctx.state.companies.rival.money;
    const built = must(connectToRoads(ctx, mill, { owner: 'rival' }));
    expect(built.built).toBe(12);
    expect(ctx.state.companies.rival.money).toBe(money - built.cost);
    expect(roadCost(ctx.state, [{ x: 0, y: 20 }])).toBe(0);
  });
});

describe('rivalMonth', () => {
  it('after 24 months headless the rival owns ≥ 1 store and ≥ 1 route', () => {
    const ctx = rivalGame(7);
    const sales: number[] = [];
    ctx.bus.on('sale', (e) => {
      if (e.ownerId === 'rival') sales.push(e.revenue);
    });
    const reserve = watchReserve(ctx);
    runDays(ctx, 720);
    const { state } = ctx;
    const rival = state.companies.rival;
    const stores = Object.values(state.buildings).filter((b) => b.ownerId === 'rival' && BUILDINGS[b.typeId].category === 'retail');
    const routes = Object.values(state.routes).filter((r) => r.ownerId === 'rival');
    const trucks = Object.values(state.vehicles).filter((v) => v.ownerId === 'rival');
    expect(stores.length).toBeGreaterThanOrEqual(1);
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(trucks.length).toBeGreaterThanOrEqual(routes.length);
    expect(reserve.low).toEqual([]);
    expect(sales.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `rival after 720 days: money $${rival.money}, loan $${rival.loan}, net worth $${netWorth(state, 'rival')}, ` +
        `stores ${stores.length}, routes ${routes.length}, trucks ${trucks.length}, ` +
        `sales ${sales.length} ($${sales.reduce((a, b) => a + b, 0)})`,
    );
  });

  it('chain ceiling grows by era and is never exceeded', () => {
    expect([1900, 1919, 1920, 1940, 1960, 1980, 2000].map(maxRivalChains)).toEqual([3, 3, 4, 5, 6, 7, 7]);
    const ctx = rivalGame(42);
    for (let year = 0; year < 25; year++) {
      runDays(ctx, 360);
      expect(rivalChainCount(ctx.state)).toBeLessThanOrEqual(maxRivalChains(ctx.state.date.year));
    }
    expect(rivalChainCount(ctx.state)).toBeGreaterThanOrEqual(3);
  });

  it('rival never dips below reserve from construction', () => {
    for (const seed of [3, 42]) {
      const ctx = rivalGame(seed);
      const reserve = watchReserve(ctx);
      runDays(ctx, 360);
      expect(reserve.low).toEqual([]);
    }
  });

  it('a poor rival builds nothing and borrows only when nearly broke', () => {
    const ctx = rivalGame(7);
    const rival = ctx.state.companies.rival;
    rival.money = 60000;
    rivalMonth(ctx);
    expect(Object.values(ctx.state.buildings).filter((b) => b.ownerId === 'rival')).toHaveLength(0);
    expect(rival.loan).toBe(0);
    rival.money = 10000;
    rivalMonth(ctx);
    expect(rival.loan).toBe(50000);
    expect(rival.money).toBe(60000);
  });

  it('repays loans when flush', () => {
    const ctx = rivalGame(7);
    const rival = ctx.state.companies.rival;
    rival.loan = 100000;
    rival.money = 400000;
    rivalMonth(ctx);
    expect(rival.loan).toBe(50000);
  });

  it('adds trucks to legs whose source is nearly full, at most 4', () => {
    const ctx = testCtx(testState({ rivalMoney: 500000 }));
    must(buildRoad(ctx, 'rival', lPath({ x: 0, y: 10 }, { x: 39, y: 10 })));
    const mill = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 5, y: 11 }));
    const fac = must(placeBuilding(ctx, 'rival', 'furniture_factory', { x: 20, y: 11 }));
    const route = must(
      createRoute(ctx, 'rival', 'lumber', [
        { buildingId: mill.id, load: ['lumber'], unload: [] },
        { buildingId: fac.id, load: [], unload: ['lumber'] },
      ]),
    );
    must(buyTruck(ctx, 'rival', route.id));
    const count = () => Object.values(ctx.state.vehicles).filter((v) => v.routeId === route.id).length;
    rivalMonth(ctx);
    expect(count()).toBe(1);
    mill.output.lumber = 100;
    for (let i = 0; i < 6; i++) rivalMonth(ctx);
    expect(count()).toBe(4);
  });

  it('is deterministic for a seed', () => {
    const a = rivalGame(11);
    const b = rivalGame(11);
    runDays(a, 240);
    runDays(b, 240);
    expect(serialize(a.state)).toBe(serialize(b.state));
  });

  it('inactive rival does nothing', () => {
    const ctx = rivalGame(7);
    ctx.state.companies.rival.active = false;
    const before = serialize(ctx.state);
    for (let i = 0; i < 12; i++) rivalMonth(ctx);
    expect(serialize(ctx.state)).toBe(before);
    runDays(ctx, 360);
    expect(Object.values(ctx.state.buildings).filter((b) => b.ownerId === 'rival')).toHaveLength(0);
    expect(ctx.state.news.filter((n) => n.kind === 'rival')).toHaveLength(0);
  });

  it('stays fast', () => {
    const ctx = rivalGame(7);
    runDays(ctx, 60);
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      rivalMonth(ctx);
      worst = Math.max(worst, performance.now() - t);
    }
    expect(worst).toBeLessThan(60); // ~20 ms target, generous for CI noise
  });
});

describe('rival projects never deadlock', () => {
  /** Longest run of consecutive month-ends with the very same project in the very same stage. */
  function longestStall(seed: number, months: number): { stall: number; routes: number } {
    const ctx = rivalGame(seed);
    let last = '';
    let run = 0;
    let worst = 0;
    for (let m = 0; m < months; m++) {
      runDays(ctx, 30);
      const p = ctx.state.rivalProject;
      const key = p ? `${JSON.stringify(p)}|${ctx.state.flags.rivalBuildings}` : '';
      run = key && key === last ? run + 1 : 0;
      worst = Math.max(worst, run);
      last = key;
    }
    const routes = Object.values(ctx.state.routes).filter((r) => r.ownerId === 'rival').length;
    return { stall: worst, routes };
  }

  it('seed 10: no project stalls more than 8 months over 180 months, ≥ 3 routes', () => {
    const r = longestStall(10, 180);
    // eslint-disable-next-line no-console
    console.log(`seed 10: longest stall ${r.stall} months, rival routes ${r.routes}`);
    expect(r.stall).toBeLessThanOrEqual(8);
    expect(r.routes).toBeGreaterThanOrEqual(3);
  }, 120000);

  it('a project waiting for money is abandoned after MAX_STALL_MONTHS when legs lack trucks', () => {
    const ctx = rivalGame(7);
    for (let i = 0; i < 3; i++) rivalMonth(ctx); // store + factory + one more building
    expect(ctx.state.rivalProject).not.toBeNull();
    ctx.state.companies.rival.money = 45000; // above the loan trigger, below reserve + anything
    for (let i = 0; i < MAX_STALL_MONTHS; i++) rivalMonth(ctx);
    expect(ctx.state.rivalProject).toBeNull();
    expect(ctx.state.flags.rivalStall).toBeUndefined();
    expect(ctx.state.flags.rivalBlocked ?? '').toBe(''); // a money stall does not blacklist the market
  });
});

describe('rivalTaunt', () => {
  it('has 20 quips and publishes rival news about 30% of months', () => {
    expect(TAUNTS).toHaveLength(20);
    const ctx = rivalGame(5);
    for (let i = 0; i < 200; i++) rivalTaunt(ctx);
    const n = ctx.state.news.filter((x) => x.kind === 'rival').length;
    expect(n).toBeGreaterThan(35);
    expect(n).toBeLessThan(85);
    const all = ctx.state.news.map((x) => `${x.headline} ${x.body}`).join('\n');
    expect(all).toContain('Smogsworth');
    expect(all).toContain('Acme Works');
    expect(all).not.toMatch(/\{\w+\}/);
  });
});

describe('takeover', () => {
  it('takeover transfers ownership', () => {
    const ctx = rivalGame(7);
    runDays(ctx, 360);
    const { state } = ctx;
    const rivalBuildings = Object.values(state.buildings).filter((b) => b.ownerId === 'rival').map((b) => b.id);
    const rivalRoutes = Object.values(state.routes).filter((r) => r.ownerId === 'rival').map((r) => r.id);
    const rivalTrucks = Object.values(state.vehicles).filter((v) => v.ownerId === 'rival').map((v) => v.id);
    const rivalRoads = state.map.tiles.filter((t) => t.roadOwner === 'rival').length;
    expect(rivalBuildings.length).toBeGreaterThan(0);

    expect(canTakeover(state)).toBe(false);
    expect(takeover(ctx).ok).toBe(false);

    const price = Math.round(1.2 * netWorth(state, 'rival'));
    state.companies.player.money = Math.max(1_000_000, 3 * netWorth(state, 'rival')) + price;
    expect(canTakeover(state)).toBe(true);
    const events: string[] = [];
    ctx.bus.on('achievement', (e) => events.push(e.id));
    const playerMoney = state.companies.player.money;
    state.companies.rival.loan = 50000;
    const rivalCash = state.companies.rival.money - state.companies.rival.loan;
    const priceWithLoan = Math.round(1.2 * netWorth(state, 'rival'));
    const playerRoads = state.companies.player.roadTiles;
    must(takeover(ctx));

    // pays 1.2 × his net worth, receives his cash net of his loan
    expect(state.companies.player.money).toBe(playerMoney - priceWithLoan + rivalCash);
    expect(state.companies.rival.money).toBe(0);
    expect(state.companies.rival.loan).toBe(0);
    for (const id of rivalBuildings) expect(state.buildings[id].ownerId).toBe('player');
    for (const id of rivalRoutes) expect(state.routes[id].ownerId).toBe('player');
    for (const id of rivalTrucks) expect(state.vehicles[id].ownerId).toBe('player');
    expect(state.map.tiles.filter((t) => t.roadOwner === 'rival')).toHaveLength(0);
    expect(state.companies.player.roadTiles).toBe(playerRoads + rivalRoads);
    expect(state.companies.rival.roadTiles).toBe(0);
    expect(state.companies.rival.active).toBe(false);
    expect(state.rivalProject).toBeNull();
    expect(state.flags.takeover).toBe(true);
    expect(events).toEqual(['baron_busted']);
    expect(state.news[state.news.length - 1].headline).toBe('SMOGSWORTH OUSTED!');
    expect(canTakeover(state)).toBe(false);

    // the rival stays dormant afterwards and nothing breaks
    runDays(ctx, 60);
    expect(Object.values(state.buildings).every((b) => b.ownerId === 'player')).toBe(true);
  });

  it('refuses below $1,000,000 net worth', () => {
    const ctx = rivalGame(7);
    ctx.state.companies.rival.money = 100000;
    ctx.state.companies.player.money = 900000;
    expect(canTakeover(ctx.state)).toBe(false);
    ctx.state.companies.player.money = 1_000_000;
    expect(canTakeover(ctx.state)).toBe(true);
  });
});
