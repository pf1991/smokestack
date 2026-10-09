import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { GOODS } from '../data/goods';
import { COMPANY_NAMES } from '../data/names';
import { getRecipe, RECIPES, recipeEra } from '../data/recipes';
import { START_DATE } from './clock';
import { canAfford, createCompany, earn, spend } from './finance';
import { generateMap } from './mapgen';
import { urbanRadius } from './market';
import { findPath, roadBuildable, waterAvoidingCost } from './pathfinding';
import { pick } from './rng';
import type { Building, BuildingTypeId, City, GameMap, GameState, OwnerId, SimContext, Tile, Vec2 } from './types';

export const ROAD_COST = 500;
export const BRIDGE_COST = 3000;
export const DEMOLITION_REFUND = 0.25;
/** Purchase prices used for asset valuation (Task 14/27 own the TRUCK/TRAIN specs). */
const VEHICLE_COST = { truck: 8000, train: 60000 } as const;
const RIVAL_NAME = 'Smogsworth Consolidated';

// ---------------------------------------------------------------------------
// small helpers

export function nextId(state: GameState): number {
  return state.nextId++;
}

function tileOf(map: GameMap, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x];
}

/** Ids of goods, buildings and recipes available in `year`. */
export function unlockedAt(year: number): string[] {
  const ids: string[] = [];
  for (const g of Object.values(GOODS)) if (g.era <= year) ids.push(g.id);
  for (const b of Object.values(BUILDINGS)) if (b.era <= year) ids.push(b.id);
  for (const id of Object.keys(RECIPES)) if (recipeEra(id) <= year) ids.push(id);
  return ids;
}

/** True when (x,y) lies inside a circle of radius r around c (Euclidean, inclusive). */
function inRadius(c: Vec2, r: number, x: number, y: number): boolean {
  const dx = x - c.x;
  const dy = y - c.y;
  return dx * dx + dy * dy <= r * r;
}

// ---------------------------------------------------------------------------
// geometry

export function footprint(b: { typeId: BuildingTypeId; pos: Vec2 }): Vec2[] {
  const { w, h } = BUILDINGS[b.typeId].size;
  const out: Vec2[] = [];
  for (let y = b.pos.y; y < b.pos.y + h; y++) for (let x = b.pos.x; x < b.pos.x + w; x++) out.push({ x, y });
  return out;
}

/** Road tiles orthogonally adjacent to the footprint, scanned row by row. */
export function accessTiles(state: GameState, building: { typeId: BuildingTypeId; pos: Vec2 }): Vec2[] {
  const { w, h } = BUILDINGS[building.typeId].size;
  const { x: bx, y: by } = building.pos;
  const out: Vec2[] = [];
  for (let y = by - 1; y <= by + h; y++) {
    for (let x = bx - 1; x <= bx + w; x++) {
      const insideX = x >= bx && x < bx + w;
      const insideY = y >= by && y < by + h;
      if (insideX === insideY) continue; // footprint itself or a diagonal corner
      if (tileOf(state.map, x, y)?.road) out.push({ x, y });
    }
  }
  return out;
}

/** Horizontal along from.y, then vertical along to.x; both ends inclusive. */
export function lPath(from: Vec2, to: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const sx = Math.sign(to.x - from.x);
  for (let x = from.x; ; x += sx) {
    out.push({ x, y: from.y });
    if (x === to.x) break;
  }
  const sy = Math.sign(to.y - from.y);
  for (let y = from.y + sy; sy !== 0; y += sy) {
    out.push({ x: to.x, y });
    if (y === to.y) break;
  }
  return out;
}

export function buildingsInCity(state: GameState, cityId: number, typeId?: BuildingTypeId): Building[] {
  return Object.values(state.buildings).filter(
    (b) => b.cityId === cityId && (typeId === undefined || b.typeId === typeId),
  );
}

// ---------------------------------------------------------------------------
// cities

/**
 * Urban area = tiles within `urbanRadius(population)` of the centre (Euclidean, inclusive), excluding water.
 * Where two areas overlap, the nearer city wins (lower id on ties). Also updates `city.urbanRadius`.
 */
