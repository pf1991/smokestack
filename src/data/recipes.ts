import type { Inventory } from '../sim/types';
import { getGood } from './goods';

export interface RecipeDef {
  id: string;
  inputs: Inventory;
  outputs: Inventory;
  days: number;
}

export const RECIPES: Record<string, RecipeDef> = {
  // Extraction
  r_wood: { id: 'r_wood', inputs: {}, outputs: { wood: 10 }, days: 1 },
  r_grain: { id: 'r_grain', inputs: {}, outputs: { grain: 12 }, days: 1 },
  r_cotton: { id: 'r_cotton', inputs: {}, outputs: { cotton: 10 }, days: 1 },
  r_fruit: { id: 'r_fruit', inputs: {}, outputs: { fruit: 10 }, days: 1 },
  r_milk: { id: 'r_milk', inputs: {}, outputs: { milk: 10 }, days: 1 },
  r_iron: { id: 'r_iron', inputs: {}, outputs: { iron_ore: 10 }, days: 1 },
  r_coal: { id: 'r_coal', inputs: {}, outputs: { coal: 10 }, days: 1 },
  r_sand: { id: 'r_sand', inputs: {}, outputs: { sand: 12 }, days: 1 },
  r_oil: { id: 'r_oil', inputs: {}, outputs: { oil: 10 }, days: 1 },

  // Refining
  r_lumber: { id: 'r_lumber', inputs: { wood: 10 }, outputs: { lumber: 5 }, days: 1 },
  r_flour: { id: 'r_flour', inputs: { grain: 12 }, outputs: { flour: 6 }, days: 1 },
  r_steel: { id: 'r_steel', inputs: { iron_ore: 6, coal: 4 }, outputs: { steel: 4 }, days: 1 },
  r_fabric: { id: 'r_fabric', inputs: { cotton: 10 }, outputs: { fabric: 5 }, days: 1 },
  r_glass: { id: 'r_glass', inputs: { sand: 8, coal: 2 }, outputs: { glass: 4 }, days: 1 },
  r_fuel: { id: 'r_fuel', inputs: { oil: 8 }, outputs: { fuel: 4 }, days: 1 },
  r_plastic: { id: 'r_plastic', inputs: { oil: 8 }, outputs: { plastic: 4 }, days: 1 },

  // Manufacturing
  r_furniture: { id: 'r_furniture', inputs: { lumber: 4 }, outputs: { furniture: 2 }, days: 1 },
  r_bread: { id: 'r_bread', inputs: { flour: 4, milk: 2 }, outputs: { bread: 6 }, days: 1 },
  r_tools: { id: 'r_tools', inputs: { steel: 2, lumber: 2 }, outputs: { tools: 2 }, days: 1 },
  r_clothes: { id: 'r_clothes', inputs: { fabric: 4 }, outputs: { clothes: 2 }, days: 1 },
  r_cheese: { id: 'r_cheese', inputs: { milk: 6 }, outputs: { cheese: 2 }, days: 1 },
  r_juice: { id: 'r_juice', inputs: { fruit: 6, glass: 2 }, outputs: { juice: 4 }, days: 1 },
  r_toys_wood: { id: 'r_toys_wood', inputs: { lumber: 2 }, outputs: { toys: 2 }, days: 1 },
  r_toys_plastic: { id: 'r_toys_plastic', inputs: { plastic: 2 }, outputs: { toys: 4 }, days: 1 },
  r_cars: { id: 'r_cars', inputs: { steel: 4, glass: 2, fuel: 1 }, outputs: { cars: 1 }, days: 2 },
  r_radios: { id: 'r_radios', inputs: { steel: 2, glass: 2, lumber: 2 }, outputs: { radios: 2 }, days: 1 },
  r_tvs: { id: 'r_tvs', inputs: { plastic: 2, glass: 2, steel: 1 }, outputs: { tvs: 1 }, days: 2 },
  r_computers: { id: 'r_computers', inputs: { plastic: 2, steel: 1, glass: 1 }, outputs: { computers: 1 }, days: 2 },
};

export function getRecipe(id: string): RecipeDef {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`Unknown recipe: ${id}`);
  return recipe;
}

/** A recipe's era is the max era over all its inputs and outputs. */
export function recipeEra(id: string): number {
  const recipe = getRecipe(id);
  return Math.max(...[...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)].map((g) => getGood(g).era));
}
