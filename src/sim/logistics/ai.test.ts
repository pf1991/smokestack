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
import { HUB_RESERVE, hubAutoSizeMonth, hubTrucks } from './hubs';
import { newestModel } from './models';
import { upgradeCost } from './levels';
import { managerAt, managerSalary, refreshMarket } from './managers';
import type { Manager, Skill } from './types';
import { checkInvariants } from '../invariants';
import { runDays } from '../simulation';
import { vehiclePrice } from '../vehicles';

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

describe('AI hubs at work', () => {
  /** A firm with a dairy farm and a creamery on the road and no route between them; the hub opens in December and a logistics-5 manager is on January's market (the only one, so the AI hires it). */
  function firmChain() {
    const ctx = setup(1915, 12);
    addFirm(ctx, 1e7, 1910);
    works(ctx, FIRM, 'dairy_farm', 22, 'r_milk', 1);
    const cream = must(placeBuilding(ctx, FIRM, 'creamery', { x: 34, y: 10 }, 'r_cheese'));
    aiLogisticsMonth(ctx);
    const [hub] = hubs(ctx, FIRM);
    expect(hub).toBeDefined();
    refreshMarket(ctx.state, 1916);
    const m = ctx.state.logistics.market[0];
    m.skills = { logistics: 5, production: 1, frugality: 1 };
    m.salary = managerSalary(m.skills);
    ctx.state.logistics.market = [m];
    nextMonth(ctx);
    aiLogisticsMonth(ctx);
    expect(managerAt(ctx.state, hub.id)?.employer).toBe(FIRM);
    return { ctx, cream, hub };
  }

  it('over a year an AI hub with unrouted work in range does jobs every month and keeps its two trucks', () => {
    const { ctx, cream, hub } = firmChain();
    let last = ctx.state.logistics.stats.hubJobs[FIRM] ?? 0;
    let cheese = 0;
    for (let month = 0; month < 12; month++) {
      runDays(ctx, 30);
      cheese += cream.producedThisMonth.cheese ?? 0;
      const jobs = ctx.state.logistics.stats.hubJobs[FIRM] ?? 0;
      // jobs every month once the farm has a load (from the second); busy, auto-sizing never sells below 2
      if (month > 0) expect(jobs, `month ${month}`).toBeGreaterThan(last);
      expect(hubTrucks(ctx.state, hub.id).length, `month ${month}`).toBeGreaterThanOrEqual(AI_HUB_TRUCKS);
      last = jobs;
    }
    expect(cheese).toBeGreaterThan(0);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('hub auto-sizing buys an AI hub truck only while the owner keeps its AI reserve', () => {
    const { ctx, hub } = firmChain();
    const reserve = aiReserve(ctx.state, FIRM);
    const price = vehiclePrice(ctx.state, newestModel(ctx.state));
    expect(reserve).toBeGreaterThan(atPrices(ctx.state, HUB_RESERVE));
    const n = hubTrucks(ctx.state, hub.id).length;
    // above HUB_RESERVE, $1 short of the AI reserve: no purchase
    ctx.state.companies[FIRM].money = reserve + price - 1;
    hub.hub!.month = { jobs: 40, idleTruckDays: 0, backlogDays: 12 };
    hubAutoSizeMonth(ctx, hubReserveOf);
    expect(hubTrucks(ctx.state, hub.id).length).toBe(n);
    ctx.state.companies[FIRM].money = reserve + price;
    hub.hub!.month = { jobs: 40, idleTruckDays: 0, backlogDays: 12 };
    hubAutoSizeMonth(ctx, hubReserveOf);
    expect(hubTrucks(ctx.state, hub.id).length).toBe(n + 1);
  });

  it('hires the cheapest candidate with logistics 2+ (lowest id on a tie), and nobody when it cannot pay a year of it and keep its reserve', () => {
    const run = (market: (c: (id: number, logistics: Skill, salary: number) => Manager) => Manager[], money?: (ctx: SimContext) => number) => {
      const ctx = setup(1915, 12);
      addFirm(ctx, 1e7, 1910);
      works(ctx, FIRM, 'sawmill', 5, 'r_lumber', 1);
      aiLogisticsMonth(ctx);
      const [hub] = hubs(ctx, FIRM);
      nextMonth(ctx);
      refreshMarket(ctx.state, 1916);
      const L = ctx.state.logistics;
      const base = L.market[0];
      L.market = market((id, logistics, salary) => ({ ...base, id, skills: { logistics, production: 1 as Skill, frugality: 1 as Skill }, salary }));
      if (money !== undefined) ctx.state.companies[FIRM].money = money(ctx);
      aiLogisticsMonth(ctx);
      return managerAt(ctx.state, hub.id)?.id ?? null;
    };
    expect(run((c) => [c(901, 5, 900), c(902, 3, 400), c(903, 2, 100), c(904, 2, 100), c(905, 1, 50)])).toBe(903);
    // a year of the cheapest is $1 more than the firm can pay above its reserve: no hire
    expect(run((c) => [c(901, 2, 100)], (ctx) => FIRM_RESERVE_MULTIPLE * atPrices(ctx.state, REGIONAL_RESERVE) + 12 * atPrices(ctx.state, 100) - 1)).toBeNull();
  });
});
