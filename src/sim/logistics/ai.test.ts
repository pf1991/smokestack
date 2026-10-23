import { describe, expect, it } from 'vitest';
import { addCompany } from '../companies';
import { listCompany } from '../exchange/shares';
import { spend } from '../finance';
import { rivalReserve } from '../rival/shared';
import { REGIONAL_RESERVE } from '../regional/firms';
import { atPrices } from '../society/economy';
import { buildRoad, lPath, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, OwnerId, SimContext } from '../types';
import {
  AI_HUB_TRUCKS, aiLogisticsMonth, aiReserve, BARON_RESERVE_MULTIPLE, BARON_UPGRADE_GAP_MONTHS, FIRM_RESERVE_MULTIPLE, FIRM_UPGRADE_GAP_MONTHS, hubCostEstimate, HUB_RETRY_MONTHS, hubReserveOf,
} from './ai';
import { outputValue } from './aiPost';
import { hubAttached, hubAutoSizeMonth, hubCap, hubTrucks } from './hubs';
import { upgradeCost } from './levels';
import { fire, managerAt, managerSalary, refreshMarket } from './managers';
import type { Skill } from './types';
import { checkInvariants } from '../invariants';
import { runDays } from '../simulation';
import { buyTruck, createRoute } from '../vehicles';

const FIRM: OwnerId = 'regional_1';

/** A 60x30 map with a road along y=12 and a town at (44,20); the date is the last day of `month`/`year`. */
function setup(year: number, month = 6): SimContext {
  const s = testState({ width: 60, height: 30, year, money: 1e8, rivalMoney: 1e8, cities: [{ x: 44, y: 20, population: 3000, name: 'Ashford' }] });
  s.date = { year, month, day: 30, hour: 0 };
  const ctx = testCtx(s);
  refreshMarket(s, year);
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 12 }, { x: 58, y: 12 })));
  return ctx;
}

/** A works for `owner` above the road at x, built `age` years ago. */
function works(ctx: SimContext, owner: OwnerId, typeId: string, x: number, recipeId: string, age = 5): Building {
  const b = must(placeBuilding(ctx, owner, typeId, { x, y: 9 }, recipeId));
  b.builtYear = ctx.state.date.year - age;
  return b;
}

/** Three furniture factories (three chains) for the Baron, the middle one the busiest. */
function baronChains(ctx: SimContext): Building[] {
  const out = [5, 15, 25].map((x) => works(ctx, 'rival', 'furniture_factory', x, 'r_furniture'));
  out[0].staffing = 0.5;
  out[2].staffing = 0.6;
  return out;
}

/** Steps the date to the next month's end. */
function nextMonth(ctx: SimContext): void {
  const d = ctx.state.date;
  if (d.month === 12) (d.year++, (d.month = 1));
  else d.month++;
}

const upgrading = (ctx: SimContext, owner: OwnerId) =>
  Object.values(ctx.state.buildings).filter((b) => b.ownerId === owner && b.works).map((b) => b.id);

const hubs = (ctx: SimContext, owner: OwnerId) => Object.values(ctx.state.buildings).filter((b) => b.ownerId === owner && b.hub);

function addFirm(ctx: SimContext, money: number, foundedYear: number): void {
  const c = addCompany(ctx.state, { id: FIRM, kind: 'regional', name: 'Ashford Joinery', money, loan: 0, homeCityId: 0 });
  // the firm's first ledger month is its founding month
  spend(c, 'construction', 0, { year: foundedYear, month: 1, day: 1, hour: 0 });
  listCompany(ctx.state, FIRM);
}

