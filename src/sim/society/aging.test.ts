import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { currentLedger } from '../finance';
import { maintenanceMonth, productionDay } from '../production';
import { runDays } from '../simulation';
import { placeBuilding } from '../state';
import { buildReferenceStrategy, must, testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { replaceCost, replaceVehicle, sellRefund, tripsLast30, vehiclePrice, vehicleUpkeep } from '../vehicles';
import { agingEfficiency, agingUpkeep, assetAge, NO_WEAR, renewBuilding, renewCost } from './aging';
import '../rail';

describe('aging curves', () => {
  it('efficiency: 1 for 15 years, then −1% a year to a 70% floor', () => {
    expect(agingEfficiency(0)).toBe(1);
    expect(agingEfficiency(15)).toBe(1);
    expect(agingEfficiency(16)).toBeCloseTo(0.99, 12);
    expect(agingEfficiency(41)).toBeCloseTo(0.74, 12);
    expect(agingEfficiency(45)).toBeCloseTo(0.7, 12);
    expect(agingEfficiency(80)).toBe(0.7);
  });

  it('upkeep: ×1 for 15 years, then +2% a year to a ×1.8 cap', () => {
    expect(agingUpkeep(0)).toBe(1);
    expect(agingUpkeep(15)).toBe(1);
    expect(agingUpkeep(16)).toBeCloseTo(1.02, 12);
    expect(agingUpkeep(40)).toBeCloseTo(1.5, 12);
    expect(agingUpkeep(55)).toBeCloseTo(1.8, 12);
    expect(agingUpkeep(90)).toBe(1.8);
  });
});

/** A lumber camp on all-forest land, built in 1900, inspected in `year`. */
function camp(year: number): { ctx: SimContext; id: number } {
  const ctx = testCtx(testState({ terrain: 'forest', money: 1e7 }));
  const b = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 4, y: 4 }));
  ctx.state.date = { ...ctx.state.date, year };
  return { ctx, id: b.id };
}

describe('aging buildings', () => {
  it('placeBuilding records the year it was built', () => {
    const { ctx, id } = camp(1900);
    expect(ctx.state.buildings[id].builtYear).toBe(1900);
    expect(assetAge(ctx.state, ctx.state.buildings[id])).toBe(0);
  });

  it('an old works produces less (efficiency multiplies the rate like staffing)', () => {
    const made = (year: number) => {
      const { ctx, id } = camp(year);
      productionDay(ctx);
      return ctx.state.buildings[id].output.wood ?? 0;
    };
    expect(made(1900)).toBeGreaterThan(0);
    expect(made(1941) / made(1900)).toBeCloseTo(0.74, 9);
  });

  it('an old works costs more to maintain', () => {
    const upkeep = (year: number) => {
      const { ctx } = camp(year);
      const m = ctx.state.companies.player.money;
      maintenanceMonth(ctx);
      return m - ctx.state.companies.player.money;
    };
    expect(upkeep(1900)).toBe(BUILDINGS.lumber_camp.maintenance);
    expect(upkeep(1940)).toBe(Math.round(BUILDINGS.lumber_camp.maintenance * 1.5));
  });

  it('renewBuilding costs 40% of today’s build price and resets the age', () => {
    const { ctx, id } = camp(1941);
    ctx.state.economy.priceIndex = 2;
    const b = ctx.state.buildings[id];
    expect(renewCost(ctx.state, b)).toBe(Math.round(BUILDINGS.lumber_camp.cost * 2 * 0.4));
    const m = ctx.state.companies.player.money;
    expect(must(renewBuilding(ctx, id, 'player')).cost).toBe(renewCost(ctx.state, b));
    expect(ctx.state.companies.player.money).toBe(m - Math.round(BUILDINGS.lumber_camp.cost * 0.8));
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).expense.construction).toBe(Math.round(BUILDINGS.lumber_camp.cost * 0.8));
    expect(b.builtYear).toBe(1941);
    expect(assetAge(ctx.state, b)).toBe(0);
    expect(renewBuilding(ctx, id, 'player')).toEqual({ ok: false, error: NO_WEAR });
  });

  it('renewBuilding refuses another company’s works and an empty purse', () => {
    const { ctx, id } = camp(1941);
    expect(renewBuilding(ctx, id, 'rival')).toEqual({ ok: false, error: 'Not your building' });
    ctx.state.companies.player.money = 0;
    expect(renewBuilding(ctx, id, 'player')).toEqual({ ok: false, error: 'Not enough money' });
    expect(renewBuilding(ctx, 9999)).toEqual({ ok: false, error: 'No such building' });
  });
});

