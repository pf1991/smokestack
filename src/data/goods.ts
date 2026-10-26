import type { GoodId } from '../sim/types';

export type GoodKind = 'raw' | 'material' | 'component' | 'consumer';

export interface GoodDef {
  id: GoodId;
  name: string;
  /** @deprecated use `kind` */
  tier: 0 | 1 | 2;
  kind: GoodKind;
  basePrice: number;
  era: number;
  fadeYear: number | null;
  color: string;
  /** Plural form for news and pleas; defaults to `name` via `goodPlural`. */
  plural?: string;
}

/** Display plural for a good (news, contracts); falls back to the singular name. */
export function goodPlural(g: GoodDef): string {
  return g.plural ?? g.name;
}

export const GOODS: Record<GoodId, GoodDef> = {
  // Raw (tier 0)
  wood: { id: 'wood', name: 'Wood', tier: 0, kind: 'raw', basePrice: 4, era: 1900, fadeYear: null, color: '#8b5a2b' },
  grain: { id: 'grain', name: 'Grain', tier: 0, kind: 'raw', basePrice: 3, era: 1900, fadeYear: null, color: '#e0c060' },
  cotton: { id: 'cotton', name: 'Cotton', tier: 0, kind: 'raw', basePrice: 4, era: 1900, fadeYear: null, color: '#f4f1ea' },
  fruit: { id: 'fruit', name: 'Fruit', tier: 0, kind: 'raw', basePrice: 3, era: 1900, fadeYear: null, color: '#d9463b' },
  milk: { id: 'milk', name: 'Milk', tier: 0, kind: 'raw', basePrice: 3, era: 1900, fadeYear: null, color: '#e8eef5' },
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', tier: 0, kind: 'raw', basePrice: 6, era: 1900, fadeYear: null, color: '#a0522d' },
  coal: { id: 'coal', name: 'Coal', tier: 0, kind: 'raw', basePrice: 5, era: 1900, fadeYear: null, color: '#2b2b2f' },
  sand: { id: 'sand', name: 'Sand', tier: 0, kind: 'raw', basePrice: 2, era: 1900, fadeYear: null, color: '#e6cf9a' },
  oil: { id: 'oil', name: 'Crude Oil', tier: 0, kind: 'raw', basePrice: 8, era: 1910, fadeYear: null, color: '#3c3a36' },
  copper_ore: { id: 'copper_ore', name: 'Copper Ore', tier: 0, kind: 'raw', basePrice: 6, era: 1900, fadeYear: null, color: '#4f8a6e' },
  cattle: { id: 'cattle', name: 'Cattle', tier: 0, kind: 'raw', basePrice: 10, era: 1900, fadeYear: null, color: '#7a4b3a' },
  sugar_beet: { id: 'sugar_beet', name: 'Sugar Beet', tier: 0, kind: 'raw', basePrice: 3, era: 1900, fadeYear: null, color: '#c77d9b' },
  clay: { id: 'clay', name: 'Clay', tier: 0, kind: 'raw', basePrice: 2, era: 1900, fadeYear: null, color: '#b5653d' },
  rubber: { id: 'rubber', name: 'Rubber', tier: 0, kind: 'raw', basePrice: 8, era: 1910, fadeYear: null, color: '#5a5f3c' },
  bauxite: { id: 'bauxite', name: 'Bauxite', tier: 0, kind: 'raw', basePrice: 6, era: 1920, fadeYear: null, color: '#d08a5a' },

  // Intermediate (tier 1)
  lumber: { id: 'lumber', name: 'Lumber', tier: 1, kind: 'material', basePrice: 10, era: 1900, fadeYear: null, color: '#c8a16e' },
  flour: { id: 'flour', name: 'Flour', tier: 1, kind: 'material', basePrice: 8, era: 1900, fadeYear: null, color: '#fbf6e9' },
  steel: { id: 'steel', name: 'Steel', tier: 1, kind: 'material', basePrice: 22, era: 1900, fadeYear: null, color: '#9aa4ae' },
  fabric: { id: 'fabric', name: 'Fabric', tier: 1, kind: 'material', basePrice: 12, era: 1900, fadeYear: null, color: '#7b4fa0' },
  glass: { id: 'glass', name: 'Glass', tier: 1, kind: 'material', basePrice: 10, era: 1900, fadeYear: null, color: '#7fd1c7' },
  fuel: { id: 'fuel', name: 'Fuel', tier: 1, kind: 'material', basePrice: 18, era: 1910, fadeYear: null, color: '#e07b22' },
  plastic: { id: 'plastic', name: 'Plastic', tier: 1, kind: 'material', basePrice: 20, era: 1935, fadeYear: null, color: '#4fb3e8' },
  copper: { id: 'copper', name: 'Copper', tier: 1, kind: 'material', basePrice: 24, era: 1900, fadeYear: null, color: '#c46f3b' },
  leather: { id: 'leather', name: 'Leather', tier: 1, kind: 'material', basePrice: 14, era: 1900, fadeYear: null, color: '#b08060' },
  sugar: { id: 'sugar', name: 'Sugar', tier: 1, kind: 'material', basePrice: 9, era: 1900, fadeYear: null, color: '#f5efe0' },
  bricks: { id: 'bricks', name: 'Bricks', tier: 1, kind: 'material', basePrice: 8, era: 1900, fadeYear: null, color: '#a63d2a' },
  paper: { id: 'paper', name: 'Paper', tier: 1, kind: 'material', basePrice: 10, era: 1900, fadeYear: null, color: '#efe6c8' },
  chemicals: { id: 'chemicals', name: 'Chemicals', tier: 1, kind: 'material', basePrice: 24, era: 1920, fadeYear: null, color: '#9bcf3c' },
  aluminium: { id: 'aluminium', name: 'Aluminium', tier: 1, kind: 'material', basePrice: 45, era: 1925, fadeYear: null, color: '#c9d1d9' },
  silicon: { id: 'silicon', name: 'Silicon', tier: 1, kind: 'material', basePrice: 45, era: 1965, fadeYear: null, color: '#6b7fa3' },

  // Component (tier 1): parts made for other works
  wire: { id: 'wire', name: 'Wire', tier: 1, kind: 'component', basePrice: 32, era: 1900, fadeYear: null, color: '#d4a017' },
  tyres: { id: 'tyres', name: 'Tyres', tier: 1, kind: 'component', basePrice: 20, era: 1910, fadeYear: null, color: '#34495e' },
  engines: { id: 'engines', name: 'Engines', tier: 1, kind: 'component', basePrice: 150, era: 1910, fadeYear: null, color: '#5b6770' },
  electric_motors: { id: 'electric_motors', name: 'Electric Motors', tier: 1, kind: 'component', basePrice: 140, era: 1920, fadeYear: null, color: '#3e7cb1' },
  vacuum_tubes: { id: 'vacuum_tubes', name: 'Vacuum Tubes', tier: 1, kind: 'component', basePrice: 22, era: 1920, fadeYear: null, color: '#ffb347' },
  microchips: { id: 'microchips', name: 'Microchips', tier: 1, kind: 'component', basePrice: 50, era: 1972, fadeYear: null, color: '#3a7d2c' },
  displays: { id: 'displays', name: 'Displays', tier: 1, kind: 'component', basePrice: 90, era: 1975, fadeYear: null, color: '#0f6e8c' },

  // Consumer (tier 2)
  furniture: { id: 'furniture', name: 'Furniture', tier: 2, kind: 'consumer', basePrice: 72, era: 1900, fadeYear: null, color: '#6b3e1f' },
  bread: { id: 'bread', name: 'Bread', tier: 2, kind: 'consumer', basePrice: 21, era: 1900, fadeYear: null, color: '#c98a3e' },
  tools: { id: 'tools', name: 'Tools', tier: 2, kind: 'consumer', basePrice: 63, era: 1900, fadeYear: null, color: '#5d6d7e' },
  clothes: { id: 'clothes', name: 'Clothes', tier: 2, kind: 'consumer', basePrice: 60, era: 1900, fadeYear: null, color: '#2e5d8c' },
  cheese: { id: 'cheese', name: 'Cheese', tier: 2, kind: 'consumer', basePrice: 33, era: 1900, fadeYear: null, color: '#f2c94c' },
  juice: { id: 'juice', name: 'Juice', tier: 2, kind: 'consumer', basePrice: 39, era: 1900, fadeYear: null, color: '#f08a24' },
  toys: { id: 'toys', name: 'Toys', tier: 2, kind: 'consumer', basePrice: 45, era: 1900, fadeYear: null, color: '#e75480' },
  cars: { id: 'cars', name: 'Automobile', tier: 2, kind: 'consumer', basePrice: 630, era: 1910, fadeYear: null, color: '#b22234', plural: 'Automobiles' },
  radios: { id: 'radios', name: 'Radio', tier: 2, kind: 'consumer', basePrice: 195, era: 1925, fadeYear: 1965, color: '#8e5b3a', plural: 'Radios' },
  tvs: { id: 'tvs', name: 'Television', tier: 2, kind: 'consumer', basePrice: 390, era: 1950, fadeYear: null, color: '#3d3d56', plural: 'Televisions' },
  computers: { id: 'computers', name: 'Computer', tier: 2, kind: 'consumer', basePrice: 900, era: 1980, fadeYear: null, color: '#1abc9c', plural: 'Computers' },
  shoes: { id: 'shoes', name: 'Shoes', tier: 2, kind: 'consumer', basePrice: 52, era: 1900, fadeYear: null, color: '#4a2c1a' },
  candy: { id: 'candy', name: 'Candy', tier: 2, kind: 'consumer', basePrice: 16, era: 1900, fadeYear: null, color: '#ff7eb6' },
  books: { id: 'books', name: 'Books', tier: 2, kind: 'consumer', basePrice: 36, era: 1900, fadeYear: null, color: '#7d2e46' },
  // Fades mid-century once refrigerators keep fresh food (E4): cannery players must retool
  canned_food: { id: 'canned_food', name: 'Canned Food', tier: 2, kind: 'consumer', basePrice: 18, era: 1900, fadeYear: 1955, color: '#b0413e', plural: 'Canned food' },
  // Coastal staple: towns buy it fresh; canneries tin it (dual use with r_canned_fish)
  fish: { id: 'fish', name: 'Fish', tier: 2, kind: 'consumer', basePrice: 10, era: 1900, fadeYear: null, color: '#3d6f8f' },
  phonographs: { id: 'phonographs', name: 'Phonograph', tier: 2, kind: 'consumer', basePrice: 120, era: 1905, fadeYear: 1955, color: '#a67c00', plural: 'Phonographs' },
  // Car suburbs thin the bicycle trade (E4); cycle works shift to motorcycles
  bicycles: { id: 'bicycles', name: 'Bicycle', tier: 2, kind: 'consumer', basePrice: 120, era: 1910, fadeYear: 1960, color: '#2f8f83', plural: 'Bicycles' },
  motorcycles: { id: 'motorcycles', name: 'Motorcycle', tier: 2, kind: 'consumer', basePrice: 480, era: 1915, fadeYear: null, color: '#6d1a1a', plural: 'Motorcycles' },
  refrigerators: { id: 'refrigerators', name: 'Refrigerator', tier: 2, kind: 'consumer', basePrice: 520, era: 1930, fadeYear: null, color: '#dfe7ee', plural: 'Refrigerators' },
  washing_machines: { id: 'washing_machines', name: 'Washing Machine', tier: 2, kind: 'consumer', basePrice: 480, era: 1935, fadeYear: null, color: '#8fb8d8', plural: 'Washing Machines' },
  cosmetics: { id: 'cosmetics', name: 'Cosmetics', tier: 2, kind: 'consumer', basePrice: 40, era: 1950, fadeYear: null, color: '#d65a8c' },
  calculators: { id: 'calculators', name: 'Calculator', tier: 2, kind: 'consumer', basePrice: 120, era: 1970, fadeYear: 1995, color: '#707070', plural: 'Calculators' },
  video_games: { id: 'video_games', name: 'Video Games', tier: 2, kind: 'consumer', basePrice: 150, era: 1978, fadeYear: null, color: '#7b3fe4' },
  mobile_phones: { id: 'mobile_phones', name: 'Mobile Phone', tier: 2, kind: 'consumer', basePrice: 650, era: 1990, fadeYear: null, color: '#14213d', plural: 'Mobile Phones' },
};

