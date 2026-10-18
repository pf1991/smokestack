/**
 * Phase 4 final review, Critical 1 and Important 2: a takeover costs what it is worth (book floor on
 * the fundamental, pro-rata cash to the buyer, the 1.5x wealth gate on the Baron) and share holdings
 * count in `wealth`.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import { autoplayDefend, runAutoplay } from '../../game/autoplay';
import { unpackState } from '../../game/saves';
import { BANKRUPT_MONTHS, maxLoan, monthProfit, spend, takeLoan } from '../finance';
import { legacyScore } from '../legacy';
import { startBid } from '../nemesis/bid';
import { regionalMonth } from '../regional/firms';
import { runDays } from '../simulation';
import { realMoney } from '../society/economy';
import { assetValue, createGame, netWorth, wealth } from '../state';
import { must } from '../testkit';
import type { OwnerId, SimContext } from '../types';
import { fundamental } from './prices';
import { moveShares } from './shares';
import { buyBack, buyBackNeed, buyShares, CONTROL_SHARES, holding, quote, sellQuote, sellShares, TRADE_LOT } from './trading';
import { PUBLIC_HOLDER, SHARES_OUTSTANDING } from './types';
import { checkInvariants } from '../invariants';

const fixtures = import.meta.glob('../__fixtures__/phase4.save.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phase4 = fixtures['../__fixtures__/phase4.save.json'];

const fresh = (): SimContext => ({ state: createGame({ seed: 42 }), bus: new EventBus() });

function fixture(): SimContext {
  const r = unpackState(phase4);
  if (!r.ok) throw new Error(r.error);
  return { state: r.value, bus: new EventBus() };
}

/** A fresh seed-42 game in January 1905 with its first regional firm founded. */
function withFirm(): SimContext {
  const ctx = fresh();
  ctx.state.date = { year: 1905, month: 1, day: 30, hour: 23 };
  regionalMonth(ctx);
  expect(ctx.state.companies.regional_1?.active).toBe(true);
  return ctx;
}

/**
 * `buyer` buys the lot that brings it to CONTROL_SHARES of `target` in one purchase (given the cash
 * for it, and for the player buying the Baron enough to clear the wealth gate). Returns the buyer's
 * cash just before the purchase and just after the takeover.
 */
function takeOver(ctx: SimContext, buyer: OwnerId, target: OwnerId): { before: number; after: number } {
  const { state } = ctx;
  const b = state.companies[buyer];
  const need = Math.ceil((CONTROL_SHARES - holding(state, buyer, target)) / TRADE_LOT) * TRADE_LOT;
  expect(holding(state, PUBLIC_HOLDER, target)).toBeGreaterThanOrEqual(need);
  const cost = quote(state, buyer, target, need).total;
  b.money += cost + 2 * Math.max(0, wealth(state, target)) + 1e6;
  if (buyer === 'player' && target === 'rival') b.money += 2 * Math.max(0, wealth(state, 'rival'));
  const before = b.money;
  must(buyShares(ctx, buyer, target, need));
  expect(state.companies[target].active).toBe(false);
  expect(checkInvariants(state)).toEqual([]);
  return { before, after: b.money };
}

