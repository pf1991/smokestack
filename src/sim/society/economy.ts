/**
 * Inflation (Phase 3 Task 8). `state.economy.priceIndex` starts at 1 in 1900 and compounds each
 * month at its decade's annual rate (DECADE_INFLATION, ruling R-S12: verbatim, about 17.6 by 2000).
 * Every price and cost in the game is its 1900 catalogue figure × the index, for every company
 * alike: sale prices, construction, maintenance, vehicles, tolls, fines, upgrades, philanthropy,
 * slush, contract rewards, refunds and asset values. Loans are scaled when taken (loanStep/maxLoan)
 * and the balance owed stays nominal. STARTING_MONEY is for new games only (index 1).
 *
 * An old save loaded in a late year starts at index 1 (its past inflation is unknown).
 */
import type { EconomyState, GameState, SimContext } from '../types';

/** Annual inflation rate by decade start (ruling R-S12: verbatim). */
export const DECADE_INFLATION: Record<number, number> = {
  1900: 0.01,
  1910: 0.05,
  1920: -0.01,
  1930: -0.02,
  1940: 0.05,
  1950: 0.025,
  1960: 0.03,
  1970: 0.08,
  1980: 0.05,
  1990: 0.03,
};

/** Months of index history kept (the finance panel's 10-year sparkline). */
export const ECONOMY_HISTORY_MONTHS = 120;

export function defaultEconomy(): EconomyState {
  return { priceIndex: 1, history: [] };
}

/** The annual rate for `year`: its decade's, held at the table's ends outside 1900-1999. */
export function inflationRate(year: number): number {
  const decade = Math.min(1990, Math.max(1900, Math.floor(year / 10) * 10));
  return DECADE_INFLATION[decade] ?? 0;
}

export function priceIndex(state: GameState): number {
  return state.economy.priceIndex;
}

/** `amount` 1900 dollars in today's prices (unrounded). */
export function atPrices(state: GameState, amount: number): number {
  return amount * state.economy.priceIndex;
}

/** Monthly: the index grows by (1 + rate)^(1/12) for the month that is ending; history keeps 10 years. */
export function economyMonth(ctx: SimContext): void {
  const e = ctx.state.economy;
  e.priceIndex *= Math.pow(1 + inflationRate(ctx.state.date.year), 1 / 12);
  e.history.push(e.priceIndex);
  if (e.history.length > ECONOMY_HISTORY_MONTHS) e.history.splice(0, e.history.length - ECONOMY_HISTORY_MONTHS);
}