/**
 * The 11 consumer goods of the v1 catalogue. Town growth averages over these first (the baseline
 * rule, sim/market.ts averageSatisfaction), so goods added later can only raise a town's satisfaction.
 */
export const BASELINE_GOODS: ReadonlySet<GoodId> = new Set([
  'furniture', 'bread', 'tools', 'clothes', 'cheese', 'juice', 'toys', 'cars', 'radios', 'tvs', 'computers',
]);

/** Farm crops that follow the seasons: none in winter, half again in summer. */
export const SEASONAL_CROPS: readonly GoodId[] = ['grain', 'cotton', 'fruit', 'sugar_beet'];

/** Monthly demand per 1000 population (units/month). */
export const DEMAND_PER_1000: Record<GoodId, number> = {
  furniture: 12,
  bread: 60,
  tools: 10,
  clothes: 16,
  cheese: 24,
  juice: 24,
  toys: 12,
  cars: 1,
  radios: 3,
  tvs: 2,
  computers: 1.2,
  shoes: 14,
  candy: 30,
  books: 10,
  canned_food: 40,
  fish: 20,
  phonographs: 3,
  bicycles: 4,
  motorcycles: 1.5,
  refrigerators: 1.5,
  washing_machines: 1.5,
  cosmetics: 12,
  calculators: 3,
  video_games: 4,
  mobile_phones: 2,
};

