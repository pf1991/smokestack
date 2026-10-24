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
  r_furniture: { id: 'r_furniture', inputs: { lumber: 5 }, outputs: { furniture: 3 }, days: 1 },
  r_bread: { id: 'r_bread', inputs: { flour: 6, milk: 3 }, outputs: { bread: 9 }, days: 1 },
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

  // R4 (after every older recipe, so firstRecipeFor and producerOf keep their choices for old goods)
  // Extraction
  r_copper_ore: { id: 'r_copper_ore', inputs: {}, outputs: { copper_ore: 10 }, days: 1 },
  r_cattle: { id: 'r_cattle', inputs: {}, outputs: { cattle: 4 }, days: 1 },
  r_sugar_beet: { id: 'r_sugar_beet', inputs: {}, outputs: { sugar_beet: 12 }, days: 1 },
  r_clay: { id: 'r_clay', inputs: {}, outputs: { clay: 12 }, days: 1 },
  r_rubber: { id: 'r_rubber', inputs: {}, outputs: { rubber: 8 }, days: 1 },
  r_bauxite: { id: 'r_bauxite', inputs: {}, outputs: { bauxite: 10 }, days: 1 },
  // Refining
  r_copper: { id: 'r_copper', inputs: { copper_ore: 8, coal: 2 }, outputs: { copper: 4 }, days: 1 },
  r_aluminium: { id: 'r_aluminium', inputs: { bauxite: 8, coal: 4 }, outputs: { aluminium: 2 }, days: 1 },
  r_leather: { id: 'r_leather', inputs: { cattle: 2 }, outputs: { leather: 4 }, days: 1 },
  r_sugar: { id: 'r_sugar', inputs: { sugar_beet: 12 }, outputs: { sugar: 6 }, days: 1 },
  r_bricks: { id: 'r_bricks', inputs: { clay: 10, coal: 2 }, outputs: { bricks: 8 }, days: 1 },
  r_paper: { id: 'r_paper', inputs: { wood: 10 }, outputs: { paper: 6 }, days: 1 },
  r_chemicals: { id: 'r_chemicals', inputs: { coal: 4, oil: 4 }, outputs: { chemicals: 4 }, days: 1 },
  r_silicon: { id: 'r_silicon', inputs: { sand: 8, coal: 2 }, outputs: { silicon: 2 }, days: 1 },
  // Components
  r_wire: { id: 'r_wire', inputs: { copper: 4 }, outputs: { wire: 4 }, days: 1 },
  r_tyres: { id: 'r_tyres', inputs: { rubber: 4, fabric: 1 }, outputs: { tyres: 4 }, days: 1 },
  r_engines: { id: 'r_engines', inputs: { steel: 3, fuel: 1 }, outputs: { engines: 1 }, days: 1 },
  r_electric_motors: { id: 'r_electric_motors', inputs: { wire: 2, steel: 1 }, outputs: { electric_motors: 1 }, days: 1 },
  r_vacuum_tubes: { id: 'r_vacuum_tubes', inputs: { glass: 2, wire: 1 }, outputs: { vacuum_tubes: 6 }, days: 1 },
  r_microchips: { id: 'r_microchips', inputs: { silicon: 2, wire: 1 }, outputs: { microchips: 4 }, days: 1 },
  r_displays: { id: 'r_displays', inputs: { glass: 2, chemicals: 1, plastic: 1 }, outputs: { displays: 2 }, days: 1 },
  // Manufacturing
  r_shoes: { id: 'r_shoes', inputs: { leather: 4 }, outputs: { shoes: 2 }, days: 1 },
  r_candy: { id: 'r_candy', inputs: { sugar: 3, milk: 2 }, outputs: { candy: 6 }, days: 1 },
  r_books: { id: 'r_books', inputs: { paper: 6 }, outputs: { books: 3 }, days: 1 },
  r_canned_food: { id: 'r_canned_food', inputs: { cattle: 2, steel: 1 }, outputs: { canned_food: 6 }, days: 1 },
  r_phonographs: { id: 'r_phonographs', inputs: { lumber: 2, copper: 2 }, outputs: { phonographs: 2 }, days: 1 },
  r_bicycles: { id: 'r_bicycles', inputs: { steel: 2, tyres: 2 }, outputs: { bicycles: 2 }, days: 1 },
  r_motorcycles: { id: 'r_motorcycles', inputs: { engines: 1, tyres: 2, steel: 1 }, outputs: { motorcycles: 1 }, days: 1 },
  r_refrigerators: { id: 'r_refrigerators', inputs: { steel: 3, electric_motors: 1, chemicals: 1 }, outputs: { refrigerators: 1 }, days: 1 },
  r_washing_machines: { id: 'r_washing_machines', inputs: { steel: 3, electric_motors: 1, rubber: 1 }, outputs: { washing_machines: 1 }, days: 1 },
  r_cosmetics: { id: 'r_cosmetics', inputs: { chemicals: 2, glass: 1 }, outputs: { cosmetics: 4 }, days: 1 },
  // Tube calculators first so firstRecipeFor / planChain stay on tubes after chips unlock
  r_calculators: { id: 'r_calculators', inputs: { vacuum_tubes: 2, plastic: 1 }, outputs: { calculators: 2 }, days: 1 },
  r_calculators_chip: { id: 'r_calculators_chip', inputs: { microchips: 1, plastic: 1 }, outputs: { calculators: 2 }, days: 1 },
  r_video_games: { id: 'r_video_games', inputs: { microchips: 2, plastic: 1 }, outputs: { video_games: 2 }, days: 1 },
  r_mobile_phones: { id: 'r_mobile_phones', inputs: { microchips: 2, displays: 1, aluminium: 1 }, outputs: { mobile_phones: 1 }, days: 1 },
  // Appended after r_computers so firstRecipeFor still prefers r_radios
  r_radios_tubes: { id: 'r_radios_tubes', inputs: { vacuum_tubes: 2, lumber: 2 }, outputs: { radios: 2 }, days: 1 },
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
