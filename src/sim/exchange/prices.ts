/**
 * Phase 4 share prices: a monthly fundamental from the books, a daily random-walk sentiment that
 * reverts to 1, and news shocks. Delisted listings are frozen: no draw, no refresh.
 */
import { monthProfit } from '../finance';
import { random } from '../rng';
import { atPrices } from '../society/economy';
import { assetValues, netWorth } from '../state';
import type { GameState, OwnerId, SimContext } from '../types';
import { PRICE_HISTORY_MONTHS, SENTIMENT_MAX, SENTIMENT_MIN, SHARES_OUTSTANDING, type Listing } from './types';

/** The least fundamental per share, in 1900 dollars. */
export const PRICE_FLOOR = 20;
/** Trailing-12-month profit counts this many times in the fundamental (a price/earnings multiple). */
export const EARNINGS_MULTIPLE = 8;
/** Daily sentiment step: × exp(DAILY_VOLATILITY × u), u uniform in [-1, 1). */
const DAILY_VOLATILITY = 0.02;
/** Daily pull of sentiment back towards 1. */
const MEAN_REVERSION = 0.01;
const TRAILING_MONTHS = 12;

const clampSentiment = (s: number): number => (s < SENTIMENT_MIN ? SENTIMENT_MIN : s > SENTIMENT_MAX ? SENTIMENT_MAX : s);

/** Rounded to the cent, never below one cent. */
const round2 = (x: number): number => Math.max(0.01, Math.round(x * 100) / 100);

/**
 * Per share: max(PRICE_FLOOR at today's prices, book net worth / shares, (net worth +
 * EARNINGS_MULTIPLE × trailing-12-month profit) / shares). The book term keeps trailing losses from
 * pricing a company below what its books (its cash among them) are worth. Dividends are not part of
 * profit (finance.ts monthProfit). Finite and > 0 whatever the books say: negative net worth, losses
 * or a non-finite figure give the floor.
 * `assets`, when given, is state.ts assetValues (so a monthly pass values every company at once).
 */
export function fundamental(state: GameState, id: OwnerId, assets?: Map<OwnerId, number>): number {
  const floor = atPrices(state, PRICE_FLOOR);
  const c = state.companies[id];
  const l = state.exchange.listings[id];
  if (!c) return floor;
  let profit = 0;
  const from = Math.max(0, c.ledger.length - TRAILING_MONTHS);
  for (let i = from; i < c.ledger.length; i++) profit += monthProfit(c.ledger[i]);
  const book = netWorth(state, id, assets);
  const shares = l?.shares ?? SHARES_OUTSTANDING;
  const v = Math.max(book, book + EARNINGS_MULTIPLE * profit) / shares;
  return Number.isFinite(v) && v > floor ? v : floor;
}

/** The listing's price from its fundamental and sentiment. */
export function listingPrice(l: Listing): number {
  return round2(l.fundamental * l.sentiment);
}

/**
 * Daily: each listed company's sentiment takes a random step, reverts 1% towards 1 and is clamped;
 * the price follows. Iterates the listings in key order, which listCompany keeps in companyIds
 * order (no allocation per day); delisted listings draw nothing. Draws only from the exchange's own
 * rng stream, never the game's.
 */
export function exchangeDay(ctx: SimContext): void {
  const { state } = ctx;
  const listings = state.exchange.listings;
  for (const id in listings) {
    const l = listings[id];
    if (!l.listed) continue;
    let s = l.sentiment * Math.exp(DAILY_VOLATILITY * (random(state.exchange) - 0.5) * 2);
    s += MEAN_REVERSION * (1 - s);
    l.sentiment = clampSentiment(s);
    l.price = listingPrice(l);
  }
}

/** Monthly: refreshes each listed company's fundamental and price and records the month-end price. */
export function exchangeMonth(ctx: SimContext): void {
  const { state } = ctx;
  const listings = state.exchange.listings;
  const assets = assetValues(state);
  for (const id in listings) {
    const l = listings[id];
    if (!l.listed) continue;
    l.fundamental = fundamental(state, id, assets);
    l.price = listingPrice(l);
    l.history.push(l.price);
    if (l.history.length > PRICE_HISTORY_MONTHS) l.history.splice(0, l.history.length - PRICE_HISTORY_MONTHS);
  }
}

/** A news shock: multiplies the sentiment of `id` (or of every listed company for '*'), clamped. */
export function exchangeShock(state: GameState, id: OwnerId | '*', factor: number): void {
  const listings = state.exchange.listings;
  for (const k in listings) {
    if (id !== '*' && k !== id) continue;
    const l = listings[k];
    if (!l.listed) continue;
    const s = l.sentiment * factor;
    l.sentiment = Number.isFinite(s) ? clampSentiment(s) : l.sentiment;
    l.price = listingPrice(l);
  }
}
