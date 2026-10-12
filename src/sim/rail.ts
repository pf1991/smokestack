/**
 * Railways (Task 27): track building, station access and trains.
 *
 * Trains reuse the generic vehicle state machine in vehicles.ts; this module registers the `train`
 * kind in `VEHICLE_KINDS` when it is loaded (production.ts imports it for the upkeep constant, so
 * any running simulation has trains available). Train routes stop only at train stations, path over
 * rail tiles, and dock at the rail tiles next to a station. A station stores goods like a warehouse,
 * so truck routes can feed it and trains haul between stations.
 */
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { BUILDINGS } from '../data/buildings';
import { dateToDays } from './clock';
import { canAfford, spend } from './finance';
import { LANDMARK_BLOCKED, LANDMARK_LAYER } from './landmarkTiles';
import { layerAt } from './layers';
import { findPath, invalidatePaths, railPassable, type Passable } from './pathfinding';
import type { Building, BuildingTypeId, GameMap, GameState, OwnerId, SimContext, Tile, Vec2, Vehicle } from './types';
import { buyVehicle, VEHICLE_KINDS, type VehicleSpec } from './vehicles';

export const TRAIN = { cost: 60000, capacity: 120, speed: 1.0, maintenance: 1200, loadTicks: 12 } as const satisfies VehicleSpec;
/** Dollars per tile of track laid. */
export const RAIL_COST = 1200;
/** Dollars per owned track tile per month. */
export const RAIL_UPKEEP = 10;
export const STATION_TYPE: BuildingTypeId = 'train_station';

function tileOf(map: GameMap, x: number, y: number): Tile | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x];
}

/** Why `tile` cannot carry new track, or null. Level crossings over road are fine. */
function railBlocked(t: Tile | undefined): boolean {
  return !t || t.terrain === 'water' || t.terrain === 'mountain' || t.buildingId !== null;
}

/** Cost of laying track on `tiles` (existing track and duplicates are free), or the reason it cannot be built. */
export function railQuote(state: GameState, owner: OwnerId, tiles: Vec2[]): { cost: number; error: string | null } {
  const { map } = state;
  const seen = new Set<number>();
  let cost = 0;
  for (const p of tiles) {
    const t = tileOf(map, p.x, p.y);
    if (t?.rail) continue;
    if (t && layerAt(state, LANDMARK_LAYER, p.x, p.y) > 0) return { cost, error: LANDMARK_BLOCKED };
    if (railBlocked(t)) return { cost, error: 'Cannot build rail there' };
    const i = p.y * map.width + p.x;
    if (seen.has(i)) continue;
    seen.add(i);
    cost += RAIL_COST;
  }
  if (!canAfford(state.companies[owner], cost)) return { cost, error: 'Not enough money' };
  return { cost, error: null };
}

/**
 * Atomic: lays track on every tile that lacks it ($1,200 each) or changes nothing. Track may cross
 * existing road (a level crossing) but not water, mountains, buildings or landmarks.
 */
export function buildRail(ctx: SimContext, owner: OwnerId, tiles: Vec2[]): Result<{ built: number; cost: number }> {
  const { state } = ctx;
  const { map } = state;
  const q = railQuote(state, owner, tiles);
  if (q.error) return err(q.error);
  const todo: Vec2[] = [];
  const seen = new Set<number>();
  for (const p of tiles) {
    const i = p.y * map.width + p.x;
    if (map.tiles[i].rail || seen.has(i)) continue;
    seen.add(i);
    todo.push({ x: p.x, y: p.y });
  }
  if (todo.length === 0) return ok({ built: 0, cost: 0 });
  for (const p of todo) {
    const t = map.tiles[p.y * map.width + p.x];
    t.rail = true;
    t.railOwner = owner;
  }
  invalidatePaths(map);
  const company = state.companies[owner];
  spend(company, 'construction', q.cost, state.date);
  company.railTiles += todo.length;
  ctx.bus.emit({ type: 'railChanged', tiles: todo });
  return ok({ built: todo.length, cost: q.cost });
}

/**
 * Removes track from the given tiles (tiles without track are skipped). Refuses, changing nothing,
 * when a tile is another company's track or a train stands on it. A train whose track ahead vanished
 * re-plans or goes `stuck` (see vehicles.ts). Owned tiles decrement the builder's `railTiles`.
 */
