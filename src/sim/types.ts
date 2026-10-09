import type { EventBus } from '../core/events';

export type GoodId = string;
export type BuildingTypeId = string;
export type OwnerId = 'player' | 'rival';
export type Vec2 = { x: number; y: number };
export type Inventory = Record<GoodId, number>;

export type Terrain = 'water' | 'sand' | 'grass' | 'forest' | 'hills' | 'mountain';

export interface Tile {
  terrain: Terrain;
  deposit: GoodId | null;
  road: boolean;
  rail: boolean;
  /** company that built (and pays upkeep for) this road; null for pre-built or unowned road */
  roadOwner: OwnerId | null;
  /** company that built this rail; null when unowned */
  railOwner: OwnerId | null;
  buildingId: number | null;
  cityId: number | null;
  pollution: number;
}

export interface GameMap {
  width: number;
  height: number;
  /** index = y * width + x */
  tiles: Tile[];
}

export interface GameDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-30 */
  day: number;
  /** 0-23 */
  hour: number;
}

export type BuildingStatus = 'ok' | 'no_input' | 'output_full' | 'halted' | 'idle';

export interface Building {
  id: number;
  typeId: BuildingTypeId;
  ownerId: OwnerId;
  /** top-left tile of the footprint */
  pos: Vec2;
  recipeId: string | null;
  input: Inventory;
  output: Inventory;
  /** 0..1 progress of the current recipe cycle */
  progress: number;
  status: BuildingStatus;
  cityId: number | null;
  haltedUntil: GameDate | null;
  producedThisMonth: Inventory;
}

export interface MarketEntry {
  sold30: number;
  demand30: number;
  /** fractional unmet demand carried day to day */
  pending: number;
}

export interface City {
  id: number;
  name: string;
  center: Vec2;
  population: number;
  /** population before the last monthly growth step (for trend arrows) */
  prevPopulation: number;
  /** 0..1 */
  happiness: number;
  /** 0..1 */
  pollution: number;
  market: Record<GoodId, MarketEntry>;
  urbanRadius: number;
}

export interface RouteStop {
  buildingId: number;
  load: GoodId[];
  unload: GoodId[];
}

export interface Route {
  id: number;
  ownerId: OwnerId;
  name: string;
  color: string;
  stops: RouteStop[];
  kind: 'truck' | 'train';
}

export type VehicleState = 'moving' | 'loading' | 'stuck' | 'idle';

export interface Vehicle {
  id: number;
  kind: 'truck' | 'train';
  ownerId: OwnerId;
  routeId: number | null;
  /** float tile coordinates */
  pos: Vec2;
  prevPos: Vec2;
  path: Vec2[];
  pathIndex: number;
  stopIndex: number;
  cargo: Inventory;
  capacity: number;
  state: VehicleState;
  waitTicks: number;
  stuckNotified: boolean;
}

export type LedgerCategory =
  | 'sales'
  | 'construction'
  | 'maintenance'
  | 'vehicles'
  | 'interest'
  | 'contracts'
  | 'events'
  | 'demolition';

export interface LedgerMonth {
  year: number;
  month: number;
  income: Partial<Record<LedgerCategory, number>>;
  expense: Partial<Record<LedgerCategory, number>>;
  salesByGood: Partial<Record<GoodId, number>>;
  cashEnd: number;
  netWorthEnd: number;
}

export interface Company {
  id: OwnerId;
  name: string;
  money: number;
  loan: number;
  ledger: LedgerMonth[];
  monthsInRed: number;
  roadTiles: number;
  railTiles: number;
  active: boolean;
}

export type NewsKind = 'historic' | 'random' | 'invention' | 'market' | 'rival' | 'contract' | 'warning';

export interface NewsItem {
  id: number;
  date: GameDate;
  headline: string;
  body: string;
  kind: NewsKind;
}

export interface DemandModifier {
  id: string;
  goodId: GoodId | '*';
  cityId: number | null;
  factor: number;
  until: GameDate;
}

export interface Contract {
  id: number;
  cityId: number;
  goodId: GoodId;
  qty: number;
  delivered: number;
  deadline: GameDate;
  reward: number;
  status: 'offered' | 'active' | 'done' | 'failed';
}

export interface RivalProject {
  cityId: number;
  goodId: GoodId;
  stage: number;
}

export type Speed = 0 | 1 | 2 | 4 | 8;

export interface GameState {
  version: 1;
  seed: number;
  rngState: number;
  date: GameDate;
  tick: number;
  map: GameMap;
  buildings: Record<number, Building>;
  cities: City[];
  vehicles: Record<number, Vehicle>;
  routes: Record<number, Route>;
  companies: Record<OwnerId, Company>;
  news: NewsItem[];
  modifiers: DemandModifier[];
  contracts: Contract[];
  unlocked: string[];
  nextId: number;
  speed: Speed;
  scenarioId: string;
  rivalProject: RivalProject | null;
  /** primitives only; timed effects store dateToDays() numbers, e.g. flags.railStrikeUntil */
  flags: Record<string, number | boolean | string>;
}

export interface SimContext {
  state: GameState;
  bus: EventBus;
}
