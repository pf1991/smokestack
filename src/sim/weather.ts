/**
 * Daily weather (Phase 3): the wind that carries smog and the rain that washes it out. Runs at the
 * start of the pollution system's day, before smogDay (sim/pollution.ts). The only writer of
 * `state.weather` besides game creation and the v6 migration.
 */
import { chance, random } from './rng';
import type { SimContext, Weather } from './types';

/** Daily wind jitter, per component, around the prevailing wind. */
export const WIND_JITTER = 0.35;

/** Daily rain chance by month (index 0 = January): wet winters, dry summers. */
export const RAIN_CHANCE: readonly number[] = [0.35, 0.32, 0.28, 0.24, 0.2, 0.17, 0.15, 0.15, 0.2, 0.26, 0.3, 0.35];

/**
 * The season's wind (+x blows east, +y blows south): westerlies March–August, a north-westerly
 * September–November, northerlies December–February.
 */
export function prevailingWind(month: number): { x: number; y: number } {
  if (month >= 3 && month <= 8) return { x: 1, y: -0.2 };
  if (month >= 9 && month <= 11) return { x: 0.6, y: 0.6 };
  return { x: 0.2, y: 1 };
}

/** Calm, dry weather blowing the prevailing wind of `month`: new games and migrated saves. */
export function defaultWeather(month: number): Weather {
  const w = prevailingWind(month);
  return { windX: w.x, windY: w.y, rain: false, rainDays: 0 };
}

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Rolls today's weather: prevailing wind plus a ±0.35 jitter per component, and the month's rain chance. */
export function weatherDay(ctx: SimContext): void {
  const { state } = ctx;
  const month = state.date.month;
  const p = prevailingWind(month);
  const w = state.weather;
  w.windX = clamp1(p.x + (random(state) * 2 - 1) * WIND_JITTER);
  w.windY = clamp1(p.y + (random(state) * 2 - 1) * WIND_JITTER);
  w.rain = chance(state, RAIN_CHANCE[(month - 1 + 12) % 12]);
  w.rainDays = w.rain ? w.rainDays + 1 : 0;
}
