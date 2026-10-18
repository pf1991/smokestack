import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { canAfford, earn, spend } from './finance';
import { acceptsGood, handlesCargo, loadSource, noCargoError, storageLeft } from './inventory';
import { findPath, pathMemo, pathStillPassable, roadPassable, type Passable } from './pathfinding';
import { truckTollsMonth } from './politics/mayorEdicts';
import { accessTiles, nextId } from './state';
import { AGING_GRACE, agingEfficiency, assetAge, assetUpkeep, NO_WEAR } from './society/aging';
import { atPrices } from './society/economy';
import type { Building, GameState, OwnerId, Route, RouteStop, SimContext, Vec2, Vehicle } from './types';

export interface VehicleSpec {
  cost: number;
  capacity: number;
  /** tiles per tick */
  speed: number;
  /** dollars per month */
  maintenance: number;
  /** ticks spent at each stop */
  loadTicks: number;
}

export const TRUCK = { cost: 8000, capacity: 20, speed: 0.5, maintenance: 150, loadTicks: 6 } as const;

/** How a vehicle kind moves: its spec, which tiles it may drive on and where it docks at a building. */
export interface VehicleKindDef {
  spec: VehicleSpec;
  passable: Passable;
  access: (state: GameState, building: Building) => Vec2[];
  /** error for a building this kind may not stop at (null when allowed); default: any building */
  stopError?: (building: Building) => string | null;
  /** error when a stop has no access tiles (default 'Stop has no road access') */
  noAccessError?: string;
  /** true while every vehicle of this kind stands still (e.g. a rail strike) */
  halted?: (state: GameState) => boolean;
}

/** Movement is generic over this table; rail.ts registers `train` here when it loads. */
export const VEHICLE_KINDS: Partial<Record<Vehicle['kind'], VehicleKindDef>> = {
  truck: { spec: TRUCK, passable: roadPassable, access: accessTiles },
};

export const ROUTE_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6'];

/** Ticks between path retries of a stuck vehicle (staggered by vehicle id). */
export const STUCK_RETRY_TICKS = 24;
export const SELL_REFUND = 0.5;
/** Window (30 days of 24 ticks) over which completed unloading stops are counted. */
export const TRIP_WINDOW_TICKS = 30 * 24;

/** Completed unloading stops of a vehicle in the last 30 days (0 for old saves without the log). */
export function tripsLast30(state: GameState, veh: Vehicle): number {
  const cutoff = state.tick - TRIP_WINDOW_TICKS;
  let n = 0;
  for (const t of veh.trips30 ?? []) if (t > cutoff) n++;
  return n;
}

// ---------------------------------------------------------------------------
// routes

function validateStops(state: GameState, owner: OwnerId, kind: Route['kind'], stops: RouteStop[]): Result {
  const def = VEHICLE_KINDS[kind];
  if (!def) return err('Unknown vehicle kind');
  for (const stop of stops) {
    const b = state.buildings[stop.buildingId];
    if (!b) return err('No such building');
    if (b.ownerId !== owner) return err('Not your building');
    if (!handlesCargo(b)) return err(noCargoError(b));
    const bad = def.stopError?.(b);
    if (bad) return err(bad);
    if (def.access(state, b).length === 0) return err(def.noAccessError ?? 'Stop has no road access');
  }
  return ok();
}

const copyStop = (s: RouteStop): RouteStop => ({ buildingId: s.buildingId, load: [...s.load], unload: [...s.unload] });

export function createRoute(
  ctx: SimContext,
  owner: OwnerId,
  name: string,
  stops: RouteStop[],
  kind: Route['kind'] = 'truck',
): Result<Route> {
  const { state } = ctx;
  if (stops.length < 2) return err('A route needs at least two stops');
  const v = validateStops(state, owner, kind, stops);
  if (!v.ok) return v;
  const id = nextId(state);
  const route: Route = {
    id,
    ownerId: owner,
    name,
    color: ROUTE_COLORS[id % ROUTE_COLORS.length],
    stops: stops.map(copyStop),
    kind,
  };
  state.routes[id] = route;
  return ok(route);
}

/**
 * Stops may drop below two here (the route's vehicles then idle); new stops must be own buildings
 * with access. When stops change, every vehicle re-plans towards its (clamped) current stop index.
 */
