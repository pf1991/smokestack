/**
 * One owner's supply chain into a city's store, built only through the public sim API
 * (findPlacement, placeBuilding, buildRoad, createRoute, buyTruck), every call charged to `owner`.
 * Debug autoplay builds the player's furniture chain with it; regional firms (regional/firms.ts)
 * found theirs with it.
 */
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { connectToRoads, ensureRoadLink } from './roads';
import { suggestStops } from './routeHelpers';
import { canPlaceBuilding, findPlacement, placeBuilding } from './state';
import type { Building, BuildingTypeId, City, OwnerId, SimContext, Vec2 } from './types';
import { buyTruck, createRoute } from './vehicles';

export type ChainId = 'furniture' | 'clothes' | 'cheese' | 'shoes';

export interface ChainStage {
  typeId: BuildingTypeId;
  recipeId: string;
}

/** Each chain's recipes, extractor first; the store at the end is implied. */
const CHAIN_RECIPES: Record<ChainId, string[]> = {
  furniture: ['r_wood', 'r_lumber', 'r_furniture'],
  clothes: ['r_cotton', 'r_fabric', 'r_clothes'],
  cheese: ['r_milk', 'r_cheese'],
  shoes: ['r_cattle', 'r_leather', 'r_shoes'],
};

/** The building type that makes `recipeId` (first match in BUILDINGS). */
function buildingFor(recipeId: string): BuildingTypeId {
  const def = Object.values(BUILDINGS).find((b) => b.recipes.includes(recipeId));
  if (!def) throw new Error(`No building makes ${recipeId}`);
  return def.id;
}

/** Each chain's stages (extractor → … → final factory), building types taken from data/buildings.ts. */
export const CHAINS: Record<ChainId, ChainStage[]> = Object.fromEntries(
  Object.entries(CHAIN_RECIPES).map(([id, recipes]) => [id, recipes.map((r) => ({ typeId: buildingFor(r), recipeId: r }))]),
) as Record<ChainId, ChainStage[]>;

/**
 * Nearest spot to `near` where `owner` can place the extractor, scanning the map's tiles of its
 * terrain by Manhattan distance (forest for a lumber camp, grass for farms).
 */
function extractorSpot(ctx: SimContext, owner: OwnerId, typeId: BuildingTypeId, near: Vec2): Vec2 | null {
  const { state } = ctx;
  const { map } = state;
  const terrain = BUILDINGS[typeId].allowedTerrain;
  const cands: { p: Vec2; d: number }[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (!terrain.includes(map.tiles[i].terrain)) continue;
    const p = { x: i % map.width, y: Math.floor(i / map.width) };
    cands.push({ p, d: Math.abs(p.x - near.x) + Math.abs(p.y - near.y) });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) if (canPlaceBuilding(state, owner, typeId, c.p).ok) return c.p;
  return null;
}

function place(ctx: SimContext, owner: OwnerId, stage: { typeId: BuildingTypeId; recipeId?: string }, near: Vec2, radius = 25): Result<Building> {
  const pos = findPlacement(ctx.state, owner, stage.typeId, near, radius);
  if (!pos) return err(`No room for ${stage.typeId}`);
  return placeBuilding(ctx, owner, stage.typeId, pos, stage.recipeId);
}

/** The route of `owner` hauling from `a` straight to `b`, if any. */
export function legRoute(ctx: SimContext, owner: OwnerId, a: Building, b: Building): number | null {
  const r = Object.values(ctx.state.routes).find(
    (x) => x.ownerId === owner && x.stops.length === 2 && x.stops[0].buildingId === a.id && x.stops[1].buildingId === b.id,
  );
  return r ? r.id : null;
}

/**
 * Builds `chain` for `owner` into a store in `city`: the store (near the centre), the final factory,
 * the extractor on the nearest suitable land to the factory, then any middle stage between the two;
 * road access for each, a road link per leg, one route per leg and `trucksPerLeg` trucks on each
 * (round by round, so every leg has its first truck before any has a second).
 * `opts.near` places the final factory (and so the extractor and middle stages) near that spot instead
 * of the town centre; `opts.routes: false` links the roads but builds no routes or trucks.
 * Returns the chain's buildings, extractor first and store last, or the first error. A failure part
 * way leaves what was already built (callers that need all-or-nothing dry-run it first).
 */
export function buildChain(
  ctx: SimContext,
  owner: OwnerId,
  city: City,
  chain: ChainId,
  trucksPerLeg = 2,
  opts: { routes?: boolean; near?: Vec2 } = {},
): Result<Building[]> {
  const stages = CHAINS[chain];
  const last = stages[stages.length - 1];
  const store = place(ctx, owner, { typeId: 'store' }, city.center, 10);
  if (!store.ok) return store;
  const factory = place(ctx, owner, last, opts.near ?? city.center);
  if (!factory.ok) return factory;
  const first = stages[0];
  const spot = extractorSpot(ctx, owner, first.typeId, factory.value.pos);
  if (!spot) return err(`No site for a ${BUILDINGS[first.typeId].name.toLowerCase()}`);
  const extractor = placeBuilding(ctx, owner, first.typeId, spot, first.recipeId);
  if (!extractor.ok) return extractor;
  // middle stages spaced evenly on the line from the extractor to the factory
  const middle: Building[] = [];
  const n = stages.length - 1;
  for (let k = 1; k < n; k++) {
    const a = extractor.value.pos;
    const b = factory.value.pos;
    const at = { x: Math.round((a.x * (n - k) + b.x * k) / n), y: Math.round((a.y * (n - k) + b.y * k) / n) };
    const m = place(ctx, owner, stages[k], at);
    if (!m.ok) return m;
    middle.push(m.value);
  }

  const built = [extractor.value, ...middle, factory.value, store.value];
  for (const b of built) {
    const r = connectToRoads(ctx, b, { owner });
    if (!r.ok) return r;
  }
  const routes: number[] = [];
  for (let i = 0; i + 1 < built.length; i++) {
    const a = built[i];
    const b = built[i + 1];
    const link = ensureRoadLink(ctx, owner, a, b);
    if (!link.ok) return link;
    if (opts.routes === false) continue;
    const good = Object.keys(RECIPES[stages[i].recipeId].outputs)[0];
    const route = createRoute(ctx, owner, `${GOODS[good]?.name ?? good} line`, suggestStops(ctx.state, [a.id, b.id]));
    if (!route.ok) return route;
    routes.push(route.value.id);
  }
  for (let k = 0; k < trucksPerLeg; k++) {
    for (const id of routes) {
      const t = buyTruck(ctx, owner, id);
      if (!t.ok) return t;
    }
  }
  return ok(built);
}
