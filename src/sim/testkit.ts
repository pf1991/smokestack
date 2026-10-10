import { EventBus } from '../core/events';
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { BUILDINGS } from '../data/buildings';
import { START_DATE } from './clock';
import { createCompany, STARTING_MONEY } from './finance';
import { urbanRadius } from './market';
import { findPath, roadBuildable, waterAvoidingCost } from './pathfinding';
import { accessTiles, buildRoad, layCityStreets, refreshUrbanTiles, unlockedAt } from './state';
import type { Building, City, GameMap, GameState, SimContext, Terrain, Vec2 } from './types';

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

/**
 * Connects a building to the existing road network: if it already has an access road tile it does
 * nothing; otherwise it paths (roadBuildable, water-avoiding) from each buildable tile orthogonally
 * adjacent to the footprint to the `targetCount` road tiles nearest the building, and builds the
 * shortest such path with `buildRoad` (paid by the building's owner). Returns the tiles built.
 */
export function connectToRoads(ctx: SimContext, building: Building, targetCount = 24): Result<{ built: number; cost: number }> {
  const { state } = ctx;
  const { map } = state;
  if (accessTiles(state, building).length > 0) return ok({ built: 0, cost: 0 });
  const { w, h } = BUILDINGS[building.typeId].size;
  const { x: bx, y: by } = building.pos;
  const starts: Vec2[] = [];
  for (let y = by - 1; y <= by + h; y++) {
    for (let x = bx - 1; x <= bx + w; x++) {
      const insideX = x >= bx && x < bx + w;
      const insideY = y >= by && y < by + h;
      if (insideX === insideY) continue;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (roadBuildable(map.tiles[y * map.width + x], x, y)) starts.push({ x, y });
    }
  }
  const cx = bx + w / 2;
  const cy = by + h / 2;
  const roads: { p: Vec2; d: number }[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (!map.tiles[i].road) continue;
    const p = { x: i % map.width, y: Math.floor(i / map.width) };
    roads.push({ p, d: Math.abs(p.x - cx) + Math.abs(p.y - cy) });
  }
  roads.sort((a, b) => a.d - b.d);
  const targets = roads.slice(0, targetCount).map((r) => r.p);
  let best: Vec2[] | null = null;
  for (const s of starts) {
    const path = findPath(map, s, targets, roadBuildable, waterAvoidingCost);
    if (path && (!best || path.length < best.length)) best = path;
  }
  if (!best) return err('No road can reach this building');
  return buildRoad(ctx, building.ownerId, best);
}
