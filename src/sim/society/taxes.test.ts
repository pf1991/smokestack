import { describe, expect, it } from 'vitest';
import { earn } from '../finance';
import { hasEdict } from '../politics/mayorEdicts';
import { testCtx, testState } from '../testkit';
import {
  cityTaxRate,
  nationalTaxRate,
  taxDueFor,
  taxOnSales,
  taxRateLabel,
  taxesMonth,
  TAX_RATE_MAX,
  TAX_RATE_MIN,
  TAX_RATE_MID,
} from './taxes';

describe('sales tax', () => {
  it('maps mayor opinion to a rate between min and max; tax_break floors at min', () => {
    const s = testState({ cities: [{ x: 10, y: 10, population: 4000, name: 'Ashford' }] });
    const city = s.cities[0]!;
    city.politics.mayor.faction = 'oldmoney';
    city.opinion.oldmoney = 0;
    city.politics.edicts = [];
    expect(cityTaxRate(city)).toBeCloseTo(TAX_RATE_MAX, 5);
    city.opinion.oldmoney = 100;
    expect(cityTaxRate(city)).toBeCloseTo(TAX_RATE_MIN, 5);
    city.opinion.oldmoney = 50;
    expect(cityTaxRate(city)).toBeCloseTo(TAX_RATE_MID, 5);
    city.politics.edicts = ['tax_break'];
    expect(hasEdict(city, 'tax_break')).toBe(true);
    city.opinion.oldmoney = 0;
    expect(cityTaxRate(city)).toBe(TAX_RATE_MIN);
  });

  it('national rate is population-weighted across cities', () => {
    const s = testState({
      cities: [
        { x: 10, y: 10, population: 1000, name: 'A' },
        { x: 30, y: 10, population: 3000, name: 'B' },
      ],
    });
    s.cities[0]!.politics.mayor.faction = 'workers';
    s.cities[0]!.opinion.workers = 0;
    s.cities[0]!.politics.edicts = [];
    s.cities[1]!.politics.mayor.faction = 'workers';
    s.cities[1]!.opinion.workers = 100;
    s.cities[1]!.politics.edicts = [];
    const r0 = cityTaxRate(s.cities[0]!);
    const r1 = cityTaxRate(s.cities[1]!);
    expect(nationalTaxRate(s)).toBeCloseTo((r0 * 1000 + r1 * 3000) / 4000, 8);
  });

  it('books whole-dollar tax under taxes from this month\'s sales', () => {
    const ctx = testCtx(testState({ money: 1e6 }));
    const c = ctx.state.companies.player;
    earn(c, 'sales', 10_000, ctx.state.date);
    const rate = nationalTaxRate(ctx.state);
    const due = taxOnSales(10_000, rate);
    expect(due).toBe(Math.floor(10_000 * rate));
    expect(taxDueFor(ctx.state, 'player')).toBe(due);
    const before = c.money;
    taxesMonth(ctx);
    expect(c.money).toBe(before - due);
    expect(c.ledger.at(-1)!.expense.taxes).toBe(due);
  });

  it('charges nothing when there were no sales', () => {
    const ctx = testCtx(testState({ money: 1e6 }));
    const before = ctx.state.companies.player.money;
    taxesMonth(ctx);
    expect(ctx.state.companies.player.money).toBe(before);
    expect(ctx.state.companies.player.ledger.at(-1)?.expense.taxes ?? 0).toBe(0);
  });
});

describe('cycle tax tug', () => {
  function midClimateState(cycle: 'boom' | 'steady' | 'recession') {
    const s = testState({
      money: 1e6,
      rivalMoney: 1e6,
      cities: [{ x: 10, y: 10, population: 4000, name: 'Ashford' }],
    });
    const city = s.cities[0]!;
    city.politics.mayor.faction = 'oldmoney';
    city.opinion.oldmoney = 50;
    city.politics.edicts = [];
    s.economy.cycle = cycle;
    s.economy.cycleLeft = 12;
    s.economy.cycleFlip = cycle === 'boom' ? 'recession' : 'boom';
    return s;
  }

  it('softens in boom and stiffens in recession by 1pp, clamped to min/max', () => {
    expect(nationalTaxRate(midClimateState('steady'))).toBeCloseTo(TAX_RATE_MID, 8);
    expect(nationalTaxRate(midClimateState('boom'))).toBeCloseTo(TAX_RATE_MID - 0.01, 8);
    expect(nationalTaxRate(midClimateState('recession'))).toBeCloseTo(TAX_RATE_MID + 0.01, 8);

    const floor = midClimateState('boom');
    floor.cities[0]!.opinion.oldmoney = 100;
    expect(nationalTaxRate(floor)).toBe(TAX_RATE_MIN);

    const ceil = midClimateState('recession');
    ceil.cities[0]!.opinion.oldmoney = 0;
    expect(nationalTaxRate(ceil)).toBe(TAX_RATE_MAX);
  });

  it('charges player and rival the same tugged rate on equal sales', () => {
    const ctx = testCtx(midClimateState('recession'));
    const sales = 10_000;
    earn(ctx.state.companies.player, 'sales', sales, ctx.state.date);
    earn(ctx.state.companies.rival, 'sales', sales, ctx.state.date);
    const due = taxOnSales(sales, nationalTaxRate(ctx.state));
    expect(due).toBe(Math.floor(sales * (TAX_RATE_MID + 0.01)));
    taxesMonth(ctx);
    expect(ctx.state.companies.player.ledger.at(-1)!.expense.taxes).toBe(due);
    expect(ctx.state.companies.rival.ledger.at(-1)!.expense.taxes).toBe(due);
  });

  it('taxRateLabel names the swinging phase', () => {
    expect(taxRateLabel(midClimateState('steady'))).toMatch(/Sales tax [\d.]+% \(national\)$/);
    expect(taxRateLabel(midClimateState('boom'))).toMatch(/\(national, boom\)$/);
    expect(taxRateLabel(midClimateState('recession'))).toMatch(/\(national, recession\)$/);
  });
});