export function refreshUrbanTiles(state: GameState): void {
  const { map, cities } = state;
  for (const t of map.tiles) t.cityId = null;
  const bestD2 = new Float64Array(map.tiles.length).fill(Infinity);
  for (const city of cities) {
    const r = urbanRadius(city.population);
    city.urbanRadius = r;
    for (let y = Math.max(0, city.center.y - r); y <= Math.min(map.height - 1, city.center.y + r); y++) {
      for (let x = Math.max(0, city.center.x - r); x <= Math.min(map.width - 1, city.center.x + r); x++) {
        if (!inRadius(city.center, r, x, y)) continue;
        const i = y * map.width + x;
        const t = map.tiles[i];
        if (t.terrain === 'water') continue;
        const d2 = (x - city.center.x) ** 2 + (y - city.center.y) ** 2;
        if (d2 < bestD2[i]) {
          bestD2[i] = d2;
          t.cityId = city.id;
        }
      }
    }
  }
}

/**
 * Street grid: centre row, centre column and every 3rd row/column within the urban radius
 * (same Euclidean disc as refreshUrbanTiles), on land that can carry a road (not water or mountain).
 * The 2-tile gaps between streets fit a 2×2 store that always touches a street. Forest and
 * deposit-free hills inside the disc become grass, so every town has room for stores.
 */
export function layCityStreets(map: GameMap, city: City): void {
  const r = urbanRadius(city.population);
  const { x: cx, y: cy } = city.center;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const t = tileOf(map, x, y);
      if (!t || !inRadius(city.center, r, x, y)) continue;
      if (t.terrain === 'water' || t.terrain === 'mountain') continue;
      // settled land: towns clear their forest and deposit-free hills so stores (grass/sand) fit
      if ((t.terrain === 'forest' || t.terrain === 'hills') && t.deposit === null) t.terrain = 'grass';
      if ((x - cx) % 3 !== 0 && (y - cy) % 3 !== 0) continue;
      t.road = true;
    }
  }
}

const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Links each city to its nearest neighbour (lower id on ties). Runs before urban tiles are marked so
 * roadBuildable sees no city land. If the nearest neighbour is unreachable (mountain-locked) the next
 * nearest is used, so every city still joins the network when possible.
 */
function linkCities(map: GameMap, cities: City[]): void {
  const done = new Set<string>();
  for (const a of cities) {
    const others = cities.filter((c) => c !== a).sort((p, q) => dist2(a.center, p.center) - dist2(a.center, q.center) || p.id - q.id);
    for (const b of others) {
      const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
      if (done.has(key)) break;
      const path = findPath(map, a.center, [b.center], roadBuildable, waterAvoidingCost);
      if (!path) continue;
      for (const p of path) map.tiles[p.y * map.width + p.x].road = true;
      done.add(key);
      break;
    }
  }
  joinNetworks(map, cities);
}

/** Road-network component label of each city centre (flood fill over road tiles); -1 off-road. */
function cityComponents(map: GameMap, cities: City[]): number[] {
  const { width: w, height: h, tiles } = map;
  const label = new Int32Array(w * h).fill(-1);
  return cities.map((c, ci) => {
    const start = c.center.y * w + c.center.x;
    if (!tiles[start].road) return -1;
    if (label[start] !== -1) return label[start];
    label[start] = ci;
    const stack = [start];
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = (i / w) | 0;
      const ns = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of ns) {
        if (n < 0 || label[n] !== -1 || !tiles[n].road) continue;
        label[n] = ci;
        stack.push(n);
      }
    }
    return ci;
  });
}

/**
 * Nearest-neighbour links can leave separate islands (e.g. two pairs). Repeatedly link the closest
 * pair of cities in different components (lower ids on ties), skipping unreachable pairs, until one
 * component remains or no further link is possible. Bounded: ≤ cities−1 links, each pair tried once.
 */
function joinNetworks(map: GameMap, cities: City[]): void {
  const tried = new Set<string>();
  for (;;) {
    const comp = cityComponents(map, cities);
    let best: [City, City] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        if (comp[i] === comp[j] && comp[i] !== -1) continue;
        if (tried.has(`${i}-${j}`)) continue;
        const d = dist2(cities[i].center, cities[j].center);
        if (d < bestD) {
          bestD = d;
          best = [cities[i], cities[j]];
        }
      }
    }
    if (!best) return;
    const [a, b] = best;
    tried.add(`${cities.indexOf(a)}-${cities.indexOf(b)}`);
    const path = findPath(map, a.center, [b.center], roadBuildable, waterAvoidingCost);
    if (path) for (const p of path) map.tiles[p.y * map.width + p.x].road = true;
  }
}

