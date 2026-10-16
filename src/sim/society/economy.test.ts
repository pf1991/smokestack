import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { LANDMARKS } from '../../data/landmarks';
import { loanStep, maxLoan, repayLoan, repayStep, takeLoan } from '../finance';
import { salePrice } from '../market';
import { migrateSave } from '../migrations';
import { maintenanceMonth } from '../production';
import { cardScale } from '../politics/cards';
import { philanthropyCost } from '../politics/edicts';
import { slushCost } from '../politics/elections';
import { placementQuote } from '../politics/mayorEdicts';
import { railTileCost } from '../rail';
import { runDays } from '../simulation';
import { assetValue, demolitionRefund, roadTileCost } from '../state';
import { buildReferenceStrategy, must, testCtx, testState } from '../testkit';
import type { GameState, LedgerMonth, SimContext } from '../types';
import { sellRefund, vehicleMaintenanceMonth, vehiclePrice } from '../vehicles';
import { DECADE_INFLATION, ECONOMY_HISTORY_MONTHS, economyMonth, indexAtYear, inflationRate, priceIndex } from './economy';
import { createGame, placeBuilding } from '../state';
import '../rail';

/** Runs economyMonth for `months` month ends starting in January of `year`, advancing the date. */
function inflate(ctx: SimContext, year: number, months: number): void {
  for (let i = 0; i < months; i++) {
    ctx.state.date = { year: year + Math.floor(i / 12), month: (i % 12) + 1, day: 30, hour: 23 };
    economyMonth(ctx);
  }
}

/** The index at 1 January of `year`, compounded from 1900 exactly as the game does. */
function indexAt(year: number): number {
  const ctx = testCtx();
  inflate(ctx, 1900, (year - 1900) * 12);
  return priceIndex(ctx.state);
}

describe('inflation (DECADE_INFLATION, ruling R-S12)', () => {
  it('uses the verbatim table', () => {
    expect(DECADE_INFLATION).toEqual({
      1900: 0.01, 1910: 0.05, 1920: -0.01, 1930: -0.02, 1940: 0.05, 1950: 0.025, 1960: 0.03, 1970: 0.08, 1980: 0.05, 1990: 0.03,
    });
    expect(inflationRate(1975)).toBe(0.08);
    expect(inflationRate(2000)).toBe(0.03); // held at the 1990s rate past the table
  });

  it('starts at 1 in 1900', () => {
    expect(priceIndex(testState())).toBe(1);
  });

  it('12 months in the 1970s multiply the index by 1.08', () => {
    const ctx = testCtx();
    ctx.state.economy.priceIndex = 3.7;
    inflate(ctx, 1970, 12);
    expect(priceIndex(ctx.state) / 3.7).toBeCloseTo(1.08, 9);
    expect(Math.abs(priceIndex(ctx.state) / 3.7 - 1.08)).toBeLessThan(1e-9);
  });

  it('reaches about 17.6 by 2000: within [14, 22]', () => {
    const p = indexAt(2000);
    expect(p).toBeGreaterThanOrEqual(14);
    expect(p).toBeLessThanOrEqual(22);
    expect(p).toBeCloseTo(17.61, 1);
  });

  it('a game starting later begins at the index inflation had reached (Motor City, 1910: about 1.10)', () => {
    expect(indexAtYear(1900)).toBe(1);
    expect(indexAtYear(1910)).toBeCloseTo(indexAt(1910), 9);
    expect(priceIndex(createGame({ seed: 7, scenarioId: 'motor_city' }))).toBeCloseTo(1.1046, 4);
    expect(priceIndex(createGame({ seed: 7 }))).toBe(1);
  });

  it('keeps the last 120 month ends as history', () => {
    const ctx = testCtx();
    inflate(ctx, 1900, 130);
    const h = ctx.state.economy.history;
    expect(h.length).toBe(ECONOMY_HISTORY_MONTHS);
    expect(h[h.length - 1]).toBe(priceIndex(ctx.state));
  });

  it('the simulation steps it once a month', () => {
    const ctx = testCtx();
    runDays(ctx, 30);
    expect(priceIndex(ctx.state)).toBeCloseTo(Math.pow(1.01, 1 / 12), 12);
    expect(ctx.state.economy.history.length).toBe(1);
  });
});

