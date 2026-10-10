import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { advanceHour, TICKS_PER_DAY } from './clock';
import { FINANCE_SYSTEM_ID, SYSTEMS } from './systems';
import type { GameState, SimContext } from './types';

export const SAVE_VERSION = 1;
const END_YEAR = 2001;

/**
 * Advances the simulation by one tick (one game hour). Exact order:
 *  1. `state.tick += 1`, then every system's `onTick` (the date is still the hour being simulated).
 *  2. If this hour is the last of a day/month/year, the ending period's hooks run while `state.date`
 *     is still inside it, so their ledger entries land in that period:
 *       a. `onDay` of every system (day 1's production/retail run at the first boundary, after 24 ticks);
 *       b. at month end, `onMonth` of every system, `finance` always last, then `monthEnd{date}` with
 *          the last hour of the month (e.g. 30 Jan 1900, 23:00);
 *       c. at year end, `onYear` of every system, then `yearEnd{year}` with the ending year.
 *  3. `state.date` advances; on a new day `dayStart{date}` is emitted with the new day's date.
 *  4. Reaching 1 Jan 2001 emits `victory{reason:'The century is over'}` and sets speed 0.
 */
export function stepTick(ctx: SimContext): void {
  const { state, bus } = ctx;
  state.tick += 1;
  for (const s of SYSTEMS) s.onTick?.(ctx);

  const next = advanceHour(state.date);
  if (next.newDay) for (const s of SYSTEMS) s.onDay?.(ctx);
  if (next.newMonth) {
    for (const s of SYSTEMS) if (s.id !== FINANCE_SYSTEM_ID) s.onMonth?.(ctx);
    for (const s of SYSTEMS) if (s.id === FINANCE_SYSTEM_ID) s.onMonth?.(ctx);
    bus.emit({ type: 'monthEnd', date: { ...state.date } });
  }
  if (next.newYear) {
    for (const s of SYSTEMS) s.onYear?.(ctx);
    bus.emit({ type: 'yearEnd', year: state.date.year });
  }

  state.date = next.date;
  if (next.newDay) bus.emit({ type: 'dayStart', date: { ...state.date } });
  if (next.newYear && state.date.year === END_YEAR) {
    bus.emit({ type: 'victory', reason: 'The century is over' });
    state.speed = 0;
  }
}

export function runTicks(ctx: SimContext, n: number): void {
  for (let i = 0; i < n; i++) stepTick(ctx);
}

export function runDays(ctx: SimContext, n: number): void {
  runTicks(ctx, n * TICKS_PER_DAY);
}

// ---------------------------------------------------------------------------
// saves

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

function isComplete(o: Record<string, unknown>): boolean {
  const { map, companies, date } = o;
  if (!isObject(map) || !Array.isArray(map.tiles) || !isNum(map.width) || !isNum(map.height)) return false;
  if (!isObject(companies) || !isObject(companies.player)) return false;
  if (!isObject(date) || !isNum(date.year) || !isNum(date.month) || !isNum(date.day) || !isNum(date.hour)) return false;
  if (!isObject(o.buildings) || !isObject(o.vehicles) || !isObject(o.routes)) return false;
  return Array.isArray(o.cities);
}

/** Parses and validates a save. Never throws; failures carry a message the UI can show as-is. */
export function deserialize(json: string): Result<GameState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return err('Save file is corrupted');
  }
  if (!isObject(parsed)) return err('Save file is corrupted');
  if (parsed.version !== SAVE_VERSION) return err('Save from an incompatible version');
  if (!isComplete(parsed)) return err('Save file is incomplete');
  return ok(parsed as unknown as GameState);
}