export function updateRoute(
  ctx: SimContext,
  routeId: number,
  patch: Partial<Pick<Route, 'name' | 'stops' | 'color'>>,
): Result {
  const { state } = ctx;
  const route = state.routes[routeId];
  if (!route) return err('No such route');
  if (patch.stops) {
    const v = validateStops(state, route.ownerId, route.kind, patch.stops);
    if (!v.ok) return v;
  }
  if (patch.name !== undefined) route.name = patch.name;
  if (patch.color !== undefined) route.color = patch.color;
  if (patch.stops) {
    const oldStops = route.stops;
    route.stops = patch.stops.map(copyStop);
    const n = route.stops.length;
    for (const veh of Object.values(state.vehicles)) {
      if (veh.routeId !== routeId) continue;
      const oldBuilding = oldStops[veh.stopIndex]?.buildingId;
      veh.stopIndex = n > 0 ? veh.stopIndex % n : 0;
      // A loading vehicle keeps its arrival path (so it moves on after its dwell) unless the
      // building at its stop changed; then the cleared path sends it to the new current stop.
      if (veh.state !== 'loading' || route.stops[veh.stopIndex]?.buildingId !== oldBuilding) {
        veh.path = [];
        veh.pathIndex = 0;
      }
      if (n < 2) {
        veh.state = 'idle';
        veh.stuckNotified = false;
      } else if (veh.state === 'idle' || veh.state === 'stuck') {
        veh.state = 'moving';
        veh.stuckNotified = false;
      }
    }
  }
  return ok();
}

/**
 * Inserts `stop` after index `afterIndex` of a route. Vehicles heading for a later stop keep that
 * target (their index is bumped); `retuned` optionally replaces the load/unload of the existing
 * stops (same buildings, same order). Paths are replaced, never mutated, and only cleared when a
 * vehicle's target building changed (a path to an unchanged target stays valid).
 */
export function insertStop(
  ctx: SimContext,
  routeId: number,
  afterIndex: number,
  stop: RouteStop,
  retuned?: RouteStop[],
): Result {
  const { state } = ctx;
  const route = state.routes[routeId];
  if (!route) return err('No such route');
  if (afterIndex < -1 || afterIndex >= route.stops.length) return err('No such stop');
  const v = validateStops(state, route.ownerId, route.kind, [stop]);
  if (!v.ok) return v;
  const oldStops = route.stops;
  const base =
    retuned && retuned.length === oldStops.length && retuned.every((s, i) => s.buildingId === oldStops[i].buildingId)
      ? retuned
      : oldStops;
  const next = base.map(copyStop);
  next.splice(afterIndex + 1, 0, copyStop(stop));
  route.stops = next;
  const n = next.length;
  for (const veh of Object.values(state.vehicles)) {
    if (veh.routeId !== routeId) continue;
    const oldBuilding = oldStops[veh.stopIndex]?.buildingId;
    if (veh.stopIndex > afterIndex) veh.stopIndex++;
    veh.stopIndex = veh.stopIndex % n;
    if (veh.state !== 'loading' && next[veh.stopIndex]?.buildingId !== oldBuilding) {
      veh.path = [];
      veh.pathIndex = 0;
    }
    if (veh.state === 'idle' || veh.state === 'stuck') {
      veh.state = 'moving';
      veh.stuckNotified = false;
      veh.path = [];
      veh.pathIndex = 0;
    }
  }
  return ok();
}

/** Sells the route's vehicles (50% refund each), then removes the route. */
export function deleteRoute(ctx: SimContext, routeId: number): Result {
  const { state } = ctx;
  if (!state.routes[routeId]) return err('No such route');
  for (const veh of Object.values(state.vehicles)) if (veh.routeId === routeId) sellVehicle(ctx, veh.id);
  delete state.routes[routeId];
  routeRemovals++;
  return ok();
}

// ---------------------------------------------------------------------------
// purchases

