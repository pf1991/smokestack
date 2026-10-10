import { BUILDINGS } from '../data/buildings';
import { RECIPES } from '../data/recipes';
import { acceptsGood, loadSource } from '../sim/inventory';
import type { Building, GameState, GoodId, RouteStop } from '../sim/types';

/** Goods a building hands to trucks: its recipe outputs, or whatever a warehouse/station holds. */
function offered(b: Building): GoodId[] {
  const def = BUILDINGS[b.typeId];
  if (!def) return [];
  if (def.category === 'retail') return [];
  if (def.category === 'logistics') return Object.keys(loadSource(b));
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  return recipe ? Object.keys(recipe.outputs) : [];
}

/**
 * Temporary stop suggestion for the Task 18 debug route tool and autoplay (Task 20 replaces it with
 * `suggestStop`): each stop loads what it offers that another stop accepts, and unloads what another
 * stop loads that it accepts.
 */
export function suggestStops(state: GameState, buildingIds: number[]): RouteStop[] {
  const bs = buildingIds.map((id) => state.buildings[id]).filter((b): b is Building => b !== undefined);
  const loads = bs.map((b, i) => offered(b).filter((g) => bs.some((o, j) => j !== i && acceptsGood(o, g))));
  return bs.map((b, i) => ({
    buildingId: b.id,
    load: loads[i],
    unload: [...new Set(loads.flatMap((l, j) => (j === i ? [] : l)))].filter((g) => acceptsGood(b, g)),
  }));
}
