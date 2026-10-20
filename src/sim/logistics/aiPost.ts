import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import { buildingList } from '../spatial';
import type { Building, GameState, OwnerId } from '../types';
import { levelRate } from './levels';
import { managerAt, managerRate } from './managers';

/**
 * Where the AI posts a manager (spec sections 7.3 and 9). A leaf of logistics/ai.ts that
 * nemesis/retaliation.ts can import without pulling vehicles.ts into state.ts's import graph.
 */

export const isWorks = (b: Building): boolean => {
  const cat = BUILDINGS[b.typeId]?.category;
  return cat === 'extractor' || cat === 'factory';
};

/**
 * A works' output value per day at base prices: what it makes now at its level, manager and staffing,
 * as hubs.ts dailyOutput counts it (0 while it is stopped). It stands in for the month's output, which
 * growthMonth has cleared by the time the logistics month runs.
 */
export function outputValue(state: GameState, b: Building): number {
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  if (!recipe || !isWorks(b) || b.works || b.status === 'halted' || b.status === 'upgrading') return 0;
  const rate = (levelRate(b) * managerRate(state, b) * b.staffing) / recipe.days;
  let v = 0;
  for (const [g, n] of Object.entries(recipe.outputs)) v += n * rate * (GOODS[g]?.basePrice ?? 0);
  return v;
}

export const ownedBy = (state: GameState, owner: OwnerId): Building[] => buildingList(state).filter((b) => b.ownerId === owner);

/** `owner`'s works with no manager and the highest output value (ties to the lowest id), or null. */
export function busiestUnmannedWorks(state: GameState, owner: OwnerId): Building | null {
  let best: Building | null = null;
  let bestV = 0;
  for (const b of ownedBy(state, owner)) {
    if (!isWorks(b) || managerAt(state, b.id)) continue;
    const v = outputValue(state, b);
    if (v > bestV) (best = b), (bestV = v);
  }
  return best;
}

/** `owner`'s first hub (lowest id), or null. */
export const hubOf = (state: GameState, owner: OwnerId): Building | null => ownedBy(state, owner).find((b) => b.hub) ?? null;

/** Where a manager joining `owner` goes: its unmanned hub, else its busiest unmanned works, else nowhere (spec §7.3). */
export function aiPostFor(state: GameState, owner: OwnerId): number | null {
  const hub = hubOf(state, owner);
  if (hub && !managerAt(state, hub.id)) return hub.id;
  return busiestUnmannedWorks(state, owner)?.id ?? null;
}
