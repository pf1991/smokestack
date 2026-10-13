import type { GoodId } from '../sim/types';

export interface GoodDef {
  id: GoodId;
  name: string;
  tier: 0 | 1 | 2;
  basePrice: number;
  era: number;
  fadeYear: number | null;
  color: string;
}

export const GOODS: Record<GoodId, GoodDef> = {
  // Raw (tier 0)
  wood: { id: 'wood', name: 'Wood', tier: 0, basePrice: 4, era: 1900, fadeYear: null, color: '#8b5a2b' },
  grain: { id: 'grain', name: 'Grain', tier: 0, basePrice: 3, era: 1900, fadeYear: null, color: '#e0c060' },
  cotton: { id: 'cotton', name: 'Cotton', tier: 0, basePrice: 4, era: 1900, fadeYear: null, color: '#f4f1ea' },
  fruit: { id: 'fruit', name: 'Fruit', tier: 0, basePrice: 3, era: 1900, fadeYear: null, color: '#d9463b' },
  milk: { id: 'milk', name: 'Milk', tier: 0, basePrice: 3, era: 1900, fadeYear: null, color: '#e8eef5' },
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', tier: 0, basePrice: 6, era: 1900, fadeYear: null, color: '#a0522d' },
  coal: { id: 'coal', name: 'Coal', tier: 0, basePrice: 5, era: 1900, fadeYear: null, color: '#2b2b2f' },
  sand: { id: 'sand', name: 'Sand', tier: 0, basePrice: 2, era: 1900, fadeYear: null, color: '#e6cf9a' },
  oil: { id: 'oil', name: 'Crude Oil', tier: 0, basePrice: 8, era: 1910, fadeYear: null, color: '#3c3a36' },

  // Intermediate (tier 1)
  lumber: { id: 'lumber', name: 'Lumber', tier: 1, basePrice: 10, era: 1900, fadeYear: null, color: '#c8a16e' },
  flour: { id: 'flour', name: 'Flour', tier: 1, basePrice: 8, era: 1900, fadeYear: null, color: '#fbf6e9' },
  steel: { id: 'steel', name: 'Steel', tier: 1, basePrice: 22, era: 1900, fadeYear: null, color: '#9aa4ae' },
  fabric: { id: 'fabric', name: 'Fabric', tier: 1, basePrice: 12, era: 1900, fadeYear: null, color: '#7b4fa0' },
  glass: { id: 'glass', name: 'Glass', tier: 1, basePrice: 10, era: 1900, fadeYear: null, color: '#7fd1c7' },
  fuel: { id: 'fuel', name: 'Fuel', tier: 1, basePrice: 18, era: 1910, fadeYear: null, color: '#e07b22' },
  plastic: { id: 'plastic', name: 'Plastic', tier: 1, basePrice: 20, era: 1935, fadeYear: null, color: '#4fb3e8' },

  // Consumer (tier 2)
  furniture: { id: 'furniture', name: 'Furniture', tier: 2, basePrice: 72, era: 1900, fadeYear: null, color: '#6b3e1f' },
  bread: { id: 'bread', name: 'Bread', tier: 2, basePrice: 21, era: 1900, fadeYear: null, color: '#c98a3e' },
  tools: { id: 'tools', name: 'Tools', tier: 2, basePrice: 63, era: 1900, fadeYear: null, color: '#5d6d7e' },
  clothes: { id: 'clothes', name: 'Clothes', tier: 2, basePrice: 60, era: 1900, fadeYear: null, color: '#2e5d8c' },
  cheese: { id: 'cheese', name: 'Cheese', tier: 2, basePrice: 33, era: 1900, fadeYear: null, color: '#f2c94c' },
  juice: { id: 'juice', name: 'Juice', tier: 2, basePrice: 39, era: 1900, fadeYear: null, color: '#f08a24' },
  toys: { id: 'toys', name: 'Toys', tier: 2, basePrice: 45, era: 1900, fadeYear: null, color: '#e75480' },
  cars: { id: 'cars', name: 'Automobile', tier: 2, basePrice: 630, era: 1910, fadeYear: null, color: '#b22234' },
  radios: { id: 'radios', name: 'Radio', tier: 2, basePrice: 195, era: 1925, fadeYear: 1965, color: '#8e5b3a' },
  tvs: { id: 'tvs', name: 'Television', tier: 2, basePrice: 390, era: 1950, fadeYear: null, color: '#3d3d56' },
  computers: { id: 'computers', name: 'Computer', tier: 2, basePrice: 900, era: 1980, fadeYear: null, color: '#1abc9c' },
};

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
};

export function getGood(id: GoodId): GoodDef {
  const good = GOODS[id];
  if (!good) throw new Error(`Unknown good: ${id}`);
  return good;
}
