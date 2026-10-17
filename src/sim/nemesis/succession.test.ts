import { describe, expect, it } from 'vitest';
import { CARDS_BY_ID } from '../../data/cards';
import { eligibleCards } from '../politics/cards';
import { testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { addGrudge, grudgeTotal, nemesisMonth } from './grudges';
import { SUCCESSION_FIRST_YEAR, SUCCESSION_FORCED_YEAR, successionMonth } from './succession';

function setup(seed: number, year = SUCCESSION_FIRST_YEAR): SimContext {
  const ctx = testCtx(testState({ seed, money: 1e6, rivalMoney: 1e6 }));
  ctx.state.date = { year, month: 12, day: 30, hour: 0 };
  return ctx;
}

/** Runs Decembers from `from` until the succession happens; returns the year or null. */
function run(ctx: SimContext, to = 1990): number | null {
  for (let y = ctx.state.date.year; y <= to; y++) {
    ctx.state.date.year = y;
    successionMonth(ctx);
  }
  return ctx.state.nemesis.succession.year;
}

describe('successionMonth', () => {
  it('happens exactly once, in 1940-1955, over 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ctx = setup(seed);
      const year = run(ctx);
      expect(year, `seed ${seed}`).not.toBeNull();
      expect(year!).toBeGreaterThanOrEqual(1940);
      expect(year!).toBeLessThanOrEqual(1955);
      expect(ctx.state.nemesis.traits).toHaveLength(3);
      expect(ctx.state.nemesis.head.generation).toBe(2);
    }
  });

  it('does nothing before 1940, nor outside December', () => {
    const ctx = setup(1, 1939);
    successionMonth(ctx);
    expect(ctx.state.nemesis.succession.done).toBe(false);
    const c2 = setup(1, 1955);
    c2.state.date.month = 11;
    successionMonth(c2);
    expect(c2.state.nemesis.succession.done).toBe(false);
  });

  it('is forced in December 1955', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = setup(seed, SUCCESSION_FORCED_YEAR);
      successionMonth(ctx);
      expect(ctx.state.nemesis.succession).toEqual({ done: true, year: 1955 });
    }
  });

  it('never repeats once done', () => {
    const ctx = setup(3, 1955);
    successionMonth(ctx);
    const traits = [...ctx.state.nemesis.traits];
    ctx.state.date.year = 1956;
    successionMonth(ctx);
    expect(ctx.state.nemesis.traits).toEqual(traits);
    expect(ctx.state.nemesis.succession.year).toBe(1955);
  });

  it('installs Junior, a distinct third trait, and x0.6 grudges', () => {
    const ctx = setup(5, 1955);
    addGrudge(ctx.state, 'city', 0);
    addGrudge(ctx.state, 'undercut', 1);
    const before = grudgeTotal(ctx.state);
    const held = [...ctx.state.nemesis.traits];
    successionMonth(ctx);
    const n = ctx.state.nemesis;
    expect(n.head).toEqual({ name: 'Reginald Smogsworth Jr.', born: 1898, generation: 2 });
    expect(n.traits.slice(0, 2)).toEqual(held);
    expect(new Set(n.traits).size).toBe(3);
    expect(grudgeTotal(ctx.state)).toBeCloseTo(before * 0.6, 9);
    expect(ctx.state.news.some((x) => x.kind === 'rival' && x.headline.includes('OLD BARON IS DEAD'))).toBe(true);
  });

  it('is silent when the Baron is inactive, but still happens', () => {
    const ctx = setup(5, 1955);
    ctx.state.companies.rival.active = false;
    successionMonth(ctx);
    expect(ctx.state.nemesis.succession.done).toBe(true);
    expect(ctx.state.nemesis.head.generation).toBe(2);
    expect(ctx.state.news.filter((x) => x.kind === 'rival')).toEqual([]);
  });
});

describe('baron_funeral card', () => {
  it('is eligible only the spring after the succession', () => {
    const ctx = setup(5, 1955);
    const ids = () => eligibleCards(ctx.state, 'spring', null).map((e) => e.card.id);
    expect(ids()).not.toContain('baron_funeral');
    successionMonth(ctx);
    expect(ids()).not.toContain('baron_funeral'); // same year, still December
    ctx.state.date = { year: 1956, month: 4, day: 1, hour: 0 };
    expect(ids()).toContain('baron_funeral');
    ctx.state.date.year = 1957;
    expect(ids()).not.toContain('baron_funeral');
  });

  it('the wake leaves a double city grudge at the next monthly hook', () => {
    const ctx = setup(5, 1956);
    ctx.state.date.month = 4;
    CARDS_BY_ID.baron_funeral.choices[2].apply!(ctx, null);
    expect(grudgeTotal(ctx.state)).toBe(0);
    nemesisMonth(ctx);
    expect(ctx.state.nemesis.grudges).toHaveLength(1);
    expect(ctx.state.nemesis.grudges[0]).toMatchObject({ kind: 'city', cityId: null });
    expect(ctx.state.flags['nemesis:wake']).toBeUndefined();
  });

  it('has the three brief choices, one free', () => {
    const c = CARDS_BY_ID.baron_funeral;
    expect(c.choices.map((x) => x.cost)).toEqual([2000, 0, 0]);
  });
});
