import { describe, expect, it } from 'vitest';
import { CARDS_BY_ID } from '../../data/cards';
import { LAWS, LAW_IDS } from '../../data/laws';
import { currentLedger } from '../finance';
import { monthIndex } from '../politics/elections';
import { resolveCard } from '../politics/cards';
import { migrateSave } from '../migrations';
import { placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, SimContext } from '../types';
import { lobbyForDelay } from './lawState';
import { monthlyFines, nationalSmogLevel, regulationMonth } from './regulation';

function world(year: number): SimContext {
  const ctx = testCtx(testState({ width: 100, height: 60, money: 1e7, year, cities: [{ x: 20, y: 20 }] }));
  ctx.state.date = { ...ctx.state.date, year, month: 6 };
  return ctx;
}
const steel = (ctx: SimContext): Building => must(placeBuilding(ctx, 'player', 'steel_mill', { x: 40, y: 30 }));
function setSales(ctx: SimContext, amount: number): void {
  const d = ctx.state.date;
  const prev = d.month === 1 ? { year: d.year - 1, month: 12 } : { year: d.year, month: d.month - 1 };
  currentLedger(ctx.state.companies.player, { ...d, ...prev }).income.sales = amount;
}
const smog = (ctx: SimContext, level: number) => (ctx.state.cities[0].smog.level = level);
const months = (ctx: SimContext, n: number) => {
  for (let i = 0; i < n; i++) regulationMonth(ctx);
};

describe('law passing', () => {
  it('forces a law at the start of its latest year when the trigger never holds', () => {
    const ctx = world(1924);
    months(ctx, 5);
    expect(ctx.state.society.laws.smoke_abatement.passed).toBeNull();
    ctx.state.date.year = 1925;
    regulationMonth(ctx);
    expect(ctx.state.society.laws.smoke_abatement.passed).toBe(1925);
    expect(ctx.state.politics.cards.pending.map((p) => p.cardId)).toContain('law_smoke_abatement');
    expect(ctx.state.news.some((n) => n.kind === 'historic')).toBe(true);
  });

  it('passes early after 24 consecutive months over the trigger inside the window', () => {
    const ctx = world(1910);
    smog(ctx, 0.04);
    months(ctx, 23);
    expect(ctx.state.society.laws.smoke_abatement.passed).toBeNull();
    regulationMonth(ctx);
    expect(ctx.state.society.laws.smoke_abatement.passed).toBe(1910);
    expect(ctx.state.society.laws.clean_air.passed).toBeNull();
  });

  it('resets the streak when the level dips, and ignores years before the window', () => {
    const ctx = world(1910);
    smog(ctx, 0.04);
    months(ctx, 20);
    smog(ctx, 0.03);
    regulationMonth(ctx);
    expect(ctx.state.society.streak.smoke_abatement).toBe(0);
    const early = world(1905);
    smog(early, 0.5);
    months(early, 30);
    expect(early.state.society.laws.smoke_abatement.passed).toBeNull();
  });

  it('uses the population-weighted smog level with the ruling R-S3 triggers', () => {
    expect(LAW_IDS.map((id) => LAWS[id].trigger)).toEqual([0.035, 0.025, 0.018]);
    const ctx = testCtx(testState({ cities: [{ x: 5, y: 5, population: 9000 }, { x: 30, y: 20, population: 1000 }] }));
    ctx.state.cities[0].smog.level = 0.01;
    ctx.state.cities[1].smog.level = 0.11;
    expect(nationalSmogLevel(ctx.state)).toBeCloseTo(0.02, 12);
  });
});

describe('fines', () => {
  function enforced(): { ctx: SimContext; b: Building } {
    const ctx = world(1926);
    const b = steel(ctx);
    ctx.state.society.laws.smoke_abatement = { passed: 1925, enforcedFrom: monthIndex(ctx.state.date) - 1, lobbied: false };
    return { ctx, b };
  }

  it('books pollution * 400 * priceIndex a month under fines', () => {
    const { ctx } = enforced();
    setSales(ctx, 1e6);
    ctx.state.date.year = 1926;
    const before = ctx.state.companies.player.money;
    regulationMonth(ctx);
    expect(before - ctx.state.companies.player.money).toBe(6 * 400);
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).expense.fines).toBe(2400);
  });

  it('caps total fines at 25% of last month sales', () => {
    const { ctx } = enforced();
    setSales(ctx, 4000);
    expect(monthlyFines(ctx.state)).toBe(1000);
    setSales(ctx, 0);
    expect(monthlyFines(ctx.state)).toBe(0);
  });

  it('does not fine compliant buildings', () => {
    const { ctx, b } = enforced();
    setSales(ctx, 1e6);
    (b as Building & { upgrades?: { scrubber: number } }).upgrades = { scrubber: 1 };
    expect(monthlyFines(ctx.state)).toBe(0);
  });

  it('does not fine before enforcement starts', () => {
    const { ctx } = enforced();
    setSales(ctx, 1e6);
    ctx.state.society.laws.smoke_abatement.enforcedFrom = monthIndex(ctx.state.date) + 1;
    expect(monthlyFines(ctx.state)).toBe(0);
  });
});

describe('lobbying', () => {
  it('delays enforcement by 24 months, once', () => {
    const ctx = world(1925);
    regulationMonth(ctx);
    const law = ctx.state.society.laws.smoke_abatement;
    const start = law.enforcedFrom!;
    expect(start).toBe(monthIndex(ctx.state.date));
    const inst = ctx.state.politics.cards.pending[0];
    const lobby = CARDS_BY_ID.law_smoke_abatement.choices.findIndex((c) => c.label === 'Lobby for delay');
    must(resolveCard(ctx, inst.uid, lobby));
    expect(law.enforcedFrom).toBe(start + 24);
    expect(law.lobbied).toBe(true);
    expect(lobbyForDelay(ctx.state, 'smoke_abatement')).toBe(false);
    expect(law.enforcedFrom).toBe(start + 24);
  });
});

describe('catalog and save', () => {
  it('has a law card per law', () => {
    for (const id of LAW_IDS) expect(CARDS_BY_ID[LAWS[id].cardId]?.trigger).toBe('law');
  });
  it('migrates a v5 save with no laws passed', () => {
    const o = JSON.parse(JSON.stringify(testState({ cities: [{ x: 5, y: 5 }] }))) as Record<string, unknown>;
    delete o.society;
    o.version = 5;
    migrateSave(o);
    expect((o.society as { streak: Record<string, number> }).streak.clean_air).toBe(0);
  });
});
