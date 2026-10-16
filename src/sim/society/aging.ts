/**
 * Aging assets (Phase 3 Task 8). Buildings and vehicles record `builtYear`. Past AGING_GRACE years,
 * an asset's efficiency (production rate, vehicle speed) falls 1% a year to a floor of 70%, and its
 * upkeep rises 2% a year to a cap of ×1.8. Renewing a building (RENEW_SHARE of today's build price)
 * or replacing a vehicle (sell and rebuy at today's price) makes it new again.
 */
import type { Result } from '../../core/result';
import { err, ok } from '../../core/result';
import { BUILDINGS } from '../../data/buildings';
import { canAfford, spend } from '../finance';
import type { Building, GameState, OwnerId, SimContext, Vehicle } from '../types';
import { atPrices } from './economy';

export const AGING_GRACE = 15;
export const AGING_EFFICIENCY_LOSS = 0.01;
export const AGING_EFFICIENCY_FLOOR = 0.7;
export const AGING_UPKEEP_GAIN = 0.02;
export const AGING_UPKEEP_CAP = 1.8;
/** Refusal for renewing or replacing an asset still inside AGING_GRACE: it would buy nothing. */
export const NO_WEAR = `No wear yet: assets start to age after ${AGING_GRACE} years`;
/** Renewal price as a share of today's build price. */
export const RENEW_SHARE = 0.4;

/** max(0.7, 1 − 0.01 × (age − 15)) after 15 years, else 1. */
export function agingEfficiency(age: number): number {
  return age <= AGING_GRACE ? 1 : Math.max(AGING_EFFICIENCY_FLOOR, 1 - AGING_EFFICIENCY_LOSS * (age - AGING_GRACE));
}

/** min(1.8, 1 + 0.02 × (age − 15)) after 15 years, else 1. */
export function agingUpkeep(age: number): number {
  return age <= AGING_GRACE ? 1 : Math.min(AGING_UPKEEP_CAP, 1 + AGING_UPKEEP_GAIN * (age - AGING_GRACE));
}

/** Whole years since the asset was built or renewed (0 when it has no `builtYear`). */
export function assetAge(state: GameState, asset: Pick<Building | Vehicle, 'builtYear'>): number {
  return Math.max(0, state.date.year - (asset.builtYear ?? state.date.year));
}

export function assetEfficiency(state: GameState, asset: Pick<Building | Vehicle, 'builtYear'>): number {
  return agingEfficiency(assetAge(state, asset));
}

export function assetUpkeep(state: GameState, asset: Pick<Building | Vehicle, 'builtYear'>): number {
  return agingUpkeep(assetAge(state, asset));
}

/** Price of renewing `b`: RENEW_SHARE of its catalogue cost at today's prices, rounded. */
export function renewCost(state: GameState, b: Building): number {
  return Math.round(atPrices(state, BUILDINGS[b.typeId].cost) * RENEW_SHARE);
}

/** Why `b` cannot be renewed by `owner` now, or null. */
export function renewRefusal(state: GameState, b: Building, owner?: OwnerId): string | null {
  if (owner !== undefined && b.ownerId !== owner) return 'Not your building';
  if (assetAge(state, b) <= AGING_GRACE) return NO_WEAR;
  if (!canAfford(state.companies[b.ownerId], renewCost(state, b))) return 'Not enough money';
  return null;
}

/** Overhauls building `id`: pays renewCost under 'construction' and sets `builtYear` to this year. */
export function renewBuilding(ctx: SimContext, id: number, owner?: OwnerId): Result<{ cost: number }> {
  const { state } = ctx;
  const b = state.buildings[id];
  if (!b) return err('No such building');
  const why = renewRefusal(state, b, owner);
  if (why) return err(why);
  const cost = renewCost(state, b);
  spend(state.companies[b.ownerId], 'construction', cost, state.date);
  b.builtYear = state.date.year;
  return ok({ cost });
}
