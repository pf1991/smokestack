import { EventBus } from '../core/events';
import type { Result } from '../core/result';
import { START_DATE } from './clock';
import { createCompany, STARTING_MONEY } from './finance';
import { urbanRadius } from './market';
import { layCityStreets, refreshUrbanTiles, unlockedAt } from './state';
import type { City, GameMap, GameState, SimContext, Terrain } from './types';

/** A w×h map filled with one terrain, no deposits, roads or buildings. */
export function flatMap(w: number, h: number, terrain: Terrain = 'grass'): GameMap {
  const tiles = [];
  for (let i = 0; i < w * h; i++) {
    tiles.push({
      terrain,
      deposit: null,
      road: false,
      rail: false,
      buildingId: null,
      cityId: null,
      pollution: 0,
      roadOwner: null,
      railOwner: null,
    });
  }
  return { width: w, height: h, tiles };
}

export interface TestCityOpts {
  x: number;
  y: number;
  population?: number;
  name?: string;
}

export interface TestStateOpts {
  width?: number;
  height?: number;
  terrain?: Terrain;
  money?: number;
  rivalMoney?: number;
  cities?: TestCityOpts[];
  /** lay the createGame-style street grid in each city (default false) */
  streets?: boolean;
  /** unlock everything with era <= year (default 1900) */
  year?: number;
  seed?: number;
}

/** A small hand-made GameState (default 40×30 grass, no cities, $300,000). */
export function testState(opts: TestStateOpts = {}): GameState {
  const width = opts.width ?? 40;
  const height = opts.height ?? 30;
  const year = opts.year ?? 1900;
  const cities: City[] = (opts.cities ?? []).map((c, id) => {
    const population = c.population ?? 6000;
    return {
      id,
      name: c.name ?? `Town ${id}`,
      center: { x: c.x, y: c.y },
      population,
      prevPopulation: population,
      happiness: 0.7,
      pollution: 0,
      market: {},
      urbanRadius: urbanRadius(population),
    };
  });
  const player = createCompany('player', 'Test Co.', opts.money ?? STARTING_MONEY);
  const rival = createCompany('rival', 'Rival Co.', opts.rivalMoney ?? STARTING_MONEY);
  const state: GameState = {
    version: 1,
    seed: opts.seed ?? 1,
    rngState: opts.seed ?? 1,
    date: { ...START_DATE, year },
    tick: 0,
    map: flatMap(width, height, opts.terrain ?? 'grass'),
    buildings: {},
    cities,
    vehicles: {},
    routes: {},
    companies: { player, rival },
    news: [],
    modifiers: [],
    contracts: [],
    unlocked: unlockedAt(year),
    nextId: 1,
    speed: 1,
    scenarioId: 'test',
    rivalProject: null,
    flags: {},
  };
  if (opts.streets) for (const c of state.cities) layCityStreets(state.map, c);
  refreshUrbanTiles(state);
  return state;
}

export function testCtx(state: GameState = testState()): SimContext {
  return { state, bus: new EventBus() };
}

/** Unwraps a Result, throwing its error message (tests only). */
export function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Moved to roads.ts (real games use it too); re-exported so existing imports keep working. */
export { connectToRoads } from './roads';
