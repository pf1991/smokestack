import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import type { Building, GoodId, Inventory } from './types';

/** Stores, warehouses and stations share one storage pool across goods; factories cap each input. */
function sharesStorage(b: Building): boolean {
  const cat = BUILDINGS[b.typeId]?.category;
  return cat === 'retail' || cat === 'logistics';
}

export function acceptsGood(b: Building, goodId: GoodId): boolean {
  const good = GOODS[goodId];
  const def = BUILDINGS[b.typeId];
  if (!good || !def) return false;
  switch (def.category) {
    case 'factory': {
      const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
      return recipe !== undefined && goodId in recipe.inputs;
    }
    case 'retail':
      return good.tier === 2;
    case 'logistics':
      return true;
    case 'extractor':
      return false;
  }
}

/** The inventory a vehicle loads from. */
export function loadSource(b: Building): Inventory {
  return sharesStorage(b) ? b.input : b.output;
}

/** Units of `goodId` this building can still receive into `input`. */
export function storageLeft(b: Building, goodId: GoodId): number {
  if (!acceptsGood(b, goodId)) return 0;
  const cap = BUILDINGS[b.typeId].storage;
  const used = sharesStorage(b)
    ? Object.values(b.input).reduce((sum, q) => sum + q, 0)
    : (b.input[goodId] ?? 0);
  return Math.max(0, Math.floor(cap - used));
}