describe('aiUpgrade', () => {
  it('the Baron upgrades his busiest works when he keeps his AI reserve, and not twice within the gap', () => {
    const ctx = setup(1905);
    const [a, b, c] = baronChains(ctx);
    expect(outputValue(ctx.state, b)).toBeGreaterThan(outputValue(ctx.state, a));
    expect(outputValue(ctx.state, b)).toBeGreaterThan(outputValue(ctx.state, c));
    const rival = ctx.state.companies.rival;
    expect(aiReserve(ctx.state, 'rival')).toBe(BARON_RESERVE_MULTIPLE * rivalReserve(ctx.state));
    // one dollar short of keeping his reserve after paying: nothing
    rival.money = aiReserve(ctx.state, 'rival') + upgradeCost(ctx.state, b) - 1;
    aiLogisticsMonth(ctx);
    expect(upgrading(ctx, 'rival')).toEqual([]);
    rival.money += 1;
    aiLogisticsMonth(ctx);
    expect(upgrading(ctx, 'rival')).toEqual([b.id]);
    expect(rival.money).toBe(aiReserve(ctx.state, 'rival'));
    rival.money = 1e8;
    for (let i = 1; i < BARON_UPGRADE_GAP_MONTHS; i++) {
      nextMonth(ctx);
      aiLogisticsMonth(ctx);
      expect(upgrading(ctx, 'rival'), `month ${i}`).toEqual([b.id]);
    }
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    // b is under works: the next busiest goes next
    expect(upgrading(ctx, 'rival')).toEqual([b.id, c.id]);
    expect(ctx.state.logistics.stats.upgrades.rival).toBe(2);
  });

  it('skips works younger than 2 years and works already at the highest available level', () => {
    const ctx = setup(1905);
    const [a, b, c] = baronChains(ctx);
    b.builtYear = 1904; // a year old
    c.level = 2; // level 3 arrives in 1920
    aiLogisticsMonth(ctx);
    expect(upgrading(ctx, 'rival')).toEqual([a.id]);
  });

  it('a firm upgrades at most once a year, keeping 2x its reserve', () => {
    expect(FIRM_RESERVE_MULTIPLE).toBe(2);
    const ctx = setup(1915);
    addFirm(ctx, 1e7, 1906);
    works(ctx, FIRM, 'sawmill', 5, 'r_lumber');
    works(ctx, FIRM, 'furniture_factory', 15, 'r_furniture');
    const seen: number[] = [];
    for (let i = 0; i < 2 * FIRM_UPGRADE_GAP_MONTHS; i++) {
      aiLogisticsMonth(ctx);
      seen.push(ctx.state.logistics.stats.upgrades[FIRM] ?? 0);
      nextMonth(ctx);
    }
    expect(seen.slice(0, FIRM_UPGRADE_GAP_MONTHS)).toEqual(Array(FIRM_UPGRADE_GAP_MONTHS).fill(1));
    expect(seen[FIRM_UPGRADE_GAP_MONTHS]).toBe(2);
    // short of 2x its reserve, it waits
    const ctx2 = setup(1915);
    addFirm(ctx2, 1e7, 1906);
    const mill = works(ctx2, FIRM, 'sawmill', 5, 'r_lumber');
    ctx2.state.companies[FIRM].money = FIRM_RESERVE_MULTIPLE * atPrices(ctx2.state, REGIONAL_RESERVE) + upgradeCost(ctx2.state, mill) - 1;
    aiLogisticsMonth(ctx2);
    expect(upgrading(ctx2, FIRM)).toEqual([]);
  });
});

