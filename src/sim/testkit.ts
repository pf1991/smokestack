import { EventBus } from '../core/events';
import type { Result } from '../core/result';
import { START_DATE } from './clock';
import { SAVE_VERSION } from './version';
import { defaultOpinion } from '../data/factions';
import { defaultPolitics } from './politics/types';
import { monthIndex, newCityPolitics } from './politics/elections';
import { createCompany, STARTING_MONEY } from './finance';
import { urbanRadius } from './market';
import { connectToRoads, ensureRoadLink } from './roads';
import { suggestStops } from './routeHelpers';
import { createGame, findPlacement, layCityStreets, placeBuilding, refreshUrbanTiles, unlockedAt } from './state';
import type { Building, BuildingTypeId, City, GameMap, GameState, SimContext, Terrain, Vec2 } from './types';
import { buyTruck, createRoute } from './vehicles';

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
      landmarks: [],
      opinion: defaultOpinion(),
      politics: newCityPolitics(id, year, monthIndex({ year, month: 4 })),
    };
  });
  const player = createCompany('player', 'Test Co.', opts.money ?? STARTING_MONEY);
  const rival = createCompany('rival', 'Rival Co.', opts.rivalMoney ?? STARTING_MONEY);
  const state: GameState = {
    version: SAVE_VERSION,
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
    layers: {},
    politics: defaultPolitics(),
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

/**
 * The balance "reference strategy" (the Task 17 headless furniture chain plus bread), used by
 * balance.test.ts: in the city with the nearest forest, lumber camp → sawmill → furniture factory →
 * store, and farm (grain) + dairy farm → flour mill → bakery → the same store, with `trucksPerLeg`
 * trucks on each of the 7 legs. Throws if the map cannot host it.
 */
export function buildReferenceStrategy(
  seed: number,
  opts: { rival?: boolean; trucksPerLeg?: number } = {},
): { ctx: SimContext; city: City } {
  const state = createGame({ seed, companyName: 'Reference Co.', rival: opts.rival ?? false });
  const ctx: SimContext = { state, bus: new EventBus() };
  let city = state.cities[0];
  let campPos: Vec2 | null = null;
  let best = Infinity;
  for (const c of state.cities) {
    const p = findPlacement(state, 'player', 'lumber_camp', c.center, 30);
    // Euclidean distance from the town's edge (urbanRadius is a Euclidean disc): bigger towns push
    // industry further out, which is not a worse site
    const d = p ? Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.urbanRadius : Infinity;
    if (p && d < best) {
      best = d;
      city = c;
      campPos = p;
    }
  }
  if (!campPos) throw new Error('no forest for a lumber camp');
  const place = (typeId: BuildingTypeId, near: Vec2): Building => {
    const pos = findPlacement(state, 'player', typeId, near, 30);
    if (!pos) throw new Error(`no placement for ${typeId}`);
    const b = must(placeBuilding(ctx, 'player', typeId, pos));
    must(connectToRoads(ctx, b));
    return b;
  };
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', campPos));
  must(connectToRoads(ctx, camp));
  const mid = { x: Math.round((campPos.x + city.center.x) / 2), y: Math.round((campPos.y + city.center.y) / 2) };
  const mill = place('sawmill', mid);
  const factory = place('furniture_factory', mid);
  const store = place('store', city.center);
  const farm = place('farm', city.center);
  const dairy = place('dairy_farm', city.center);
  const flourMill = place('flour_mill', city.center);
  const bakery = place('bakery', city.center);
  const legs: [Building, Building][] = [
    [camp, mill],
    [mill, factory],
    [factory, store],
    [farm, flourMill],
    [flourMill, bakery],
    [dairy, bakery],
    [bakery, store],
  ];
  for (const [a, b] of legs) {
    must(ensureRoadLink(ctx, 'player', a, b));
    const route = must(createRoute(ctx, 'player', `${a.typeId} to ${b.typeId}`, suggestStops(state, [a.id, b.id])));
    for (let i = 0; i < (opts.trucksPerLeg ?? 2); i++) must(buyTruck(ctx, 'player', route.id));
  }
  return { ctx, city };
}
