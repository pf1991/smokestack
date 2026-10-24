import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { currentLedger } from './finance';
import { acceptsGood, storageLeft } from './inventory';
import { priceIndex } from './society/economy';
import { checkInvariants } from './invariants';
import { must, testCtx, testState } from './testkit';
import { placeBuilding } from './state';
import {
  ABSORB_VALUE,
  absorb,
  FACTOR_MAX,
  FACTOR_MIN,
  newTrade,
  TRADE_DAILY_UNITS,
  TRADE_FACTOR,
  TRADE_GOODS,
  tradeDay,
  tradePrice,
} from './trade';
import type { Building, SimContext } from './types';

function houseCtx(n = 1): { ctx: SimContext; houses: Building[] } {
  const ctx = testCtx(testState({ width: 60, height: 40, money: 5e6 }));
  const houses: Building[] = [];
  for (let i = 0; i < n; i++) houses.push(must(placeBuilding(ctx, 'player', 'trading_house', { x: 2 + (i % 5) * 4, y: 2 + Math.floor(i / 5) * 3 })));
  return { ctx, houses };
}

describe('the national market', () => {
  it('TRADE_GOODS is every material and component, in catalogue order', () => {
    const want = Object.keys(GOODS).filter((g) => GOODS[g].kind === 'material' || GOODS[g].kind === 'component');
    expect(TRADE_GOODS).toEqual(want);
    expect(TRADE_GOODS).toContain('steel');
    expect(TRADE_GOODS).toContain('wire');
    expect(TRADE_GOODS).not.toContain('bread');
    expect(TRADE_GOODS).not.toContain('coal');
  });

  it('newTrade seeds its own stream from the game seed, with no factors or sales', () => {
    expect(newTrade(42)).toEqual({ rngState: (42 ^ 0x54524144) | 0, factor: {}, sold30: {} });
    expect(absorb('steel')).toBeCloseTo(ABSORB_VALUE / GOODS.steel.basePrice);
  });

  it('prices a fresh market at base × 0.8 × index, and 0 for goods it does not buy', () => {
    const s = testState();
    expect(tradePrice(s, 'steel')).toBe(Math.round(GOODS.steel.basePrice * TRADE_FACTOR * priceIndex(s)));
    expect(tradePrice(s, 'bread')).toBe(0);
    expect(tradePrice(s, 'coal')).toBe(0);
  });

  it('drift bounds: 20,000 days keep every factor within [0.75, 1.25], with a mean near 1', () => {
    const ctx = testCtx(testState());
    let sum = 0;
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = 0; d < 20_000; d++) {
      tradeDay(ctx);
      for (const g of TRADE_GOODS) {
        const f = ctx.state.trade.factor[g];
        if (f < lo) lo = f;
        if (f > hi) hi = f;
        sum += f;
        n++;
      }
    }
    expect(lo).toBeGreaterThanOrEqual(FACTOR_MIN);
    expect(hi).toBeLessThanOrEqual(FACTOR_MAX);
    expect(Math.abs(sum / n - 1)).toBeLessThan(0.05);
  });

  it('one drift step clamps a factor set outside the bounds back into [0.75, 1.25]', () => {
    const ctx = testCtx(testState());
    ctx.state.trade.factor.steel = 0.7;
    ctx.state.trade.factor.lumber = 1.3;
    tradeDay(ctx);
    for (const g of ['steel', 'lumber']) {
      expect(ctx.state.trade.factor[g]).toBeGreaterThanOrEqual(FACTOR_MIN);
      expect(ctx.state.trade.factor[g]).toBeLessThanOrEqual(FACTOR_MAX);
    }
    expect(ctx.state.trade.factor.steel).toBe(FACTOR_MIN);
    expect(ctx.state.trade.factor.lumber).toBe(FACTOR_MAX);
  });

  it('determinism: the same seed reaches the same market after 365 days, and the main rng never moves', () => {
    const a = houseCtx();
    const b = houseCtx();
    const before = a.ctx.state.rngState;
    for (let d = 0; d < 365; d++) {
      for (const { ctx, houses } of [a, b]) {
        houses[0].input.steel = 25;
        houses[0].input.wire = 10;
        tradeDay(ctx);
      }
    }
    expect(a.ctx.state.trade).toEqual(b.ctx.state.trade);
    expect(a.ctx.state.rngState).toBe(before);
    expect(checkInvariants(a.ctx.state)).toEqual([]);
  });

  it('a sale: 30 steel and 30 lumber sell 20 of each on day 1, booked in sales and salesByGood', () => {
    const { ctx, houses } = houseCtx();
    const house = houses[0];
    house.input = { steel: 30, lumber: 30 };
    const pSteel = tradePrice(ctx.state, 'steel');
    const pLumber = tradePrice(ctx.state, 'lumber');
    const sales: number[] = [];
    ctx.bus.on('sale', (e) => sales.push(e.revenue));
    tradeDay(ctx);
    expect(TRADE_DAILY_UNITS).toBe(40);
    expect(house.input).toEqual({ steel: 10, lumber: 10 });
    const ledger = currentLedger(ctx.state.companies.player, ctx.state.date);
    expect(ledger.income.sales).toBe(20 * pSteel + 20 * pLumber);
    expect(ledger.salesByGood.steel).toBe(20 * pSteel);
    expect(ledger.salesByGood.lumber).toBe(20 * pLumber);
    expect(sales.reduce((x, y) => x + y, 0)).toBe(20 * pSteel + 20 * pLumber);
    expect(ctx.state.flags['sold:steel']).toBe(20);
    expect(Object.keys(ctx.state.flags).some((k) => k.startsWith('seller:'))).toBe(false);
    expect(house.status).toBe('ok');
    expect(ctx.state.trade.sold30.steel).toBe(20);
  });

  it('staffing scales the daily cap, and an empty house is idle', () => {
    const { ctx, houses } = houseCtx(2);
    houses[0].input = { steel: 100 };
    houses[0].staffing = 0.5;
    tradeDay(ctx);
    expect(houses[0].input.steel).toBe(80);
    expect(houses[1].status).toBe('idle');
  });

  it('acceptance: a house takes materials and components, not consumer goods', () => {
    const { houses } = houseCtx();
    expect(BUILDINGS.trading_house.category).toBe('trade');
    expect(acceptsGood(houses[0], 'bread')).toBe(false);
    expect(acceptsGood(houses[0], 'steel')).toBe(true);
    expect(acceptsGood(houses[0], 'wire')).toBe(true);
    expect(acceptsGood(houses[0], 'coal')).toBe(false);
  });

  it('saturation: ten houses dumping steel push the price down to at most 0.65 of normal', () => {
    const { ctx, houses } = houseCtx(10);
    const top = GOODS.steel.basePrice * priceIndex(ctx.state);
    for (let d = 0; d < 60; d++) {
      for (const h of houses) h.input.steel = 40;
      tradeDay(ctx);
      // the exploit cap: never above base × index (0.8 × the top of the drift)
      expect(tradePrice(ctx.state, 'steel')).toBeLessThanOrEqual(top);
    }
    expect(tradePrice(ctx.state, 'steel')).toBeLessThanOrEqual(0.65 * GOODS.steel.basePrice * TRADE_FACTOR * priceIndex(ctx.state));
  });

  it('the price never exceeds base × index, even at the top of the drift', () => {
    const s = testState();
    for (const g of TRADE_GOODS) {
      s.trade.factor[g] = FACTOR_MAX;
      expect(tradePrice(s, g), g).toBeLessThanOrEqual(GOODS[g].basePrice * priceIndex(s));
    }
  });

  it('halted: a halted house sells nothing', () => {
    const { ctx, houses } = houseCtx();
    houses[0].input = { steel: 30 };
    houses[0].status = 'halted';
    houses[0].haltedUntil = { ...ctx.state.date, year: ctx.state.date.year + 1 };
    tradeDay(ctx);
    expect(houses[0].input.steel).toBe(30);
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).income.sales ?? 0).toBe(0);
  });

  it('pool: a full 600-unit pool gives storageLeft 0 for every good', () => {
    const { houses } = houseCtx();
    houses[0].input = { steel: 400, wire: 200 };
    for (const g of Object.keys(GOODS)) expect(storageLeft(houses[0], g), g).toBe(0);
    houses[0].input = { steel: 400 };
    expect(storageLeft(houses[0], 'wire')).toBe(200);
  });
});
