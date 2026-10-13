import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { currentLedger } from '../finance';
import { placeBuilding } from '../state';
import { TRUCK } from '../vehicles';
import { must, testCtx, testState } from '../testkit';
import { EARNINGS_MONTHS, insolvencyGuard, recordBaronEarnings, worstBaronBuilding } from './insolvency';
import { rivalMonth } from './index';

/** The Baron with a store in town and two works on open grass. */
function baron() {
  const ctx = testCtx(testState({ rivalMoney: 1e7, cities: [{ x: 30, y: 20 }] }));
  const store = must(placeBuilding(ctx, 'rival', 'store', { x: 30, y: 21 }));
  const mill = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 8, y: 2 }));
  const shop = must(placeBuilding(ctx, 'rival', 'furniture_factory', { x: 14, y: 2 }));
  return { ctx, store, mill, shop };
}

describe('the Baron’s insolvency guard (R-S13)', () => {
  it('records a month of sales (stores) or output value (works) less upkeep, keeping 12 months', () => {
    const { ctx, store, mill } = baron();
    ctx.state.economy.priceIndex = 2;
    store.salesThisMonth = 5000;
    mill.producedThisMonth = { lumber: 10 };
    recordBaronEarnings(ctx);
    expect(store.earnings12).toEqual([5000 - BUILDINGS.store.maintenance * 2]);
    expect(mill.earnings12).toEqual([Math.round(10 * GOODS.lumber.basePrice * 2 - BUILDINGS.sawmill.maintenance * 2)]);
    expect(store.salesThisMonth).toBe(0);
    for (let i = 0; i < 20; i++) recordBaronEarnings(ctx);
    expect(store.earnings12!.length).toBe(EARNINGS_MONTHS);
  });

  it('does nothing while his money is 0 or more', () => {
    const { ctx } = baron();
    ctx.state.companies.rival.money = 0;
    expect(insolvencyGuard(ctx)).toBeNull();
    expect(Object.values(ctx.state.buildings).length).toBe(3);
  });

  it('below 0 at month end he demolishes his single worst earner, with the normal refund', () => {
    const { ctx, store, mill, shop } = baron();
    store.earnings12 = [900, 900];
    mill.earnings12 = [-400, -100];
    shop.earnings12 = [-200, 100];
    expect(worstBaronBuilding(ctx.state)?.id).toBe(mill.id);
    ctx.state.companies.rival.money = -10_000;
    expect(insolvencyGuard(ctx)).toBe(mill.id);
    expect(ctx.state.buildings[mill.id]).toBeUndefined();
    expect(ctx.state.buildings[shop.id]).toBeDefined();
    expect(ctx.state.companies.rival.money).toBe(-10_000 + Math.round(BUILDINGS.sawmill.cost * 0.25));
    expect(currentLedger(ctx.state.companies.rival, ctx.state.date).income.demolition).toBe(Math.round(BUILDINGS.sawmill.cost * 0.25));
  });

  it('cuts nothing when even the worst earner made money (he waits for the profits)', () => {
    const { ctx, store, mill, shop } = baron();
    store.earnings12 = [900];
    mill.earnings12 = [10];
    shop.earnings12 = [500];
    ctx.state.companies.rival.money = -10_000;
    expect(insolvencyGuard(ctx)).toBeNull();
    expect(Object.values(ctx.state.buildings).length).toBe(3);
  });

  it('charges each vehicle’s upkeep to its route’s stops, and sells the vehicles of a route the cut leaves stopless', () => {
    const { ctx, store, mill, shop } = baron();
    const stops = [
      { buildingId: mill.id, load: ['lumber'], unload: [] },
      { buildingId: shop.id, load: [], unload: ['lumber'] },
    ];
    // route and vehicle by hand: these works have no road access
    const route = { id: 998, ownerId: 'rival', name: 'Lumber', color: '#fff', stops, kind: 'truck' as const };
    ctx.state.routes[route.id] = route;
    ctx.state.vehicles[999] = {
      id: 999, kind: 'truck', ownerId: 'rival', routeId: route.id, pos: { x: 0, y: 0 }, prevPos: { x: 0, y: 0 }, path: [],
      pathIndex: 0, stopIndex: 0, cargo: {}, capacity: 20, state: 'idle', waitTicks: 0, stuckNotified: false, builtYear: 1900,
    };
    recordBaronEarnings(ctx);
    expect(mill.earnings12).toEqual([Math.round(-BUILDINGS.sawmill.maintenance - TRUCK.maintenance / 2)]);
    expect(store.earnings12).toEqual([-BUILDINGS.store.maintenance]);
    ctx.state.companies.rival.money = -10_000;
    const cut = insolvencyGuard(ctx);
    // the costlier works (its upkeep plus half a truck) is the worst; either cut leaves the route one stop
    const worst = BUILDINGS.furniture_factory.maintenance > BUILDINGS.sawmill.maintenance ? shop.id : mill.id;
    expect(cut).toBe(worst);
    expect(ctx.state.routes[route.id]).toBeUndefined();
    expect(ctx.state.vehicles[999]).toBeUndefined();
  });

  it('never cuts a logistics building directly; with no losing works or store, nothing is cut', () => {
    const { ctx, store, mill, shop } = baron();
    const depot = must(placeBuilding(ctx, 'rival', 'warehouse', { x: 2, y: 12 }));
    depot.earnings12 = [-99_999];
    store.earnings12 = [100];
    mill.earnings12 = [-10];
    shop.earnings12 = [50];
    expect(worstBaronBuilding(ctx.state)?.id).toBe(mill.id);
    ctx.state.companies.rival.money = -1;
    mill.earnings12 = [10];
    expect(insolvencyGuard(ctx)).toBeNull();
    expect(ctx.state.buildings[depot.id]).toBeDefined();
  });

  it('breaks ties by the lowest id, and spares the buildings of a project in progress', () => {
    const { ctx, store, mill, shop } = baron();
    for (const b of [store, mill, shop]) b.earnings12 = [-50];
    expect(worstBaronBuilding(ctx.state)?.id).toBe(store.id);
    ctx.state.flags.rivalBuildings = `${store.id}`;
    expect(worstBaronBuilding(ctx.state)?.id).toBe(mill.id);
  });

  it('starts no new project while his money is negative', () => {
    const ctx = testCtx(testState({ cities: [{ x: 25, y: 15, population: 20000 }], rivalMoney: 1e7 }));
    ctx.state.companies.rival.money = -1;
    ctx.state.companies.rival.loan = 1e9; // no loan can rescue him
    rivalMonth(ctx);
    expect(ctx.state.rivalProject).toBeNull();
    expect(ctx.state.rivalRail ?? null).toBeNull();
  });
});
