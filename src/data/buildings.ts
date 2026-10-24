import type { BuildingTypeId, Terrain } from '../sim/types';

/** `trade` is the Trading House (sim/trade.ts): it sells materials and components to the nation. */
export type BuildingCategory = 'extractor' | 'factory' | 'retail' | 'trade' | 'logistics';

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
  /** hands needed at full output; drawn from the nearest town (sim/politics/workforce.ts) */
  workers: number;
}

const EX: Pick<BuildingDef, 'category' | 'requiresCity' | 'workers'> = { category: 'extractor', requiresCity: false, workers: 20 };
const FA: Pick<BuildingDef, 'category' | 'requiresCity' | 'workers'> = { category: 'factory', requiresCity: false, workers: 60 };

export const BUILDINGS: Record<BuildingTypeId, BuildingDef> = {
  lumber_camp: {
    id: 'lumber_camp', name: 'Lumber Camp', ...EX, size: { w: 2, h: 2 }, cost: 12000, maintenance: 200,
    allowedTerrain: ['forest'], requiresDeposit: false, recipes: ['r_wood'], storage: 120, era: 1900, pollution: 0,
    color: '#6b4423', description: 'Fells honest timber from the old forest.',
  },
  farm: {
    id: 'farm', name: 'Farm', ...EX, size: { w: 3, h: 3 }, cost: 10000, maintenance: 150,
    allowedTerrain: ['grass'], requiresDeposit: false, recipes: ['r_grain', 'r_cotton', 'r_fruit', 'r_sugar_beet'], storage: 120, era: 1900, pollution: 0,
    color: '#8fae3e', description: 'Grain, cotton and fruit, as the seasons allow.',
  },
  dairy_farm: {
    id: 'dairy_farm', name: 'Dairy Farm', ...EX, size: { w: 3, h: 3 }, cost: 12000, maintenance: 175,
    allowedTerrain: ['grass'], requiresDeposit: false, recipes: ['r_milk'], storage: 120, era: 1900, pollution: 0,
    color: '#a9d18e', description: 'Twice-daily milking, rain or shine.',
  },
  mine: {
    id: 'mine', name: 'Mine', ...EX, size: { w: 2, h: 2 }, cost: 25000, maintenance: 400,
    allowedTerrain: ['hills', 'mountain'], requiresDeposit: true, recipes: ['r_iron', 'r_coal'], storage: 160, era: 1900, pollution: 3,
    color: '#5a5048', description: 'A shaft sunk into the hillside, lamps lit and men below.',
  },
  sand_pit: {
    id: 'sand_pit', name: 'Sand Pit', ...EX, size: { w: 2, h: 2 }, cost: 8000, maintenance: 125,
    allowedTerrain: ['sand'], requiresDeposit: false, recipes: ['r_sand'], storage: 160, era: 1900, pollution: 1,
    color: '#d8bf85', description: 'Dry sand, dug by the cartload for the glassmen.',
  },
  oil_well: {
    id: 'oil_well', name: 'Oil Well', ...EX, size: { w: 2, h: 2 }, cost: 30000, maintenance: 450,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: true, recipes: ['r_oil'], storage: 160, era: 1910, pollution: 3,
    color: '#2a2622', description: 'A black gusher of progress, nodding day and night.',
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmill', ...FA, size: { w: 3, h: 3 }, cost: 20000, maintenance: 300,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_lumber'], storage: 120, era: 1900, pollution: 2,
    color: '#b5834f', description: 'Whining blades turn logs into lumber.',
  },
  flour_mill: {
    id: 'flour_mill', name: 'Flour Mill', ...FA, size: { w: 3, h: 3 }, cost: 18000, maintenance: 250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_flour'], storage: 120, era: 1900, pollution: 1,
    color: '#e9dfc7', description: 'Great stones grind the harvest to white flour.',
  },
  steel_mill: {
    id: 'steel_mill', name: 'Steel Mill', ...FA, workers: 120, size: { w: 3, h: 3 }, cost: 60000, maintenance: 750,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, recipes: ['r_steel'], storage: 120, era: 1900, pollution: 6,
    color: '#737d88', description: 'Blast furnaces roar; the sky turns the colour of iron.',
  },
  textile_mill: {
    id: 'textile_mill', name: 'Textile Mill', ...FA, size: { w: 3, h: 3 }, cost: 30000, maintenance: 400,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_fabric'], storage: 120, era: 1900, pollution: 2,
    color: '#9b6bb3', description: 'Hundreds of looms clatter in perfect step.',
  },
  glassworks: {
    id: 'glassworks', name: 'Glassworks', ...FA, size: { w: 3, h: 3 }, cost: 35000, maintenance: 450,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_glass'], storage: 120, era: 1900, pollution: 4,
    color: '#86cfc4', description: 'Molten sand, blown by hand and by machine.',
  },
  refinery: {
    id: 'refinery', name: 'Refinery', ...FA, size: { w: 3, h: 3 }, cost: 70000, maintenance: 900,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_fuel', 'r_plastic'], storage: 120, era: 1910, pollution: 8,
    color: '#c0702a', description: 'Towers of pipe cracking crude into fuel and wonder.',
  },
  furniture_factory: {
    id: 'furniture_factory', name: 'Furniture Factory', ...FA, size: { w: 3, h: 3 }, cost: 30000, maintenance: 350,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_furniture'], storage: 80, era: 1900, pollution: 1,
    color: '#7a4a25', description: 'Solid oak chairs for solid citizens.',
  },
  bakery: {
    id: 'bakery', name: 'Bakery', ...FA, size: { w: 2, h: 2 }, cost: 15000, maintenance: 200,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_bread'], storage: 120, era: 1900, pollution: 1,
    color: '#d99a52', description: 'The ovens are lit before the sun is up.',
  },
  toolworks: {
    id: 'toolworks', name: 'Toolworks', ...FA, size: { w: 3, h: 3 }, cost: 35000, maintenance: 450,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_tools'], storage: 80, era: 1900, pollution: 3,
    color: '#4e5e6e', description: 'Hammers, saws and spanners, forged to last a lifetime.',
  },
  clothing_factory: {
    id: 'clothing_factory', name: 'Clothing Factory', ...FA, size: { w: 3, h: 3 }, cost: 30000, maintenance: 400,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_clothes'], storage: 80, era: 1900, pollution: 1,
    color: '#3f6fa3', description: 'Stitched by the thousand for every size of gentleman.',
  },
  creamery: {
    id: 'creamery', name: 'Creamery', ...FA, size: { w: 2, h: 2 }, cost: 15000, maintenance: 200,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_cheese'], storage: 80, era: 1900, pollution: 1,
    color: '#f5d66b', description: 'Cheese aged in cool cellars, wheel by wheel.',
  },
  juice_plant: {
    id: 'juice_plant', name: 'Juice Plant', ...FA, size: { w: 2, h: 2 }, cost: 20000, maintenance: 250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_juice'], storage: 80, era: 1900, pollution: 1,
    color: '#f39a2e', description: 'Pure fruit, bottled for the modern temperance household.',
  },
  toy_factory: {
    id: 'toy_factory', name: 'Toy Factory', ...FA, size: { w: 2, h: 2 }, cost: 22000, maintenance: 250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_toys_wood', 'r_toys_plastic'], storage: 80, era: 1900, pollution: 1,
    color: '#ea6d9a', description: 'Tin soldiers and wooden trains for every nursery.',
  },
  car_plant: {
    id: 'car_plant', name: 'Car Plant', ...FA, workers: 120, size: { w: 4, h: 4 }, cost: 150000, maintenance: 2000,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_cars'], storage: 60, era: 1910, pollution: 5,
    color: '#b8322c', description: 'The moving line: a horseless carriage every few hours.',
  },
  electronics_plant: {
    id: 'electronics_plant', name: 'Electronics Plant', ...FA, size: { w: 3, h: 3 }, cost: 90000, maintenance: 1250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_radios', 'r_tvs', 'r_computers'], storage: 60, era: 1925, pollution: 2,
    color: '#2aa198', description: 'Valves, circuits and glowing screens, assembled with care.',
  },
  // R4 1900 works (before the store; none makes an old good)
  ranch: {
    id: 'ranch', name: 'Cattle Ranch', ...EX, size: { w: 3, h: 3 }, cost: 14000, maintenance: 200,
    allowedTerrain: ['grass'], requiresDeposit: false, recipes: ['r_cattle'], storage: 120, era: 1900, pollution: 1,
    color: '#9c6b3f', description: 'Longhorns on the open range, driven to the railhead.',
  },
  clay_pit: {
    id: 'clay_pit', name: 'Clay Pit', ...EX, size: { w: 2, h: 2 }, cost: 8000, maintenance: 125,
    allowedTerrain: ['grass', 'hills'], requiresDeposit: false, recipes: ['r_clay'], storage: 160, era: 1900, pollution: 1,
    color: '#b86b45', description: 'Stiff red clay, dug wet for the brick kilns.',
  },
  copper_mine: {
    id: 'copper_mine', name: 'Copper Mine', ...EX, size: { w: 2, h: 2 }, cost: 22000, maintenance: 350,
    allowedTerrain: ['hills', 'mountain'], requiresDeposit: false, recipes: ['r_copper_ore'], storage: 160, era: 1900, pollution: 3,
    color: '#5f7a68', description: 'Green-stained adits worked for copper ore.',
  },
  smelter: {
    id: 'smelter', name: 'Smelter', ...FA, size: { w: 3, h: 3 }, cost: 45000, maintenance: 600,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, recipes: ['r_copper'], storage: 120, era: 1900, pollution: 6,
    color: '#7a4e3a', description: 'Roaring furnaces that win copper, and later aluminium, from ore.',
  },
  tannery: {
    id: 'tannery', name: 'Tannery', ...FA, workers: 90, size: { w: 2, h: 2 }, cost: 18000, maintenance: 250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_leather'], storage: 120, era: 1900, pollution: 3,
    color: '#8c6d4f', description: 'Pits of bark liquor; the smell carries for a mile.',
  },
  sugar_refinery: {
    id: 'sugar_refinery', name: 'Sugar Refinery', ...FA, size: { w: 3, h: 3 }, cost: 25000, maintenance: 300,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_sugar'], storage: 120, era: 1900, pollution: 2,
    color: '#e9d9d0', description: 'Beet sliced, boiled and crystallised into white sugar.',
  },
  brickworks: {
    id: 'brickworks', name: 'Brickworks', ...FA, workers: 90, size: { w: 3, h: 3 }, cost: 20000, maintenance: 250,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, recipes: ['r_bricks'], storage: 160, era: 1900, pollution: 5,
    color: '#9e3b2b', description: 'Kilns fired day and night; the town is built of their bricks.',
  },
  paper_mill: {
    id: 'paper_mill', name: 'Paper Mill', ...FA, size: { w: 3, h: 3 }, cost: 28000, maintenance: 350,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_paper'], storage: 120, era: 1900, pollution: 3,
    color: '#d9cfb0', description: 'Pulp and rollers turn timber into reams of paper.',
  },
  machine_shop: {
    id: 'machine_shop', name: 'Machine Shop', ...FA, size: { w: 3, h: 3 }, cost: 40000, maintenance: 500,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, recipes: ['r_wire'], storage: 100, era: 1900, pollution: 3,
    color: '#56606b', description: 'Lathes and drop hammers making parts for other works.',
  },
  shoe_factory: {
    id: 'shoe_factory', name: 'Shoe Factory', ...FA, size: { w: 2, h: 2 }, cost: 20000, maintenance: 250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_shoes'], storage: 80, era: 1900, pollution: 1,
    color: '#5a3a26', description: 'Lasts, awls and stitching machines: boots for the nation.',
  },
  confectionery: {
    id: 'confectionery', name: 'Confectionery', ...FA, size: { w: 2, h: 2 }, cost: 16000, maintenance: 200,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_candy'], storage: 80, era: 1900, pollution: 1,
    color: '#f29bc0', description: 'Copper pans of boiling sugar, wrapped by the penny.',
  },
  print_works: {
    id: 'print_works', name: 'Print Works', ...FA, size: { w: 3, h: 3 }, cost: 25000, maintenance: 300,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_books'], storage: 80, era: 1900, pollution: 1,
    color: '#6e2f40', description: 'Presses thunder out books and almanacs.',
  },
  cannery: {
    id: 'cannery', name: 'Cannery', ...FA, size: { w: 2, h: 2 }, cost: 20000, maintenance: 250,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, recipes: ['r_canned_food'], storage: 80, era: 1900, pollution: 2,
    color: '#a8473f', description: 'Sealed tins of meat that keep a winter or a war.',
  },
  store: {
    id: 'store', name: 'Store', category: 'retail', workers: 12, size: { w: 2, h: 2 }, cost: 15000, maintenance: 200,
    allowedTerrain: ['grass', 'sand'], requiresDeposit: false, requiresCity: true, recipes: [], storage: 300, era: 1900, pollution: 0,
    color: '#e3b04b', description: 'A bright shopfront where the city comes to buy.',
  },
  // R4: sells materials and components at the national price (sim/trade.ts); stands outside towns
  trading_house: {
    id: 'trading_house', name: 'Trading House', category: 'trade', workers: 12, size: { w: 3, h: 2 }, cost: 35000, maintenance: 400,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, requiresCity: false, recipes: [], storage: 600, era: 1900, pollution: 0,
    color: '#7d6b4f', description: 'Brokers on the telephone sell your materials and parts to the whole nation.',
  },
  warehouse: {
    id: 'warehouse', name: 'Warehouse', category: 'logistics', workers: 6, size: { w: 3, h: 3 }, cost: 20000, maintenance: 150,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, requiresCity: false, recipes: [], storage: 1000, era: 1900, pollution: 0,
    color: '#8a8f99', description: 'Cavernous brick sheds holding goods until the wagons call.',
  },
  train_station: {
    id: 'train_station', name: 'Train Station', category: 'logistics', workers: 6, size: { w: 3, h: 2 }, cost: 40000, maintenance: 500,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, requiresCity: false, recipes: [], storage: 600, era: 1900, pollution: 0,
    color: '#4a4f5c', description: 'Iron girders, a clock tower and a whistle that carries for miles.',
  },
  // Phase 2: houses hands for a nearby factory (sim/politics/workforce.ts); employs nobody itself
  company_housing: {
    id: 'company_housing', name: 'Company Housing', category: 'logistics', workers: 0, size: { w: 2, h: 2 }, cost: 8000, maintenance: 120,
    allowedTerrain: ['grass', 'sand', 'hills'], requiresDeposit: false, requiresCity: false, recipes: [], storage: 0, era: 1900, pollution: 0,
    color: '#9c5a44', description: 'Neat brick terraces beside the works: more hands, and grateful ones.',
  },
};

/** Company housing must stand within this many tiles (Chebyshev, footprint to footprint) of a player factory. */
export const HOUSING_RADIUS = 3;
/** Hands one company housing adds to the labour pool of its factory's town. */
export const HOUSING_POOL = 150;
/** Workers' opinion gained, once, in that town when company housing goes up. */
export const HOUSING_OPINION = 3;

export function getBuilding(id: string): BuildingDef {
  const building = BUILDINGS[id];
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
}