describe('everything is priced at the index', () => {
  const at = (index: number): GameState => {
    const s = testState({ cities: [{ x: 30, y: 20 }], money: 1e9, rivalMoney: 1e9 });
    s.economy.priceIndex = index;
    return s;
  };

  it('sale prices, construction, vehicles, road, rail, refunds, slush, philanthropy and asset values', () => {
    const a = at(1);
    const b = at(2.5);
    const ratio = (f: (s: GameState) => number) => f(b) / f(a);
    expect(salePrice('furniture', 0.4, 2.5) / salePrice('furniture', 0.4, 1)).toBeCloseTo(2.5, 1);
    expect(ratio((s) => placementQuote(s, 'rival', 'sawmill', { x: 2, y: 2 }).cost)).toBeCloseTo(2.5, 6);
    expect(ratio((s) => placementQuote(s, 'player', 'sawmill', { x: 2, y: 2 }).cost)).toBeCloseTo(2.5, 6);
    expect(ratio((s) => vehiclePrice(s, 'truck'))).toBeCloseTo(2.5, 6);
    expect(ratio((s) => vehiclePrice(s, 'train'))).toBeCloseTo(2.5, 6);
    expect(ratio((s) => sellRefund(s, 'truck'))).toBeCloseTo(2.5, 6);
    expect(ratio((s) => roadTileCost(s, false))).toBeCloseTo(2.5, 6);
    expect(ratio((s) => roadTileCost(s, true))).toBeCloseTo(2.5, 6);
    expect(ratio((s) => railTileCost(s))).toBeCloseTo(2.5, 6);
    expect(ratio((s) => slushCost(s))).toBeCloseTo(2.5, 6);
    expect(philanthropyCost(a, 'park')).toBe(LANDMARKS.park.philanthropy!.cost);
    expect(ratio((s) => philanthropyCost(s, 'park'))).toBeCloseTo(2.5, 6);
    expect(cardScale(b)).toBeGreaterThanOrEqual(2.5);
  });

  it('placing, demolishing and valuing a building use today’s prices for every company', () => {
    for (const owner of ['player', 'rival'] as const) {
      const ctx = testCtx(at(3));
      const m = ctx.state.companies[owner].money;
      const bld = must(placeBuilding(ctx, owner, 'sawmill', { x: 2, y: 2 }));
      expect(m - ctx.state.companies[owner].money).toBe(BUILDINGS.sawmill.cost * 3);
      expect(demolitionRefund(ctx.state, bld)).toBe(Math.round(BUILDINGS.sawmill.cost * 3 * 0.25));
      expect(assetValue(ctx.state, owner)).toBe(Math.round(BUILDINGS.sawmill.cost * 0.5 * 3));
    }
  });

  it('maintenance (buildings and road) is charged at the index for every company', () => {
    const ctx = testCtx(at(2));
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 2, y: 2 }));
    must(placeBuilding(ctx, 'rival', 'sawmill', { x: 8, y: 2 }));
    ctx.state.companies.rival.roadTiles = 10;
    const before = { p: ctx.state.companies.player.money, r: ctx.state.companies.rival.money };
    maintenanceMonth(ctx);
    expect(before.p - ctx.state.companies.player.money).toBe(BUILDINGS.sawmill.maintenance * 2);
    expect(before.r - ctx.state.companies.rival.money).toBe((BUILDINGS.sawmill.maintenance + 10 * 5) * 2);
  });

  it('a contract reward is set at the index when offered', async () => {
    const { offerContracts } = await import('../contracts');
    const s = at(4);
    s.cities[0].population = 20000;
    const ctx = testCtx(s);
    const c = offerContracts(ctx);
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.reward).toBe(Math.round(c.qty * GOODS[c.goodId].basePrice * 1.5 * 4));
  });
});