export function removeRail(ctx: SimContext, owner: OwnerId, tiles: Vec2[]): Result {
  const { state } = ctx;
  const { map } = state;
  const seen = new Set<number>();
  const todo: Vec2[] = [];
  for (const p of tiles) {
    const t = tileOf(map, p.x, p.y);
    if (!t || !t.rail) continue;
    const i = p.y * map.width + p.x;
    if (seen.has(i)) continue;
    if (t.railOwner !== null && t.railOwner !== owner) return err('Not your rail');
    seen.add(i);
    todo.push({ x: p.x, y: p.y });
  }
  for (const v of Object.values(state.vehicles)) {
    if (v.kind !== 'train') continue;
    const vx = Math.round(v.pos.x);
    const vy = Math.round(v.pos.y);
    if (vx >= 0 && vx < map.width && seen.has(vy * map.width + vx)) return err('A train is on that track');
  }
  if (todo.length === 0) return ok();
  for (const p of todo) {
    const t = map.tiles[p.y * map.width + p.x];
    if (t.railOwner !== null) {
      const c = state.companies[t.railOwner];
      c.railTiles = Math.max(0, c.railTiles - 1);
    }
    t.rail = false;
    t.railOwner = null;
  }
  invalidatePaths(map);
  ctx.bus.emit({ type: 'railChanged', tiles: todo });
  return ok();
}

/** Rail tiles orthogonally adjacent to the building's footprint, scanned row by row. */
export function stationAccess(state: GameState, station: { typeId: BuildingTypeId; pos: Vec2 }): Vec2[] {
  const def = BUILDINGS[station.typeId];
  if (!def) return [];
  const { w, h } = def.size;
  const { x: bx, y: by } = station.pos;
  const out: Vec2[] = [];
  for (let y = by - 1; y <= by + h; y++) {
    for (let x = bx - 1; x <= bx + w; x++) {
      const insideX = x >= bx && x < bx + w;
      const insideY = y >= by && y < by + h;
      if (insideX === insideY) continue;
      if (tileOf(state.map, x, y)?.rail) out.push({ x, y });
    }
  }
  return out;
}

/** Tiles orthogonally adjacent to a building's footprint (in bounds), scanned row by row. */
function perimeter(state: GameState, b: { typeId: BuildingTypeId; pos: Vec2 }): Vec2[] {
  const { w, h } = BUILDINGS[b.typeId].size;
  const { x: bx, y: by } = b.pos;
  const out: Vec2[] = [];
  for (let y = by - 1; y <= by + h; y++) {
    for (let x = bx - 1; x <= bx + w; x++) {
      const insideX = x >= bx && x < bx + w;
      const insideY = y >= by && y < by + h;
      if (insideX === insideY) continue;
      if (tileOf(state.map, x, y)) out.push({ x, y });
    }
  }
  return out;
}

const plannerCache: Partial<Record<OwnerId, Passable>> = {};

/**
 * Where `owner` may run new track: its own (or unowned) existing rail, or any tile `buildRail`
 * accepts (not water, mountain or a building; road tiles become level crossings).
 */
function railPlannable(owner: OwnerId): Passable {
  let p = plannerCache[owner];
  if (!p) {
    p = (t: Tile) => (t.rail ? t.railOwner === null || t.railOwner === owner : !railBlocked(t));
    plannerCache[owner] = p;
  }
  return p;
}

/** Existing track is cheapest; crossings and town land are discouraged so lines run beside roads, not on them. */
const railStepCost = (t: Tile): number => (t.rail ? 1 : t.road || t.cityId !== null ? 3 : 2);

/** Starting tiles tried from station `a` (the A* runs once per start, so keep this short). */
const MAX_RAIL_STARTS = 3;

/**
 * The cheapest track `owner` could lay from the side of building `a` (from its first rail access tile
 * when it has one, since that is where trains start) to a tile beside building `b`, or null. Existing
 * own track counts as free; nothing is built. One A* per start tile (at most MAX_RAIL_STARTS), and
 * the targets are only `b`'s perimeter tiles.
 */