/** A good's demand multiplier per social class (Phase 3 Task 7, sim/society/classes.ts). */
export interface ClassDemand {
  working: number;
  middle: number;
  upper: number;
}

const LUXURY: ClassDemand = { working: 0.6, middle: 1.2, upper: 2.0 };
const STAPLE: ClassDemand = { working: 1.2, middle: 1.0, upper: 0.7 };
const PLAIN: ClassDemand = { working: 1, middle: 1, upper: 1 };
const MIDDLE: ClassDemand = { working: 0.8, middle: 1.5, upper: 1.2 };

/**
 * Class demand multipliers of every good with city demand: luxuries sell to the rich, staples to the
 * working class, everything else is class-blind. Demand is scaled by the city's class mix against the
 * initial mix (sim/society/classes.ts classDemandFactor), so a 1900 town keeps its v1 demand.
 */
export const CLASS_DEMAND: Record<GoodId, ClassDemand> = {
  furniture: LUXURY,
  bread: STAPLE,
  tools: PLAIN,
  clothes: STAPLE,
  cheese: LUXURY,
  juice: LUXURY,
  toys: LUXURY,
  cars: LUXURY,
  radios: PLAIN,
  tvs: PLAIN,
  computers: LUXURY,
  shoes: STAPLE,
  candy: PLAIN,
  books: MIDDLE,
  canned_food: STAPLE,
  fish: STAPLE,
  phonographs: MIDDLE,
  bicycles: STAPLE,
  motorcycles: PLAIN,
  refrigerators: MIDDLE,
  washing_machines: MIDDLE,
  cosmetics: LUXURY,
  calculators: MIDDLE,
  video_games: PLAIN,
  mobile_phones: PLAIN,
};

export function getGood(id: GoodId): GoodDef {
  const good = GOODS[id];
  if (!good) throw new Error(`Unknown good: ${id}`);
  return good;
}