describe('takeovers cost what they are worth', () => {
  for (const [label, make] of [['a fresh game', fresh], ['the phase4 fixture', fixture]] as const) {
    it(`player -> Baron on ${label}: the buyer ends with no more cash than before the purchase`, () => {
      const ctx = make();
      const { before, after } = takeOver(ctx, 'player', 'rival');
      expect(ctx.state.flags.takeover).toBe(true);
      expect(after).toBeLessThanOrEqual(before);
    });
  }

  it('player -> firm and Baron -> firm on a fresh game: no cash windfall', () => {
    const a = withFirm();
    const r1 = takeOver(a, 'player', 'regional_1');
    expect(r1.after).toBeLessThanOrEqual(r1.before);
    const b = withFirm();
    const r2 = takeOver(b, 'rival', 'regional_1');
    expect(r2.after).toBeLessThanOrEqual(r2.before);
  });

  it('player -> firm and Baron -> firm on the phase4 fixture: no cash windfall', () => {
    const firms = (ctx: SimContext) => Object.keys(ctx.state.companies).filter((id) => ctx.state.companies[id].kind === 'regional' && ctx.state.companies[id].active);
    for (const id of firms(fixture())) {
      for (const buyer of ['player', 'rival'] as const) {
        const ctx = fixture();
        const r = takeOver(ctx, buyer, id);
        expect(r.after, `${buyer} -> ${id}`).toBeLessThanOrEqual(r.before);
      }
    }
  });

  it("the buyer gets its holding's share of the target's cash net of its loan; the rest leaves the economy", () => {
    const ctx = withFirm();
    const { state } = ctx;
    const firm = state.companies.regional_1;
    firm.money = 2_000_000;
    firm.loan = 500_000;
    // the Baron holds 50: he is paid his part as a holder
    state.companies.rival.money += 1e7;
    must(buyShares(ctx, 'rival', 'regional_1', 50));
    state.companies.player.money += 1e8;
    const need = CONTROL_SHARES;
    const cost = quote(state, 'player', 'regional_1', need).total;
    const p = state.companies.player.money;
    const r = state.companies.rival.money;
    const net = firm.money - firm.loan;
    must(buyShares(ctx, 'player', 'regional_1', need));
    expect(state.companies.player.money).toBe(p - cost + Math.round((net * need) / SHARES_OUTSTANDING));
    expect(state.companies.rival.money).toBe(r + Math.round((net * 50) / SHARES_OUTSTANDING));
    expect(firm.money).toBe(0);
    expect(firm.loan).toBe(0);
    // booked outside operating profit
    expect(firm.ledger.at(-1)!.expense.dividends).toBe(net);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('a target whose debts exceed its cash passes the shortfall to the buyer', () => {
    const ctx = withFirm();
    const { state } = ctx;
    const firm = state.companies.regional_1;
    firm.money = 100_000;
    firm.loan = 400_000;
    state.companies.player.money += 1e8;
    const cost = quote(state, 'player', 'regional_1', CONTROL_SHARES).total;
    const p = state.companies.player.money;
    must(buyShares(ctx, 'player', 'regional_1', CONTROL_SHARES));
    expect(state.companies.player.money).toBe(p - cost - 300_000);
    expect(firm.loan).toBe(0);
  });
});

describe('the 1.5x wealth gate on the Baron', () => {
  it('blocks a day-one buyout of the Baron, but not the lots below control', () => {
    const ctx = fresh();
    const { state } = ctx;
    expect(wealth(state, 'player')).toBeLessThan(1.5 * wealth(state, 'rival'));
    const r = buyShares(ctx, 'player', 'rival', CONTROL_SHARES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1\.5/);
    expect(state.companies.rival.active).toBe(true);
    expect(holding(state, 'player', 'rival')).toBe(0);
    // below control is always allowed
    state.companies.player.money += quote(state, 'player', 'rival', 500).total;
    must(buyShares(ctx, 'player', 'rival', 500));
    const lot = quote(state, 'player', 'rival', 10);
    state.companies.player.money += lot.total - lot.premium;
    expect(wealth(state, 'player')).toBeLessThan(1.5 * wealth(state, 'rival'));
    expect(buyShares(ctx, 'player', 'rival', 10).ok).toBe(false);
    expect(state.flags.takeover).toBeUndefined();
    // once 1.5x his wealth, the lot goes through
    state.companies.player.money += 1.5 * wealth(state, 'rival') + lot.premium;
    must(buyShares(ctx, 'player', 'rival', 10));
    expect(state.flags.takeover).toBe(true);
  });

  it('regional firms have no gate', () => {
    const ctx = withFirm();
    ctx.state.companies.player.money = quote(ctx.state, 'player', 'regional_1', CONTROL_SHARES).total;
    must(buyShares(ctx, 'player', 'regional_1', CONTROL_SHARES));
    expect(ctx.state.companies.regional_1.active).toBe(false);
  });
});

describe('book floor on the fundamental', () => {
  it('a loss-making company is priced at least at its book value per share', () => {
    const { state } = fresh();
    const c = state.companies.rival;
    c.money = 3_000_000;
    // a year of heavy losses: the earnings term is far below zero
    spend(c, 'fines', 1_000_000, state.date);
    const book = netWorth(state, 'rival') / SHARES_OUTSTANDING;
    expect(book).toBeGreaterThan(0);
    expect(fundamental(state, 'rival')).toBeCloseTo(book, 6);
    // cash per share never exceeds the price anchor
    expect(fundamental(state, 'rival')).toBeGreaterThanOrEqual((c.money - c.loan) / SHARES_OUTSTANDING);
  });
});

describe('wealth counts share holdings', () => {
  it("selling the player's own treasury shares leaves wealth unchanged apart from price impact and fee", () => {
    const { state, bus } = fresh();
    const ctx = { state, bus };
    const l = state.exchange.listings.player;
    const w0 = wealth(state, 'player');
    const nw0 = netWorth(state, 'player');
    const lg0 = legacyScore(state);
    const p0 = l.price;
    const n = 100;
    const total = sellQuote(state, 'player', 'player', n).total;
    must(sellShares(ctx, 'player', 'player', n));
    const w1 = wealth(state, 'player');
    // net worth books the sale as cash, with nothing taken off
    expect(netWorth(state, 'player')).toBe(nw0 + total);
    // wealth loses only the impact and the fee
    const cost = n * p0 - total + (400 - n) * (p0 - l.price);
    expect(w1).toBeLessThanOrEqual(w0);
    expect(Math.abs(w0 - w1 - cost)).toBeLessThan(1);
    expect(w0 - w1).toBeLessThan(0.05 * 400 * p0);
    expect(Math.abs(legacyScore(state).fortune - lg0.fortune)).toBeLessThanOrEqual(1);
    expect(legacyScore(state).fortune).toBe(Math.max(0, Math.round(realMoney(state, w1) / 10_000)));
  });
});

describe('the worst-case emergency bid loan', () => {
  it('the largest buy-back with zero cash and a maxed loan leaves a typical company solvent', () => {
    const ctx = fresh();
    must(runAutoplay(ctx));
    runDays(ctx, 360 * 3);
    const { state } = ctx;
    const p = state.companies.player;
    const profit12 = p.ledger.slice(-12).reduce((t, m) => t + monthProfit(m), 0);
    // the Baron holds every share of the player (the treasury sold off): the largest buy-back
    for (const holder of ['player', PUBLIC_HOLDER]) moveShares(state, 'player', holder, 'rival', holding(state, holder, 'player'));
    startBid(ctx);
    expect(buyBackNeed(state)).toBe(500);
    if (p.loan < maxLoan(1)) must(takeLoan(p, maxLoan(1) - p.loan, 1));
    p.money = 0;
    must(buyBack(ctx));
    const bidLoan = p.bidLoan ?? 0;
    expect(bidLoan).toBeGreaterThan(0);
    const over: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    let worstRed = 0;
    for (let m = 0; m < 36 && over.length === 0; m++) {
      runDays(ctx, 30);
      autoplayDefend(ctx);
      worstRed = Math.max(worstRed, p.monthsInRed);
    }
    // the numbers, for the report
    console.log(`bid-loan worst case: trailing profit ${profit12}, loan ${p.loan}, bid loan ${bidLoan}, cash after 3 years ${p.money}, worst months in red ${worstRed}`);
    expect(over).toEqual([]);
    expect(worstRed).toBeLessThan(BANKRUPT_MONTHS);
  });
});

describe('the control premium on the Baron (residual round)', () => {
  /** Seed `seed` under autoplay, run month by month until the player's wealth first reaches 1.5x the Baron's. */
  function gateOpen(seed: number): SimContext {
    const ctx: SimContext = { state: createGame({ seed }), bus: new EventBus() };
    must(runAutoplay(ctx));
    for (let m = 0; m < 60 && wealth(ctx.state, 'player') < 1.5 * wealth(ctx.state, 'rival'); m++) runDays(ctx, 30);
    expect(wealth(ctx.state, 'player')).toBeGreaterThanOrEqual(1.5 * wealth(ctx.state, 'rival'));
    return ctx;
  }

  for (const seed of [42, 7]) {
    it(`seed ${seed}, the month the gate opens: the takeover costs at least the cash and book assets it returns`, () => {
      const ctx = gateOpen(seed);
      const { state } = ctx;
      expect(state.date.year).toBe(1901);
      const q = quote(state, 'player', 'rival', CONTROL_SHARES);
      expect(q.premium).toBeGreaterThan(0);
      const p = state.companies.player;
      // lend the purchase, so the test reads only what it costs and returns
      p.money += q.total;
      const assets = assetValue(state, 'rival');
      const before = p.money;
      const sharesBefore = p.ledger.at(-1)!.expense.shares ?? 0;
      must(buyShares(ctx, 'player', 'rival', CONTROL_SHARES));
      expect(state.flags.takeover).toBe(true);
      const cashBack = p.money - (before - q.total);
      expect(q.total).toBeGreaterThanOrEqual(cashBack + assets);
      // the premium is booked under 'shares' with the lot
      expect((p.ledger.at(-1)!.expense.shares ?? 0) - sharesBefore).toBe(q.total);
    });
  }

  it('prices the premium as 100% of (510 x the lot price) for the lot that takes control, and none below it', () => {
    const ctx = fresh();
    const { state } = ctx;
    expect(quote(state, 'player', 'rival', 500).premium).toBe(0);
    const q = quote(state, 'player', 'rival', CONTROL_SHARES);
    const lot = q.total - q.premium;
    expect(q.premium).toBe(Math.round((CONTROL_SHARES * lot) / CONTROL_SHARES));
    // a small lot crossing the line still carries the premium on 510 shares at its price
    state.companies.player.money += 1e8;
    must(buyShares(ctx, 'player', 'rival', 500));
    const small = quote(state, 'player', 'rival', 10);
    expect(small.premium).toBe(Math.round(CONTROL_SHARES * ((small.total - small.premium) / 10)));
    // regional firms and the Baron's own buying carry none
    expect(quote(state, 'rival', 'player', CONTROL_SHARES).premium).toBe(0);
  });

  it('refuses a control lot the player cannot pay with its premium, with a clear error', () => {
    const ctx = fresh();
    const { state } = ctx;
    state.companies.rival.money = 0;
    const q = quote(state, 'player', 'rival', CONTROL_SHARES);
    state.companies.player.money = q.total - q.premium;
    expect(wealth(state, 'player')).toBeGreaterThanOrEqual(1.5 * wealth(state, 'rival'));
    const r = buyShares(ctx, 'player', 'rival', CONTROL_SHARES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/control premium/);
    expect(state.companies.rival.active).toBe(true);
  });
});

describe('the crash price floor (residual round)', () => {
  const crash = (ctx: SimContext) => {
    for (const l of Object.values(ctx.state.exchange.listings)) l.sentiment = 0.4;
  };
  for (const id of ['rival', 'regional_2', 'regional_3']) {
    it(`phase4 fixture at sentiment 0.4: taking over ${id} gives the player no cash windfall`, () => {
      const ctx = fixture();
      crash(ctx);
      const { before, after } = takeOver(ctx, 'player', id);
      expect(after).toBeLessThanOrEqual(before);
    });
  }
  it('fresh game at sentiment 0.4: a firm takeover gives no cash windfall, and a cash-rich firm trades at book', () => {
    const ctx = withFirm();
    ctx.state.companies.regional_1.money = 5_000_000;
    crash(ctx);
    const book = netWorth(ctx.state, 'regional_1') / SHARES_OUTSTANDING;
    expect(quote(ctx.state, 'player', 'regional_1', 10).total).toBeGreaterThanOrEqual(Math.round(10 * book));
    expect(sellQuote(ctx.state, 'player', 'regional_1', 10).total).toBeGreaterThanOrEqual(Math.floor(10 * book * 0.99) - 1);
    const { before, after } = takeOver(ctx, 'player', 'regional_1');
    expect(after).toBeLessThanOrEqual(before);
  });
});
