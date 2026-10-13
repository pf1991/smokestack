/**
 * Social classes per town (Phase 3 Task 7): a working / middle / upper mix that shapes demand
 * (market.ts classDemandFactor, CLASS_DEMAND in data/goods.ts), votes (politics/elections.ts
 * factionWeights) and the house art (render/sprites.ts houseTier).
 *
 * Monthly (`classesMonth`), for every town, from its mean market satisfaction `s` (0..1, the same
 * figure growthMonth reads) and its smog `p`:
 *  - middle += 0.0004 × (1 + s), plus 0.0002 after 1945 (the post-war boom);
 *  - upper  += 0.0001 × s − 0.0006 × p (the rich flee smog);
 *  - working takes up the remainder;
 *  - each class is clamped to [0.05, 0.85] and the mix renormalised to sum to 1.
 *
 * Smog scale (controller ruling R-S2): the brief's "pollution" is the plan's 0..1 figure; the
 * Phase 3 field is about 10× smaller, so `p` is `city.smog.level × 5` clamped to [0, 1]
 * (SMOG_HEALTH_SCALE, as the workforce health factor reads it).
 *
 * Ordering: run from the `pollution` system's onMonth right after escalationMonth (systems.ts):
 * after upkeep's growthMonth and pollutionMonth (so the month's satisfaction and smog level are
 * final) and before the politics system, so an election held this month votes with this month's
 * mix. Demand reads the new mix from the next day on.
 *
 * `city.classes` is written only here (and by the initialisers and the v6 migration).
 */
import { averageSatisfaction, INITIAL_CLASSES } from '../market';
import type { CityClasses, SimContext } from '../types';
import { SMOG_HEALTH_SCALE } from './tiers';

export { classDemandFactor, INITIAL_CLASSES } from '../market';

export const CLASS_MIN = 0.05;
export const CLASS_MAX = 0.85;
export const MIDDLE_GROWTH = 0.0004;
export const POSTWAR_BOOM = 0.0002;
export const POSTWAR_YEAR = 1945;
export const UPPER_GROWTH = 0.0001;
export const UPPER_SMOG_FLIGHT = 0.0006;

/** A fresh copy of the initial mix (0.75 / 0.2 / 0.05). */
export function newCityClasses(): CityClasses {
  return { working: INITIAL_CLASSES.working, middle: INITIAL_CLASSES.middle, upper: INITIAL_CLASSES.upper };
}

const clamp = (x: number): number => Math.min(CLASS_MAX, Math.max(CLASS_MIN, x));

/**
 * One month's step from mix `c` (pure): `sat` is the mean satisfaction 0..1, `smog` the 0..1 smog
 * figure (level × 5, clamped), `year` the game year.
 */
export function stepClasses(c: Readonly<CityClasses>, sat: number, smog: number, year: number): CityClasses {
  let middle = clamp(c.middle + MIDDLE_GROWTH * (1 + sat) + (year > POSTWAR_YEAR ? POSTWAR_BOOM : 0));
  let upper = clamp(c.upper + UPPER_GROWTH * sat - UPPER_SMOG_FLIGHT * smog);
  let working = 1 - middle - upper;
  // middle and upper are within the clamps, so they sum to 0.1..1.7; when the remainder leaves its
  // clamp, pin it and rescale the other two to the rest (they stay within theirs: see the test)
  if (working < CLASS_MIN || working > CLASS_MAX) {
    working = clamp(working);
    const k = (1 - working) / (middle + upper);
    middle *= k;
    upper *= k;
  }
  return { working, middle, upper };
}

/** The monthly class shift of every town (see the module comment). */
export function classesMonth(ctx: SimContext): void {
  const { state } = ctx;
  const year = state.date.year;
  for (const city of state.cities) {
    const sat = Math.min(1, Math.max(0, averageSatisfaction(state, city)));
    const smog = Math.min(1, Math.max(0, (city.smog?.level ?? 0) * SMOG_HEALTH_SCALE));
    city.classes = stepClasses(city.classes ?? newCityClasses(), sat, smog, year);
  }
}

/** True when `c` sums to 1 (1e-9) with each class within its clamps (invariants). */
export function classesValid(c: CityClasses | undefined): boolean {
  if (!c) return false;
  const vals = [c.working, c.middle, c.upper];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= CLASS_MIN - 1e-9 && v <= CLASS_MAX + 1e-9)) return false;
  return Math.abs(vals[0] + vals[1] + vals[2] - 1) < 1e-9;
}