// ---------------------------------------------------------------------------
// game creation

export function createGame(opts: { seed: number; companyName?: string; scenarioId?: string; rival?: boolean }): GameState {
  const { map, cities } = generateMap(opts.seed);
  for (const c of cities) layCityStreets(map, c);
  linkCities(map, cities);
  const rng = { rngState: opts.seed | 0 };
  const playerName = opts.companyName ?? pick(rng, COMPANY_NAMES);
  const rival = createCompany('rival', RIVAL_NAME);
  rival.active = opts.rival ?? true;
  const state: GameState = {
    version: 1,
    seed: opts.seed,
    rngState: rng.rngState,
    date: { ...START_DATE },
    tick: 0,
    map,
    buildings: {},
    cities,
    vehicles: {},
    routes: {},
    companies: { player: createCompany('player', playerName), rival },
    news: [],
    modifiers: [],
    contracts: [],
    unlocked: unlockedAt(START_DATE.year),
    nextId: 1,
    speed: 1,
    scenarioId: opts.scenarioId ?? 'sandbox',
    rivalProject: null,
    flags: {},
  };
  refreshUrbanTiles(state);
  return state;
}

// ---------------------------------------------------------------------------
// placement

interface PlacementPlan {
  def: BuildingDef;
  cost: number;
  recipeId: string | null;
  cityId: number | null;
}

function planPlacement(
  state: GameState,
  owner: OwnerId,
  typeId: BuildingTypeId,
  pos: Vec2,
  recipeId?: string,
): Result<PlacementPlan> {
  const def = BUILDINGS[typeId];
  if (!def) return err('Unknown building');
  if (!state.unlocked.includes(typeId)) return err('Not invented yet');
  if (recipeId !== undefined) {
    if (!def.recipes.includes(recipeId)) return err('Unknown recipe');
    if (!state.unlocked.includes(recipeId)) return err('Not invented yet');
  }
  const { map } = state;
  const { w, h } = def.size;
  if (!Number.isInteger(pos.x) || !Number.isInteger(pos.y)) return err('Out of bounds');
  if (pos.x < 0 || pos.y < 0 || pos.x + w > map.width || pos.y + h > map.height) return err('Out of bounds');

  const tiles: Tile[] = [];
  for (let y = pos.y; y < pos.y + h; y++) for (let x = pos.x; x < pos.x + w; x++) tiles.push(map.tiles[y * map.width + x]);

  if (tiles.some((t) => t.buildingId !== null || t.road || t.rail)) return err('Tile occupied');
  if (tiles.some((t) => !def.allowedTerrain.includes(t.terrain))) return err('Wrong terrain');

  let cityId: number | null = null;
  if (def.requiresCity) {
    cityId = tiles[0].cityId;
    if (cityId === null || tiles.some((t) => t.cityId !== cityId)) return err('Must be inside a city');
  } else if (tiles.some((t) => t.cityId !== null)) {
    return err('Cannot build on city land');
  }

  let recipe: string | null = recipeId ?? null;
  if (def.requiresDeposit) {
    const candidates = recipeId !== undefined ? [recipeId] : def.recipes.filter((r) => state.unlocked.includes(r));
    const found = tiles
      .map((t) => t.deposit)
      .map((d) => candidates.find((r) => d !== null && getRecipe(r).outputs[d] !== undefined))
      .find((r) => r !== undefined);
    if (!found) return err('Needs a resource deposit');
    recipe = found;
  } else if (recipe === null) {
    recipe = def.recipes.find((r) => state.unlocked.includes(r)) ?? null;
  }

  if (!canAfford(state.companies[owner], def.cost)) return err('Not enough money');
  return ok({ def, cost: def.cost, recipeId: recipe, cityId });
}

export function canPlaceBuilding(state: GameState, owner: OwnerId, typeId: BuildingTypeId, pos: Vec2): Result<{ cost: number }> {
  const r = planPlacement(state, owner, typeId, pos);
  return r.ok ? ok({ cost: r.value.cost }) : r;
}