/** Buys a vehicle of `kind` for a route of the same kind (used by buyTruck and rail.ts's buyTrain). */
export function buyVehicle(ctx: SimContext, owner: OwnerId, routeId: number, kind: Vehicle['kind']): Result<Vehicle> {
  const { state } = ctx;
  const def = VEHICLE_KINDS[kind];
  if (!def) return err('Unknown vehicle kind');
  const route = state.routes[routeId];
  if (!route) return err('No such route');
  if (route.ownerId !== owner) return err('Not your route');
  if (route.kind !== kind) return err('Wrong vehicle for this route');
  const first = route.stops[0] ? state.buildings[route.stops[0].buildingId] : undefined;
  const spawn = first ? def.access(state, first)[0] : undefined;
  if (!spawn) return err(def.noAccessError ?? 'Stop has no road access');
  const company = state.companies[owner];
  const price = vehiclePrice(state, kind);
  if (!canAfford(company, price)) return err('Not enough money');
  spend(company, 'vehicles', price, state.date);
  const vehicle: Vehicle = {
    id: nextId(state),
    kind,
    ownerId: owner,
    routeId,
    pos: { x: spawn.x, y: spawn.y },
    prevPos: { x: spawn.x, y: spawn.y },
    path: [],
    pathIndex: 0,
    stopIndex: 0,
    cargo: {},
    capacity: def.spec.capacity,
    state: route.stops.length >= 2 ? 'moving' : 'idle',
    waitTicks: 0,
    stuckNotified: false,
    builtYear: state.date.year,
  };
  state.vehicles[vehicle.id] = vehicle;
  return ok(vehicle);
}

/** Spawns at the first stop's first access tile and heads for that stop. */
export function buyTruck(ctx: SimContext, owner: OwnerId, routeId: number): Result<Vehicle> {
  return buyVehicle(ctx, owner, routeId, 'truck');
}

/** Removes the vehicle (cargo is lost) and refunds 50% of its price as `vehicles` income. */
export function sellVehicle(ctx: SimContext, id: number): Result {
  const { state } = ctx;
  const veh = state.vehicles[id];
  if (!veh) return err('No such vehicle');
  earn(state.companies[veh.ownerId], 'vehicles', sellRefund(state, veh.kind), state.date);
  delete state.vehicles[id];
  fleetRemovals++;
  return ok();
}

/**
 * Replaces an (old) vehicle with a new one of the same kind on the same route: sells it
 * (sellVehicle, cargo lost) and buys new at today's price (buyVehicle). The newcomer takes the old
 * one's place (its tile and next stop) and re-plans from there: a vehicle in service is on the
 * route's working network, while the first stop's spawn tile may be a stub the network has since
 * outgrown. Checks the purchase can go through first, so it never sells without rebuying.
 */
export function replaceVehicle(ctx: SimContext, id: number, owner?: OwnerId): Result<Vehicle> {
  const { state } = ctx;
  const veh = state.vehicles[id];
  if (!veh) return err('No such vehicle');
  if (owner !== undefined && veh.ownerId !== owner) return err('Not your vehicle');
  const route = veh.routeId !== null ? state.routes[veh.routeId] : undefined;
  if (!route) return err('Assign it to a route first');
  const def = VEHICLE_KINDS[veh.kind];
  const first = route.stops[0] ? state.buildings[route.stops[0].buildingId] : undefined;
  if (!def || !first || !def.access(state, first)[0]) return err(def?.noAccessError ?? 'Stop has no road access');
  if (assetAge(state, veh) <= AGING_GRACE) return err(NO_WEAR);
  if (!canAfford(state.companies[veh.ownerId], replaceCost(state, veh.kind))) return err('Not enough money');
  const { ownerId, kind, stopIndex } = veh;
  const at = { x: Math.round(veh.pos.x), y: Math.round(veh.pos.y) };
  sellVehicle(ctx, id);
  const bought = buyVehicle(ctx, ownerId, route.id, kind);
  if (!bought.ok) return bought;
  const fresh = bought.value;
  fresh.pos = { ...at };
  fresh.prevPos = { ...at };
  fresh.stopIndex = stopIndex;
  fresh.path = [];
  fresh.pathIndex = 0;
  return bought;
}

/** Price of a new vehicle of `kind` at today's prices, rounded. */
export function vehiclePrice(state: GameState, kind: Vehicle['kind']): number {
  return Math.round(atPrices(state, VEHICLE_KINDS[kind]?.spec.cost ?? 0));
}

/** What selling a vehicle of `kind` refunds: SELL_REFUND of today's price, rounded. */
export function sellRefund(state: GameState, kind: Vehicle['kind']): number {
  return Math.round(vehiclePrice(state, kind) * SELL_REFUND);
}

/** Net price of replacing a vehicle of `kind`: a new one less the old one's refund. */
export function replaceCost(state: GameState, kind: Vehicle['kind']): number {
  return vehiclePrice(state, kind) - sellRefund(state, kind);
}

/** Monthly upkeep of `veh`: its kind's maintenance at today's prices × its age factor. */
export function vehicleUpkeep(state: GameState, veh: Vehicle): number {
  return atPrices(state, VEHICLE_KINDS[veh.kind]?.spec.maintenance ?? 0) * assetUpkeep(state, veh);
}

