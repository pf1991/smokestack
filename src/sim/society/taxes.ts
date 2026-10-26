/**
 * Corporate sales tax (hubs-first / economy loop): a readable monthly levy on booked sales,
 * softened by friendly mayors and tax-break edicts, tugged by the soft business cycle.
 * Same rules for every company.
 */
import { companyIds } from '../companies';
import { currentLedger, spend } from '../finance';
import { hasEdict } from '../politics/mayorEdicts';
import { cyclePhase } from './economy';
import type { Company, CyclePhase, GameState, OwnerId, SimContext } from '../types';

/** National floor / ceiling for the sales-tax rate (opinion 100 → min, 0 → max). */
export const TAX_RATE_MIN = 0.03;
export const TAX_RATE_MAX = 0.07;
/** Rate when opinion is 50 and no tax break: midpoint of min/max. */
export const TAX_RATE_MID = (TAX_RATE_MIN + TAX_RATE_MAX) / 2;

/** Additive tug on the national rate by soft-cycle phase (clamped after). */
export const CYCLE_TAX_TUG: Record<CyclePhase, number> = {
  boom: -0.01,
  steady: 0,
  recession: 0.01,
};

/** One city's tax climate from its mayor's faction opinion and edicts. */
export function cityTaxRate(city: GameState['cities'][number]): number {
  const faction = city.politics.mayor.faction;
  const op = city.opinion[faction] ?? 50;
  // opinion 0 → MAX, 50 → MID, 100 → MIN
  let rate = TAX_RATE_MAX - (op / 100) * (TAX_RATE_MAX - TAX_RATE_MIN);
  if (hasEdict(city, 'tax_break')) rate = Math.min(rate, TAX_RATE_MIN);
  return Math.min(TAX_RATE_MAX, Math.max(TAX_RATE_MIN, rate));
}

/** Population-weighted climate before the soft-cycle tug (mid rate when there are no cities). */
export function baseNationalTaxRate(state: GameState): number {
  const cities = state.cities;
  if (cities.length === 0) return TAX_RATE_MID;
  let w = 0;
  let sum = 0;
  for (const c of cities) {
    const p = Math.max(1, c.population);
    sum += cityTaxRate(c) * p;
    w += p;
  }
  return sum / w;
}

/**
 * National sales-tax rate for this month: city climate + cycle tug, clamped to min/max.
 * Same number for every company.
 */
export function nationalTaxRate(state: GameState): number {
  const raw = baseNationalTaxRate(state) + CYCLE_TAX_TUG[cyclePhase(state.economy)];
  return Math.min(TAX_RATE_MAX, Math.max(TAX_RATE_MIN, raw));
}

/** This month's sales already booked for `owner` (whole dollars). */
export function monthSales(c: Company, date: GameState['date']): number {
  const m = currentLedger(c, date);
  return Math.floor(m.income.sales ?? 0);
}

/** Tax owed on this month's sales at `rate` (whole dollars; 0 under $1). */
export function taxOnSales(sales: number, rate: number): number {
  if (sales <= 0 || rate <= 0) return 0;
  return Math.floor(sales * rate);
}

/**
 * Monthly: every active company pays sales tax on this month's booked sales under ledger `taxes`.
 * Runs late in the month so daily sales are already on the ledger.
 */
export function taxesMonth(ctx: SimContext): void {
  const { state } = ctx;
  const rate = nationalTaxRate(state);
  for (const id of companyIds(state)) {
    const c = state.companies[id];
    if (!c?.active) continue;
    const sales = monthSales(c, state.date);
    const due = taxOnSales(sales, rate);
    if (due <= 0) continue;
    spend(c, 'taxes', due, state.date);
  }
}

/** Short tip for UI: e.g. "Sales tax 5.2% (national)" or "... (national, recession)". */
export function taxRateLabel(state: GameState): string {
  const pct = (nationalTaxRate(state) * 100).toFixed(1);
  const phase = cyclePhase(state.economy);
  const tag = phase === 'steady' ? 'national' : `national, ${phase}`;
  return `Sales tax ${pct}% (${tag})`;
}

/** Test helper: tax for one owner at the current national rate. */
export function taxDueFor(state: GameState, owner: OwnerId): number {
  const c = state.companies[owner];
  if (!c) return 0;
  return taxOnSales(monthSales(c, state.date), nationalTaxRate(state));
}