export function placeBuilding(
  ctx: SimContext,
  owner: OwnerId,
  typeId: BuildingTypeId,
  pos: Vec2,
  recipeId?: string,
): Result<Building> {
  const { state } = ctx;
  const plan = planPlacement(state, owner, typeId, pos, recipeId);
  if (!plan.ok) return plan;
  spend(state.companies[owner], 'construction', plan.value.cost, state.date);
  const building: Building = {
    id: nextId(state),
    typeId,
    ownerId: owner,
    pos: { x: pos.x, y: pos.y },
    recipeId: plan.value.recipeId,
    input: {},
    output: {},
    progress: 0,
    status: 'idle',
    cityId: plan.value.cityId,
    haltedUntil: null,
    producedThisMonth: {},
  };
  state.buildings[building.id] = building;
  for (const p of footprint(building)) state.map.tiles[p.y * state.map.width + p.x].buildingId = building.id;
  ctx.bus.emit({ type: 'buildingPlaced', building });
  return ok(building);
}

/**
 * Deterministic square-spiral search (rings of growing Chebyshev radius around `near`, each ring
 * scanned clockwise from its top-left corner). `near` is the footprint's centre tile.
 * Checks at most (2·maxRadius+1)² positions. Returns null early, without searching, when the failure
 * cannot depend on position: 'Not enough money' or 'Not invented yet'.
 */
