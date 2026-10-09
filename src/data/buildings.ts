import type { BuildingTypeId, Terrain } from '../sim/types';

export type BuildingCategory = 'extractor' | 'factory' | 'retail' | 'logistics';

export interface BuildingDef {
  id: BuildingTypeId;
  name: string;
  category: BuildingCategory;
  size: { w: number; h: number };
  cost: number;
  maintenance: number;
  allowedTerrain: Terrain[];
  requiresDeposit: boolean;
  requiresCity: boolean;
  recipes: string[];
  storage: number;
  era: number;
  pollution: number;
  color: string;
  description: string;
}

const EX: Pick<BuildingDef, 'category' | 'requiresCity'> = { category: 'extractor', requiresCity: false };
const FA: Pick<BuildingDef, 'category' | 'requiresCity'> = { category: 'factory', requiresCity: false };

export const BUILDINGS: Record<BuildingTypeId, BuildingDef> = {
  lumber_camp: {
    id: 'lumber_camp', name: 'Lumber Camp', ...EX, size: { w: 2, h: 2 }, cost: 12000, maintenance: 400,
    allowedTerrain: ['forest'], requiresDeposit: false, recipes: ['r_wood'], storage: 60, era: 1900, pollution: 0,
    color: '#6b4423', description: 'Fells honest timber from the old forest.',
  },
  farm: {
    id: 'farm', name: 'Farm', ...EX, size: { w: 3, h: 3 }, cost: 10000, maintenance: 300,
    allowedTerrain: ['grass'], requiresDeposit: false, recipes: ['r_grain', 'r_cotton', 'r_fruit'], storage: 60, era: 1900, pollution: 0,
    color: '#8fae3e', description: 'Grain, cotton and fruit, as the seasons allow.',
  },
  dairy_farm: {
    id: 'dairy_farm', name: 'Dairy Farm', ...EX, size: { w: 3, h: 3 }, cost: 12000, maintenance: 350,
    allowedTerrain: ['grass'], requiresDeposit: false, recipes: ['r_milk'], storage: 60, era: 1900, pollution: 0,
    color: '#a9d18e', description: 'Twice-daily milking, rain or shine.',
  },
  mine: {
    id: 'mine', name: 'Mine', ...EX, size: { w: 2, h: 2 }, cost: 25000, maintenance: 800,
    allowedTerrain: ['hills', 'mountain'], requiresDeposit: true, recipes: ['r_iron', 'r_coal'], storage: 80, era: 1900, pollution: 3,
    color: '#5a5048', description: 'A shaft sunk into the hillside, lamps lit and men below.',
  },
  sand_pit: {
    id: 'sand_pit', name: 'Sand Pit', ...EX, size: { w: 2, h: 2 }, cost: 8000, maintenance: 250,
    allowedTerrain: ['sand'], requiresDeposit: false, recipes: ['r_sand'], storage: 80, era: 1900, pollution: 1,
    color: '#d8bf85', description: 'Dry sand, dug by the cartload for the glassmen.',
  },
  oil_well: {
    id: 'oil_well', name: 'Oil Well', ...EX, size: { w: 2, h: 2 }, cost: 30000, maintenance: 900,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: true, recipes: ['r_oil'], storage: 80, era: 1910, pollution: 3,
    color: '#2a2622', description: 'A black gusher of progress, nodding day and night.',
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmill', ...FA, size: { w: 3, h: 3 }, cost: 20000, maintenance: 600,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_lumber'], storage: 60, era: 1900, pollution: 2,
    color: '#b5834f', description: 'Whining blades turn logs into lumber.',
  },
  flour_mill: {
    id: 'flour_mill', name: 'Flour Mill', ...FA, size: { w: 3, h: 3 }, cost: 18000, maintenance: 500,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_flour'], storage: 60, era: 1900, pollution: 1,
    color: '#e9dfc7', description: 'Great stones grind the harvest to white flour.',
  },
  steel_mill: {
    id: 'steel_mill', name: 'Steel Mill', ...FA, size: { w: 3, h: 3 }, cost: 60000, maintenance: 1500,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, recipes: ['r_steel'], storage: 60, era: 1900, pollution: 6,
    color: '#737d88', description: 'Blast furnaces roar; the sky turns the colour of iron.',
  },
  textile_mill: {
    id: 'textile_mill', name: 'Textile Mill', ...FA, size: { w: 3, h: 3 }, cost: 30000, maintenance: 800,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_fabric'], storage: 60, era: 1900, pollution: 2,
    color: '#9b6bb3', description: 'Hundreds of looms clatter in perfect step.',
  },
  glassworks: {
    id: 'glassworks', name: 'Glassworks', ...FA, size: { w: 3, h: 3 }, cost: 35000, maintenance: 900,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_glass'], storage: 60, era: 1900, pollution: 4,
    color: '#86cfc4', description: 'Molten sand, blown by hand and by machine.',
  },
  refinery: {
    id: 'refinery', name: 'Refinery', ...FA, size: { w: 3, h: 3 }, cost: 70000, maintenance: 1800,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_fuel', 'r_plastic'], storage: 60, era: 1910, pollution: 8,
    color: '#c0702a', description: 'Towers of pipe cracking crude into fuel and wonder.',
  },
  furniture_factory: {
    id: 'furniture_factory', name: 'Furniture Factory', ...FA, size: { w: 3, h: 3 }, cost: 30000, maintenance: 700,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_furniture'], storage: 40, era: 1900, pollution: 1,
    color: '#7a4a25', description: 'Solid oak chairs for solid citizens.',
  },
  bakery: {
    id: 'bakery', name: 'Bakery', ...FA, size: { w: 2, h: 2 }, cost: 15000, maintenance: 400,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_bread'], storage: 60, era: 1900, pollution: 1,
    color: '#d99a52', description: 'The ovens are lit before the sun is up.',
  },
  toolworks: {
    id: 'toolworks', name: 'Toolworks', ...FA, size: { w: 3, h: 3 }, cost: 35000, maintenance: 900,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_tools'], storage: 40, era: 1900, pollution: 3,
    color: '#4e5e6e', description: 'Hammers, saws and spanners, forged to last a lifetime.',
  },
  clothing_factory: {
    id: 'clothing_factory', name: 'Clothing Factory', ...FA, size: { w: 3, h: 3 }, cost: 30000, maintenance: 800,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_clothes'], storage: 40, era: 1900, pollution: 1,
    color: '#3f6fa3', description: 'Stitched by the thousand for every size of gentleman.',
  },
  creamery: {
    id: 'creamery', name: 'Creamery', ...FA, size: { w: 2, h: 2 }, cost: 15000, maintenance: 400,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_cheese'], storage: 40, era: 1900, pollution: 1,
    color: '#f5d66b', description: 'Cheese aged in cool cellars, wheel by wheel.',
  },
  juice_plant: {
    id: 'juice_plant', name: 'Juice Plant', ...FA, size: { w: 2, h: 2 }, cost: 20000, maintenance: 500,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_juice'], storage: 40, era: 1900, pollution: 1,
    color: '#f39a2e', description: 'Pure fruit, bottled for the modern temperance household.',
  },
  toy_factory: {
    id: 'toy_factory', name: 'Toy Factory', ...FA, size: { w: 2, h: 2 }, cost: 22000, maintenance: 500,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_toys_wood', 'r_toys_plastic'], storage: 40, era: 1900, pollution: 1,
    color: '#ea6d9a', description: 'Tin soldiers and wooden trains for every nursery.',
  },
  car_plant: {
    id: 'car_plant', name: 'Car Plant', ...FA, size: { w: 4, h: 4 }, cost: 150000, maintenance: 4000,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_cars'], storage: 30, era: 1910, pollution: 5,
    color: '#b8322c', description: 'The moving line: a horseless carriage every few hours.',
  },
  electronics_plant: {
    id: 'electronics_plant', name: 'Electronics Plant', ...FA, size: { w: 3, h: 3 }, cost: 90000, maintenance: 2500,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_radios', 'r_tvs', 'r_computers'], storage: 30, era: 1925, pollution: 2,
    color: '#2aa198', description: 'Valves, circuits and glowing screens, assembled with care.',
  },
  store: {
    id: 'store', name: 'Store', category: 'retail', size: { w: 2, h: 2 }, cost: 15000, maintenance: 400,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, requiresCity: true, recipes: [], storage: 200, era: 1900, pollution: 0,
    color: '#e3b04b', description: 'A bright shopfront where the city comes to buy.',
  },
  warehouse: {
    id: 'warehouse', name: 'Warehouse', category: 'logistics', size: { w: 3, h: 3 }, cost: 20000, maintenance: 300,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, requiresCity: false, recipes: [], storage: 600, era: 1900, pollution: 0,
    color: '#8a8f99', description: 'Cavernous brick sheds holding goods until the wagons call.',
  },
  train_station: {
    id: 'train_station', name: 'Train Station', category: 'logistics', size: { w: 3, h: 2 }, cost: 40000, maintenance: 1000,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, requiresCity: false, recipes: [], storage: 400, era: 1900, pollution: 0,
    color: '#4a4f5c', description: 'Iron girders, a clock tower and a whistle that carries for miles.',
  },
};

export function getBuilding(id: string): BuildingDef {
  const building = BUILDINGS[id];
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
}
