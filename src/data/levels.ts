import type { BuildingLevel } from '../sim/logistics/types';

/**
 * Building level tables (Phase 4b spec section 4.1), indexed by level - 1. Factors multiply the
 * catalogue value; level 1 is all ones. `costShare` is the share of the catalogue build cost an
 * upgrade to this level costs; `days` is the works time; `year` is the first year it is available.
 */
export interface LevelDef {
  level: BuildingLevel;
  year: number;
  rate: number;
  workers: number;
  upkeep: number;
  storage: number;
  smoke: number;
  costShare: number;
  days: number;
  /** warehouses only: hub range in tiles */
  range?: number;
  /** warehouses only: hub truck cap */
  hubTrucks?: number;
}

/** Extractors and factories. */
export const WORKS_LEVELS: readonly LevelDef[] = [
  { level: 1, year: 1900, rate: 1, workers: 1, upkeep: 1, storage: 1, smoke: 1, costShare: 0, days: 0 },
  { level: 2, year: 1900, rate: 1.4, workers: 1.3, upkeep: 1.3, storage: 1.4, smoke: 1.3, costShare: 0.5, days: 30 },
  { level: 3, year: 1920, rate: 1.8, workers: 1.6, upkeep: 1.6, storage: 1.8, smoke: 1.6, costShare: 0.75, days: 45 },
  { level: 4, year: 1950, rate: 2.2, workers: 1.9, upkeep: 1.9, storage: 2.2, smoke: 1.9, costShare: 1, days: 60 },
];

/** Warehouses (storage is a factor on the catalogue 1,000: 1,000 / 1,500 / 2,000). */
export const WAREHOUSE_LEVELS: readonly LevelDef[] = [
  { level: 1, year: 1900, rate: 1, workers: 1, upkeep: 1, storage: 1, smoke: 1, costShare: 0, days: 0, range: 12, hubTrucks: 4 },
  { level: 2, year: 1900, rate: 1, workers: 1, upkeep: 1.3, storage: 1.5, smoke: 1, costShare: 0.5, days: 30, range: 16, hubTrucks: 6 },
  { level: 3, year: 1930, rate: 1, workers: 1, upkeep: 1.6, storage: 2, smoke: 1, costShare: 0.75, days: 45, range: 20, hubTrucks: 8 },
];
