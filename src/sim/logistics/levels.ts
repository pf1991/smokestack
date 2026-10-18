import { BUILDINGS } from '../../data/buildings';
import { WAREHOUSE_LEVELS, WORKS_LEVELS, type LevelDef } from '../../data/levels';
import type { Building } from '../types';

/**
 * Effective level-scaled values. Every reader of a placed building's storage, workers, rate, upkeep,
 * smoke or hub range goes through here, never through BUILDINGS[t].storage or .workers directly.
 * Each is the catalogue value times the level factor, and times 1 when the building has no table.
 */

/** The level row of `b`: the works table for extractors and factories, the warehouse table for a warehouse, else null. */
export function levelDef(b: Building): LevelDef | null {
  if (b.typeId === 'warehouse') return WAREHOUSE_LEVELS[b.level - 1] ?? null;
  const cat = BUILDINGS[b.typeId]?.category;
  if (cat === 'extractor' || cat === 'factory') return WORKS_LEVELS[b.level - 1] ?? null;
  return null;
}

export function buildingStorage(b: Building): number {
  return Math.round(BUILDINGS[b.typeId].storage * (levelDef(b)?.storage ?? 1));
}

export function buildingWorkers(b: Building): number {
  // rounded to 1e-6 so 60 x 1.6 is 96, not 96.00000000000001
  return Math.round(BUILDINGS[b.typeId].workers * (levelDef(b)?.workers ?? 1) * 1e6) / 1e6;
}

export function levelRate(b: Building): number {
  return levelDef(b)?.rate ?? 1;
}

export function levelUpkeep(b: Building): number {
  return levelDef(b)?.upkeep ?? 1;
}

export function levelSmoke(b: Building): number {
  return levelDef(b)?.smoke ?? 1;
}

/** Hub range in tiles; 0 for anything but a warehouse. */
export function hubRange(b: Building): number {
  return b.typeId === 'warehouse' ? (levelDef(b)?.range ?? 0) : 0;
}