/**
 * Moves a vehicle onto another of its owner's routes of the same kind (or off all routes with
 * `null`). Restarts it at the route's first stop with an empty hold (old cargo would otherwise
 * never be unloaded on the new route); never deletes the vehicle, and replaces (never mutates) its path.
 */
export function assignVehicle(ctx: SimContext, vehicleId: number, routeId: number | null): Result {
  const { state } = ctx;
  const veh = state.vehicles[vehicleId];
  if (!veh) return err('No such vehicle');
  let route: Route | undefined;
  if (routeId !== null) {
    route = state.routes[routeId];
    if (!route) return err('No such route');
    if (route.ownerId !== veh.ownerId) return err('Not your route');
    if (route.kind !== veh.kind) return err(veh.kind === 'train' ? 'Trains only run on rail lines' : 'Trucks cannot run rail lines');
  }
  if (veh.routeId !== routeId) veh.cargo = {};
  veh.routeId = routeId;
  veh.stopIndex = 0;
  veh.path = [];
  veh.pathIndex = 0;
  veh.waitTicks = 0;
  veh.stuckNotified = false;
  veh.state = route && route.stops.length >= 2 ? 'moving' : 'idle';
  return ok();
}

/** Monthly: each vehicle's upkeep, then mayors' truck tolls on the player (both under 'vehicles'). */
export function vehicleMaintenanceMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const veh of Object.values(state.vehicles)) {
    if (VEHICLE_KINDS[veh.kind]) spend(state.companies[veh.ownerId], 'vehicles', vehicleUpkeep(state, veh), state.date);
  }
  truckTollsMonth(ctx);
}

// ---------------------------------------------------------------------------
// state machine

function cargoTotal(veh: Vehicle): number {
  let n = 0;
  for (const g in veh.cargo) n += veh.cargo[g];
  return n;
}

/** Unload `stop.unload` goods the building accepts (bounded by storageLeft), then load `stop.load`. */
function transfer(state: GameState, veh: Vehicle, stop: RouteStop, b: Building): void {
  let unloaded: string[] | null = null;
  for (const g of stop.unload) {
    const carried = veh.cargo[g] ?? 0;
    if (carried <= 0 || !acceptsGood(b, g)) continue;
    const n = Math.min(carried, storageLeft(b, g));
    if (n <= 0) continue;
    b.input[g] = (b.input[g] ?? 0) + n;
    if (carried - n > 0) veh.cargo[g] = carried - n;
    else delete veh.cargo[g];
    (unloaded ??= []).push(g);
  }
  if (unloaded) {
    const log = (veh.trips30 ??= []);
    log.push(state.tick);
    const cutoff = state.tick - TRIP_WINDOW_TICKS;
    while (log.length > 0 && log[0] <= cutoff) log.shift();
  }

  const src = loadSource(b);
  const goods = stop.load;
  const k = goods.length;
  let free = veh.capacity - cargoTotal(veh);
  if (k === 0 || free <= 0) return;
  if (k === 1) {
    // single good: the unit-by-unit loop below takes min(free, floor(avail)) units, and subtracting
    // whole units from a stock below 2^53 is exact, so this is the same result in one step
    const g = goods[0];
    if (unloaded?.includes(g)) return;
    const avail = src[g] ?? 0;
    if (avail < 1) return;
    const n = Math.min(free, Math.floor(avail));
    src[g] = avail - n;
    veh.cargo[g] = (veh.cargo[g] ?? 0) + n;
    return;
  }
  // whole units, one at a time round-robin; the starting good rotates with the clock so remainders
  // are not always given to the first listed good. Goods just unloaded here are not reloaded.
  const start = state.tick % k;
  let progress = true;
  while (free > 0 && progress) {
    progress = false;
    for (let j = 0; j < k && free > 0; j++) {
      const g = goods[(start + j) % k];
      if (unloaded?.includes(g)) continue;
      const avail = src[g] ?? 0;
      if (avail < 1) continue;
      src[g] = avail - 1;
      veh.cargo[g] = (veh.cargo[g] ?? 0) + 1;
      free--;
      progress = true;
    }
  }
}

function goStuck(ctx: SimContext, veh: Vehicle): false {
  veh.state = 'stuck';
  veh.path = [];
  veh.pathIndex = 0;
  if (!veh.stuckNotified) {
    veh.stuckNotified = true;
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: veh.id });
  }
  return false;
}

