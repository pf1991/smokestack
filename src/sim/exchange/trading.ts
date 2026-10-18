/**
 * Phase 4 share trading (Task 8): buying and selling any listed company's shares, takeovers by share
 * majority and the player's buy-back against a hostile bid.
 *
 * - Shares trade in lots of TRADE_LOT. A buy takes them from the public, never from another holder,
 *   with one exception: while the Baron's hostile bid is open (nemesis/bid.ts), the player buying its
 *   own shares buys them back from the Baron at the fundamental (buyBackQuote: no sentiment, impact
 *   or fee); that is the only way his stake can fall, and it is always on offer, funded by an
 *   emergency bid loan if need be (buyBack). A sale goes to the public.
 * - Price impact: each IMPACT_BLOCK shares bought raise the price PRICE_IMPACT for the next ones
 *   (priced lot by lot), and selling lowers it the same way. The impact lands on the listing's
 *   sentiment through exchangeShock (same clamp), so the daily walk wears it off. A broker takes
 *   BROKER_FEE on each side, so a round trip loses a little.
 * - Money moves through spend and earn under 'shares', which stays out of operating profit.
 * - A buyer reaching CONTROL_SHARES of another company takes it: the player buying the Baron completes
 *   rival/takeover.ts `takeover` (the lot that reaches control needs CONTROL_WEALTH_RATIO × his wealth,
 *   takeoverRefusal); anyone buying a regional firm absorbs it (transferOwnership); the
 *   Baron reaching it of the player opens a hostile bid.
 *
 * No randomness. Holdings are written only through exchange/shares.ts moveShares.
 */
import { err, ok, type Result } from '../../core/result';
import { BARON_ID, PLAYER_ID, transferOwnership } from '../companies';
import { earn, loanStep, maxLoan, spend, takeBidLoan, takeLoan } from '../finance';
import { bidOpen, checkBid, dropBid, startBid } from '../nemesis/bid';
import { addGrudge } from '../nemesis/grudges';
import { publishNews } from '../news';
import { takeover } from '../rival/takeover';
import { priceIndex } from '../society/economy';
import type { GameState, OwnerId, SimContext } from '../types';
import { exchangeShock } from './prices';
import { delist, handOverHoldings, moveShares, windUp } from './shares';
import { netWorth, wealth } from '../state';
import { CONTROL_SHARES, CONTROL_WEALTH_RATIO, PUBLIC_HOLDER, SENTIMENT_MAX, SENTIMENT_MIN } from './types';

/** Shares trade in whole lots of this many. */
export const TRADE_LOT = 10;
/** Each block of this many shares moves the price by PRICE_IMPACT. */
export const IMPACT_BLOCK = 50;
export const PRICE_IMPACT = 1.02;
/** The broker's commission on each side of a trade. */
export const BROKER_FEE = 0.01;
export { CONTROL_SHARES, CONTROL_WEALTH_RATIO };

const clampSentiment = (s: number): number => (s < SENTIMENT_MIN ? SENTIMENT_MIN : s > SENTIMENT_MAX ? SENTIMENT_MAX : s);

/** How many shares of `target` `holder` holds (0 for an unknown listing). */
export function holding(state: GameState, holder: OwnerId, target: OwnerId): number {
  return state.exchange.listings[target]?.holders[holder] ?? 0;
}

/**
 * The gross value of `n` shares of `target` at the current fundamental (tradeFundamental) and sentiment, priced lot by
 * lot: a buy (dir 1) pays sentiment × PRICE_IMPACT^(shares before / IMPACT_BLOCK) for each lot, a sale
 * (dir -1) gets it at PRICE_IMPACT^-(shares after / IMPACT_BLOCK), so a buy and the same sale cost the
 * same before fees. Each lot's sentiment is clamped like exchangeShock's.
 */
function gross(state: GameState, target: OwnerId, n: number, dir: 1 | -1): number {
  const l = state.exchange.listings[target];
  if (!l || !(n > 0)) return 0;
  const f = tradeFundamental(state, target);
  let sum = 0;
  for (let done = 0; done < n; done += TRADE_LOT) {
    const lot = Math.min(TRADE_LOT, n - done);
    const at = dir > 0 ? done : -(done + lot);
    sum += lot * f * clampSentiment(l.sentiment * PRICE_IMPACT ** (at / IMPACT_BLOCK));
  }
  return sum;
}

/**
 * The fundamental a trade is priced at: the listing's monthly figure, floored at today's book value
 * per share (prices.ts applies the same floor monthly). The live floor keeps the books between two
 * monthly refreshes (cash that came in this month, or a save from before the floor) from selling a
 * company below what a takeover would pay out of it.
 */
function tradeFundamental(state: GameState, target: OwnerId): number {
  const l = state.exchange.listings[target];
  const book = state.companies[target] ? netWorth(state, target) / l.shares : 0;
  return Number.isFinite(book) && book > l.fundamental ? book : l.fundamental;
}

