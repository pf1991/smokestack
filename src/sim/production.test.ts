import { describe, it, expect } from 'vitest';
import { productionDay, retailDay, maintenanceMonth, growthMonth, demandModifier } from './production';
import { footprint, placeBuilding } from './state';
import { BUILDINGS } from '../data/buildings';
import { DEMAND_PER_1000, GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { monthlyDemand, urbanRadius } from './market';
import { testCtx, testState } from './testkit';
import type { Building, SimContext } from './types';
import { newCityClasses } from './society/classes';

function place(ctx: SimContext, type: string, x: number, y: number, recipe?: string): Building {
  const r = placeBuilding(ctx, 'player', type, { x, y }, recipe);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function storeCtx(stock: number) {
  const state = testState({ cities: [{ x: 20, y: 15, population: 10000 }], streets: true });
  const ctx = testCtx(state);
  let store: Building | null = null;
  for (let y = 10; y < 20 && !store; y++)
    for (let x = 15; x < 25 && !store; x++) {
      const r = placeBuilding(ctx, 'player', 'store', { x, y });
      if (r.ok) store = r.value;
    }
  if (!store) throw new Error('no store spot');
  store.input.furniture = stock;
  return { ctx, store };
}

const PRICE = GOODS.furniture.basePrice * 1.5;
const DAILY = (monthlyDemand({ population: 10000, classes: newCityClasses() } as never, 'furniture', 1900)) / 30;

describe('production', () => {
  it('lumber camp produces full recipe output on full forest', () => {
    const ctx = testCtx(testState({ terrain: 'forest' }));
    const b = place(ctx, 'lumber_camp', 5, 5);
    productionDay(ctx);
    expect(b.output.wood).toBe(RECIPES.r_wood.outputs.wood);
    expect(b.output.wood).toBe(10);
    expect(b.producedThisMonth.wood).toBe(10);
    expect(b.status).toBe('ok');
  });

  it('farm fallow in January, x1.5 in August', () => {
    const ctx = testCtx();
    const b = place(ctx, 'farm', 5, 5, 'r_grain');
    ctx.state.date.month = 1;
    productionDay(ctx);
    expect(b.output.grain ?? 0).toBe(0);
    ctx.state.date.month = 8;
    productionDay(ctx);
    expect(b.output.grain).toBeCloseTo(RECIPES.r_grain.outputs.grain * 1.5);
    expect(b.output.grain).toBeCloseTo(18);
  });

  it('sawmill converts wood to lumber; no_input when empty', () => {
    const ctx = testCtx();
    const s = place(ctx, 'sawmill', 5, 5);
    productionDay(ctx);
    expect(s.status).toBe('no_input');
    s.input.wood = RECIPES.r_lumber.inputs.wood;
    productionDay(ctx);
    expect(s.output.lumber).toBe(RECIPES.r_lumber.outputs.lumber);
    expect(s.output.lumber).toBe(5);
    expect(s.input.wood).toBe(0);
  });

  it('output_full stops production and loses nothing', () => {
    const ctx = testCtx();
    const s = place(ctx, 'sawmill', 5, 5);
    const cap = BUILDINGS.sawmill.storage;
    const per = RECIPES.r_lumber.outputs.lumber;
    s.input.wood = 20;
    s.output.lumber = cap - per + 1; // one cycle would overflow
    productionDay(ctx);
    expect(s.status).toBe('output_full');
    expect(s.input.wood).toBe(20);
    expect(s.output.lumber).toBe(cap - per + 1);
    s.output.lumber = cap - per; // exactly fits
    productionDay(ctx);
    expect(s.output.lumber).toBe(cap);
    expect(s.input.wood).toBe(20 - RECIPES.r_lumber.inputs.wood);
  });

  it('car plant takes 2 days per car', () => {
    const ctx = testCtx(testState({ year: 1930 }));
    const c = place(ctx, 'car_plant', 5, 5);
    c.input = { steel: 4, glass: 2, fuel: 1 };
    productionDay(ctx);
    expect(c.output.cars ?? 0).toBe(0);
    expect(c.input).toEqual({ steel: 4, glass: 2, fuel: 1 });
    expect(c.progress).toBeCloseTo(0.5);
    productionDay(ctx);
    expect(c.output.cars).toBe(1);
    expect(c.input.steel).toBe(0);
  });

  it('locked recipe leaves the building idle', () => {
    const ctx = testCtx(testState({ terrain: 'forest' }));
    const b = place(ctx, 'lumber_camp', 5, 5);
    ctx.state.unlocked = ctx.state.unlocked.filter((id) => id !== 'r_wood');
    productionDay(ctx);
    expect(b.status).toBe('idle');
    expect(b.output.wood ?? 0).toBe(0);
  });

  it('halted building does not produce and clears when passed', () => {
    const ctx = testCtx(testState({ terrain: 'forest' }));
    const b = place(ctx, 'lumber_camp', 5, 5);
    b.haltedUntil = { year: 1900, month: 4, day: 5, hour: 0 };
    productionDay(ctx);
    expect(b.status).toBe('halted');
    expect(b.output.wood ?? 0).toBe(0);
    ctx.state.date.day = 5;
    productionDay(ctx);
    expect(b.haltedUntil).toBeNull();
    expect(b.output.wood).toBe(10);
  });

  it('mine efficiency follows matching deposit share, min 0.25', () => {
    const state = testState({ terrain: 'hills' });
    const ctx = testCtx(state);
    const w = state.map.width;
    state.map.tiles[5 * w + 5].deposit = 'coal';
    state.map.tiles[5 * w + 6].deposit = 'coal';
    const half = place(ctx, 'mine', 5, 5, 'r_coal');
    productionDay(ctx);
    expect(half.output.coal).toBeCloseTo(RECIPES.r_coal.outputs.coal * 0.5);
    state.map.tiles[10 * w + 10].deposit = 'coal';
    const one = place(ctx, 'mine', 10, 10, 'r_coal');
    productionDay(ctx);
    expect(one.output.coal).toBeCloseTo(RECIPES.r_coal.outputs.coal * 0.25);
    // deposit of a different good gives nothing for a coal recipe
    state.map.tiles[15 * w + 15].deposit = 'iron_ore';
    const wrong = place(ctx, 'mine', 15, 15, 'r_iron');
    wrong.recipeId = 'r_coal';
    productionDay(ctx);
    expect(wrong.output.coal ?? 0).toBe(0);
  });

  it('store sells to city and earns money', () => {
    const { ctx, store } = storeCtx(10);
    const sales: number[] = [];
    ctx.bus.on('sale', (e) => sales.push(e.buildingId));
    const before = ctx.state.companies.player.money;
    retailDay(ctx);
    expect(DAILY).toBeCloseTo(4);
    expect(store.input.furniture).toBe(10 - 4);
    expect(ctx.state.companies.player.money - before).toBe(4 * PRICE);
    expect(4 * PRICE).toBe(432);
    expect(ctx.state.companies.player.ledger[0].salesByGood.furniture).toBe(4 * PRICE);
    expect(sales).toEqual([store.id]);
  });

  it('retail sales count toward an active contract without any bus listener (first day after a load)', () => {
    const { ctx } = storeCtx(10);
    ctx.state.contracts.push({
      id: ctx.state.nextId++, cityId: 0, goodId: 'furniture', qty: 100, delivered: 0,
      deadline: { ...ctx.state.date, year: ctx.state.date.year + 1 }, reward: 5000, status: 'active',
    });
    retailDay(ctx);
    expect(ctx.state.contracts[0].delivered).toBe(4);
  });

  it('store is ok on a day it sells and idle on a day it does not', () => {
    const { ctx, store } = storeCtx(10);
    productionDay(ctx);
    expect(store.status).toBe('idle');
    retailDay(ctx);
    expect(store.status).toBe('ok');
    store.input.furniture = 0;
    productionDay(ctx);
    retailDay(ctx);
    expect(store.status).toBe('idle');
  });

  it('rival store revenue goes to the rival', () => {
    const { ctx, store } = storeCtx(10);
    store.ownerId = 'rival';
    const p = ctx.state.companies.player.money;
    const r = ctx.state.companies.rival.money;
    retailDay(ctx);
    expect(ctx.state.companies.player.money).toBe(p);
    expect(ctx.state.companies.rival.money - r).toBe(4 * PRICE);
  });

  it('demand modifier doubles sales', () => {
    const { ctx, store } = storeCtx(20);
    ctx.state.modifiers.push({ id: 'm', goodId: 'furniture', cityId: null, factor: 2, until: { year: 1901, month: 1, day: 1, hour: 0 } });
    expect(demandModifier(ctx.state, 0, 'furniture')).toBe(2);
    retailDay(ctx);
    expect(store.input.furniture).toBe(20 - 8);
    ctx.state.modifiers[0].until = { year: 1900, month: 1, day: 1, hour: 0 };
    expect(demandModifier(ctx.state, 0, 'furniture')).toBe(1);
  });

  it('demand30 decays on a no-sale day', () => {
    const { ctx } = storeCtx(0);
    const city = ctx.state.cities[0];
    retailDay(ctx);
    const d1 = city.market.furniture.demand30;
    expect(d1).toBeCloseTo(4);
    expect(city.market.furniture.sold30).toBe(0);
    city.market.furniture.sold30 = 30;
    retailDay(ctx);
    expect(city.market.furniture.sold30).toBeCloseTo(29);
    expect(city.market.furniture.demand30).toBeCloseTo((d1 * 29) / 30 + 4);
  });

  it('maintenance charged monthly', () => {
    const ctx = testCtx();
    place(ctx, 'farm', 5, 5, 'r_grain');
    ctx.state.companies.player.roadTiles = 10;
    maintenanceMonth(ctx);
    expect(ctx.state.companies.player.ledger.at(-1)?.expense.maintenance).toBe(BUILDINGS.farm.maintenance + 50);
  });

  it('well-supplied city grows', () => {
    const state = testState({ cities: [{ x: 20, y: 15, population: 6000 }] });
    const ctx = testCtx(state);
    const city = state.cities[0];
    for (const g of Object.keys(DEMAND_PER_1000))
      if (monthlyDemand(city, g, state.date.year) > 0) city.market[g] = { sold30: 100, demand30: 100, pending: 0 };
    const b = place(ctx, 'farm', 5, 5, 'r_grain');
    b.producedThisMonth.grain = 5;
    growthMonth(ctx);
    expect(city.prevPopulation).toBe(6000);
    expect(city.population).toBe(Math.round(6000 * (1 + 0.015 * (1 - 6000 / 80_000))));
    expect(city.happiness).toBe(1);
    expect(b.producedThisMonth).toEqual({});
  });

  it('growth averages over currently demanded goods, including unserved ones', () => {
    const state = testState({ cities: [{ x: 20, y: 15, population: 6000 }] });
    const ctx = testCtx(state);
    const city = state.cities[0];
    const demanded = Object.keys(DEMAND_PER_1000).filter((g) => monthlyDemand(city, g, 1900) > 0);
    city.market[demanded[0]] = { sold30: 100, demand30: 100, pending: 0 };
    growthMonth(ctx);
    expect(city.happiness).toBeCloseTo(1 / demanded.length);
  });

  it('growth refreshes urban tiles when population crosses a radius boundary', () => {
    const state = testState({ cities: [{ x: 20, y: 15, population: 3990 }] });
    const ctx = testCtx(state);
    const city = state.cities[0];
    const r0 = city.urbanRadius;
    for (const g of Object.keys(DEMAND_PER_1000))
      if (monthlyDemand(city, g, 1900) > 0) city.market[g] = { sold30: 100, demand30: 100, pending: 0 };
    growthMonth(ctx);
    expect(city.population).toBeGreaterThanOrEqual(4000);
    expect(city.urbanRadius).toBe(r0 + 1);
    expect(state.map.tiles[15 * state.map.width + 20 + r0 + 1].cityId).toBe(0);
  });

  it('a growing city lays new streets in its larger disc, never over buildings, rail or deposits', () => {
    const state = testState({ width: 60, height: 60, cities: [{ x: 30, y: 30, population: 5000 }], streets: true });
    const ctx = testCtx(state);
    const city = state.cities[0];
    const R = urbanRadius(30_000);
    const tileAt = (x: number, y: number) => state.map.tiles[y * state.map.width + x];
    // outside the 5k disc, on what will be street rows of the 30k disc
    const farm = place(ctx, 'farm', 30 + 9, 30 - 1, 'r_grain');
    tileAt(30, 30 + 9).rail = true;
    tileAt(30 - 9, 30).deposit = 'coal';
    const roadsInDisc = () => {
      let n = 0;
      for (let y = 30 - R; y <= 30 + R; y++)
        for (let x = 30 - R; x <= 30 + R; x++) if ((x - 30) ** 2 + (y - 30) ** 2 <= R * R && tileAt(x, y).road) n++;
      return n;
    };
    const before = roadsInDisc();
    const changed: { x: number; y: number }[] = [];
    ctx.bus.on('roadChanged', (e) => changed.push(...e.tiles));
    for (let i = 0; i < 400 && city.population < 30_000; i++) {
      for (const g of Object.keys(DEMAND_PER_1000))
        if (monthlyDemand(city, g, state.date.year) > 0) city.market[g] = { sold30: 100, demand30: 100, pending: 0 };
      growthMonth(ctx);
    }
    expect(city.population).toBeGreaterThanOrEqual(30_000);
    expect(roadsInDisc()).toBeGreaterThan(before);
    expect(changed.length).toBeGreaterThan(0);
    for (const p of changed) expect(tileAt(p.x, p.y).road).toBe(true);
    for (const p of footprint(farm)) expect(tileAt(p.x, p.y).road).toBe(false);
    expect(tileAt(30, 30 + 9).road).toBe(false);
    expect(tileAt(30 - 9, 30).road).toBe(false);
    for (const t of state.map.tiles) if (t.buildingId !== null) expect(t.road).toBe(false);
  });
});