/**
 * Plans a path from the vehicle's current tile to any access tile of its current stop, skipping
 * stops whose building no longer exists. Sets 'moving' on success, 'stuck' (one event) on failure.
 */
function plan(ctx: SimContext, veh: Vehicle, route: Route, def: VehicleKindDef): boolean {
  const { state } = ctx;
  const n = route.stops.length;
  let b: Building | undefined;
  for (let tries = 0; tries < n; tries++) {
    b = state.buildings[route.stops[veh.stopIndex].buildingId];
    if (b) break;
    veh.stopIndex = (veh.stopIndex + 1) % n;
  }
  if (!b) return goStuck(ctx, veh);
  const { map } = state;
  const from = { x: Math.round(veh.pos.x), y: Math.round(veh.pos.y) };
  // memoised per (start tile, building): access tiles depend only on road/rail tiles, and any change
  // to those drops the memo (see invalidatePaths), so this equals a fresh search
  const memo = pathMemo(map, def.passable);
  const key = (from.y * map.width + from.x) * 2 ** 32 + b.id;
  let path = memo.get(key);
  if (path && !pathStillPassable(map, path, def.passable)) path = undefined;
  if (path === undefined) {
    const targets = def.access(state, b);
    path = targets.length > 0 ? findPath(map, from, targets, def.passable) : null;
    memo.set(key, path);
  }
  if (!path) return goStuck(ctx, veh);
  veh.path = path;
  veh.pathIndex = 0;
  veh.state = 'moving';
  veh.stuckNotified = false;
  return true;
}

function arrive(ctx: SimContext, veh: Vehicle, route: Route, def: VehicleKindDef): void {
  const { state } = ctx;
  const stop = route.stops[veh.stopIndex];
  const b = state.buildings[stop.buildingId];
  if (!b) {
    veh.stopIndex = (veh.stopIndex + 1) % route.stops.length;
    plan(ctx, veh, route, def);
    return;
  }
  transfer(state, veh, stop, b);
  veh.state = 'loading';
  veh.waitTicks = def.spec.loadTicks;
}

const EPS = 1e-9;

/** Advances `speed` tiles along the path, crossing several nodes if needed; arrival at the last node. */
function move(ctx: SimContext, veh: Vehicle, route: Route, def: VehicleKindDef, grace: number): void {
  const { map } = ctx.state;
  // an old vehicle is slower (society/aging.ts); the hot path skips the call while it is young
  const age = ctx.state.date.year - veh.builtYear;
  let remaining = age > grace ? def.spec.speed * agingEfficiency(age) : def.spec.speed;
  let replanned = false;
  for (;;) {
    if (veh.pathIndex >= veh.path.length) {
      arrive(ctx, veh, route, def);
      return;
    }
    const node = veh.path[veh.pathIndex];
    // the road ahead was removed: re-plan once from here (the start node is always our own tile)
    if (veh.pathIndex > 0 && !def.passable(map.tiles[node.y * map.width + node.x], node.x, node.y)) {
      if (replanned || !plan(ctx, veh, route, def)) {
        if (veh.state === 'moving') goStuck(ctx, veh);
        return;
      }
      replanned = true;
      continue;
    }
    if (remaining <= EPS) return;
    const dx = node.x - veh.pos.x;
    const dy = node.y - veh.pos.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d <= remaining + EPS) {
      veh.pos.x = node.x;
      veh.pos.y = node.y;
      remaining -= d;
      veh.pathIndex++;
    } else {
      // partial step: x first, then y (off-grid only right after a mid-tile re-plan)
      const mx = Math.max(-remaining, Math.min(remaining, dx));
      veh.pos.x += mx;
      remaining -= Math.abs(mx);
      const my = Math.max(-remaining, Math.min(remaining, dy));
      veh.pos.y += my;
      return;
    }
  }
}

/**
 * `route` is `state.routes[veh.routeId]` (undefined without a route), looked up by vehiclesTick, and
 * `grace` is AGING_GRACE, read once per tick rather than once per vehicle.
 */
