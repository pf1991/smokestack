/**
 * Smoke abatement a works can buy (Phase 3 Task 6): scrubbers in three tiers and a tall chimney.
 *
 * - A scrubber tier multiplies the works' daily emission (`emissionFactor` in pollution.ts) and its
 *   maintenance. A new tier replaces the one fitted; tiers only go up. Its price is a share of the
 *   building's catalogue cost, times the price index.
 * - A tall chimney puts the smoke down the wind instead of on the works (see smogDay).
 *
 * Upgrades are not placements: town permits (`permits_required`) never apply to them.
 */
import { err, ok, type Result } from '../../core/result';
import { BUILDINGS } from '../../data/buildings';
import { levelUpkeep } from '../logistics/levels';
import { PLAYER_ID } from '../companies';
import { canAfford, spend } from '../finance';
import type { Building, GameState, SimContext } from '../types';
import { assetUpkeep } from './aging';
import { atPrices, priceIndex } from './economy';
import { scrubberTier } from './lawState';

export type ScrubberTier = 1 | 2 | 3;

export interface ScrubberTierDef {
  tier: ScrubberTier;
  /** first year it can be fitted */
  year: number;
  /** multiplier on the works' emission */
  emission: number;
  /** price as a share of the building's catalogue cost (times the price index) */
  cost: number;
  /** multiplier on the works' maintenance (the part above ×1 scales with the price index) */
  upkeep: number;
}

/** Index tier − 1. The years come before the smoke laws that demand each tier (1908 / 1950 / 1988). */
export const SCRUBBER_TIERS: readonly ScrubberTierDef[] = [
  { tier: 1, year: 1905, emission: 0.7, cost: 0.3, upkeep: 1.1 },
  { tier: 2, year: 1948, emission: 0.45, cost: 0.5, upkeep: 1.2 },
  { tier: 3, year: 1985, emission: 0.2, cost: 0.8, upkeep: 1.3 },
];

/** Tall chimney: first year, price as a share of the catalogue cost, and its advection share. */
export const TALL_CHIMNEY_YEAR = 1900;
export const TALL_CHIMNEY_COST = 0.2;
/** Share of a tall chimney's smoke carried one tile further (it lands 2 and 3 tiles downwind). */
export const TALL_CHIMNEY_ADVECT = 0.4;
/** Tiles downwind the tall chimney's plume comes down. */
export const TALL_CHIMNEY_REACH = 2;

/** Tree planting: price per grass tile, times the price index. */
export const TREE_COST = 300;

export type UpgradeKind = 'scrubber' | 'tallChimney';

export function hasTallChimney(b: Building): boolean {
  return b.upgrades?.tallChimney === true;
}

/** Emission multiplier of the fitted scrubber (1 when none). */
export function scrubberEmission(b: Building): number {
  const t = scrubberTier(b);
  return t > 0 ? SCRUBBER_TIERS[t - 1].emission : 1;
}

/**
 * Maintenance multiplier of the fitted scrubber (×1 when none). Applied on top of the indexed
 * maintenance (buildingMaintenance), so it follows prices without being scaled twice (Task 8,
 * superseding ruling R-S8's 1 + (upkeep − 1) × priceIndex).
 */
export function scrubberUpkeepFactor(b: Building): number {
  const t = scrubberTier(b);
  return t > 0 ? SCRUBBER_TIERS[t - 1].upkeep : 1;
}

/**
 * Monthly maintenance of building `b` before company edicts: catalogue maintenance at today's prices
 * × its age factor (society/aging.ts) × scrubber upkeep.
 */
export function buildingMaintenance(state: GameState, b: Building): number {
  return atPrices(state, BUILDINGS[b.typeId].maintenance) * assetUpkeep(state, b) * scrubberUpkeepFactor(b) * levelUpkeep(b);
}

/** True for works that make smoke (only these can be fitted). */
export function canAbate(b: Building): boolean {
  return (BUILDINGS[b.typeId]?.pollution ?? 0) > 0;
}

/** Price of the next upgrade of `kind` (scrubber: the next tier), rounded. */
export function upgradeCost(state: GameState, b: Building, kind: UpgradeKind): number {
  const def = BUILDINGS[b.typeId];
  const share = kind === 'tallChimney' ? TALL_CHIMNEY_COST : SCRUBBER_TIERS[Math.min(scrubberTier(b), 2)].cost;
  return Math.round(def.cost * share * priceIndex(state));
}

/** The next scrubber tier on offer, or null at tier 3. */
export function nextScrubber(b: Building): ScrubberTierDef | null {
  const t = scrubberTier(b);
  return t < 3 ? SCRUBBER_TIERS[t] : null;
}

/** Why the upgrade cannot be bought now (owner, kind, era, already fitted, money), or null when it can. */
export function upgradeRefusal(state: GameState, b: Building, kind: UpgradeKind): string | null {
  if (b.ownerId !== PLAYER_ID) return 'Not your building';
  if (!canAbate(b)) return 'This works makes no smoke';
  const year = state.date.year;
  if (kind === 'tallChimney') {
    if (hasTallChimney(b)) return 'Tall chimney already built';
    if (year < TALL_CHIMNEY_YEAR) return `Available from ${TALL_CHIMNEY_YEAR}`;
  } else {
    const next = nextScrubber(b);
    if (!next) return 'Best scrubber already fitted';
    if (year < next.year) return `Tier ${next.tier} scrubbers arrive in ${next.year}`;
  }
  if (!canAfford(state.companies[PLAYER_ID], upgradeCost(state, b, kind))) return 'Not enough money';
  return null;
}

/**
 * Buys the next scrubber tier or a tall chimney for the player's works `buildingId`, booked as
 * 'construction'. Refuses another company's building, a works without smoke, a tier not yet
 * invented, a tier that does not go up, and an empty purse.
 */
export function buyUpgrade(ctx: SimContext, buildingId: number, kind: UpgradeKind): Result {
  const { state } = ctx;
  const b = state.buildings[buildingId];
  if (!b) return err('No such building');
  const refusal = upgradeRefusal(state, b, kind);
  if (refusal) return err(refusal);
  const cost = upgradeCost(state, b, kind);
  spend(state.companies[PLAYER_ID], 'construction', cost, state.date);
  const up = b.upgrades ?? { scrubber: 0, tallChimney: false };
  if (kind === 'tallChimney') up.tallChimney = true;
  else up.scrubber = (up.scrubber + 1) as 1 | 2 | 3;
  b.upgrades = up;
  return ok();
}