describe('aiHub and aiHire', () => {
  it('from 1910 a Baron with 3 chains builds one hub with 2 trucks, then hires a logistics 2+ manager at the end of January', () => {
    const early = setup(1909, 12);
    baronChains(early);
    aiLogisticsMonth(early);
    expect(hubs(early, 'rival')).toEqual([]);

    const ctx = setup(1910, 12);
    baronChains(ctx);
    aiLogisticsMonth(ctx);
    const [hub] = hubs(ctx, 'rival');
    expect(hub?.typeId).toBe('warehouse');
    expect(hubs(ctx, 'rival')).toHaveLength(1);
    expect(hubTrucks(ctx.state, hub.id)).toHaveLength(AI_HUB_TRUCKS);
    expect(hub.hub!.autoSize).toBe(true);
    // December: no hire yet
    expect(ctx.state.logistics.managers.filter((m) => m.employer === 'rival')).toEqual([]);
    refreshMarket(ctx.state, 1911);
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    expect(hubs(ctx, 'rival')).toHaveLength(1);
    const boss = managerAt(ctx.state, hub.id);
    expect(boss?.employer).toBe('rival');
    expect(boss!.skills.logistics).toBeGreaterThanOrEqual(2);
    expect(ctx.state.logistics.stats.hires.rival).toBeGreaterThanOrEqual(1);
    // at most 2 managers: the hub's and his busiest works'
    expect(ctx.state.logistics.managers.filter((m) => m.employer === 'rival').length).toBeLessThanOrEqual(2);
  });

  it('a Baron with fewer than 3 chains builds no hub', () => {
    const ctx = setup(1912, 1);
    for (const x of [5, 15]) works(ctx, 'rival', 'furniture_factory', x, 'r_furniture');
    aiLogisticsMonth(ctx);
    expect(hubs(ctx, 'rival')).toEqual([]);
  });

  it('a firm founded 5 years ago with enough cash builds a hub; one short of cash or younger does not', () => {
    const rich = setup(1915);
    addFirm(rich, 1e7, 1910);
    works(rich, FIRM, 'sawmill', 5, 'r_lumber', 1);
    aiLogisticsMonth(rich);
    expect(hubs(rich, FIRM)).toHaveLength(1);

    const young = setup(1915);
    addFirm(young, 1e7, 1911);
    works(young, FIRM, 'sawmill', 5, 'r_lumber', 1);
    aiLogisticsMonth(young);
    expect(hubs(young, FIRM)).toEqual([]);

    const poor = setup(1915);
    addFirm(poor, 1e7, 1910);
    works(poor, FIRM, 'sawmill', 5, 'r_lumber', 1);
    poor.state.companies[FIRM].money = FIRM_RESERVE_MULTIPLE * atPrices(poor.state, REGIONAL_RESERVE) + hubCostEstimate(poor.state) - 1;
    aiLogisticsMonth(poor);
    expect(hubs(poor, FIRM)).toEqual([]);
    expect(Object.values(poor.state.buildings).filter((b) => b.ownerId === FIRM && b.typeId === 'warehouse')).toEqual([]);
  });

  it('a firm that cannot place or link its warehouse waits HUB_RETRY_MONTHS before trying again', () => {
    const ctx = setup(1915);
    addFirm(ctx, 1e7, 1910);
    works(ctx, FIRM, 'sawmill', 5, 'r_lumber', 1);
    // no free land anywhere: no site for the warehouse
    const tiles = ctx.state.map.tiles;
    const saved = tiles.map((t) => t.terrain);
    for (const t of tiles) if (t.buildingId === null && !t.road) t.terrain = 'water';
    const money = ctx.state.companies[FIRM].money;
    aiLogisticsMonth(ctx);
    expect(hubs(ctx, FIRM)).toEqual([]);
    expect(ctx.state.companies[FIRM].money).toBe(money);
    tiles.forEach((t, i) => (t.terrain = saved[i]));
    for (let m = 1; m < HUB_RETRY_MONTHS; m++) {
      nextMonth(ctx);
      aiLogisticsMonth(ctx);
      expect(hubs(ctx, FIRM), `month ${m}`).toEqual([]);
    }
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    expect(hubs(ctx, FIRM)).toHaveLength(1);
  });

  it('a firm hires at most one manager, for its hub, only in January', () => {
    const ctx = setup(1915, 12);
    addFirm(ctx, 1e7, 1910);
    works(ctx, FIRM, 'sawmill', 5, 'r_lumber', 1);
    aiLogisticsMonth(ctx);
    const [hub] = hubs(ctx, FIRM);
    expect(managerAt(ctx.state, hub.id)).toBeNull();
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    expect(managerAt(ctx.state, hub.id)?.employer).toBe(FIRM);
    nextMonth(ctx);
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    expect(ctx.state.logistics.managers.filter((m) => m.employer === FIRM)).toHaveLength(1);
  });
});

