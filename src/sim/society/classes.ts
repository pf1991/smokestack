/**
 * Social classes per town (Phase 3 Task 7): a working / middle / upper mix that shapes demand
 * (market.ts classDemandFactor, CLASS_DEMAND in data/goods.ts), votes (politics/elections.ts
 * factionWeights) and the house art (render/sprites.ts houseTier).
 *
 * Monthly (`classesMonth`), for every town, from its mean market satisfaction `s` (0..1, the same
 * figure growthMonth reads) and its smog `p`:
 *  - middle += 0.00015 × (1 + s), plus 0.0001 from 1945 (the post-war boom);
 *  - upper  += 0.00012 × s − 0.00025 × p (the rich flee smog);
 *  - working takes up the remainder;
 *  - clamps: working [0.2, 0.85], middle [0.1, 0.6], upper [0.03, 0.3] (see stepClasses).
 * Rates and clamps are controller ruling R-S9: the plan's (0.0004 / 0.0002 / 0.0001 / 0.0006,
 * every class in [0.05, 0.85]) saturated the middle class by 1985 and pinned the upper at its floor.
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

/** Per-class clamps (controller ruling R-S9). */
export const CLASS_CLAMPS: Readonly<Record<keyof CityClasses, readonly [number, number]>> = {
  working: [0.2, 0.85],
  middle: [0.1, 0.6],
  upper: [0.03, 0.3],
};
/** Monthly rates (ruling R-S9; the plan's 0.0004 / 0.0002 / 0.0001 / 0.0006 saturated the middle class and pinned the upper). */
export const MIDDLE_GROWTH = 0.00015;
export const POSTWAR_BOOM = 0.0001;
export const POSTWAR_YEAR = 1945;
export const UPPER_GROWTH = 0.00012;
export const UPPER_SMOG_FLIGHT = 0.00025;

/** A fresh copy of the initial mix (0.75 / 0.2 / 0.05). */
export function newCityClasses(): CityClasses {
  return { working: INITIAL_CLASSES.working, middle: INITIAL_CLASSES.middle, upper: INITIAL_CLASSES.upper };
}

const clampTo = (x: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, x));

/**
 * One month's step from mix `c` (pure): `sat` is the mean satisfaction 0..1, `smog` the 0..1 smog
 * figure (level × 5, clamped), `year` the game year. Middle and upper move and are clamped; working
 * takes the remainder. If that leaves working's clamp, working is pinned and the difference is taken
 * from (or given to) the middle class first, then the upper class, each within its own clamp, so the
 * mix always sums to 1 with every class inside its clamp.
 */
export function stepClasses(c: Readonly<CityClasses>, sat: number, smog: number, year: number): CityClasses {
  const M = CLASS_CLAMPS.middle, U = CLASS_CLAMPS.upper, W = CLASS_CLAMPS.working;
  let middle = clampTo(c.middle + MIDDLE_GROWTH * (1 + sat) + (year >= POSTWAR_YEAR ? POSTWAR_BOOM : 0), M);
  let upper = clampTo(c.upper + UPPER_GROWTH * sat - UPPER_SMOG_FLIGHT * smog, U);
  let working = 1 - middle - upper;
  if (working < W[0]) {
    // too few workers: take the excess from the middle class, then the upper
    let excess = W[0] - working;
    const fromMiddle = Math.min(excess, middle - M[0]);
    middle -= fromMiddle;
    excess -= fromMiddle;
    upper -= Math.min(excess, upper - U[0]);
    working = 1 - middle - upper;
  } else if (working > W[1]) {
    // too many workers: give the surplus to the middle class, then the upper
    let surplus = working - W[1];
    const toMiddle = Math.min(surplus, M[1] - middle);
    middle += toMiddle;
    surplus -= toMiddle;
    upper += Math.min(surplus, U[1] - upper);
    working = 1 - middle - upper;
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
  for (const k of ['working', 'middle', 'upper'] as const) {
    const v = c[k];
    const [lo, hi] = CLASS_CLAMPS[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo - 1e-9 || v > hi + 1e-9) return false;
  }
  return Math.abs(c.working + c.middle + c.upper - 1) < 1e-9;
}