export function findPlacement(
  state: GameState,
  owner: OwnerId,
  typeId: BuildingTypeId,
  near: Vec2,
  maxRadius = 20,
): Vec2 | null {
  const def = BUILDINGS[typeId];
  if (!def) return null;
  const ox = near.x - Math.floor((def.size.w - 1) / 2);
  const oy = near.y - Math.floor((def.size.h - 1) / 2);
  const tryAt = (x: number, y: number): Vec2 | null | 'stop' => {
    const pos = { x, y };
    const r = canPlaceBuilding(state, owner, typeId, pos);
    if (r.ok) return pos;
    // these failures do not depend on the position
    if (r.error === 'Not invented yet' || r.error === 'Not enough money') return 'stop';
    return null;
  };
  for (let r = 0; r <= maxRadius; r++) {
    const ring: Vec2[] = [];
    if (r === 0) ring.push({ x: ox, y: oy });
    else {
      for (let x = ox - r; x < ox + r; x++) ring.push({ x, y: oy - r });
      for (let y = oy - r; y < oy + r; y++) ring.push({ x: ox + r, y });
      for (let x = ox + r; x > ox - r; x--) ring.push({ x, y: oy + r });
      for (let y = oy + r; y > oy - r; y--) ring.push({ x: ox - r, y });
    }
    for (const p of ring) {
      const res = tryAt(p.x, p.y);
      if (res === 'stop') return null;
      if (res) return res;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// demolition

/**
 * Refunds 25% of the cost, frees the footprint and removes the building's stops from every route.
 * Vehicles keep heading to the same stop (re-indexed); if their target stop was removed they head to
 * the stop that took its place. Their path is cleared so the vehicle system re-plans. Vehicles on a
 * route left with fewer than 2 stops go `idle`. With `owner`, refuses other companies' buildings.
 */
export function demolishBuilding(ctx: SimContext, id: number, owner?: OwnerId): Result {
  const { state } = ctx;
  const building = state.buildings[id];
  if (!building) return err('No such building');
  if (owner !== undefined && building.ownerId !== owner) return err('Not your building');
  const def = BUILDINGS[building.typeId];
  earn(state.companies[building.ownerId], 'demolition', def.cost * DEMOLITION_REFUND, state.date);
  for (const p of footprint(building)) {
    const t = state.map.tiles[p.y * state.map.width + p.x];
    if (t.buildingId === id) t.buildingId = null;
  }
  for (const route of Object.values(state.routes)) {
    const removed: number[] = [];
    route.stops.forEach((s, i) => {
      if (s.buildingId === id) removed.push(i);
    });
    if (removed.length === 0) continue;
    const kept = route.stops.filter((s) => s.buildingId !== id);
    route.stops = kept;
    for (const v of Object.values(state.vehicles)) {
      if (v.routeId !== route.id) continue;
      const targetRemoved = removed.includes(v.stopIndex);
      const shift = removed.filter((i) => i < v.stopIndex).length;
      v.stopIndex -= shift;
      if (targetRemoved || v.stopIndex >= kept.length) v.stopIndex = kept.length > 0 ? v.stopIndex % kept.length : 0;
      v.path = [];
      v.pathIndex = 0;
      if (kept.length < 2) v.state = 'idle';
    }
  }
  delete state.buildings[id];
  ctx.bus.emit({ type: 'buildingRemoved', buildingId: id });
  return ok();
}

// ---------------------------------------------------------------------------
// roads

/**
 * Atomic: either every new tile is built and paid for, or nothing changes. Tiles that already carry
 * road are skipped (free). Allowed on any in-bounds tile that is not mountain and has no building —
 * urban tiles included, so a removed city street can be rebuilt. Water tiles become bridges.
 */
export function buildRoad(ctx: SimContext, owner: OwnerId, tiles: Vec2[]): Result<{ built: number; cost: number }> {
  const { state } = ctx;
  const { map } = state;
  const seen = new Set<number>();
  const todo: Vec2[] = [];
  let cost = 0;
  for (const p of tiles) {
    const t = tileOf(map, p.x, p.y);
    if (!t || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return err('Cannot build road there');
    const i = p.y * map.width + p.x;
    if (t.road || seen.has(i)) continue;
    if (t.terrain === 'mountain' || t.buildingId !== null) return err('Cannot build road there');
    seen.add(i);
    todo.push({ x: p.x, y: p.y });
    cost += t.terrain === 'water' ? BRIDGE_COST : ROAD_COST;
  }
  const company = state.companies[owner];
  if (!canAfford(company, cost)) return err('Not enough money');
  if (todo.length === 0) return ok({ built: 0, cost: 0 });
  for (const p of todo) {
    const t = map.tiles[p.y * map.width + p.x];
    t.road = true;
    t.roadOwner = owner;
  }
  spend(company, 'construction', cost, state.date);
  company.roadTiles += todo.length;
  ctx.bus.emit({ type: 'roadChanged', tiles: todo });
  return ok({ built: todo.length, cost });
}

/**
 * Removes road from the given tiles. Tiles without road, out of bounds or under a building are
 * skipped. Refuses (changing nothing) if any tile is another company's road ('Not your road') or a
 * vehicle currently stands on one of them. Pre-built/unowned road may be removed by anyone. Each
 * removed owned tile decrements its builder's `roadTiles` (floored at 0); `roadOwner` is cleared.
 */
export function removeRoad(ctx: SimContext, owner: OwnerId, tiles: Vec2[]): Result {
  const { state } = ctx;
  const { map } = state;
  const seen = new Set<number>();
  const todo: Vec2[] = [];
  for (const p of tiles) {
    const t = tileOf(map, p.x, p.y);
    if (!t || !t.road || t.buildingId !== null) continue;
    const i = p.y * map.width + p.x;
    if (seen.has(i)) continue;
    if (t.roadOwner !== null && t.roadOwner !== owner) return err('Not your road');
    seen.add(i);
    todo.push({ x: p.x, y: p.y });
  }
  for (const v of Object.values(state.vehicles)) {
    const vx = Math.round(v.pos.x);
    const vy = Math.round(v.pos.y);
    if (seen.has(vy * map.width + vx) && vx >= 0 && vx < map.width) return err('A vehicle is on that road');
  }
  if (todo.length === 0) return ok();
  for (const p of todo) {
    const t = map.tiles[p.y * map.width + p.x];
    if (t.roadOwner !== null) {
      const c = state.companies[t.roadOwner];
      c.roadTiles = Math.max(0, c.roadTiles - 1);
    }
    t.road = false;
    t.roadOwner = null;
  }
  ctx.bus.emit({ type: 'roadChanged', tiles: todo });
  return ok();
}

// ---------------------------------------------------------------------------
// valuation

/** Σ building cost × 0.5 + Σ vehicle purchase price × 0.5, rounded. */
export function assetValue(state: GameState, owner: OwnerId): number {
  let v = 0;
  for (const b of Object.values(state.buildings)) if (b.ownerId === owner) v += BUILDINGS[b.typeId].cost * 0.5;
  for (const veh of Object.values(state.vehicles)) if (veh.ownerId === owner) v += VEHICLE_COST[veh.kind] * 0.5;
  return Math.round(v);
}