export function planRail(state: GameState, owner: OwnerId, a: { typeId: BuildingTypeId; pos: Vec2 }, b: { typeId: BuildingTypeId; pos: Vec2 }): Vec2[] | null {
  const { map } = state;
  // landmarks sit on town land the planner would otherwise cross (buildRail refuses them)
  const plannable = railPlannable(owner);
  const lm = state.layers[LANDMARK_LAYER];
  const passable: Passable = lm ? (t, x, y) => plannable(t, x, y) && !(lm[y * map.width + x] > 0) : plannable;
  const ok1 = (p: Vec2) => passable(map.tiles[p.y * map.width + p.x], p.x, p.y);
  // never build on from another company's track: if it were lifted, our trains would be stranded
  const fromAccess = stationAccess(state, a).filter(ok1);
  const bw = BUILDINGS[b.typeId].size;
  const bc = { x: b.pos.x + bw.w / 2, y: b.pos.y + bw.h / 2 };
  const starts =
    fromAccess.length > 0
      ? [fromAccess[0]]
      : perimeter(state, a)
          .filter(ok1)
          .map((p) => ({ p, d: Math.abs(p.x - bc.x) + Math.abs(p.y - bc.y) }))
          .sort((p, q) => p.d - q.d)
          .slice(0, MAX_RAIL_STARTS)
          .map((e) => e.p);
  const targets = perimeter(state, b).filter(ok1);
  if (targets.length === 0) return null;
  let best: { path: Vec2[]; fresh: number } | null = null;
  for (const s of starts) {
    const path = findPath(map, s, targets, passable, railStepCost);
    if (!path) continue;
    const fresh = path.filter((p) => !map.tiles[p.y * map.width + p.x].rail).length;
    if (!best || fresh < best.fresh || (fresh === best.fresh && path.length < best.path.length)) best = { path, fresh };
  }
  return best?.path ?? null;
}

/**
 * Makes sure a train can run from station `a` to station `b`, the rail analogue of `ensureRoadLink`:
 * when `a`'s first rail access tile (where trains spawn) is not already linked to `b`'s, lays the
 * cheapest track between the stations' sides (existing own track reused for free, road tiles crossed
 * as level crossings, never water, mountains or buildings), paid by `owner`. Atomic; refuses with
 * 'Not enough money' when the payer would be left with less than `reserve`. `tiles` lists the new
 * track tiles.
 */
export function ensureRailLink(
  ctx: SimContext,
  owner: OwnerId,
  a: Building,
  b: Building,
  reserve = 0,
): Result<{ built: number; cost: number; tiles: Vec2[] }> {
  const { state } = ctx;
  const { map } = state;
  // "already linked" only counts track the owner may rely on (its own or unowned)
  const passable = railPlannable(owner);
  const mine = (p: Vec2) => passable(map.tiles[p.y * map.width + p.x], p.x, p.y);
  const fromAccess = stationAccess(state, a).filter(mine);
  const toAccess = stationAccess(state, b).filter(mine);
  if (fromAccess.length > 0 && toAccess.length > 0 && findPath(map, fromAccess[0], toAccess, passable)) {
    return ok({ built: 0, cost: 0, tiles: [] });
  }
  const best = planRail(state, owner, a, b);
  if (!best) return err('No rail can link these stations');
  const tiles = best.filter((p) => !map.tiles[p.y * map.width + p.x].rail);
  const q = railQuote(state, owner, best);
  if (q.error) return err(q.error);
  if (!canAfford(state.companies[owner], q.cost + reserve)) return err('Not enough money');
  const r = buildRail(ctx, owner, best);
  if (!r.ok) return r;
  return ok({ ...r.value, tiles });
}

export function isRailStrike(state: GameState): boolean {
  const until = state.flags.railStrikeUntil;
  return typeof until === 'number' && dateToDays(state.date) < until;
}

/** Spawns at the first station's first rail access tile and heads for that station. */
export function buyTrain(ctx: SimContext, owner: OwnerId, routeId: number): Result<Vehicle> {
  return buyVehicle(ctx, owner, routeId, 'train');
}

VEHICLE_KINDS.train = {
  spec: TRAIN,
  passable: railPassable,
  access: stationAccess,
  stopError: (b: Building) => (b.typeId === STATION_TYPE ? null : 'Trains only stop at train stations'),
  noAccessError: 'Station has no rail access',
  halted: isRailStrike,
};
