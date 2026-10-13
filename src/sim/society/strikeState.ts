/**
 * Strike state (Phase 3 Task 4): the leaf half of strikes.ts, imported by production (the slowdown
 * and the halt) and by the strike cards' `apply` hooks (data/cards/helpers.ts). It imports no card
 * code, so the card tables can use it without an import cycle.
 *
 * A strike lives on its building (`Building.strike`), so demolishing the building removes it with
 * nothing left behind. Each strike is bound to the strike card it opened by the card's uid
 * (`strike.cardUid`); the card's `apply` receives its instance and acts only on that strike
 * (`strikeTarget`). A strike that ends on its own withdraws its card (strikes.ts `strikeOver`).
 */
import { BUILDINGS } from '../../data/buildings';
import { PLAYER_ID } from '../companies';
import { workCity } from '../politics/workforce';
import type { Building, BuildingStrike, GameState } from '../types';

/** Below this `opinion.workers`, the player's works staffed from the town go slow. */
export const SLOWDOWN_OPINION = 30;
/** Production rate of a works on a go-slow. */
export const SLOWDOWN_FACTOR = 0.9;
/** Below this `opinion.workers`, the town's works may strike (sim/society/strikes.ts). */
export const STRIKE_OPINION = 25;
/** Hard cap on a strike's length, in days from its start. */
export const STRIKE_MAX_DAYS = 120;

/** The day (dateToDays) the strike is over: its `until`, never later than STRIKE_MAX_DAYS after it began. */
export function strikeEnd(s: BuildingStrike): number {
  return Math.min(s.until, s.since + STRIKE_MAX_DAYS);
}

/** True while the strike is on, on day `today` (dateToDays). */
export function strikeActive(s: BuildingStrike | null | undefined, today: number): boolean {
  return !!s && today < strikeEnd(s);
}

/** Player factories and extractors: the works that go slow and strike. */
export function isWorks(b: Building): boolean {
  if (b.ownerId !== PLAYER_ID) return false;
  const cat = BUILDINGS[b.typeId]?.category;
  return cat === 'factory' || cat === 'extractor';
}

/** The player's works staffed from a town whose workers' opinion is below SLOWDOWN_OPINION. */
export function slowedBuildings(state: GameState): Set<number> {
  const out = new Set<number>();
  if (!state.cities.some((c) => c.opinion.workers < SLOWDOWN_OPINION)) return out;
  for (const b of Object.values(state.buildings)) {
    if (!isWorks(b)) continue;
    const city = workCity(state, b);
    if (city && city.opinion.workers < SLOWDOWN_OPINION) out.add(b.id);
  }
  return out;
}

/** The building whose strike is bound to pending strike card `uid` (null: none, e.g. demolished or already over). */
export function strikeTarget(state: GameState, uid: number | null | undefined): Building | null {
  if (uid === null || uid === undefined) return null;
  for (const b of Object.values(state.buildings)) if (b.strike && b.strike.cardUid === uid) return b;
  return null;
}

/** Concede: the strike bound to card `uid` ends now. */
export function concedeStrike(state: GameState, uid: number | null | undefined): void {
  const b = strikeTarget(state, uid);
  if (b) b.strike = null;
}

/** Wait it out: the strike bound to card `uid` goes on; its card is answered. */
export function waitOutStrike(state: GameState, uid: number | null | undefined): void {
  const b = strikeTarget(state, uid);
  if (b?.strike) b.strike.cardUid = null;
}

/** Break it: the strike bound to card `uid` ends within `days` (never later than it would have). */
export function breakStrike(state: GameState, uid: number | null | undefined, today: number, days: number): void {
  const b = strikeTarget(state, uid);
  if (!b?.strike) return;
  b.strike.until = Math.min(b.strike.until, today + days);
  b.strike.cardUid = null;
}
