/**
 * Static economics of a production chain (used by the balance tests and `scripts/chain-report.ts`).
 *
 * The chain is balanced around ONE manufacturing building running flat out: every upstream building is
 * counted fractionally, as the share of its capacity the manufacturer consumes ("full utilisation":
 * with whole buildings you would build several manufacturers per refinery and get the same ratios).
 * Fixed costs that do not scale are charged whole: one store, and one truck per leg.
 */
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES, recipeEra, type RecipeDef } from '../data/recipes';
import { TRUCK } from './vehicles';
import type { BuildingTypeId, GoodId } from './types';

/** Average yearly yield of a seasonal farm crop: Dec–Feb ×0, Jul–Sep ×1.5, rest ×1. */
export const SEASONAL_FARM_FACTOR = (3 * 0 + 3 * 1.5 + 6 * 1) / 12;
const SEASONAL: GoodId[] = ['grain', 'cotton', 'fruit'];
const DAYS_PER_MONTH = 30;

export interface ChainReport {
  goodId: GoodId;
  recipeId: string;
  /** units of the good the manufacturer makes per day */
  outputPerDay: number;
  /** fractional building counts across the whole chain (manufacturer = 1), plus the store */
  buildings: Partial<Record<BuildingTypeId, number>>;
  /** number of truck legs (one truck each) */
  legs: number;
  /** raw (tier-0) goods the chain consumes per day, valued at base price */
  rawInputCostPerDay: number;
  /** output per day × base price */
  revenuePerDay: number;
  /** buildings (fractional) + store + one truck per leg, per day */
  maintenancePerDay: number;
  profitPerDay: number;
}

interface Producer {
  typeId: BuildingTypeId;
  recipe: RecipeDef;
}

/** The first building/recipe that makes `goodId` and is invented by `year` (extractors before factories). */
export function producerOf(goodId: GoodId, year: number): Producer | null {
  for (const def of Object.values(BUILDINGS)) {
    if (def.era > year) continue;
    for (const rid of def.recipes) {
      const recipe = RECIPES[rid];
      if (recipe && recipe.outputs[goodId] !== undefined && recipeEra(rid) <= year) return { typeId: def.id, recipe };
    }
  }
  return null;
}

function dailyYield(p: Producer, goodId: GoodId): number {
  const perDay = p.recipe.outputs[goodId] / p.recipe.days;
  return p.typeId === 'farm' && SEASONAL.includes(goodId) ? perDay * SEASONAL_FARM_FACTOR : perDay;
}

export function chainEconomics(goodId: GoodId, year: number): ChainReport | null {
  const top = producerOf(goodId, year);
  if (!top) return null;
  const buildings: Partial<Record<BuildingTypeId, number>> = {};
  let raw = 0;
  let legs = 0;
  let ok = true;
  const need = (g: GoodId, perDay: number): void => {
    const p = producerOf(g, year);
    if (!p) {
      ok = false;
      return;
    }
    legs++; // a truck leg delivers g to its consumer
    const share = perDay / dailyYield(p, g);
    buildings[p.typeId] = (buildings[p.typeId] ?? 0) + share;
    if (GOODS[g].tier === 0) raw += perDay * GOODS[g].basePrice;
    for (const [inp, q] of Object.entries(p.recipe.inputs)) need(inp, (q / p.recipe.days) * share);
  };
  const outputPerDay = top.recipe.outputs[goodId] / top.recipe.days;
  need(goodId, outputPerDay); // counts the manufacturer → store leg
  if (!ok) return null;
  buildings.store = (buildings.store ?? 0) + 1;
  let maintenance = legs * TRUCK.maintenance;
  for (const [t, n] of Object.entries(buildings)) maintenance += BUILDINGS[t].maintenance * (n ?? 0);
  const maintenancePerDay = maintenance / DAYS_PER_MONTH;
  const revenuePerDay = outputPerDay * GOODS[goodId].basePrice;
  return {
    goodId,
    recipeId: top.recipe.id,
    outputPerDay,
    buildings,
    legs,
    rawInputCostPerDay: raw,
    revenuePerDay,
    maintenancePerDay,
    profitPerDay: revenuePerDay - maintenancePerDay,
  };
}