const perShare = (total: number, n: number): number => (n > 0 ? Math.round((total / n) * 100) / 100 : 0);

/**
 * What buying `n` shares of `target` costs now: `total` in whole dollars (price impact and the broker's
 * fee included) and its average `price` per share. The buyer does not change the price; it is part of
 * the interface so a quote reads like the trade it prices.
 */
export function quote(state: GameState, _buyer: OwnerId, target: OwnerId, n: number): { price: number; total: number } {
  const total = Math.round(gross(state, target, n, 1) * (1 + BROKER_FEE));
  return { price: perShare(total, n), total };
}

/** What selling `n` shares of `target` brings now, net of price impact and the broker's fee. */
export function sellQuote(state: GameState, _seller: OwnerId, target: OwnerId, n: number): { price: number; total: number } {
  const total = Math.round(gross(state, target, n, -1) * (1 - BROKER_FEE));
  return { price: perShare(total, n), total };
}

/** Why `trader` cannot trade `n` shares of `target` (null when the trade is well formed). */
function refusal(state: GameState, trader: OwnerId, target: OwnerId, n: number): string | null {
  if (!Number.isInteger(n) || n <= 0 || n % TRADE_LOT !== 0) return `Shares trade in lots of ${TRADE_LOT}`;
  const c = state.companies[trader];
  if (!c || !c.active) return 'No such company';
  const l = state.exchange.listings[target];
  const t = state.companies[target];
  if (!l || !t) return 'No such company';
  if (!l.listed || !t.active) return `${t.name} is not listed`;
  return null;
}

const dollars = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Why `buyer` may not buy `n` more shares of `target` under the takeover gate (null when it may): the
 * player's lot that would bring its holding of the Baron to CONTROL_SHARES or more needs the player's
 * wealth at least CONTROL_WEALTH_RATIO × his. Lots below control are always allowed, and regional
 * firms have no gate. The UI shows this text on the disabled Buy button.
 */
export function takeoverRefusal(state: GameState, buyer: OwnerId, target: OwnerId, n: number): string | null {
  if (buyer !== PLAYER_ID || target !== BARON_ID) return null;
  if (holding(state, buyer, target) + n < CONTROL_SHARES) return null;
  const mine = wealth(state, PLAYER_ID);
  const need = CONTROL_WEALTH_RATIO * wealth(state, BARON_ID);
  if (mine >= need) return null;
  return `Taking control of Smogsworth needs ${CONTROL_WEALTH_RATIO}× his wealth: ${dollars(need)} (you have ${dollars(mine)})`;
}

/**
 * Where `buyer`'s shares of `target` come from: the public, except that the player buying back its
 * own shares during the Baron's open bid buys them from him.
 */
export function sellerFor(state: GameState, buyer: OwnerId, target: OwnerId): OwnerId {
  if (buyer === PLAYER_ID && target === PLAYER_ID && bidOpen(state) && holding(state, BARON_ID, PLAYER_ID) > 0) return BARON_ID;
  return PUBLIC_HOLDER;
}

/**
 * The buy-back price during the Baron's open bid: the fundamental per share, with no sentiment, no
 * price impact and no broker's fee, so his own buying cannot price the player out of its company.
 */
export function buyBackQuote(state: GameState, n: number): { price: number; total: number } {
  const f = state.exchange.listings[PLAYER_ID]?.fundamental ?? 0;
  const total = n > 0 ? Math.round(f * n) : 0;
  return { price: perShare(total, n), total };
}

/** What `buyer` buying `n` shares of `target` costs now: the buy-back price from the bidder, else the market quote. */
export function buyQuote(state: GameState, buyer: OwnerId, target: OwnerId, n: number): { price: number; total: number } {
  return sellerFor(state, buyer, target) === BARON_ID ? buyBackQuote(state, n) : quote(state, buyer, target, n);
}

/** `buyer` buys `n` shares of `target` (its own included) at buyQuote. */
export function buyShares(ctx: SimContext, buyer: OwnerId, target: OwnerId, n: number): Result {
  const { state } = ctx;
  const bad = refusal(state, buyer, target, n);
  if (bad) return err(bad);
  const gate = takeoverRefusal(state, buyer, target, n);
  if (gate) return err(gate);
  const from = sellerFor(state, buyer, target);
  const have = holding(state, from, target);
  if (have < n) return err(have === 0 ? 'No shares on offer' : `Only ${have} shares on offer`);
  const { total } = buyQuote(state, buyer, target, n);
  const c = state.companies[buyer];
  if (c.money < total) return err('Not enough money');
  spend(c, 'shares', total, state.date);
  if (from !== PUBLIC_HOLDER) earn(state.companies[from], 'shares', total, state.date);
  moveShares(state, target, from, buyer, n);
  // a buy-back from the bidder is off the market: it does not move the price
  if (from === PUBLIC_HOLDER) exchangeShock(state, target, PRICE_IMPACT ** (n / IMPACT_BLOCK));
  // he notices who is buying into his company
  if (buyer === PLAYER_ID && target === BARON_ID) addGrudge(state, 'shares', null, n / 100);
  settle(ctx, buyer, target);
  return ok();
}

