import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { acceptsGood, handlesCargo, loadSource } from './inventory';
import { findPath, roadPassable } from './pathfinding';
import { accessTiles } from './state';
import type { Building, GameState, GoodId, Route, RouteStop } from './types';
import { TRUCK, VEHICLE_KINDS } from './vehicles';

/** Ticks in a game month (30 days x 24 ticks). */
export const TICKS_PER_MONTH = 720;

/** Goods a building hands to trucks: its recipe outputs, or whatever a warehouse/station holds (stores and Trading Houses hand out nothing). */
export function offeredGoods(b: Building): GoodId[] {
  const def = BUILDINGS[b.typeId];
  if (!def || def.category === 'retail' || def.category === 'trade' || !handlesCargo(b)) return [];
  if (def.category === 'logistics') return Object.keys(loadSource(b));
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  return recipe ? Object.keys(recipe.outputs) : [];
}

/** Goods worth offering as unload chips: what the recipe consumes; every accepted good for stores/depots. */
export function acceptedGoods(b: Building): GoodId[] {
  const def = BUILDINGS[b.typeId];
  if (!def || def.category === 'extractor') return [];
  if (def.category === 'factory') {
    const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
    return recipe ? Object.keys(recipe.inputs) : [];
  }
  return Object.keys(GOODS).filter((g) => acceptsGood(b, g));
}

/**
 * Suggested load/unload for a stop appended after `prevStops`: it loads what it offers that an
 * earlier stop accepts (everything it offers when it is the first stop) and unloads what the
 * previous stops load that it accepts.
 */
export function suggestStop(state: GameState, buildingId: number, prevStops: RouteStop[]): RouteStop {
  const b = state.buildings[buildingId];
  if (!b) return { buildingId, load: [], unload: [] };
  const prev = prevStops.map((s) => state.buildings[s.buildingId]).filter((x): x is Building => x !== undefined);
  const load = offeredGoods(b).filter((g) => prev.length === 0 || prev.some((p) => acceptsGood(p, g)));
  const unload = [...new Set(prevStops.flatMap((s) => s.load))].filter((g) => acceptsGood(b, g));
  return { buildingId, load, unload };
}

/** Appends a stop pre-filled by `suggestStop`; earlier stops also start loading what the new one accepts. */
export function appendStop(state: GameState, stops: RouteStop[], buildingId: number): RouteStop[] {
  const nb = state.buildings[buildingId];
  // a building that takes no cargo is never offered as a stop
  if (nb && !handlesCargo(nb)) return stops.map((s) => ({ buildingId: s.buildingId, load: [...s.load], unload: [...s.unload] }));
  const updated = stops.map((s) => {
    const sb = state.buildings[s.buildingId];
    const extra = sb && nb ? offeredGoods(sb).filter((g) => acceptsGood(nb, g) && !s.load.includes(g)) : [];
    return { buildingId: s.buildingId, load: [...s.load, ...extra], unload: [...s.unload] };
  });
  return [...updated, suggestStop(state, buildingId, updated)];
}

/** Pairwise suggestion for a whole list of buildings (used by autoplay). */
export function suggestStops(state: GameState, buildingIds: number[]): RouteStop[] {
  const bs = buildingIds.map((id) => state.buildings[id]).filter((b): b is Building => b !== undefined && handlesCargo(b));
  const loads = bs.map((b, i) => offeredGoods(b).filter((g) => bs.some((o, j) => j !== i && acceptsGood(o, g))));
  return bs.map((b, i) => ({
    buildingId: b.id,
    load: loads[i],
    unload: [...new Set(loads.flatMap((l, j) => (j === i ? [] : l)))].filter((g) => acceptsGood(b, g)),
  }));
}

/**
 * Length in tiles of the path between two buildings' access tiles for a vehicle `kind` (road for
 * trucks, rail for trains), or null when unreachable.
 */
export function legLength(state: GameState, a: Building, b: Building, kind: Route['kind'] = 'truck'): number | null {
  const def = VEHICLE_KINDS[kind];
  const access = def?.access ?? accessTiles;
  const from = access(state, a)[0];
  const targets = access(state, b);
  if (!from || targets.length === 0) return null;
  const path = findPath(state.map, from, targets, def?.passable ?? roadPassable);
  return path ? path.length - 1 : null;
}

/** Round-trip duration in ticks (travel plus dwell at each stop), or null if any leg has no road. */
export function roundTripTicks(state: GameState, routeId: number): number | null {
  const route = state.routes[routeId];
  if (!route || route.stops.length < 2) return null;
  const spec = VEHICLE_KINDS[route.kind]?.spec ?? TRUCK;
  let tiles = 0;
  for (let i = 0; i < route.stops.length; i++) {
    const a = state.buildings[route.stops[i].buildingId];
    const b = state.buildings[route.stops[(i + 1) % route.stops.length].buildingId];
    if (!a || !b) return null;
    const len = legLength(state, a, b, route.kind);
    if (len === null) return null;
    tiles += len;
  }
  return tiles / spec.speed + route.stops.length * spec.loadTicks;
}

/** Estimated units per month: trucks x capacity x 720 / round-trip ticks. */
export function routeThroughput(state: GameState, routeId: number): number {
  const route = state.routes[routeId];
  if (!route) return 0;
  const spec = VEHICLE_KINDS[route.kind]?.spec ?? TRUCK;
  const trucks = Object.values(state.vehicles).filter((v) => v.routeId === routeId).length;
  const trip = roundTripTicks(state, routeId);
  if (trucks === 0 || trip === null || trip <= 0) return 0;
  return (trucks * spec.capacity * TICKS_PER_MONTH) / trip;
}
