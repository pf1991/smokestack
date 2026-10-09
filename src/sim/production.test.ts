import { describe, it, expect } from 'vitest';
import { productionDay, retailDay, maintenanceMonth, growthMonth, demandModifier } from './production';
import { placeBuilding } from './state';
import { testCtx, testState } from './testkit';
import type { Building, SimContext } from './types';

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

describe('production', () => {
  it('lumber camp produces 4 wood/day on full forest', () => {
    const ctx = testCtx(testState({ terrain: 'forest' }));
    const b = place(ctx, 'lumber_camp', 5, 5);
    productionDay(ctx);
    expect(b.output.wood).toBe(4);
    expect(b.producedThisMonth.wood).toBe(4);
    expect(b.status).toBe('ok');
  });

  it('farm fallow in January, x1.5 in August', () => {
    const ctx = testCtx();
    const b = place(ctx, 'farm', 5, 5, 'r_grain');
    productionDay(ctx);
    expect(b.output.grain ?? 0).toBe(0);
    ctx.state.date.month = 8;
    productionDay(ctx);
    expect(b.output.grain).toBeCloseTo(7.5);
  });

  it('sawmill converts 4 wood -> 2 lumber; no_input when empty; output_full stops', () => {
    const ctx = testCtx();
    const s = place(ctx, 'sawmill', 5, 5);
    productionDay(ctx);
    expect(s.status).toBe('no_input');
    s.input.wood = 4;
    productionDay(ctx);
    expect(s.output.lumber).toBe(2);
    expect(s.input.wood).toBe(0);
    s.input.wood = 8;
    s.output.lumber = 60;
    productionDay(ctx);
    expect(s.status).toBe('output_full');
    expect(s.input.wood).toBe(8);
    expect(s.output.lumber).toBe(60);
  });

  it('car plant takes 2 days per car', () => {
    const ctx = testCtx(testState({ year: 1930 }));
    const c = place(ctx, 'car_plant', 5, 5);
    c.input = { steel: 4, glass: 2, fuel: 1 };
    productionDay(ctx);
    expect(c.output.cars ?? 0).toBe(0);
    expect(c.progress).toBeCloseTo(0.5);
    productionDay(ctx);
    expect(c.output.cars).toBe(1);
    expect(c.input.steel).toBe(0);
  });

  it('halted building does not produce and clears when passed', () => {
    const ctx = testCtx(testState({ terrain: 'forest' }));
    const b = place(ctx, 'lumber_camp', 5, 5);
    b.haltedUntil = { year: 1900, month: 1, day: 5, hour: 0 };
    productionDay(ctx);
    expect(b.status).toBe('halted');
    expect(b.output.wood ?? 0).toBe(0);
    ctx.state.date.day = 5;
    productionDay(ctx);
    expect(b.haltedUntil).toBeNull();
    expect(b.output.wood).toBe(4);
  });

  it('store sells to city and earns money', () => {
    const { ctx, store } = storeCtx(10);
    const sales: number[] = [];
    ctx.bus.on('sale', (e) => sales.push(e.buildingId));
    const before = ctx.state.companies.player.money;
    retailDay(ctx);
    expect(store.input.furniture).toBe(8);
    expect(ctx.state.companies.player.money - before).toBe(144);
    expect(ctx.state.companies.player.ledger[0].salesByGood.furniture).toBe(144);
    expect(sales).toEqual([store.id]);
  });

  it('demand modifier doubles sales', () => {
    const { ctx, store } = storeCtx(10);
    ctx.state.modifiers.push({ id: 'm', goodId: 'furniture', cityId: null, factor: 2, until: { year: 1901, month: 1, day: 1, hour: 0 } });
    expect(demandModifier(ctx.state, 0, 'furniture')).toBe(2);
    retailDay(ctx);
    expect(store.input.furniture).toBe(6);
    ctx.state.modifiers[0].until = { year: 1900, month: 1, day: 1, hour: 0 };
    expect(demandModifier(ctx.state, 0, 'furniture')).toBe(1);
  });

  it('maintenance charged monthly', () => {
    const ctx = testCtx();
    place(ctx, 'farm', 5, 5, 'r_grain');
    ctx.state.companies.player.roadTiles = 10;
    maintenanceMonth(ctx);
    expect(ctx.state.companies.player.ledger.at(-1)?.expense.maintenance).toBe(350);
  });

  it('well-supplied city grows', () => {
    const state = testState({ cities: [{ x: 20, y: 15, population: 6000 }] });
    const ctx = testCtx(state);
    const city = state.cities[0];
    city.market.bread = { sold30: 100, demand30: 100, pending: 0 };
    const b = place(ctx, 'farm', 5, 5, 'r_grain');
    b.producedThisMonth.grain = 5;
    growthMonth(ctx);
    expect(city.prevPopulation).toBe(6000);
    expect(city.population).toBe(6072);
    expect(city.happiness).toBe(1);
    expect(b.producedThisMonth).toEqual({});
  });
});
