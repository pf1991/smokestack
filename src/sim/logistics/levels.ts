import { BUILDINGS } from '../../data/buildings';
import { WAREHOUSE_LEVELS, WORKS_LEVELS, type LevelDef } from '../../data/levels';
import { err, ok, type Result } from '../../core/result';
import { dateToDays } from '../clock';
import { canAfford, spend } from '../finance';
import { atPrices } from '../society/economy';
import { markRenewed } from '../society/aging';
import { buildingList } from '../spatial';
import type { Building, GameState, OwnerId, SimContext } from '../types';

/**
 * Effective level-scaled values. Every reader of a placed building's storage, workers, rate, upkeep,
 * smoke or hub range goes through here, never through BUILDINGS[t].storage or .workers directly.
 * Each is the catalogue value times the level factor, and times 1 when the building has no table.
 */

/** The level row of `b`: the works table for extractors and factories, the warehouse table for a warehouse, else null. */
export function levelDef(b: Building): LevelDef | null {
  if (b.typeId === 'warehouse') return WAREHOUSE_LEVELS[b.level - 1] ?? null;
  const cat = BUILDINGS[b.typeId]?.category;
  if (cat === 'extractor' || cat === 'factory') return WORKS_LEVELS[b.level - 1] ?? null;
  return null;
}

export function buildingStorage(b: Building): number {
  return Math.round(BUILDINGS[b.typeId].storage * (levelDef(b)?.storage ?? 1));
}

export function buildingWorkers(b: Building): number {
  // rounded to 1e-6 so 60 x 1.6 is 96, not 96.00000000000001
  return Math.round(BUILDINGS[b.typeId].workers * (levelDef(b)?.workers ?? 1) * 1e6) / 1e6;
}

export function levelRate(b: Building): number {
  return levelDef(b)?.rate ?? 1;
}

export function levelUpkeep(b: Building): number {
  return levelDef(b)?.upkeep ?? 1;
}

export function levelSmoke(b: Building): number {
  return levelDef(b)?.smoke ?? 1;
}

/** Hub range in tiles; 0 for anything but a warehouse. */
export function hubRange(b: Building): number {
  return b.typeId === 'warehouse' ? (levelDef(b)?.range ?? 0) : 0;
}

// ---------------------------------------------------------------------------
// upgrades and works (Phase 4b spec section 4)

/** The level table `b` climbs, or null when its type has none. */
function levelTable(b: Building): readonly LevelDef[] | null {
  if (b.typeId === 'warehouse') return WAREHOUSE_LEVELS;
  const cat = BUILDINGS[b.typeId]?.category;
  return cat === 'extractor' || cat === 'factory' ? WORKS_LEVELS : null;
}

/** The next level's row, or null at the top (or for a type with no levels). */
export function nextLevel(b: Building): LevelDef | null {
  return levelTable(b)?.[b.level] ?? null;
}

/** Price of the next level: its share of the catalogue cost at today's prices, rounded. 0 at the top. */
export function upgradeCost(state: GameState, b: Building): number {
  const next = nextLevel(b);
  return next ? Math.round(atPrices(state, BUILDINGS[b.typeId].cost * next.costShare)) : 0;
}

/** Why `owner` cannot start an upgrade of `b` now, or null. */
export function upgradeRefusal(state: GameState, b: Building, owner?: OwnerId): string | null {
  if (owner !== undefined && b.ownerId !== owner) return 'Not your building';
  if (!levelTable(b)) return 'This building has no levels';
  const next = nextLevel(b);
  if (!next) return 'Already at the top level';
  if (b.works) return 'Works already under way';
  if (state.date.year < next.year) return `Level ${next.level} arrives in ${next.year}`;
  if (!canAfford(state.companies[b.ownerId], upgradeCost(state, b))) return 'Not enough money';
  return null;
}

/** Charges the upgrade ('construction') and starts the works: output stops until `days` have passed. */
export function startUpgrade(ctx: SimContext, buildingId: number, owner?: OwnerId): Result<{ cost: number; days: number }> {
  const { state } = ctx;
  const b = state.buildings[buildingId];
  if (!b) return err('No such building');
  const why = upgradeRefusal(state, b, owner);
  if (why) return err(why);
  const next = nextLevel(b)!;
  const cost = upgradeCost(state, b);
  const today = dateToDays(state.date);
  spend(state.companies[b.ownerId], 'construction', cost, state.date);
  b.works = { toLevel: next.level, startDay: today, untilDay: today + next.days };
  b.status = 'upgrading';
  const upgrades = state.logistics.stats.upgrades;
  upgrades[b.ownerId] = (upgrades[b.ownerId] ?? 0) + 1;
  return ok({ cost, days: next.days });
}

/**
 * Finishes the works that are due, in id order: the level rises, the building is renewed (age resets) and
 * `buildingUpgraded` is emitted. It runs after productionDay on the date's boundary, so the works end on
 * the boundary that carries the date to `untilDay`: exactly `days` production days are lost.
 */
export function worksDay(ctx: SimContext): void {
  const { state } = ctx;
  const today = dateToDays(state.date);
  for (const b of buildingList(state)) {
    const w = b.works;
    if (!w || today + 1 < w.untilDay) continue;
    b.level = w.toLevel;
    delete b.works;
    if (b.hub) b.hub.maxTrucks = levelDef(b)?.hubTrucks ?? 0; // the hub cap follows the level table
    markRenewed(state, b);
    b.status = 'idle';
    ctx.bus.emit({ type: 'buildingUpgraded', buildingId: b.id, level: b.level, ownerId: b.ownerId });
  }
}
