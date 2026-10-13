/**
 * Strike state (Phase 3 Task 4): the leaf half of strikes.ts, imported by production (the slowdown
 * and the halt) and by the strike cards' `apply` hooks (data/cards/helpers.ts). It imports no card
 * code, so the card tables can use it without an import cycle.
 *
 * A strike lives on its building (`Building.strike`), so demolishing the building removes it with
 * nothing left behind. A strike card instance stores only its town, so the card's `apply` finds its
 * building with `strikeTarget`: the town's oldest strike whose card is still open (`open`), ties to
 * the lower building id.
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

/** The building a strike card in town `cityId` acts on: the oldest strike there with its card open. */
export function strikeTarget(state: GameState, cityId: number | null): Building | null {
  if (cityId === null) return null;
  let best: Building | null = null;
  for (const b of Object.values(state.buildings)) {
    const s = b.strike;
    if (!s || !s.open || s.cityId !== cityId) continue;
    if (!best || s.since < best.strike!.since || (s.since === best.strike!.since && b.id < best.id)) best = b;
  }
  return best;
}

/** Concede: the strike ends now. */
export function concedeStrike(state: GameState, cityId: number | null): void {
  const b = strikeTarget(state, cityId);
  if (b) b.strike = null;
}

/** Wait it out: the strike goes on; its card is answered. */
export function waitOutStrike(state: GameState, cityId: number | null): void {
  const b = strikeTarget(state, cityId);
  if (b?.strike) b.strike.open = false;
}

/** Break it: the strike ends within `days` (never later than it would have). */
export function breakStrike(state: GameState, cityId: number | null, today: number, days: number): void {
  const b = strikeTarget(state, cityId);
  if (!b?.strike) return;
  b.strike.until = Math.min(b.strike.until, today + days);
  b.strike.open = false;
}