/** `seller` sells `n` of its shares of `target` (its own included) to the public at the quote. */
export function sellShares(ctx: SimContext, seller: OwnerId, target: OwnerId, n: number): Result {
  const { state } = ctx;
  const bad = refusal(state, seller, target, n);
  if (bad) return err(bad);
  const have = holding(state, seller, target);
  if (have < n) return err(`Only ${have} shares held`);
  const { total } = sellQuote(state, seller, target, n);
  moveShares(state, target, seller, PUBLIC_HOLDER, n);
  earn(state.companies[seller], 'shares', total, state.date);
  exchangeShock(state, target, PRICE_IMPACT ** (-n / IMPACT_BLOCK));
  if (target === PLAYER_ID) checkBid(ctx);
  return ok();
}

/** After a buy: a controlling stake takes the company (or opens a bid); a buy-back may end the bid. */
function settle(ctx: SimContext, buyer: OwnerId, target: OwnerId): void {
  const { state } = ctx;
  if (buyer === target) {
    if (target === PLAYER_ID) checkBid(ctx);
    return;
  }
  if (holding(state, buyer, target) < CONTROL_SHARES) return;
  if (target === PLAYER_ID) {
    if (buyer === BARON_ID) startBid(ctx);
  } else if (target === BARON_ID) {
    if (buyer === PLAYER_ID) {
      takeover(ctx);
      dropBid(ctx);
    }
  } else if (state.companies[target].kind === 'regional') {
    absorb(ctx, target, buyer);
  }
}

/**
 * `buyer` absorbs regional firm `target`: its treasury is wound up (shares.ts windUp: the buyer gets
 * its holding's share of the net cash and assumes any debts beyond it), its works, routes, vehicles
 * and roads (transferOwnership) and its share holdings pass to the buyer whole; the firm closes and
 * is delisted.
 */
function absorb(ctx: SimContext, target: OwnerId, buyer: OwnerId): void {
  const { state } = ctx;
  const firm = state.companies[target];
  const to = state.companies[buyer];
  windUp(state, target, buyer);
  transferOwnership(ctx, target, buyer);
  firm.active = false;
  handOverHoldings(state, target, buyer);
  delist(state, target);
  publishNews(ctx, 'market', `${firm.name} absorbed`, `${to.name} has bought a majority of ${firm.name} and takes over its works, its wagons and its debts.`);
}

/**
 * Pays a company's dividend `amount` (already spent from its treasury) to its shareholders pro rata:
 * each active company holding its shares, in listing key order, earns its part under 'dividends'. The
 * public's part and the company's own (treasury) part leave the economy.
 */
export function payDividend(state: GameState, id: OwnerId, amount: number): void {
  const l = state.exchange.listings[id];
  if (!l || !(amount > 0)) return;
  for (const holder in l.holders) {
    if (holder === id || holder === PUBLIC_HOLDER) continue;
    const c = state.companies[holder];
    if (!c || !c.active) continue;
    const part = Math.round((amount * l.holders[holder]) / l.shares);
    if (part > 0) earn(c, 'dividends', part, state.date);
  }
}

/** The shares the player must buy back to bring the Baron below CONTROL_SHARES (0 with no open bid). */
export function buyBackNeed(state: GameState): number {
  if (!bidOpen(state)) return 0;
  const his = holding(state, BARON_ID, PLAYER_ID);
  if (his < CONTROL_SHARES) return 0;
  return Math.ceil((his - CONTROL_SHARES + 1) / TRADE_LOT) * TRADE_LOT;
}

/**
 * Answers the Baron's bid, always (plan Review Focus 2): buys back buyBackNeed shares from him at
 * buyBackQuote. A shortfall is borrowed in loan steps, first within the loan limit (takeLoan), then
 * the rest as an emergency bid loan above it (takeBidLoan, drawn only here).
 */
export function buyBack(ctx: SimContext): Result {
  const { state } = ctx;
  const need = buyBackNeed(state);
  if (need === 0) return err('There is no bid to answer');
  const c = state.companies[PLAYER_ID];
  const { total } = buyBackQuote(state, need);
  if (total > c.money) {
    const index = priceIndex(state);
    const step = loanStep(index);
    const headroom = Math.max(0, Math.floor((maxLoan(index) - c.loan) / step) * step);
    const normal = Math.min(headroom, Math.ceil((total - c.money) / step) * step);
    if (normal > 0) {
      const r = takeLoan(c, normal, index);
      if (!r.ok) return r;
    }
    if (total > c.money) {
      const r = takeBidLoan(c, Math.ceil((total - c.money) / step) * step);
      if (!r.ok) return r;
    }
  }
  return buyShares(ctx, PLAYER_ID, PLAYER_ID, need);
}
