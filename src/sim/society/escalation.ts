/**
 * Smog escalation per town (Phase 3 Task 3): tiers, the Black Lung ledger and protests.
 *
 * Monthly (`escalationMonth`), for every town:
 *  1. `smog.level ← 0.5 × level + 0.5 × pollution` (the 3-month EMA the tiers read; see ./tiers.ts
 *     for the calibration, ruling R-S2);
 *  2. the tier moves at most one step: up after SMOG_STREAK consecutive months with the level above
 *     the next tier's threshold, down after SMOG_STREAK consecutive months below SMOG_EXIT_SHARE of
 *     the current tier's threshold (`smog.months` is that streak, positive up and negative down);
 *  3. the effects of the tier now in force, each tier including the ones below it:
 *     1. reformers −0.3 × tier and workers −0.2 × tier a month in the town (not logged, ruling
 *        R-S4); one smog editorial a game year nationally, on the worst tier-1+ town (highest
 *        tier, then level, then lowest id), from the pollution warning HEADLINES;
 *     2. Black Lung: round(population × level × 0.004) deaths added to `smog.blackLung`; the growth
 *        penalty and the workforce health factor are read from ./tiers.ts by growthMonth and
 *        workforceMonth;
 *     3. protests: player polluters in the town's zone (siteCity) run at ×0.8 (`protestedBuildings`,
 *        read by productionDay); a 'protest' news item when the tier is entered;
 *     4. revolt: `smog_limit` and `permits_required` are in force whatever the mayor decreed
 *        (activeEdicts unions ./tiers.ts forcedEdicts; nothing is stored, so they lapse with the
 *        tier unless the mayor's own edicts hold them), and the reformers' election score is ×1.5.
 *
 * Ordering: run from the `pollution` system's onMonth, after pollutionMonth (systems.ts). That is
 * after upkeep's growthMonth (which reads last month's tier) and before the politics system, so
 * this month's tier already reaches workforceMonth and an election held this month.
 *
 * `city.smog` is written only here (and by the initialisers and the v6 migration).
 */
import { BUILDINGS } from '../../data/buildings';
import { PLAYER_ID } from '../companies';
import { publishNews } from '../news';
import { adjustOpinion } from '../politics/factions';
import { siteCity } from '../politics/mayorEdicts';
import { HEADLINES } from '../pollution';
import type { Building, City, GameState, SimContext, SmogTier } from '../types';
import {
  BLACK_LUNG_RATE,
  SMOG_EXIT_SHARE,
  SMOG_LEVEL_ALPHA,
  SMOG_REFORMERS_DRIFT,
  SMOG_STREAK,
  SMOG_TIER_THRESHOLDS,
  SMOG_WORKERS_DRIFT,
} from './tiers';

export * from './tiers';

/** Steps one town's level and tier for the month (no effects). Returns the tier before the step. */
export function stepSmogTier(city: City): SmogTier {
  const s = city.smog;
  const before = s.tier;
  s.level = (1 - SMOG_LEVEL_ALPHA) * s.level + SMOG_LEVEL_ALPHA * city.pollution;
  const up = s.tier < 4 ? SMOG_TIER_THRESHOLDS[s.tier + 1] : Infinity;
  const down = s.tier > 0 ? SMOG_TIER_THRESHOLDS[s.tier] * SMOG_EXIT_SHARE : -Infinity;
  if (s.level > up) s.months = Math.max(0, s.months) + 1;
  else if (s.level < down) s.months = Math.min(0, s.months) - 1;
  else s.months = 0;
  if (s.months >= SMOG_STREAK) {
    s.tier = (s.tier + 1) as SmogTier;
    s.months = 0;
  } else if (s.months <= -SMOG_STREAK) {
    s.tier = (s.tier - 1) as SmogTier;
    s.months = 0;
  }
  return before;
}

/** Black Lung deaths this month in a town at tier 2+: round(population × level × 0.004). */
export function blackLungDeaths(city: City): number {
  return city.smog.tier >= 2 ? Math.round(city.population * city.smog.level * BLACK_LUNG_RATE) : 0;
}

/** `state.flags` key holding the year of the last smog editorial (one a year nationally). */
export const SMOG_EDITORIAL_FLAG = 'smogEditorial';

/** Monthly escalation step for every town (see the module comment). */
export function escalationMonth(ctx: SimContext): void {
  const { state } = ctx;
  /** the worst town at tier 1+ this month: highest tier, then highest level, then lowest id */
  let worst: City | null = null;
  for (const city of state.cities) {
    const before = stepSmogTier(city);
    const s = city.smog;
    if (s.tier >= 1) {
      adjustOpinion(state, 'reformers', city.id, SMOG_REFORMERS_DRIFT * s.tier, 'Smog', { log: false });
      adjustOpinion(state, 'workers', city.id, SMOG_WORKERS_DRIFT * s.tier, 'Smog', { log: false });
      if (!worst || s.tier > worst.smog.tier || (s.tier === worst.smog.tier && s.level > worst.smog.level)) worst = city;
    }
    if (s.tier >= 2) s.blackLung += blackLungDeaths(city);
    if (s.tier >= 3 && before < 3) {
      publishNews(
        ctx,
        'protest',
        `MARCHERS FILL THE STREETS OF ${city.name.toUpperCase()}`,
        `Placards and coughing crowds gather outside the works around ${city.name}. Smokestacks in the town run slow while the protest lasts.`,
      );
    }
  }
  // one smog editorial a year nationally, on the worst town
  if (worst && state.flags[SMOG_EDITORIAL_FLAG] !== state.date.year) {
    state.flags[SMOG_EDITORIAL_FLAG] = state.date.year;
    const [headline, body] = HEADLINES[(worst.id + state.date.year) % HEADLINES.length](worst.name);
    publishNews(ctx, 'warning', headline, body);
  }
}

/** Total smog deaths across every town. */
export function nationalBlackLung(state: GameState): number {
  let n = 0;
  for (const c of state.cities) n += c.smog?.blackLung ?? 0;
  return n;
}

/** Whether a player building is held to PROTEST_FACTOR: it pollutes and its zone town is at tier 3+. */
function isProtested(state: GameState, b: Building): boolean {
  if (b.ownerId !== PLAYER_ID || !(BUILDINGS[b.typeId]?.pollution > 0)) return false;
  const city = siteCity(state, b.typeId, b.pos);
  return city !== null && city.smog.tier >= 3;
}

/** Ids of player polluters in the zone (siteCity) of a town at tier 3+: they run at PROTEST_FACTOR. */
export function protestedBuildings(state: GameState): Set<number> {
  const out = new Set<number>();
  if (!state.cities.some((c) => c.smog.tier >= 3)) return out;
  for (const b of Object.values(state.buildings)) if (isProtested(state, b)) out.add(b.id);
  return out;
}

/**
 * Where a tier-3+ town's marchers gather: the player's largest polluter in the town's zone (highest
 * `def.pollution`, then the larger footprint, then the lower id), or null when there is none.
 */
export function protestSite(state: GameState, city: City): Building | null {
  let best: Building | null = null;
  let bestKey = [-1, -1];
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== PLAYER_ID) continue;
    const def = BUILDINGS[b.typeId];
    if (!def || !(def.pollution > 0)) continue;
    if (siteCity(state, b.typeId, b.pos)?.id !== city.id) continue;
    const key = [def.pollution, def.size.w * def.size.h];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && best !== null && b.id < best.id)))) {
      best = b;
      bestKey = key;
    }
  }
  return best;
}
