import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../../core/events';
import { CARDS_BY_ID } from '../../data/cards';
import { autoplayDefend, runAutoplay } from '../../game/autoplay';
import { unpackState } from '../../game/saves';
import { loanStep, maxLoan, monthProfit, repayLoan, takeLoan } from '../finance';
import { checkInvariants } from '../invariants';
import { BID_GRACE_MONTHS, BARON_TAKES_YOU, bidMonth, HOSTILE_BID_CARD_ID } from '../nemesis/bid';
import { eligibleKinds, retaliate } from '../nemesis/retaliation';
import { addGrudge } from '../nemesis/grudges';
import { cardText, forceCard, resolveCard } from '../politics/cards';
import { monthIndex } from '../politics/elections';
import { regionalMonth } from '../regional/firms';
import { runDays, serialize } from '../simulation';
import { createGame, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { delist } from './shares';
import {
  BROKER_FEE,
  buyBack,
  buyBackQuote,
  buyQuote,
  buyBackNeed,
  buyShares,
  CONTROL_SHARES,
  holding,
  quote,
  sellQuote,
  sellShares,
} from './trading';
import { PUBLIC_HOLDER, SHARES_OUTSTANDING } from './types';

const rich = (money = 1e9, rivalMoney = 1e9): SimContext =>
  testCtx(testState({ width: 60, height: 30, money, rivalMoney, cities: [{ x: 10, y: 10, population: 10000 }] }));

function events(ctx: SimContext): GameEvent[] {
  const out: GameEvent[] = [];
  ctx.bus.onAny((e) => out.push(e));
  return out;
}

/** The Baron buys up to CONTROL_SHARES of the player through the market: a bid opens. */
function openBid(ctx: SimContext): void {
  must(buyShares(ctx, 'rival', 'player', CONTROL_SHARES + 10 - holding(ctx.state, 'rival', 'player')));
}

/** One month of the nemesis system's bid check, then the next month. */
function monthEnd(ctx: SimContext): void {
  bidMonth(ctx);
  const d = ctx.state.date;
  if (d.month === 12) {
    d.year++;
    d.month = 1;
  } else d.month++;
}

function holdingsSane(ctx: SimContext): void {
  for (const [id, l] of Object.entries(ctx.state.exchange.listings)) {
    let sum = 0;
    for (const [h, n] of Object.entries(l.holders)) {
      expect(Number.isInteger(n) && n > 0, `${id}/${h} ${n}`).toBe(true);
      sum += n;
    }
    expect(sum, id).toBe(SHARES_OUTSTANDING);
  }
}

/** A game in January 1905 with its first regional firm founded. */
function withFirm(): SimContext {
  const ctx: SimContext = { state: createGame({ seed: 42 }), bus: new EventBus() };
  ctx.state.date = { year: 1905, month: 1, day: 30, hour: 23 };
  regionalMonth(ctx);
  expect(ctx.state.companies.regional_1?.active).toBe(true);
  return ctx;
}

describe('quotes', () => {
  it('a quote rises with block size (2% per 50 shares) and includes the broker fee', () => {
    const { state } = rich();
    const l = state.exchange.listings.rival;
    // a fundamental well above book (as earnings make it), so no lot here meets the book floor
    l.fundamental *= 2;
    const base = l.fundamental * l.sentiment;
    const q10 = quote(state, 'player', 'rival', 10);
    const q50 = quote(state, 'player', 'rival', 50);
    const q100 = quote(state, 'player', 'rival', 100);
    const q500 = quote(state, 'player', 'rival', 500);
    expect(q10.price).toBeCloseTo(base * (1 + BROKER_FEE), 1);
    expect(q10.price).toBeLessThan(q50.price);
    expect(q50.price).toBeLessThan(q100.price);
    expect(q100.price).toBeLessThan(q500.price);
    expect(q100.total).toBe(Math.round(q100.total));
    expect(q100.total).toBeGreaterThan(2 * q50.total);
    // selling pays less than buying, and less for a bigger block
    const s10 = sellQuote(state, 'public', 'rival', 10);
    const s100 = sellQuote(state, 'public', 'rival', 100);
    expect(s10.price).toBeLessThan(q10.price);
    expect(s100.price).toBeLessThan(s10.price);
    // quoting changes nothing
    expect(l.sentiment).toBe(1);
  });

  it('buy then sell round-trips at a loss of less than 5%; the impact decays through sentiment', () => {
    const ctx = rich();
    const { state } = ctx;
    const c = state.companies.player;
    const before = c.money;
    const l = state.exchange.listings.rival;
    must(buyShares(ctx, 'player', 'rival', 100));
    expect(l.sentiment).toBeCloseTo(1.02 ** 2, 9);
    expect(l.price).toBe(Math.round(l.fundamental * l.sentiment * 100) / 100);
    must(sellShares(ctx, 'player', 'rival', 100));
    expect(l.sentiment).toBeCloseTo(1, 9);
    const loss = before - c.money;
    expect(loss).toBeGreaterThan(0);
    expect(loss / quote(state, 'player', 'rival', 100).total).toBeLessThan(0.05);
    holdingsSane(ctx);
  });

  it('money is booked under shares, outside operating profit', () => {
    const ctx = rich();
    const { state } = ctx;
    const c = state.companies.player;
    const total = quote(state, 'player', 'rival', 50).total;
    const money = c.money;
    must(buyShares(ctx, 'player', 'rival', 50));
    expect(money - c.money).toBe(total);
    const proceeds = sellQuote(state, 'player', 'rival', 20).total;
    must(sellShares(ctx, 'player', 'rival', 20));
    const m = c.ledger.at(-1)!;
    expect(m.expense.shares).toBe(total);
    expect(m.income.shares).toBe(proceeds);
    expect(monthProfit(m)).toBe(0);
    expect(holding(state, 'player', 'rival')).toBe(30);
    expect(state.exchange.listings.rival.holders).toEqual({ rival: 400, [PUBLIC_HOLDER]: 570, player: 30 });
  });

  it('buying your own shares moves them to the company holding', () => {
    const ctx = rich();
    must(buyShares(ctx, 'player', 'player', 50));
    expect(ctx.state.exchange.listings.player.holders).toEqual({ player: 450, public: 550 });
    must(sellShares(ctx, 'player', 'player', 100));
    expect(ctx.state.exchange.listings.player.holders).toEqual({ player: 350, public: 650 });
  });

  it('refuses bad sizes, delisted companies, overdrawn sells and empty purses with a Result', () => {
    const ctx = rich(1000);
    const { state } = ctx;
    const snap = JSON.stringify(state);
    expect(buyShares(ctx, 'player', 'rival', 15).ok).toBe(false);
    expect(buyShares(ctx, 'player', 'rival', 0).ok).toBe(false);
    expect(buyShares(ctx, 'player', 'rival', -10).ok).toBe(false);
    expect(buyShares(ctx, 'player', 'rival', 10)).toEqual({ ok: false, error: 'Not enough money' });
    expect(buyShares(ctx, 'player', 'rival', 610).ok).toBe(false);
    expect(sellShares(ctx, 'player', 'rival', 10).ok).toBe(false);
    expect(buyShares(ctx, 'player', 'nobody', 10).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(snap);
    state.companies.player.money = 1e9;
    state.companies.rival.active = false;
    delist(state, 'rival');
    const r = buyShares(ctx, 'player', 'rival', 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not listed/);
    expect(sellShares(ctx, 'player', 'rival', 10).ok).toBe(false);
  });

  it('holdings never go negative over 2,000 random trades', () => {
    const ctx = rich(1e12, 1e12);
    const { state } = ctx;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const ids = ['player', 'rival'];
    for (let i = 0; i < 2000; i++) {
      const who = ids[Math.floor(rnd() * 2)];
      const what = ids[Math.floor(rnd() * 2)];
      // never into the takeover range: the Baron would open a bid, the player would take him over
      const n = 10 * (1 + Math.floor(rnd() * 8));
      const r = rnd() < 0.5 ? buyShares(ctx, who, what, n) : sellShares(ctx, who, what, n);
      if (!r.ok) continue;
      if (who !== what && holding(state, who, what) >= CONTROL_SHARES - 80) must(sellShares(ctx, who, what, 100));
      holdingsSane(ctx);
    }
    for (const l of Object.values(state.exchange.listings)) {
      expect(Number.isFinite(l.price) && l.price > 0).toBe(true);
    }
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('takeovers', () => {
  it('crossing 510 of the Baron calls takeover: his works transfer, the flag is set and he is delisted', () => {
    const ctx = rich();
    const { state } = ctx;
    const works = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 30, y: 20 }));
    state.companies.rival.loan = 50_000;
    const seen = events(ctx);
    must(buyShares(ctx, 'player', 'rival', 500));
    expect(state.companies.rival.active).toBe(true);
    const cash = state.companies.rival.money - state.companies.rival.loan;
    // the lot that takes control needs 1.5x his wealth
    state.companies.player.money = 1e10;
    const money = state.companies.player.money;
    const price = quote(state, 'player', 'rival', 10).total;
    must(buyShares(ctx, 'player', 'rival', 10));
    expect(state.buildings[works.id].ownerId).toBe('player');
    expect(state.companies.rival.active).toBe(false);
    expect(state.flags.takeover).toBe(true);
    const l = state.exchange.listings.rival;
    expect(l.listed).toBe(false);
    expect(l.holders).toEqual({ public: SHARES_OUTSTANDING });
    // the shares were the price: the deal brings the player's 510/1000 of his cash net of his loan
    expect(state.companies.player.money).toBe(money - price + Math.round((cash * CONTROL_SHARES) / SHARES_OUTSTANDING));
    expect(state.companies.rival.money).toBe(0);
    expect(state.companies.rival.loan).toBe(0);
    expect(seen.some((e) => e.type === 'achievement' && e.id === 'baron_busted')).toBe(true);
    expect(state.news.some((n) => n.headline === 'SMOGSWORTH OUSTED!')).toBe(true);
    expect(checkInvariants(state)).toEqual([]);
  });

  it("the Baron's own holdings pass to the buyer and an open bid ends", () => {
    const ctx = rich();
    const { state } = ctx;
    openBid(ctx);
    expect(state.nemesis.bid).not.toBeNull();
    const his = holding(state, 'rival', 'player');
    state.companies.player.money = 1e10;
    must(buyShares(ctx, 'player', 'rival', CONTROL_SHARES));
    expect(state.companies.rival.active).toBe(false);
    expect(state.nemesis.bid).toBeNull();
    expect(state.exchange.listings.player.holders.player).toBe(400 + his);
    expect(state.exchange.listings.player.holders.rival).toBeUndefined();
    expect(checkInvariants(state)).toEqual([]);
  });

  it('the player crossing 510 of a regional firm absorbs it', () => {
    const ctx = withFirm();
    const { state } = ctx;
    state.companies.player.money = 1e9;
    const firm = state.companies.regional_1;
    const works = Object.values(state.buildings).filter((b) => b.ownerId === 'regional_1').map((b) => b.id);
    const trucks = Object.values(state.vehicles).filter((v) => v.ownerId === 'regional_1').map((v) => v.id);
    expect(works.length).toBeGreaterThan(0);
    must(buyShares(ctx, 'player', 'regional_1', CONTROL_SHARES));
    for (const id of works) expect(state.buildings[id].ownerId).toBe('player');
    for (const id of trucks) expect(state.vehicles[id].ownerId).toBe('player');
    expect(firm.active).toBe(false);
    expect(firm.money).toBe(0);
    expect(state.exchange.listings.regional_1.listed).toBe(false);
    expect(state.exchange.listings.regional_1.holders).toEqual({ public: SHARES_OUTSTANDING });
    expect(state.news.some((n) => n.headline === `${firm.name} absorbed`)).toBe(true);
    expect(state.flags.takeover).toBeUndefined();
    expect(checkInvariants(state)).toEqual([]);
    // the firm stays out of the regional system's hands
    expect(() => regionalMonth(ctx)).not.toThrow();
    for (const id of works) expect(state.buildings[id].ownerId).toBe('player');
  });

  it('the Baron crossing 510 of a regional firm absorbs it for himself', () => {
    const ctx = withFirm();
    const { state } = ctx;
    state.companies.rival.money = 1e9;
    const works = Object.values(state.buildings).filter((b) => b.ownerId === 'regional_1').map((b) => b.id);
    must(buyShares(ctx, 'rival', 'regional_1', CONTROL_SHARES));
    for (const id of works) expect(state.buildings[id].ownerId).toBe('rival');
    expect(state.companies.regional_1.active).toBe(false);
    expect(state.exchange.listings.regional_1.listed).toBe(false);
    expect(state.news.some((n) => n.headline === `${state.companies.regional_1.name} absorbed`)).toBe(true);
    expect(checkInvariants(state)).toEqual([]);
  });

  it("a regional firm's December dividend is paid pro rata to the player and the Baron", () => {
    const ctx = withFirm();
    const { state } = ctx;
    state.companies.player.money = 1e9;
    state.companies.rival.money = 1e9;
    must(buyShares(ctx, 'player', 'regional_1', 100));
    must(buyShares(ctx, 'rival', 'regional_1', 50));
    const firm = state.companies.regional_1;
    firm.money = 10_000_000;
    state.date = { year: 1905, month: 12, day: 30, hour: 23 };
    const p = state.companies.player.money;
    const b = state.companies.rival.money;
    const f = firm.money;
    regionalMonth(ctx);
    const paid = firm.ledger.at(-1)!.expense.dividends!;
    expect(paid).toBeGreaterThan(0);
    expect(state.companies.player.money - p).toBe(Math.round((paid * 100) / SHARES_OUTSTANDING));
    expect(state.companies.player.ledger.at(-1)!.income.dividends).toBe(Math.round((paid * 100) / SHARES_OUTSTANDING));
    expect(state.companies.rival.money - b).toBe(Math.round((paid * 50) / SHARES_OUTSTANDING));
    expect(f - firm.money).toBeGreaterThanOrEqual(paid);
  });
});

describe('hostile bids', () => {
  it("the Baron's bid opens a 6-month grace period, a warning card and a started event", () => {
    const ctx = rich();
    const { state } = ctx;
    const seen = events(ctx);
    must(buyShares(ctx, 'rival', 'player', CONTROL_SHARES - 10));
    expect(state.nemesis.bid).toBeNull();
    must(buyShares(ctx, 'rival', 'player', 10));
    const now = monthIndex(state.date);
    expect(state.nemesis.bid).toEqual({ since: now, deadline: now + BID_GRACE_MONTHS });
    expect(seen.filter((e) => e.type === 'hostileBid')).toEqual([{ type: 'hostileBid', stage: 'started' }]);
    expect(state.politics.cards.pending.map((p) => p.cardId)).toEqual([HOSTILE_BID_CARD_ID]);
    expect(CARDS_BY_ID[HOSTILE_BID_CARD_ID].trigger).toBe('bid');
    expect(HOSTILE_BID_CARD_ID).toBe('hostile_bid_warning');
    // more buying does not open a second bid
    must(buyShares(ctx, 'rival', 'player', 10));
    expect(seen.filter((e) => e.type === 'hostileBid')).toHaveLength(1);
    expect(state.politics.cards.pending).toHaveLength(1);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('the grace period survives serialize and load, and the deadline still falls', () => {
    const ctx = rich();
    openBid(ctx);
    monthEnd(ctx);
    const bid = ctx.state.nemesis.bid;
    const r = unpackState(serialize(ctx.state));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loaded: SimContext = { state: r.value, bus: new EventBus() };
    expect(loaded.state.nemesis.bid).toEqual(bid);
    expect(checkInvariants(loaded.state)).toEqual([]);
    const over: string[] = [];
    loaded.bus.on('gameOver', (e) => over.push(e.reason));
    while (monthIndex(loaded.state.date) < bid!.deadline) monthEnd(loaded);
    expect(over).toEqual([]);
    monthEnd(loaded);
    expect(over).toEqual([BARON_TAKES_YOU]);
  });

  it('buying back below 510 repels the bid and adds a grudge', () => {
    const ctx = rich();
    const { state } = ctx;
    openBid(ctx);
    const seen = events(ctx);
    const need = buyBackNeed(state);
    // whole lots of 10, just enough to bring him below 510
    expect(need).toBe(Math.ceil((holding(state, 'rival', 'player') - CONTROL_SHARES + 1) / 10) * 10);
    const baronCash = state.companies.rival.money;
    const total = buyBackQuote(state, need).total;
    must(buyBack(ctx));
    expect(holding(state, 'rival', 'player')).toBeLessThan(CONTROL_SHARES);
    // bought from the bidder, who is paid the buy-back price
    expect(state.companies.rival.money - baronCash).toBe(total);
    expect(state.nemesis.bid).toBeNull();
    expect(seen.filter((e) => e.type === 'hostileBid')).toEqual([{ type: 'hostileBid', stage: 'repelled' }]);
    expect(state.nemesis.grudges.some((g) => g.kind === 'takeover_bid')).toBe(true);
    // nothing falls due any more
    const over: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    for (let i = 0; i < 12; i++) monthEnd(ctx);
    expect(over).toEqual([]);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('not buying back ends the game at the deadline', () => {
    const ctx = rich();
    const { state } = ctx;
    openBid(ctx);
    const seen = events(ctx);
    for (let i = 0; i < BID_GRACE_MONTHS; i++) monthEnd(ctx);
    expect(seen.filter((e) => e.type === 'gameOver')).toEqual([]);
    monthEnd(ctx);
    expect(seen.filter((e) => e.type === 'gameOver')).toEqual([{ type: 'gameOver', reason: 'Smogsworth has taken your company' }]);
    expect(seen.filter((e) => e.type === 'hostileBid')).toEqual([{ type: 'hostileBid', stage: 'lost' }]);
    expect(state.speed).toBe(0);
  });

  it('the warning card buys back on credit when the player is short, at a quote shown on the card', () => {
    const ctx = rich(100_000, 1e9);
    const { state } = ctx;
    openBid(ctx);
    const need = buyBackNeed(state);
    const total = buyBackQuote(state, need).total;
    state.companies.player.money = Math.round(total / 2);
    const inst = state.politics.cards.pending[0];
    const card = CARDS_BY_ID[inst.cardId];
    const body = cardText(state, inst).body;
    expect(body).toContain(`${need} shares`);
    expect(body).toContain(`$${total.toLocaleString('en-US')}`);
    expect(body).toContain(`${BID_GRACE_MONTHS} months`);
    expect(card.choices[card.defaultChoice].cost).toBe(0);
    expect(card.choices[0].cost).toBe(0);
    must(resolveCard(ctx, inst.uid, 0));
    expect(state.companies.player.loan).toBeGreaterThan(0);
    expect(state.nemesis.bid).toBeNull();
    expect(holding(state, 'rival', 'player')).toBeLessThan(CONTROL_SHARES);
    expect(state.companies.player.money).toBeGreaterThanOrEqual(0);
  });

  it('the buy-back is priced at the fundamental: no sentiment, no price impact, no fee', () => {
    const ctx = rich(100_000, 1e9);
    const { state } = ctx;
    openBid(ctx);
    const l = state.exchange.listings.player;
    // his buying has driven the market price up; the buy-back ignores it
    l.sentiment = 1.6;
    const need = buyBackNeed(state);
    const fair = buyBackQuote(state, need);
    expect(fair.total).toBe(Math.round(l.fundamental * need));
    expect(fair.total).toBeLessThan(quote(state, 'player', 'player', need).total);
    expect(buyQuote(state, 'player', 'player', need)).toEqual(fair);
    // an ordinary trade keeps the market quote
    expect(buyQuote(state, 'player', 'rival', 10)).toEqual(quote(state, 'player', 'rival', 10));
    const money = state.companies.player.money;
    must(buyBack(ctx));
    expect(money - state.companies.player.money).toBe(fair.total);
    expect(l.sentiment).toBe(1.6);
  });

  /** A player with no cash and a maxed loan facing a bid whose buy-back costs far more than the loan limit. */
  function cornered(): SimContext {
    const ctx = rich(100_000, 1e10);
    const { state } = ctx;
    openBid(ctx);
    const p = state.companies.player;
    must(takeLoan(p, maxLoan(1), 1));
    p.money = 1_000;
    const l = state.exchange.listings.player;
    l.fundamental = 1_000_000;
    l.sentiment = 1.6;
    expect(buyBackQuote(state, buyBackNeed(state)).total).toBeGreaterThan(10 * maxLoan(1));
    return ctx;
  }

  it('a cornered player still repels the bid through the card, with an emergency bid loan above the limit', () => {
    const ctx = cornered();
    const { state } = ctx;
    const p = state.companies.player;
    const need = buyBackNeed(state);
    const total = buyBackQuote(state, need).total;
    const inst = state.politics.cards.pending[0];
    expect(cardText(state, inst).body).toContain(`$${total.toLocaleString('en-US')}`);
    const seen = events(ctx);
    must(resolveCard(ctx, inst.uid, 0));
    expect(seen.some((e) => e.type === 'hostileBid' && e.stage === 'repelled')).toBe(true);
    expect(state.nemesis.bid).toBeNull();
    expect(holding(state, 'rival', 'player')).toBeLessThan(CONTROL_SHARES);
    expect(p.loan).toBeGreaterThan(maxLoan(1));
    expect(p.bidLoan).toBe(p.loan - maxLoan(1));
    expect(p.money).toBeGreaterThanOrEqual(0);
    expect(state.politics.cards.pending).toEqual([]);
    expect(checkInvariants(state)).toEqual([]);
    // it survives save and load and is repaid like any loan, the bid loan first
    const r = unpackState(serialize(state));
    expect(r.ok && r.value.companies.player.bidLoan).toBe(p.bidLoan);
    p.money += p.loan;
    const bid = p.bidLoan!;
    must(repayLoan(p, loanStep(1), 1));
    expect(p.bidLoan).toBe(bid - loanStep(1));
    must(repayLoan(p, p.loan, 1));
    expect(p.bidLoan).toBeUndefined();
    expect(p.loan).toBe(0);
    expect(checkInvariants(state)).toEqual([]);
    // the normal limit still binds new borrowing while the bid loan is owed
    const again = cornered();
    must(buyBack(again));
    expect(takeLoan(again.state.companies.player, loanStep(1), 1).ok).toBe(false);
  });

  it('a cornered player still repels the bid through autoplayDefend', () => {
    const ctx = cornered();
    const seen = events(ctx);
    autoplayDefend(ctx);
    expect(seen.some((e) => e.type === 'hostileBid' && e.stage === 'repelled')).toBe(true);
    expect(ctx.state.nemesis.bid).toBeNull();
    expect(ctx.state.companies.player.bidLoan).toBeGreaterThan(0);
    for (let i = 0; i < BID_GRACE_MONTHS + 1; i++) monthEnd(ctx);
    expect(seen.some((e) => e.type === 'gameOver')).toBe(false);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('a buy-back made outside the card withdraws the warning card, leaving other cards alone', () => {
    const ctx = rich();
    const { state } = ctx;
    openBid(ctx);
    expect(forceCard(ctx, 'new_machine')).toBe(true);
    must(buyBack(ctx));
    expect(state.politics.cards.pending.map((p) => p.cardId)).toEqual(['new_machine']);
    expect(state.politics.cards.history.some((h) => h.id === HOSTILE_BID_CARD_ID)).toBe(false);
  });

  it('waiting (the default) leaves the grace period running, and the game ends at the deadline', () => {
    const ctx = rich();
    const { state } = ctx;
    openBid(ctx);
    const inst = state.politics.cards.pending[0];
    must(resolveCard(ctx, inst.uid, CARDS_BY_ID[inst.cardId].defaultChoice));
    expect(state.nemesis.bid).not.toBeNull();
    const over: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    for (let i = 0; i <= BID_GRACE_MONTHS; i++) monthEnd(ctx);
    expect(over).toEqual([BARON_TAKES_YOU]);
  });

  it('autoplayDefend repels an injected bid on seed 42', () => {
    const ctx: SimContext = { state: createGame({ seed: 42 }), bus: new EventBus() };
    must(runAutoplay(ctx));
    runDays(ctx, 360 * 3);
    const { state } = ctx;
    state.companies.rival.money += 1e8;
    openBid(ctx);
    const seen = events(ctx);
    for (let m = 0; m < BID_GRACE_MONTHS + 2; m++) {
      autoplayDefend(ctx);
      runDays(ctx, 30);
    }
    expect(seen.some((e) => e.type === 'hostileBid' && e.stage === 'repelled')).toBe(true);
    expect(seen.some((e) => e.type === 'gameOver')).toBe(false);
    expect(state.nemesis.bid).toBeNull();
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('hostile_bid retaliation', () => {
  it('needs him 1.5x richer than the player and the cash for 100 shares above his reserve', () => {
    const ctx = rich(100_000, 100_000);
    const { state } = ctx;
    addGrudge(state, 'takeover_bid', null);
    expect(eligibleKinds(ctx)).not.toContain('hostile_bid');
    state.companies.rival.money = 1e8;
    expect(eligibleKinds(ctx)).toContain('hostile_bid');
    const seen = events(ctx);
    const pub = holding(state, PUBLIC_HOLDER, 'player');
    expect(retaliate(ctx, 'hostile_bid')).toBe(true);
    expect(holding(state, 'rival', 'player')).toBe(100);
    expect(holding(state, PUBLIC_HOLDER, 'player')).toBe(pub - 100);
    expect(seen.some((e) => e.type === 'baronStrike' && e.kind === 'hostile_bid')).toBe(true);
    const news = state.news.filter((n) => n.tag === 'nemesis');
    expect(news).toHaveLength(1);
    expect(news[0].body).toContain('your bid for his company');
    expect(state.companies.rival.ledger.at(-1)!.expense.shares).toBeGreaterThan(0);
    expect(state.companies.rival.ledger.at(-1)!.expense.events ?? 0).toBe(0);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('buys fewer when fewer are on offer, none when none are, and none while a bid is open', () => {
    const ctx = rich(100_000, 1e9);
    const { state } = ctx;
    state.companies.player.money = 1e6;
    must(buyShares(ctx, 'player', 'player', 100));
    state.companies.player.money = 100_000;
    must(buyShares(ctx, 'rival', 'player', 460));
    addGrudge(state, 'takeover_bid', null);
    expect(retaliate(ctx, 'hostile_bid')).toBe(true);
    expect(holding(state, 'rival', 'player')).toBe(500);
    expect(holding(state, PUBLIC_HOLDER, 'player')).toBe(0);
    expect(state.nemesis.bid).toBeNull();
    expect(eligibleKinds(ctx)).not.toContain('hostile_bid');

    const other = rich(100_000, 1e9);
    openBid(other);
    addGrudge(other.state, 'takeover_bid', null);
    expect(eligibleKinds(other)).not.toContain('hostile_bid');
  });
});
