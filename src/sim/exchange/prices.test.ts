import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import { unpackState } from '../../game/saves';
import phase3 from '../__fixtures__/phase3.save.json?raw';
import { companyIds } from '../companies';
import { earn, spend } from '../finance';
import { checkInvariants } from '../invariants';
import { regionalMonth } from '../regional/firms';
import { netWorth, takeover } from '../rival';
import { must } from '../testkit';
import { atPrices } from '../society/economy';
import { assetValue, createGame } from '../state';
import type { SimContext } from '../types';
import { exchangeDay, exchangeMonth, exchangeShock, fundamental } from './prices';
import { delist, moveShares } from './shares';
import { defaultExchange, PUBLIC_HOLDER, SENTIMENT_MAX, SENTIMENT_MIN, SHARES_OUTSTANDING } from './types';

const fresh = (seed = 42): SimContext => ({ state: createGame({ seed }), bus: new EventBus() });

describe('share prices', () => {
  it('a new game lists the player and the Baron, 40% family and 60% public', () => {
    const { state } = fresh();
    expect(Object.keys(state.exchange.listings)).toEqual(['player', 'rival']);
    for (const id of ['player', 'rival']) {
      const l = state.exchange.listings[id];
      expect(l.shares).toBe(SHARES_OUTSTANDING);
      expect(l.holders).toEqual({ [id]: 400, [PUBLIC_HOLDER]: 600 });
      expect(l.listed).toBe(true);
      expect(l.sentiment).toBe(1);
      expect(l.price).toBeGreaterThan(0);
      expect(l.price).toBe(Math.round(l.fundamental * 100) / 100);
    }
    expect(checkInvariants(state)).toEqual([]);
  });

  it('the fundamental tracks net worth and trailing-12-month profit, never below the floor', () => {
    const { state } = fresh();
    const c = state.companies.player;
    const nw = () => c.money - c.loan + assetValue(state, 'player');
    expect(fundamental(state, 'player')).toBeCloseTo(nw() / SHARES_OUTSTANDING, 6);
    earn(c, 'sales', 120_000, state.date);
    // profit counts twice: once in net worth (cash) and 8 times as earnings
    expect(fundamental(state, 'player')).toBeCloseTo((nw() + 8 * 120_000) / SHARES_OUTSTANDING, 6);
    // dividends are not a loss
    spend(c, 'dividends', 50_000, state.date);
    expect(fundamental(state, 'player')).toBeCloseTo((nw() + 8 * 120_000) / SHARES_OUTSTANDING, 6);
    // a ledger month older than 12 does not count
    c.ledger.unshift({ year: 1890, month: 1, income: { sales: 10_000_000 }, expense: {}, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 });
    for (let m = 2; m <= 12; m++) c.ledger.push({ year: 1900, month: m, income: {}, expense: {}, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 });
    expect(fundamental(state, 'player')).toBeCloseTo((nw() + 8 * 120_000) / SHARES_OUTSTANDING, 6);
    // monthly refresh
    exchangeMonth({ state, bus: new EventBus() });
    const l = state.exchange.listings.player;
    expect(l.fundamental).toBeCloseTo((nw() + 8 * 120_000) / SHARES_OUTSTANDING, 6);
    expect(l.history).toEqual([l.price]);
  });

  it('a company with negative net worth (or NaN books) keeps a price at or above the floor', () => {
    const ctx = fresh();
    const { state } = ctx;
    const c = state.companies.rival;
    c.money = -5_000_000;
    c.loan = 500_000;
    spend(c, 'fines', 2_000_000, state.date);
    const floor = atPrices(state, 20);
    expect(fundamental(state, 'rival')).toBe(floor);
    exchangeMonth(ctx);
    for (let d = 0; d < 400; d++) exchangeDay(ctx);
    const l = state.exchange.listings.rival;
    expect(l.price).toBeGreaterThanOrEqual(Math.round(floor * SENTIMENT_MIN * 100) / 100);
    expect(l.price).toBeGreaterThan(0);
    c.money = NaN;
    expect(fundamental(state, 'rival')).toBe(floor);
  });

  it('over 36,000 seeded days the price stays within [0.4, 1.6] × fundamental and sentiment in bounds', () => {
    const ctx = fresh(7);
    const { state } = ctx;
    let lo = Infinity;
    let hi = -Infinity;
    let sLo = Infinity;
    let sHi = -Infinity;
    let bad = 0;
    for (let d = 0; d < 36_000; d++) {
      exchangeDay(ctx);
      for (const id of ['player', 'rival']) {
        const l = state.exchange.listings[id];
        if (!(Number.isFinite(l.price) && l.price > 0)) bad++;
        const r = l.price / l.fundamental;
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
        sLo = Math.min(sLo, l.sentiment);
        sHi = Math.max(sHi, l.sentiment);
      }
    }
    expect(bad).toBe(0);
    expect(sLo).toBeGreaterThanOrEqual(SENTIMENT_MIN);
    expect(sHi).toBeLessThanOrEqual(SENTIMENT_MAX);
    // rounding to the cent may cross the bound by half a cent
    const tol = 0.005 / state.exchange.listings.player.fundamental;
    expect(lo).toBeGreaterThanOrEqual(SENTIMENT_MIN - tol);
    expect(hi).toBeLessThanOrEqual(SENTIMENT_MAX + tol);
    // the price actually moves
    expect(hi - lo).toBeGreaterThan(0.05);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('draws only from its own rng stream, seeded from the game seed: the game rng is untouched', () => {
    const ctx = fresh();
    const { state } = ctx;
    const game = state.rngState;
    const own = state.exchange.rngState;
    expect(own).toBe(fresh().state.exchange.rngState);
    expect(own).not.toBe(fresh(43).state.exchange.rngState);
    for (let d = 0; d < 1000; d++) exchangeDay(ctx);
    for (let m = 0; m < 12; m++) exchangeMonth(ctx);
    exchangeShock(state, '*', 0.9);
    expect(state.rngState).toBe(game);
    expect(state.exchange.rngState).not.toBe(own);
  });

  it('shocks multiply sentiment, clamped; "*" shocks every listed company', () => {
    const ctx = fresh();
    const { state } = ctx;
    exchangeShock(state, 'player', 0.5);
    expect(state.exchange.listings.player.sentiment).toBe(0.5);
    expect(state.exchange.listings.rival.sentiment).toBe(1);
    exchangeShock(state, '*', 0.5);
    expect(state.exchange.listings.player.sentiment).toBe(SENTIMENT_MIN);
    expect(state.exchange.listings.rival.sentiment).toBe(0.5);
    exchangeShock(state, '*', 10);
    expect(state.exchange.listings.player.sentiment).toBe(SENTIMENT_MAX);
    const l = state.exchange.listings.player;
    expect(l.price).toBe(Math.round(l.fundamental * l.sentiment * 100) / 100);
  });

  it('delist freezes the price (no rng draw) and returns every holding to the public', () => {
    const ctx = fresh();
    const { state } = ctx;
    moveShares(state, 'rival', PUBLIC_HOLDER, 'player', 100);
    expect(state.exchange.listings.rival.holders).toEqual({ rival: 400, public: 500, player: 100 });
    delist(state, 'rival');
    const l = state.exchange.listings.rival;
    expect(l.listed).toBe(false);
    expect(l.holders).toEqual({ public: SHARES_OUTSTANDING });
    const frozen = JSON.stringify(l);
    // only the player's listing draws now
    const rng = state.exchange.rngState;
    exchangeDay(ctx);
    exchangeMonth(ctx);
    exchangeShock(state, '*', 0.5);
    expect(JSON.stringify(l)).toBe(frozen);
    const twoDraws = fresh();
    exchangeDay(twoDraws);
    expect(state.exchange.rngState).not.toBe(rng);
    expect(state.exchange.rngState).not.toBe(twoDraws.state.exchange.rngState);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('moveShares throws on a negative, fractional or overdrawn move', () => {
    const { state } = fresh();
    expect(() => moveShares(state, 'player', PUBLIC_HOLDER, 'rival', -1)).toThrow();
    expect(() => moveShares(state, 'player', PUBLIC_HOLDER, 'rival', 1.5)).toThrow();
    expect(() => moveShares(state, 'player', PUBLIC_HOLDER, 'rival', 601)).toThrow();
    expect(() => moveShares(state, 'player', 'rival', PUBLIC_HOLDER, 1)).toThrow();
    expect(() => moveShares(state, 'nobody', PUBLIC_HOLDER, 'rival', 1)).toThrow();
    expect(state.exchange.listings.player.holders).toEqual({ player: 400, public: 600 });
  });

  it('a regional founding lists the firm; its closure delists it', async () => {
    const ctx = fresh();
    const { state } = ctx;
    state.date = { year: 1905, month: 1, day: 30, hour: 23 };
    regionalMonth(ctx);
    expect(state.companies.regional_1).toBeDefined();
    const l = state.exchange.listings.regional_1;
    expect(l.listed).toBe(true);
    // listed after its chain was built: the opening price counts the built works
    expect(assetValue(state, 'regional_1')).toBeGreaterThan(0);
    expect(l.fundamental).toBe(fundamental(state, 'regional_1'));
    expect(l.price).toBe(Math.round(l.fundamental * 100) / 100);
    expect(l.holders).toEqual({ regional_1: 400, public: 600 });
    expect(Object.keys(state.exchange.listings)).toEqual(companyIds(state));
    expect(checkInvariants(state)).toEqual([]);
    const { closeFirm } = await import('../regional/firms');
    closeFirm(ctx, 'regional_1', false);
    expect(l.listed).toBe(false);
    expect(l.holders).toEqual({ public: SHARES_OUTSTANDING });
    expect(l.price).toBeGreaterThan(0);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('a taken-over Baron is delisted, his holdings cleared and his price frozen above zero', () => {
    const ctx = fresh();
    const { state } = ctx;
    moveShares(state, 'rival', PUBLIC_HOLDER, 'player', 50);
    state.companies.rival.money = -200_000;
    state.companies.player.money = 10_000_000 + 3 * Math.max(0, netWorth(state, 'rival'));
    exchangeMonth(ctx);
    must(takeover(ctx));
    const l = state.exchange.listings.rival;
    expect(l.listed).toBe(false);
    expect(l.holders).toEqual({ public: SHARES_OUTSTANDING });
    const price = l.price;
    expect(Number.isFinite(price) && price > 0).toBe(true);
    for (let d = 0; d < 40; d++) exchangeDay(ctx);
    exchangeMonth(ctx);
    expect(l.price).toBe(price);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('a game without the Baron delists him at the start', () => {
    const state = createGame({ seed: 42, rival: false });
    expect(state.exchange.listings.rival.listed).toBe(false);
    expect(state.exchange.listings.player.listed).toBe(true);
  });

  it('the v6 fixture migrates with a listing for every company and runs on', () => {
    const r = unpackState(phase3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = r.value;
    expect(Object.keys(state.exchange.listings)).toEqual(companyIds(state));
    // the exchange's rng stream is seeded from the save's seed, as in a new game
    expect(state.exchange.rngState).toBe(defaultExchange(state.seed).rngState);
    for (const id of companyIds(state)) {
      const l = state.exchange.listings[id];
      expect(l.listed).toBe(state.companies[id].active);
      expect(l.price).toBeGreaterThan(0);
      expect(l.fundamental).toBeCloseTo(fundamental(state, id), 6);
    }
    expect(checkInvariants(state)).toEqual([]);
  });

  it('invariants catch bad holdings, prices and sentiment', () => {
    const { state } = fresh();
    const l = state.exchange.listings.player;
    l.price = NaN;
    l.sentiment = 2;
    l.holders.public = 599;
    const msgs = checkInvariants(state).join('\n');
    expect(msgs).toMatch(/price/);
    expect(msgs).toMatch(/sentiment/);
    expect(msgs).toMatch(/holders/);
    delete state.exchange.listings.rival;
    expect(checkInvariants(state).join('\n')).toMatch(/rival.*listing/);
  });
});
