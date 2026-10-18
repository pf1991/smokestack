/**
 * Phase 4 stock exchange types: one listing per company, its holdings and its daily price. Plain JSON
 * stored on `GameState.exchange`. Holdings are written only by exchange/shares.ts (moveShares).
 */
import type { OwnerId } from '../types';

/** Every company issues this many shares. */
export const SHARES_OUTSTANDING = 1000;
/** The founding family's (treasury) holding at listing; the rest goes to the public. */
export const FOUNDER_SHARES = 400;
/** The holder id for shares in the hands of the public. */
export const PUBLIC_HOLDER: OwnerId = 'public';
/** Bounds of the sentiment multiplier. */
export const SENTIMENT_MIN = 0.4;
export const SENTIMENT_MAX = 1.6;
/** Month-end prices kept in a listing's history. */
export const PRICE_HISTORY_MONTHS = 120;

export interface Listing {
  /** SHARES_OUTSTANDING */
  shares: number;
  /** includes PUBLIC_HOLDER; sums to `shares` */
  holders: Record<OwnerId, number>;
  /** per share, nominal $, > 0 */
  price: number;
  /** the monthly anchor (exchange/prices.ts fundamental) */
  fundamental: number;
  /** multiplier, in [SENTIMENT_MIN, SENTIMENT_MAX] */
  sentiment: number;
  /** month-end prices, last PRICE_HISTORY_MONTHS, oldest first */
  history: number[];
  /** false once delisted (taken over or closed): the price is frozen */
  listed: boolean;
}

export interface ExchangeState {
  /** keyed by company id, in companyIds order (exchange/shares.ts listCompany keeps it so) */
  listings: Record<OwnerId, Listing>;
  /**
   * The exchange's own rng stream (sim/rng.ts mulberry32 state; `random(state.exchange)`), so share
   * price noise never draws from the game's rng and never changes the game's course.
   */
  rngState: number;
}

/** Mixed into the game seed to start the exchange's rng stream. */
const EXCHANGE_SEED_SALT = 0x5eed_c0de;

/** An empty exchange whose rng stream is seeded from the game seed. */
export function defaultExchange(seed: number): ExchangeState {
  return { listings: {}, rngState: (seed ^ EXCHANGE_SEED_SALT) | 0 };
}