describe('loans', () => {
  it('the step and the limit are scaled by the index when the loan is taken; the balance stays nominal', () => {
    expect(loanStep(1)).toBe(50_000);
    expect(maxLoan(1)).toBe(500_000);
    expect(loanStep(4)).toBe(200_000);
    expect(maxLoan(4)).toBe(2_000_000);
    const s = testState();
    const c = s.companies.player;
    expect(takeLoan(c, 50_000, 1).ok).toBe(true);
    expect(takeLoan(c, 50_000, 4)).toEqual({ ok: false, error: 'Loans come in $200,000 steps' });
    expect(takeLoan(c, 200_000, 4).ok).toBe(true);
    expect(c.loan).toBe(250_000); // nominal: 50k borrowed at index 1 plus 200k at index 4
    // a repayment is a step at today's prices, or the whole balance when that is smaller
    expect(repayStep(c, 4)).toBe(200_000);
    expect(repayLoan(c, 200_000, 4).ok).toBe(true);
    expect(repayStep(c, 4)).toBe(50_000);
    expect(repayLoan(c, 50_000, 4).ok).toBe(true);
    expect(c.loan).toBe(0);
  });
});

describe('migration', () => {
  it('a v5 save gets priceIndex 1 (whatever its year), an empty history, and builtYear = the load year', () => {
    const o: Record<string, unknown> = {
      version: 5,
      date: { year: 1962, month: 3 },
      cities: [],
      buildings: { 1: { id: 1, typeId: 'sawmill' } },
      vehicles: { 2: { id: 2, kind: 'truck' } },
    };
    expect(migrateSave(o).ok).toBe(true);
    expect(o.economy).toEqual({ priceIndex: 1, history: [] });
    expect((o.buildings as Record<string, { builtYear: number }>)[1].builtYear).toBe(1962);
    expect((o.vehicles as Record<string, { builtYear: number }>)[2].builtYear).toBe(1962);
  });
});

/**
 * Review Focus #5: inflation does not break the old economy. The reference chain (furniture and bread,
 * testkit's buildReferenceStrategy) runs the same year twice, once priced at the 1910 index and once
 * at the 1990 index (both compounded from DECADE_INFLATION). The map, the date and so every physical
 * flow are identical, and every asset is new (aging plays no part), so only prices differ. Its margin
 * (sales over running costs: building, road and vehicle upkeep) must agree within ±5%.
 */
describe('Review Focus #5: margins survive inflation', () => {
  function margin(index: number): { margin: number; sales: number; costs: number } {
    const { ctx } = buildReferenceStrategy(7, { rival: false });
    const s = ctx.state;
    s.economy.priceIndex = index;
    // the company's cash at the same prices too, so nothing money-gated (cards) behaves differently
    s.companies.player.money = Math.round(s.companies.player.money * index);
    const from = s.date.year * 12 + s.date.month;
    runDays(ctx, 360);
    const months = s.companies.player.ledger.filter((m: LedgerMonth) => m.year * 12 + m.month > from);
    const sales = months.reduce((t, m) => t + (m.income.sales ?? 0), 0);
    const costs = months.reduce((t, m) => t + (m.expense.maintenance ?? 0) + (m.expense.vehicles ?? 0), 0);
    return { margin: sales / costs, sales, costs };
  }

  it('the reference chain’s revenue/cost ratio in 1990 is within ±5% of 1910’s', () => {
    const p1910 = indexAt(1910);
    const p1990 = indexAt(1990);
    expect(p1990 / p1910).toBeGreaterThan(10);
    const a = margin(p1910);
    const b = margin(p1990);
    expect(a.sales).toBeGreaterThan(0);
    expect(b.sales / a.sales).toBeGreaterThan(10); // nominal figures inflate…
    expect(Math.abs(b.margin / a.margin - 1)).toBeLessThanOrEqual(0.05); // …the margin does not
  });

  it('vehicle upkeep follows the index too', () => {
    const pay = (index: number) => {
      const { ctx: c } = buildReferenceStrategy(7, { rival: false });
      c.state.economy.priceIndex = index;
      const m = c.state.companies.player.money;
      vehicleMaintenanceMonth(c);
      return m - c.state.companies.player.money;
    };
    expect(pay(3) / pay(1)).toBeCloseTo(3, 3);
  });
});
