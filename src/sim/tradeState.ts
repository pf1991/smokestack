/**
 * The national market's state and constants (R4, sim/trade.ts). A leaf module: state.ts, the
 * migrations and the invariants build and check the slice without importing the trade system.
 */
import type { TradeState } from './types';

/** The national price is this share of the base price before drift and saturation. */
export const TRADE_FACTOR = 0.8;
/** Width of a day's random drift step. */
export const DRIFT_STEP = 0.06;
/** Daily pull of the drift factor back toward 1. */
export const DRIFT_PULL = 0.05;
export const FACTOR_MIN = 0.75;
export const FACTOR_MAX = 1.25;
/** Dollars of 1900 base value of a good the nation absorbs in 30 days before the price sags. */
export const ABSORB_VALUE = 30_000;
/** Saturation never cuts the price below this share. */
export const SATURATION_FLOOR = 0.5;
/** Units a fully staffed Trading House sells a day. */
export const TRADE_DAILY_UNITS = 40;

const TRADE_SEED_SALT = 0x54524144; // "TRAD"

/** Fresh national market: no drift yet, nothing sold. */
export function newTrade(seed: number): TradeState {
  return { rngState: (seed ^ TRADE_SEED_SALT) | 0, factor: {}, sold30: {} };
}
