import { BUILDINGS } from '../data/buildings';
import { buildingStorage } from './logistics/levels';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import type { Building, GoodId, Inventory } from './types';

/** Stores, Trading Houses, warehouses and stations share one storage pool across goods; factories cap each input. */
function sharesStorage(b: Building): boolean {
  const cat = BUILDINGS[b.typeId]?.category;
  return cat === 'retail' || cat === 'trade' || cat === 'logistics';
}

/**
 * True when the building can take part in cargo routes at all. A storage-less depot (company
 * housing) takes no cargo: it is never a route stop and never a send target.
 */
export function handlesCargo(b: Building): boolean {
  const def = BUILDINGS[b.typeId];
  return def !== undefined && !(def.category === 'logistics' && def.storage <= 0);
}

/** The refusal for a building that `handlesCargo` rejects, e.g. "Company Housing takes no cargo". */
export function noCargoError(b: Building): string {
  return `${BUILDINGS[b.typeId]?.name ?? 'This building'} takes no cargo`;
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
      return good.kind === 'consumer';
    case 'trade':
      return good.kind === 'material' || good.kind === 'component';
    case 'logistics':
      return def.storage > 0;
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
  const cap = buildingStorage(b);
  let used = 0;
  if (sharesStorage(b)) {
    // the pool's total, summed in Object.values order without building the list
    for (const g in b.input) used += b.input[g];
  } else used = b.input[goodId] ?? 0;
  return Math.max(0, Math.floor(cap - used));
}

/** A store has something to sell: any good on its shelves. */
export function storeStocked(b: Building): boolean {
  return Object.values(loadSource(b)).some((q) => q > 0.5);
}
