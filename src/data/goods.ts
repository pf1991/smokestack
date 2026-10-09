import type { GoodId } from '../sim/types';

export interface GoodDef {
  id: GoodId;
  name: string;
  tier: 0 | 1 | 2;
  basePrice: number;
  era: number;
  fadeYear: number | null;
  icon: string;
  color: string;
}

export const GOODS: Record<GoodId, GoodDef> = {
  // Raw (tier 0)
  wood: { id: 'wood', name: 'Wood', tier: 0, basePrice: 4, era: 1900, fadeYear: null, icon: '🪵', color: '#8b5a2b' },
  grain: { id: 'grain', name: 'Grain', tier: 0, basePrice: 3, era: 1900, fadeYear: null, icon: '🌾', color: '#e0c060' },
  cotton: { id: 'cotton', name: 'Cotton', tier: 0, basePrice: 4, era: 1900, fadeYear: null, icon: '☁️', color: '#f4f1ea' },
  fruit: { id: 'fruit', name: 'Fruit', tier: 0, basePrice: 3, era: 1900, fadeYear: null, icon: '🍎', color: '#d9463b' },
  milk: { id: 'milk', name: 'Milk', tier: 0, basePrice: 3, era: 1900, fadeYear: null, icon: '🥛', color: '#e8eef5' },
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', tier: 0, basePrice: 6, era: 1900, fadeYear: null, icon: '⛏️', color: '#a0522d' },
  coal: { id: 'coal', name: 'Coal', tier: 0, basePrice: 5, era: 1900, fadeYear: null, icon: '⚫', color: '#2b2b2f' },
  sand: { id: 'sand', name: 'Sand', tier: 0, basePrice: 2, era: 1900, fadeYear: null, icon: '⏳', color: '#e6cf9a' },
  oil: { id: 'oil', name: 'Crude Oil', tier: 0, basePrice: 8, era: 1910, fadeYear: null, icon: '🛢️', color: '#3c3a36' },

  // Intermediate (tier 1)
  lumber: { id: 'lumber', name: 'Lumber', tier: 1, basePrice: 10, era: 1900, fadeYear: null, icon: '🪚', color: '#c8a16e' },
  flour: { id: 'flour', name: 'Flour', tier: 1, basePrice: 8, era: 1900, fadeYear: null, icon: '🥡', color: '#fbf6e9' },
  steel: { id: 'steel', name: 'Steel', tier: 1, basePrice: 22, era: 1900, fadeYear: null, icon: '🔩', color: '#9aa4ae' },
  fabric: { id: 'fabric', name: 'Fabric', tier: 1, basePrice: 12, era: 1900, fadeYear: null, icon: '🧵', color: '#7b4fa0' },
  glass: { id: 'glass', name: 'Glass', tier: 1, basePrice: 10, era: 1900, fadeYear: null, icon: '🪟', color: '#7fd1c7' },
  fuel: { id: 'fuel', name: 'Fuel', tier: 1, basePrice: 18, era: 1910, fadeYear: null, icon: '⛽', color: '#e07b22' },
  plastic: { id: 'plastic', name: 'Plastic', tier: 1, basePrice: 20, era: 1935, fadeYear: null, icon: '🧪', color: '#4fb3e8' },

  // Consumer (tier 2)
  furniture: { id: 'furniture', name: 'Furniture', tier: 2, basePrice: 48, era: 1900, fadeYear: null, icon: '🪑', color: '#6b3e1f' },
  bread: { id: 'bread', name: 'Bread', tier: 2, basePrice: 14, era: 1900, fadeYear: null, icon: '🍞', color: '#c98a3e' },
  tools: { id: 'tools', name: 'Tools', tier: 2, basePrice: 42, era: 1900, fadeYear: null, icon: '🔨', color: '#5d6d7e' },
  clothes: { id: 'clothes', name: 'Clothes', tier: 2, basePrice: 40, era: 1900, fadeYear: null, icon: '👔', color: '#2e5d8c' },
  cheese: { id: 'cheese', name: 'Cheese', tier: 2, basePrice: 22, era: 1900, fadeYear: null, icon: '🧀', color: '#f2c94c' },
  juice: { id: 'juice', name: 'Juice', tier: 2, basePrice: 26, era: 1900, fadeYear: null, icon: '🧃', color: '#f08a24' },
  toys: { id: 'toys', name: 'Toys', tier: 2, basePrice: 30, era: 1900, fadeYear: null, icon: '🧸', color: '#e75480' },
  cars: { id: 'cars', name: 'Automobile', tier: 2, basePrice: 420, era: 1910, fadeYear: null, icon: '🚗', color: '#b22234' },
  radios: { id: 'radios', name: 'Radio', tier: 2, basePrice: 130, era: 1925, fadeYear: 1965, icon: '📻', color: '#8e5b3a' },
  tvs: { id: 'tvs', name: 'Television', tier: 2, basePrice: 260, era: 1950, fadeYear: null, icon: '📺', color: '#3d3d56' },
  computers: { id: 'computers', name: 'Computer', tier: 2, basePrice: 600, era: 1980, fadeYear: null, icon: '💻', color: '#1abc9c' },
};

/** Monthly demand per 1000 population (units/month). */
export const DEMAND_PER_1000: Record<GoodId, number> = {
  furniture: 6,
  bread: 30,
  tools: 5,
  clothes: 8,
  cheese: 12,
  juice: 12,
  toys: 6,
  cars: 0.5,
  radios: 1.5,
  tvs: 1,
  computers: 0.6,
};

export function getGood(id: GoodId): GoodDef {
  const good = GOODS[id];
  if (!good) throw new Error(`Unknown good: ${id}`);
  return good;
}
