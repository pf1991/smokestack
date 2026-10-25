/**
 * Inflation (Phase 3 Task 8) plus a soft business cycle (demand boom / recession).
 * `state.economy.priceIndex` starts at 1 in 1900 and compounds each month at its decade's annual
 * rate (DECADE_INFLATION, ruling R-S12: verbatim, about 17.6 by 2000). Every price and cost in the
 * game is its 1900 catalogue figure × the index, for every company alike.
 *
 * The cycle multiplies national demand (see cycleDemandFactor) and is telegraphed in the paper.
 * An old save loaded in a late year starts at index 1 (its past inflation is unknown); missing
 * cycle fields are filled on the first economyMonth.
 */
import type { CyclePhase, EconomyState, GameState, SimContext } from '../types';

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

/** How long each soft-cycle phase lasts (months). */
export const CYCLE_MONTHS: Record<CyclePhase, number> = {
  boom: 18,
  steady: 24,
  recession: 18,
};

/** National demand multiplier while the phase holds. */
export const CYCLE_DEMAND: Record<CyclePhase, number> = {
  boom: 1.12,
  steady: 1,
  recession: 0.88,
};

/** A fresh economy at `index` (1 for a game starting in 1900; see indexAtYear for later starts). */
export function defaultEconomy(index = 1): EconomyState {
  return {
    priceIndex: index,
    history: [],
    cycle: 'steady',
    cycleLeft: CYCLE_MONTHS.steady,
    /** after the opening steady, the first swing is a boom */
    cycleFlip: 'boom',
  };
}

/**
 * The index on 1 January of `year`, compounded from 1900 exactly as economyMonth would have
 * (twelve monthly steps of (1 + rate)^(1/12) make a year's 1 + rate). About 1.10 in 1910.
 */
export function indexAtYear(year: number): number {
  let p = 1;
  for (let y = 1900; y < year; y++) p *= 1 + inflationRate(y);
  return p;
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

/** `nominal` dollars today in 1900 dollars (nominal / price index): ruling R-S14's real money. */
export function realMoney(state: GameState, nominal: number): number {
  return nominal / state.economy.priceIndex;
}

/** Fills cycle fields on old saves that only had priceIndex + history. */
export function ensureCycle(e: EconomyState): void {
  if (e.cycle !== undefined && e.cycleLeft !== undefined && e.cycleFlip !== undefined) return;
  e.cycle = e.cycle ?? 'steady';
  e.cycleLeft = e.cycleLeft ?? CYCLE_MONTHS[e.cycle];
  e.cycleFlip = e.cycleFlip ?? 'boom';
}

export function cyclePhase(e: EconomyState): CyclePhase {
  ensureCycle(e);
  return e.cycle!;
}

/** National demand multiplier for the current soft cycle (1 when steady / missing). */
export function cycleDemandFactor(e: EconomyState): number {
  return CYCLE_DEMAND[cyclePhase(e)];
}

export function cycleLabel(phase: CyclePhase): string {
  if (phase === 'boom') return 'Boom';
  if (phase === 'recession') return 'Recession';
  return 'Steady times';
}

/** Advances the soft cycle one month; returns the new phase when it just flipped, else null. */
export function advanceCycle(e: EconomyState): CyclePhase | null {
  ensureCycle(e);
  e.cycleLeft! -= 1;
  if (e.cycleLeft! > 0) return null;
  if (e.cycle === 'steady') {
    e.cycle = e.cycleFlip!;
    e.cycleFlip = e.cycleFlip === 'boom' ? 'recession' : 'boom';
  } else {
    e.cycle = 'steady';
  }
  e.cycleLeft = CYCLE_MONTHS[e.cycle!];
  return e.cycle!;
}

/**
 * Monthly: the index grows by (1 + rate)^(1/12) for the month that is ending; history keeps 10 years;
 * cycle ticks. Returns the phase when it just flipped (including into steady), else null — systems.ts
 * telegraphs boom/recession so this module stays free of news/state cycles.
 */
export function economyMonth(ctx: SimContext): CyclePhase | null {
  const e = ctx.state.economy;
  e.priceIndex *= Math.pow(1 + inflationRate(ctx.state.date.year), 1 / 12);
  e.history.push(e.priceIndex);
  if (e.history.length > ECONOMY_HISTORY_MONTHS) e.history.splice(0, e.history.length - ECONOMY_HISTORY_MONTHS);
  return advanceCycle(e);
}
