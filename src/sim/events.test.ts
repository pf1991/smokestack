import { describe, expect, it } from 'vitest';
import { dateToDays } from './clock';
import { MAX_NEWS, publishNews } from './news';
import { demandModifier } from './production';
import { historicDay, monthlyMarketReport, randomMonth, RANDOM_EVENTS } from './events';
import { placeBuilding } from './state';
import { runDays } from './simulation';
import { currentLedger } from './finance';
import { must, testCtx, testState } from './testkit';

function at(year: number, month: number) {
  const state = testState({ cities: [{ x: 10, y: 10 }], year: 1900, seed: 7 });
  state.date = { year, month, day: 1, hour: 0 };
  return testCtx(state);
}

describe('historic events', () => {
  it("1929 crash applies '*' 0.6 modifier for 18 months", () => {
    const ctx = at(1929, 10);
    historicDay(ctx);
    expect(demandModifier(ctx.state, 0, 'bread')).toBeCloseTo(0.6);
    expect(ctx.state.news.some((n) => n.kind === 'historic')).toBe(true);
    const m = ctx.state.modifiers.find((x) => x.goodId === '*')!;
    expect(dateToDays(m.until) - dateToDays(ctx.state.date)).toBe(18 * 30);
  });
  it('fires once only', () => {
    const ctx = at(1929, 10);
    historicDay(ctx);
    historicDay(ctx);
    expect(ctx.state.modifiers).toHaveLength(1);
  });
  it('modifier expires', () => {
    const ctx = at(1929, 10);
    historicDay(ctx);
    ctx.state.date = { year: 1931, month: 5, day: 1, hour: 0 };
    expect(demandModifier(ctx.state, 0, 'bread')).toBe(1);
  });
  it('oil crisis cuts cars', () => {
    const ctx = at(1973, 10);
    historicDay(ctx);
    expect(demandModifier(ctx.state, 0, 'cars')).toBeCloseTo(0.6);
    expect(demandModifier(ctx.state, 0, 'bread')).toBe(1);
  });
});

describe('random events', () => {
  it('strike halts and resumes production', () => {
    const ctx = at(1900, 3);
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 20, y: 5 }));
    b.recipeId = 'r_lumber';
    b.input.wood = 100;
    const strike = RANDOM_EVENTS.find((e) => e.id === 'strike')!;
    expect(strike.apply(ctx)).not.toBeNull();
    expect(b.haltedUntil).not.toBeNull();
    runDays(ctx, 2);
    expect(b.status).toBe('halted');
    expect(b.output.lumber ?? 0).toBe(0);
    runDays(ctx, 12);
    expect(b.output.lumber ?? 0).toBeGreaterThan(0);
  });
  it('random roll deterministic for seed', () => {
    const run = () => {
      const ctx = at(1950, 6);
      for (let i = 0; i < 24; i++) randomMonth(ctx);
      return ctx.state.news.map((n) => n.headline);
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(0);
  });
});

describe('news & report', () => {
  it('news capped at 200', () => {
    const ctx = at(1900, 1);
    for (let i = 0; i < 260; i++) publishNews(ctx, 'random', `h${i}`, 'b');
    expect(ctx.state.news).toHaveLength(MAX_NEWS);
  });
  it('monthly report names the top-selling good', () => {
    const ctx = at(1900, 2);
    const l = currentLedger(ctx.state.companies.player, ctx.state.date);
    l.salesByGood = { bread: 50, tools: 900 };
    monthlyMarketReport(ctx);
    const n = ctx.state.news[ctx.state.news.length - 1];
    expect(n.kind).toBe('market');
    expect(n.headline + n.body).toMatch(/Tools/i);
  });
});
