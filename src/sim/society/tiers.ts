/**
 * Smog escalation tiers (Phase 3 Task 3): the constants and pure per-town effects. A leaf module
 * (types only) so workforce, elections, mayor edicts and growth can read a town's tier without an
 * import cycle; the monthly step lives in ./escalation.ts.
 *
 * Calibration (controller ruling R-S2): the Phase 3 smog field puts `city.pollution` on a much
 * smaller scale than the plan assumed. Autoplay towns average about 0.015–0.02 with summer peaks of
 * 0.13–0.16; ten steel mills beside a small town average 0.135 (peak 0.24); the monthly swing is
 * about 6×. Tiers therefore read `city.smog.level`, a 3-month EMA (α = 0.5 monthly) of the
 * pollution, against thresholds of 0.03 / 0.06 / 0.10 / 0.135 (the plan had 0.15 / 0.30 / 0.45 /
 * 0.60 on the raw figure; tier 4 was 0.16 until ruling R-S6 made the revolt tier reachable by a
 * heavy-industry town, pinned in heavy.test.ts). Black Lung is `round(population × level × 0.004)` a month (plan: 0.0004
 * on a 10× larger scale), and the workforce health factor reads `level × 5` clamped to [0, 1] in
 * place of the plan's pollution, so the effect sizes match the plan's intent.
 */
import type { City, CitySmog, SmogTier } from '../types';
import type { MayorEdictId } from '../politics/types';

/** Entry thresholds on `smog.level` (ruling R-S2; tier 4 per R-S6). */
export const SMOG_TIER_1 = 0.03;
export const SMOG_TIER_2 = 0.06;
export const SMOG_TIER_3 = 0.1;
export const SMOG_TIER_4 = 0.135;
/** Entry threshold of tiers 1..4 by tier (index 0 is tier 0: always 0). */
export const SMOG_TIER_THRESHOLDS: readonly number[] = [0, SMOG_TIER_1, SMOG_TIER_2, SMOG_TIER_3, SMOG_TIER_4];
/** Consecutive months above a threshold to enter its tier, or below EXIT_SHARE of it to leave. */
export const SMOG_STREAK = 3;
export const SMOG_EXIT_SHARE = 0.8;
/** Monthly EMA weight of the new pollution figure in `smog.level`. */
export const SMOG_LEVEL_ALPHA = 0.5;
/** Scale from `smog.level` to the plan's 0..1 pollution figure for the health factor. */
export const SMOG_HEALTH_SCALE = 5;
/** Tier 2: monthly growth-rate penalty. */
export const SMOG_GROWTH_PENALTY = 0.004;
/** Tier 2: Black Lung deaths per head per unit of level, per month. */
export const BLACK_LUNG_RATE = 0.004;
/**
 * Tier 1+: monthly ambient opinion drift in the town per tier (not logged), so tier 1 gives
 * −0.3 / −0.2 and tier 4 −1.2 / −0.8 (ruling R-S4: the plan's flat −1.5 / −1 pinned smoggy towns
 * at 0 against the drift back toward 50).
 */
export const SMOG_REFORMERS_DRIFT = -0.3;
export const SMOG_WORKERS_DRIFT = -0.2;
/** Tier 3: throughput of player polluters in the town's zone. */
export const PROTEST_FACTOR = 0.8;
/** Tier 4: the reformers' election score multiplier. */
export const REVOLT_REFORMER_VOTE = 1.5;
/** Tier 4: edicts the town imposes whatever its mayor decreed. */
export const REVOLT_EDICTS: readonly MayorEdictId[] = ['smog_limit', 'permits_required'];

export const SMOG_TIER_NAMES = ['Clean', 'Grumbling', 'Ailing', 'Protesting', 'Revolt'] as const;
export const SMOG_HINT = 'Scrubbers, parks or fewer smokestacks lower it';

export function smogTier(city: City): SmogTier {
  return city.smog?.tier ?? 0;
}

/** Tier 2+: 1 − 0.5 × clamp(level × 5, 0, 1); 1 below tier 2. Multiplies the town's labour pool. */
export function healthFactor(city: City): number {
  if (smogTier(city) < 2) return 1;
  const h = Math.min(1, Math.max(0, city.smog.level * SMOG_HEALTH_SCALE));
  return 1 - 0.5 * h;
}

/** Tier 2+: the growth-rate penalty (SMOG_GROWTH_PENALTY), else 0. */
export function growthPenalty(city: City): number {
  return smogTier(city) >= 2 ? SMOG_GROWTH_PENALTY : 0;
}

/** Tier 4: the edicts the town forces (REVOLT_EDICTS), else none. */
export function forcedEdicts(city: City): readonly MayorEdictId[] {
  return smogTier(city) >= 4 ? REVOLT_EDICTS : [];
}

/** A fresh smog record for a town whose current pollution is `pollution` (tier 0, no Black Lung). */
export function newCitySmog(pollution = 0): CitySmog {
  return { tier: 0, months: 0, blackLung: 0, level: pollution };
}