describe('aging vehicles', () => {
  it('buyTruck records the year; old vehicles cost more to keep', () => {
    const { ctx } = buildReferenceStrategy(7, { rival: false });
    const v = Object.values(ctx.state.vehicles)[0];
    expect(v.builtYear).toBe(ctx.state.date.year);
    const fresh = vehicleUpkeep(ctx.state, v);
    v.builtYear -= 40;
    expect(vehicleUpkeep(ctx.state, v)).toBeCloseTo(fresh * 1.5, 9);
  });

  it('an old fleet is slower: fewer completed stops in a month', () => {
    const trips = (aged: boolean) => {
      const { ctx } = buildReferenceStrategy(7, { rival: false });
      if (aged) for (const v of Object.values(ctx.state.vehicles)) v.builtYear -= 45; // 70% speed
      runDays(ctx, 30);
      return Object.values(ctx.state.vehicles).reduce((n, v) => n + tripsLast30(ctx.state, v), 0);
    };
    const fresh = trips(false);
    expect(fresh).toBeGreaterThan(0);
    expect(trips(true)).toBeLessThan(fresh);
  });

  it('replaceVehicle sells and rebuys at today’s price, keeping the route', () => {
    const { ctx } = buildReferenceStrategy(7, { rival: false });
    const s = ctx.state;
    runDays(ctx, 5); // out on the road, away from the spawn tile
    s.economy.priceIndex = 3;
    const old = Object.values(s.vehicles)[0];
    old.builtYear -= 30;
    const routeId = old.routeId;
    const onRoute = () => Object.values(s.vehicles).filter((v) => v.routeId === routeId).length;
    const n = onRoute();
    const m = s.companies.player.money;
    const where = { x: Math.round(old.pos.x), y: Math.round(old.pos.y) };
    const next = old.stopIndex;
    const fresh = must(replaceVehicle(ctx, old.id, 'player'));
    expect(fresh.pos).toEqual(where); // takes the old one's place on the network…
    expect(fresh.stopIndex).toBe(next); // …and heads for the same stop
    expect(s.vehicles[old.id]).toBeUndefined();
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.routeId).toBe(routeId);
    expect(fresh.kind).toBe(old.kind);
    expect(fresh.builtYear).toBe(s.date.year);
    expect(onRoute()).toBe(n);
    expect(replaceCost(s, 'truck')).toBe(vehiclePrice(s, 'truck') - sellRefund(s, 'truck'));
    expect(m - s.companies.player.money).toBe(replaceCost(s, 'truck'));
  });

  it('replaceVehicle refuses a vehicle without a route, another company’s, and an empty purse (selling nothing)', () => {
    const { ctx } = buildReferenceStrategy(7, { rival: false });
    const s = ctx.state;
    const [a, b] = Object.values(s.vehicles);
    expect(replaceVehicle(ctx, a.id, 'player')).toEqual({ ok: false, error: NO_WEAR }); // brand new: nothing to gain
    a.builtYear -= 30;
    expect(replaceVehicle(ctx, a.id, 'rival')).toEqual({ ok: false, error: 'Not your vehicle' });
    s.companies.player.money = 0;
    expect(replaceVehicle(ctx, a.id, 'player')).toEqual({ ok: false, error: 'Not enough money' });
    expect(s.vehicles[a.id]).toBeDefined();
    s.companies.player.money = 1e6;
    b.routeId = null;
    expect(replaceVehicle(ctx, b.id, 'player')).toEqual({ ok: false, error: 'Assign it to a route first' });
    expect(s.vehicles[b.id]).toBeDefined();
  });
});
