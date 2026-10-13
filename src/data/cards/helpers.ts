/**
 * Small building blocks for card definitions: effect shorthands, conditions and the sim effects a
 * choice's `apply` may have (a demand modifier, a short halt, a news item). Opinion never moves here:
 * it goes in a choice's `effects`, through adjustOpinion. Everything is deterministic (no rng needed).
 */
import { BUILDINGS } from '../buildings';
import type { FactionId } from '../factions';
import type { LandmarkId } from '../landmarks';
import { addDays, compareDates } from '../../sim/clock';
import { PLAYER_ID } from '../../sim/companies';
import { pushModifier } from '../../sim/events';
import { NEAR_MARGIN } from '../../sim/politics/factions';
import { buildingsNear } from '../../sim/spatial';
import type { Building, GameState, GoodId, SimContext } from '../../sim/types';
import { cityOf, type CardEffect } from './types';

/** A city-scoped effect. */
export const city = (faction: FactionId, delta: number): CardEffect => ({ faction, scope: 'city', delta });
/** A national effect. */
export const nation = (faction: FactionId, delta: number): CardEffect => ({ faction, scope: 'national', delta });

export const DAYS_PER_MONTH = 30;

/** The player's factories near town `cityId` (urbanRadius + NEAR_MARGIN), nearest first, ties by id. */
export function worksNear(state: GameState, cityId: number | null): Building[] {
  const c = cityOf(state, cityId);
  if (!c) return [];
  const d = (b: Building) => {
    const size = BUILDINGS[b.typeId].size;
    return Math.hypot(b.pos.x + size.w / 2 - c.center.x, b.pos.y + size.h / 2 - c.center.y);
  };
  return buildingsNear(state, c.center, c.urbanRadius + NEAR_MARGIN, PLAYER_ID)
    .filter((b) => BUILDINGS[b.typeId].category === 'factory')
    .sort((a, b) => d(a) - d(b) || a.id - b.id);
}

export const hasWorksNear = (state: GameState, cityId: number | null) => worksNear(state, cityId).length > 0;
export const mayorIs = (faction: FactionId) => (state: GameState, cityId: number | null) => cityOf(state, cityId)?.politics.mayor.faction === faction;
export const hasLandmark = (id: LandmarkId) => (state: GameState, cityId: number | null) => cityOf(state, cityId)?.landmarks.some((l) => l.id === id) ?? false;
export const smoggy = (min: number) => (state: GameState, cityId: number | null) => (cityOf(state, cityId)?.pollution ?? 0) >= min;

/** Halts the player's factory nearest town `cityId` for `days` (never shortens a longer halt); nothing without one. */
export function haltNearestWorks(ctx: SimContext, cityId: number | null, days: number): void {
  const b = worksNear(ctx.state, cityId)[0];
  if (!b) return;
  const until = addDays(ctx.state.date, days);
  if (!b.haltedUntil || compareDates(until, b.haltedUntil) > 0) b.haltedUntil = until;
}

/** A demand modifier on `good` ('*': every good) in town `cityId` (null: everywhere) for `days`. */
export function demand(ctx: SimContext, tag: string, good: GoodId | '*', cityId: number | null, factor: number, days: number): void {
  pushModifier(ctx, `card_${tag}`, good, cityId, factor, days);
}
