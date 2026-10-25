import { describe, expect, it } from 'vitest';
import { earn } from '../finance';
import { hasEdict } from '../politics/mayorEdicts';
import { testCtx, testState } from '../testkit';
import {
  cityTaxRate,
  nationalTaxRate,
  taxDueFor,
  taxOnSales,
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