describe('AI hub legs (review fix A)', () => {
  /** A firm with a dairy farm and a creamery on the road, a milk route between them with `trucks` trucks; the hub opens in December. */
  function firmChain(trucks = 1) {
    const ctx = setup(1915, 12);
    addFirm(ctx, 1e7, 1910);
    const farm = works(ctx, FIRM, 'dairy_farm', 22, 'r_milk', 1);
    const cream = must(placeBuilding(ctx, FIRM, 'creamery', { x: 34, y: 10 }, 'r_cheese'));
    const route = must(createRoute(ctx, FIRM, 'Milk line', [
      { buildingId: farm.id, load: ['milk'], unload: [] },
      { buildingId: cream.id, load: [], unload: ['milk'] },
    ]));
    for (let i = 0; i < trucks; i++) must(buyTruck(ctx, FIRM, route.id));
    aiLogisticsMonth(ctx);
    const [hub] = hubs(ctx, FIRM);
    expect(hub).toBeDefined();
    // January: a logistics-5 candidate on the market sees the whole range
    refreshMarket(ctx.state, 1916);
    const m = ctx.state.logistics.market[0];
    m.skills = { logistics: 5, production: 1, frugality: 1 };
    m.salary = managerSalary(m.skills);
    nextMonth(ctx);
    return { ctx, farm, cream, route, hub };
  }

  it('a managed AI hub takes over the in-range leg and logs hub jobs over 60 days', () => {
    const { ctx, farm, cream, route, hub } = firmChain();
    aiLogisticsMonth(ctx);
    expect(managerAt(ctx.state, hub.id)?.employer).toBe(FIRM);
    expect(ctx.state.routes[route.id]).toBeUndefined();
    expect(hub.hub!.legs).toEqual([{ from: farm.id, to: cream.id, load: ['milk'], unload: ['milk'], trucks: 1 }]);
    expect(hubTrucks(ctx.state, hub.id).length).toBe(AI_HUB_TRUCKS + 1);
    runDays(ctx, 60);
    expect(ctx.state.logistics.stats.hubJobs[FIRM] ?? 0).toBeGreaterThan(0);
    expect((cream.input.milk ?? 0) + (cream.output.cheese ?? 0) + (cream.producedThisMonth.cheese ?? 0)).toBeGreaterThan(0);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('over a year the converted hub keeps working its leg and keeps its two trucks (auto-sizing does not shrink it)', () => {
    const { ctx, hub } = firmChain();
    aiLogisticsMonth(ctx);
    expect(managerAt(ctx.state, hub.id)?.employer).toBe(FIRM);
    let last = ctx.state.logistics.stats.hubJobs[FIRM] ?? 0;
    for (let month = 0; month < 12; month++) {
      runDays(ctx, 30);
      const jobs = ctx.state.logistics.stats.hubJobs[FIRM] ?? 0;
      // jobs every month once the farm has a load (from the second), and the fleet never below the
      // hub's two plus the leg's truck: busy, auto-sizing grows it (to the cap here) instead of selling
      if (month > 0) expect(jobs, `month ${month}`).toBeGreaterThan(last);
      expect(hubTrucks(ctx.state, hub.id).length, `month ${month}`).toBeGreaterThanOrEqual(AI_HUB_TRUCKS + 1);
      last = jobs;
    }
    expect(hubTrucks(ctx.state, hub.id).length).toBe(hubCap(hub));
    expect(Object.values(ctx.state.routes).filter((r) => r.ownerId === FIRM)).toEqual([]);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('a leg into a store stays a route', () => {
    const { ctx, farm, cream, route, hub } = firmChain();
    // a corner of Ashford next to the creamery
    for (const [x, y] of [[38, 13], [39, 13], [38, 14], [39, 14]]) ctx.state.map.tiles[y * ctx.state.map.width + x].cityId = 0;
    const store = must(placeBuilding(ctx, FIRM, 'store', { x: 38, y: 13 }));
    // the store is in the hub's range, so only its kind keeps its leg routed
    expect(hubAttached(ctx.state, hub, 12).map((b) => b.id)).toEqual(expect.arrayContaining([farm.id, cream.id, store.id]));
    const sell = must(createRoute(ctx, FIRM, 'Cheese line', [
      { buildingId: cream.id, load: ['cheese'], unload: [] },
      { buildingId: store.id, load: [], unload: ['cheese'] },
    ]));
    aiLogisticsMonth(ctx);
    expect(ctx.state.routes[route.id]).toBeUndefined();
    expect(ctx.state.routes[sell.id]).toBeDefined();
    expect(hub.hub!.legs).toHaveLength(1);
  });

  it('moves all of a leg\'s trucks to the hub, keeping their age, with no sale or charge', () => {
    const { ctx, route, hub } = firmChain(2);
    expect(hubCap(hub) - AI_HUB_TRUCKS).toBe(2);
    const before = Object.values(ctx.state.vehicles).filter((v) => v.ownerId === FIRM).map((v) => v.id);
    const legTrucks = Object.values(ctx.state.vehicles).filter((v) => v.routeId === route.id).map((v) => v.id);
    // the leg's trucks are a year older than the hub's: a moved truck keeps its age and model
    for (const id of legTrucks) ctx.state.vehicles[id].builtYear -= 1;
    const legYear = ctx.state.vehicles[legTrucks[0]].builtYear;
    const fleetBooks = () =>
      ctx.state.companies[FIRM].ledger.reduce(([i, e], m) => [i + (m.income.vehicles ?? 0), e + (m.expense.vehicles ?? 0)], [0, 0]);
    const books = fleetBooks();
    aiLogisticsMonth(ctx);
    expect(ctx.state.routes[route.id]).toBeUndefined();
    const after = hubTrucks(ctx.state, hub.id);
    expect(after.length).toBe(AI_HUB_TRUCKS + 2);
    // the hub's own two stay; the leg's are re-issued onto it (new ids), idle and without a job
    const own = before.filter((id) => !legTrucks.includes(id));
    expect(after.slice(0, AI_HUB_TRUCKS).map((v) => v.id)).toEqual(own);
    const moved = after.slice(AI_HUB_TRUCKS);
    expect(moved.map((v) => v.builtYear)).toEqual([legYear, legYear]);
    expect(moved.every((v) => !legTrucks.includes(v.id) && v.job === null && v.routeId === null && v.state === 'idle')).toBe(true);
    expect(Object.keys(ctx.state.vehicles).map(Number).sort((a, b) => a - b)).toEqual(after.map((v) => v.id));
    // nothing sold or bought (the month's other spending is the manager's hire)
    expect(fleetBooks()).toEqual(books);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('hub auto-sizing never sells the trucks a converted leg brought, idle or not', () => {
    const { ctx, hub } = firmChain(2);
    aiLogisticsMonth(ctx);
    expect(hubTrucks(ctx.state, hub.id).length).toBe(AI_HUB_TRUCKS + 2);
    // a month of nothing but idle trucks: it sells down to the leg's two plus one, and no further
    for (let i = 0; i < 3; i++) {
      hub.hub!.month = { jobs: 0, idleTruckDays: 30 * 4, backlogDays: 0 };
      hubAutoSizeMonth(ctx, hubReserveOf);
    }
    expect(hubTrucks(ctx.state, hub.id).length).toBe(3);
  });

  it('a leg with more trucks than the hub has room for stays a route, and none is sold', () => {
    const { ctx, route, hub } = firmChain(3);
    const trucks = Object.keys(ctx.state.vehicles).length;
    aiLogisticsMonth(ctx);
    expect(managerAt(ctx.state, hub.id)?.employer).toBe(FIRM);
    expect(ctx.state.routes[route.id]).toBeDefined();
    expect(hub.hub!.legs ?? []).toEqual([]);
    expect(hubTrucks(ctx.state, hub.id).length).toBe(AI_HUB_TRUCKS);
    expect(Object.keys(ctx.state.vehicles).length).toBe(trucks);
  });

  it('a hub that loses its manager rebuilds its legs as routes that month, and the chain keeps delivering', () => {
    const { ctx, farm, cream, hub } = firmChain();
    aiLogisticsMonth(ctx);
    const m = managerAt(ctx.state, hub.id)!;
    must(fire(ctx, FIRM, m.id, false));
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    const routes = Object.values(ctx.state.routes).filter((r) => r.ownerId === FIRM);
    expect(routes.map((r) => r.stops.map((s) => [s.buildingId, s.load, s.unload]))).toEqual([
      [[farm.id, ['milk'], []], [cream.id, [], ['milk']]],
    ]);
    expect(hub.hub!.legs).toEqual([]);
    expect(hubTrucks(ctx.state, hub.id)).toEqual([]);
    expect(Object.values(ctx.state.vehicles).filter((v) => v.routeId === routes[0].id).length).toBe(AI_HUB_TRUCKS + 1);
    cream.input = {};
    cream.output = {};
    runDays(ctx, 30);
    expect((cream.input.milk ?? 0) + (cream.output.cheese ?? 0) + (cream.producedThisMonth.cheese ?? 0)).toBeGreaterThan(0);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('hires the best affordable candidate: highest logistics, then lowest salary, then lowest id', () => {
    const ctx = setup(1915, 12);
    addFirm(ctx, 1e7, 1910);
    works(ctx, FIRM, 'sawmill', 5, 'r_lumber', 1);
    aiLogisticsMonth(ctx);
    const [hub] = hubs(ctx, FIRM);
    nextMonth(ctx);
    refreshMarket(ctx.state, 1916);
    const L = ctx.state.logistics;
    const base = L.market[0];
    const cand = (id: number, logistics: Skill, salary: number) => ({ ...base, id, skills: { logistics, production: 1 as Skill, frugality: 1 as Skill }, salary });
    // the firm can pay a year of at most (money - reserve) / 12
    const budget = (ctx.state.companies[FIRM].money - FIRM_RESERVE_MULTIPLE * atPrices(ctx.state, REGIONAL_RESERVE)) / 12;
    L.market = [cand(901, 5, budget + 1), cand(902, 3, 400), cand(903, 3, 300), cand(904, 3, 300), cand(905, 2, 100), cand(906, 1, 50)];
    aiLogisticsMonth(ctx);
    expect(managerAt(ctx.state, hub.id)?.id).toBe(903);
  });
});
