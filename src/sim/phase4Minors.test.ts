/** Phase 4 final review minors: each guards one fix (see the fix brief, Minors 5 to 9, and the 1960 load). */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { CARDS_BY_ID } from '../data/cards';
import { FEMALE_GIVEN_NAMES, MALE_GIVEN_NAMES } from '../data/dynasty';
import { GRUDGE_LABELS, GRUDGE_WEIGHTS } from '../data/nemesis';
import { unpackState } from '../game/saves';
import { buyShares } from './exchange/trading';
import { checkInvariants } from './invariants';
import { SAVE_VERSION } from './version';
import { GRUDGE_FORGET, grudgesYear, nemesisMonth } from './nemesis/grudges';
import { cardText, forceCard, resolveCard } from './politics/cards';
import { nationalOpinion } from './politics/factions';
import { regionalMonth } from './regional/firms';
import { runDays } from './simulation';
import { createGame } from './state';
import { must, testCtx } from './testkit';
import type { SimContext } from './types';

const fixtures = import.meta.glob('./__fixtures__/phase3.save.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phase3 = fixtures['./__fixtures__/phase3.save.json'];

const fresh = (seed = 42): SimContext => ({ state: createGame({ seed }), bus: new EventBus() });

function resolve(ctx: SimContext, cardId: string, choice: number): void {
  expect(forceCard(ctx, cardId)).toBe(true);
  const inst = ctx.state.politics.cards.pending.at(-1)!;
  must(resolveCard(ctx, inst.uid, choice));
}

describe('crash card "Buy back your shares" (Minor 5)', () => {
  it('pleases Old Money only when the purchase goes through', () => {
    const broke = fresh();
    broke.state.companies.player.money = 0;
    const toasts: string[] = [];
    broke.bus.on('toast', (e) => toasts.push(e.message));
    const before = nationalOpinion(broke.state, 'oldmoney');
    resolve(broke, 'exchange_panic', 0);
    expect(toasts).toEqual(['Not enough money']);
    expect(nationalOpinion(broke.state, 'oldmoney')).toBe(before);

    const flush = fresh();
    flush.state.companies.player.money = 1e7;
    const held = flush.state.exchange.listings.player.holders.player;
    const was = nationalOpinion(flush.state, 'oldmoney');
    resolve(flush, 'exchange_panic', 0);
    expect(flush.state.exchange.listings.player.holders.player).toBe(held + 50);
    expect(nationalOpinion(flush.state, 'oldmoney')).toBeCloseTo(Math.min(100, was + 10), 6);
  });
});

describe("the 'shares' grudge (Minor 6)", () => {
  const sharesWeight = (ctx: SimContext) => ctx.state.nemesis.grudges.filter((g) => g.kind === 'shares').reduce((t, g) => t + g.weight, 0);

  it("aggregates a month's purchases of the Baron into one grudge, so splitting a buy evades nothing", () => {
    const split = fresh();
    split.state.companies.player.money = 1e8;
    for (let i = 0; i < 10; i++) must(buyShares(split, 'player', 'rival', 10));
    const whole = fresh();
    whole.state.companies.player.money = 1e8;
    must(buyShares(whole, 'player', 'rival', 100));
    for (const ctx of [split, whole]) {
      ctx.state.nemesis.grudges = [];
      nemesisMonth(ctx);
    }
    const g = split.state.nemesis.grudges.filter((x) => x.kind === 'shares');
    expect(g).toHaveLength(1);
    expect(g[0].weight).toBeCloseTo(GRUDGE_WEIGHTS.shares, 6);
    expect(sharesWeight(split)).toBeCloseTo(sharesWeight(whole), 6);
    // it survives the year's decay
    grudgesYear(split);
    expect(split.state.nemesis.grudges.some((x) => x.kind === 'shares' && x.weight >= GRUDGE_FORGET)).toBe(true);
    // the tally starts again
    nemesisMonth(split);
    expect(split.state.nemesis.grudges.filter((x) => x.kind === 'shares')).toHaveLength(1);
  });
});

describe('the funeral wake (Minor 7)', () => {
  it("leaves a 'wake' grudge of its own, not a town-less 'city' one", () => {
    const ctx = fresh();
    resolve(ctx, 'baron_funeral', 2);
    ctx.state.nemesis.grudges = [];
    // a penniless Baron cannot strike back this month (a strike would halve the grudge)
    ctx.state.companies.rival.money = 0;
    nemesisMonth(ctx);
    const g = ctx.state.nemesis.grudges;
    expect(g.some((x) => x.kind === 'city')).toBe(false);
    const wake = g.find((x) => x.kind === 'wake');
    expect(wake).toBeDefined();
    expect(wake!.weight).toBe(2 * GRUDGE_WEIGHTS.city);
    expect(GRUDGE_LABELS.wake).toBeTruthy();
  });
});

describe('regional firm seed money (Minor 8)', () => {
  it('is whole dollars', () => {
    const ctx = fresh();
    ctx.state.date = { year: 1905, month: 1, day: 30, hour: 23 };
    // a price index with a long fraction, as in later years
    ctx.state.economy.priceIndex = 1.2345678;
    regionalMonth(ctx);
    const firm = ctx.state.companies.regional_1;
    expect(firm?.active).toBe(true);
    expect(Number.isInteger(firm.money)).toBe(true);
  });
});

describe('the marriage card (Minor 9)', () => {
  it("offers a daughter head a banker's son and a viscount's nephew, and a son head the reverse", () => {
    const body = (given: string) => {
      const ctx = fresh();
      const d = ctx.state.dynasty;
      d.head.name = `${given} ${d.head.name.split(' ').slice(-1)[0]}`;
      expect(forceCard(ctx, 'marriage')).toBe(true);
      return cardText(ctx.state, ctx.state.politics.cards.pending.at(-1)!).body;
    };
    const her = body(FEMALE_GIVEN_NAMES[0]);
    expect(her).toContain("a banker's son");
    expect(her).toContain("a viscount's nephew");
    expect(her).not.toMatch(/daughter|niece|dowry/);
    const his = body(MALE_GIVEN_NAMES[0]);
    expect(his).toContain("a banker's daughter");
    expect(his).toContain("a viscount's niece");
    expect(CARDS_BY_ID.marriage.body).not.toMatch(/daughter/);
  });
});

describe('a v6 save dated 1960 (past the succession window)', () => {
  it('migrates, holds invariants and plays a year', () => {
    const raw = JSON.parse(phase3) as { version: number; date: { year: number } };
    expect(raw.version).toBe(6);
    raw.date.year = 1960;
    const r = unpackState(JSON.stringify(raw));
    if (!r.ok) throw new Error(r.error);
    const s = r.value;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.date.year).toBe(1960);
    expect(checkInvariants(s)).toEqual([]);
    const ctx = testCtx(s);
    runDays(ctx, 360);
    expect(ctx.state.date.year).toBe(1961);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
});
