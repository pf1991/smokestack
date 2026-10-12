import type { EventBus } from '../core/events';
import type { FactionId } from '../data/factions';
import type { LandmarkId } from '../data/landmarks';
import type { PoliticsState } from './politics/types';

export type GoodId = string;
export type BuildingTypeId = string;
export type OwnerId = string;
export type CompanyKind = 'player' | 'baron' | 'regional';
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
  /** 0..1 share of `workers` the building could hire, recomputed monthly (sim/politics/workforce.ts) */
  staffing: number;
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
  /** civic landmarks in the order they were built; each is a 2×2 block with top-left `pos` (sim/landmarks.ts) */
  landmarks: { id: LandmarkId; pos: Vec2 }[];
  /** each faction's opinion of the player's company, 0..100; written only by sim/politics/factions.ts */
  opinion: Record<FactionId, number>;
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
  /** ticks at which this vehicle completed an unloading stop (pruned to the last 30 days); absent in old saves */
  trips30?: number[];
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
  kind: CompanyKind;
  name: string;
  money: number;
  loan: number;
  ledger: LedgerMonth[];
  monthsInRed: number;
  roadTiles: number;
  railTiles: number;
  active: boolean;
}

export type NewsKind = 'historic' | 'civic' | 'random' | 'invention' | 'market' | 'rival' | 'contract' | 'warning' | 'politics';

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

/**
 * The Baron's railway under construction: a long truck leg (`routeId`, source → dest hauling `goodId`)
 * being replaced by truck feeder → train → truck feeder. Plain JSON; built one stage per month.
 */
export interface RivalRailProject {
  routeId: number;
  sourceId: number;
  destId: number;
  goodId: GoodId;
  /** road length of the truck leg when the project began */
  legTiles: number;
  /** candidate station sites along the surveyed track, nearest each end first */
  anchorsA: Vec2[];
  anchorsB: Vec2[];
  /** 0 station A, 1 station B, 2 track, 3 routes and train */
  stage: number;
  stationA: number | null;
  stationB: number | null;
  /** tile indices of the track this project laid (removed again if it is abandoned) */
  railTiles: number[];
  /** consecutive months spent waiting for money */
  stall: number;
}

export type Speed = 0 | 1 | 2 | 4 | 8;

export interface GameState {
  version: number;
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
  /** the Baron's railway in progress; absent in saves from before rival railways */
  rivalRail?: RivalRailProject | null;
  /** primitives only; timed effects store dateToDays() numbers, e.g. flags.railStrikeUntil */
  flags: Record<string, number | boolean | string>;
  /** per-tile numeric layers (width*height each); see sim/layers.ts. Packed in saves. */
  layers: Record<string, number[]>;
  /** Phase 2 politics (sim/politics); added to old saves by the v5 migration */
  politics: PoliticsState;
}

export interface SimContext {
  state: GameState;
  bus: EventBus;
}
