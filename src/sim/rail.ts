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
import { railPassable } from './pathfinding';
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
 * existing road (a level crossing) but not water, mountains or buildings.
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