function tickVehicle(ctx: SimContext, veh: Vehicle, route: Route | undefined, grace: number): void {
  const { state } = ctx;
  veh.prevPos.x = veh.pos.x;
  veh.prevPos.y = veh.pos.y;
  const def = VEHICLE_KINDS[veh.kind];
  if (!def) return;
  if (def.halted?.(state)) return;
  const n = route ? route.stops.length : 0;
  if (!route || n < 2) {
    veh.state = 'idle';
    veh.stuckNotified = false;
    if (veh.path.length > 0) {
      veh.path = [];
      veh.pathIndex = 0;
    }
    return;
  }
  if (veh.stopIndex >= n || veh.stopIndex < 0) veh.stopIndex = ((veh.stopIndex % n) + n) % n;
  if (veh.state === 'idle') {
    veh.state = 'moving';
    veh.path = [];
    veh.pathIndex = 0;
  }

  switch (veh.state) {
    case 'loading': {
      if (--veh.waitTicks > 0) return;
      veh.waitTicks = 0;
      // A cleared path means the stops were re-indexed while we dwelt (demolition or edit):
      // head for the current stop instead of skipping past it.
      if (veh.path.length > 0) veh.stopIndex = (veh.stopIndex + 1) % n;
      plan(ctx, veh, route, def);
      return;
    }
    case 'stuck': {
      if ((state.tick + veh.id) % STUCK_RETRY_TICKS !== 0) return;
      plan(ctx, veh, route, def);
      return;
    }
    case 'moving': {
      if (veh.path.length === 0 && !plan(ctx, veh, route, def)) return;
      move(ctx, veh, route, def, grace);
      return;
    }
  }
}

/** The vehicle state machine: moving → loading → moving, with stuck/idle side states. Ids ascending. */
export function vehiclesTick(ctx: SimContext): void {
  const { state } = ctx;
  const c = fleet(state);
  const { list } = c;
  const grace = AGING_GRACE;
  for (let k = 0; k < list.length; k++) {
    const veh = list[k];
    tickVehicle(ctx, veh, veh.routeId !== null ? routeOf(state, c, k, veh.routeId) : undefined, grace);
  }
}

/**
 * Removals from `state.routes` (bumped by deleteRoute, the only code that deletes a route). With the
 * fleet cache's `nextId` (createRoute takes a new id), it tells when a remembered route may be stale.
 */
let routeRemovals = 0;

/**
 * `state.routes[routeId]` for the fleet's vehicle at index k. The routes record is a sparse-id
 * dictionary, and a hash lookup per vehicle per hour was a large share of the vehicle tick, so the
 * route found last time is reused while the vehicle keeps its route id and the record is the same
 * object with no route deleted since. A miss (no such route) is never remembered.
 */
function routeOf(state: GameState, c: FleetCache, k: number, routeId: number): Route | undefined {
  if (c.routesRecord !== state.routes || c.routeRemovals !== routeRemovals) {
    c.routesRecord = state.routes;
    c.routeRemovals = routeRemovals;
    c.routes.fill(undefined);
  }
  let route = c.routes[k];
  if (route === undefined || c.routeIds[k] !== routeId) {
    route = state.routes[routeId];
    c.routes[k] = route;
    c.routeIds[k] = routeId;
  }
  return route;
}

/**
 * The vehicles in ascending id order, cached per `state.vehicles` object (outside GameState).
 * Vehicle ids are sparse, so the record is a dictionary and enumerating it every tick is costly.
 * The cache is reused while `state.nextId` is unchanged (no entity was created, so no vehicle was
 * added) and no vehicle was sold (`fleetRemovals`, bumped by sellVehicle, the only code that removes
 * vehicles). A new or loaded GameState has a new `vehicles` object and so starts a fresh cache.
 */
let fleetRemovals = 0;

interface FleetCache {
  nextId: number;
  removals: number;
  list: Vehicle[];
  /** routeOf's memo, by index into `list`: the route found and the route id it was found for */
  routes: (Route | undefined)[];
  routeIds: number[];
  routesRecord: GameState['routes'] | null;
  routeRemovals: number;
}

const fleetCache = new WeakMap<Record<number, Vehicle>, FleetCache>();

function fleet(state: GameState): FleetCache {
  const { vehicles } = state;
  const c = fleetCache.get(vehicles);
  if (c && c.nextId === state.nextId && c.removals === fleetRemovals) return c;
  const list = Object.values(vehicles);
  const fresh: FleetCache = {
    nextId: state.nextId,
    removals: fleetRemovals,
    list,
    routes: new Array<Route | undefined>(list.length).fill(undefined),
    routeIds: new Array<number>(list.length).fill(-1),
    routesRecord: state.routes,
    routeRemovals,
  };
  fleetCache.set(vehicles, fresh);
  return fresh;
}
