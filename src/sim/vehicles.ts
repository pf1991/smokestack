import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { canAfford, earn, spend } from './finance';
import { acceptsGood, handlesCargo, loadSource, noCargoError, storageLeft } from './inventory';
import { findPath, pathMemo, pathStillPassable, roadPassable, type Passable } from './pathfinding';
import { truckTollsMonth } from './politics/mayorEdicts';
import { accessTiles, nextId } from './state';
import { AGING_GRACE, agingEfficiency, assetAge, assetUpkeep, NO_WEAR } from './society/aging';
import { atPrices } from './society/economy';
import { hasNewerModel, modelSpec, newestModel } from './logistics/models';
import {
  AUTO_RECHECK_TICKS, autoPickup, autoRoutesChanged, clampMaxTrucks, departAuto, dropAutoJobs, leaveAutoRoute, MIN_LOAD_MAX_WAIT_TICKS, noteDeparture,
} from './logistics/autoRoutes';
import { advanceHubJob, fleetChanged, hubLoadCap, hubRoute, joinHub, leaveHub } from './logistics/jobRoute';
import type { AutoSize, HubJob, RouteMode, VehicleModelId } from './logistics/types';
import type { Building, GameState, GoodId, OwnerId, Route, RouteStop, SimContext, Vec2, Vehicle } from './types';

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
    if (stop.minLoad !== undefined && !MIN_LOADS.includes(stop.minLoad)) return err('Leave at 0%, 50% or 100% load');
  }
  return ok();
}

/** A manual stop's smart-wait shares (D10): leave at any load, half full or full. */
export const MIN_LOADS: readonly number[] = [0, 0.5, 1];

const copyStop = (s: RouteStop): RouteStop => {
  const c: RouteStop = { buildingId: s.buildingId, load: [...s.load], unload: [...s.unload] };
  if (s.minLoad) c.minLoad = s.minLoad;
  return c;
};

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
    mode: 'manual',
  };
  state.routes[id] = route;
  return ok(route);
}

/**
 * Stops may drop below two here (the route's vehicles then idle); new stops must be own buildings
 * with access. When stops change, every vehicle re-plans towards its (clamped) current stop index.
 * `mode` and `autoSize` (spec §6) are for truck routes; the truck cap is clamped to 1–20. A change of
 * stops or mode drops an auto route's jobs (the next daily rebuild starts afresh).
 */
export function updateRoute(
  ctx: SimContext,
  routeId: number,
  patch: Partial<Pick<Route, 'name' | 'stops' | 'color'>> & { mode?: RouteMode; autoSize?: AutoSize },
): Result {
  const { state } = ctx;
  const route = state.routes[routeId];
  if (!route) return err('No such route');
  if (patch.stops) {
    const v = validateStops(state, route.ownerId, route.kind, patch.stops);
    if (!v.ok) return v;
  }
  if ((patch.mode === 'auto' || patch.autoSize?.on) && route.kind !== 'truck') return err('Rail lines run as written');
  if (patch.mode !== undefined && patch.mode !== 'manual' && patch.mode !== 'auto') return err('Unknown route mode');
  if (patch.name !== undefined) route.name = patch.name;
  if (patch.color !== undefined) route.color = patch.color;
  if (patch.autoSize !== undefined || patch.mode !== undefined) autoRoutesChanged();
  if (patch.autoSize !== undefined) route.autoSize = { on: patch.autoSize.on === true, maxTrucks: clampMaxTrucks(patch.autoSize.maxTrucks) };
  if (patch.mode !== undefined && patch.mode !== route.mode) {
    route.mode = patch.mode;
    dropAutoJobs(state, route);
    for (const v of Object.values(state.vehicles)) if (v.routeId === routeId && v.dwell) v.dwell = 0; // a smart wait starts afresh
    if (route.mode === 'manual') delete route.jobs;
  }
  if (patch.stops) {
    const oldStops = route.stops;
    route.stops = patch.stops.map(copyStop);
    if (route.mode === 'auto') dropAutoJobs(state, route);
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
  if (route.mode === 'auto') dropAutoJobs(state, route);
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
export function buyVehicle(
  ctx: SimContext,
  owner: OwnerId,
  routeId: number,
  kind: Vehicle['kind'],
  model: VehicleModelId = kind === 'truck' ? newestModel(ctx.state) : 'train',
): Result<Vehicle> {
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
  if ((model === 'train') !== (kind === 'train')) return err('Wrong vehicle for this route');
  const price = vehiclePrice(state, model);
  if (!canAfford(company, price)) return err('Not enough money');
  spend(company, 'vehicles', price, state.date);
  const vehicle = newVehicle(state, owner, kind, model, spawn, routeId);
  if (route.stops.length >= 2) vehicle.state = 'moving';
  return ok(vehicle);
}

/**
 * Adds a new idle vehicle of `model` at `spawn` (no charge: the caller spends under 'vehicles'). Used by
 * buyVehicle and by hub truck purchases (logistics/hubs.ts), which pass `routeId: null`.
 */
export function newVehicle(state: GameState, owner: OwnerId, kind: Vehicle['kind'], model: VehicleModelId, spawn: Vec2, routeId: number | null): Vehicle {
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
    capacity: modelSpec(model).capacity,
    state: 'idle',
    waitTicks: 0,
    stuckNotified: false,
    builtYear: state.date.year,
    model,
    speed: modelSpec(model).speed,
    // declared up front (undefined is not saved) so every vehicle shares one object shape: a vehicle that
    // gained these later, in its own order, made the per-tick vehicle code megamorphic (several x slower)
    trips30: undefined,
    kits: undefined,
    hubId: undefined,
    job: undefined,
    dwell: undefined,
  };
  state.vehicles[vehicle.id] = vehicle;
  return vehicle;
}

/** Every Vehicle key in newVehicle's order. */
const VEHICLE_KEYS: readonly (keyof Vehicle)[] = [
  'id', 'kind', 'ownerId', 'routeId', 'pos', 'prevPos', 'path', 'pathIndex', 'stopIndex', 'cargo', 'capacity', 'state',
  'waitTicks', 'stuckNotified', 'builtYear', 'model', 'speed', 'trips30', 'kits', 'hubId', 'job', 'dwell',
];

/**
 * A loaded vehicle rebuilt with newVehicle's key order and shape (deserialize): a save then reloads into
 * the same objects, and serializes the same, as the game that wrote it.
 */
export function canonicalVehicle(v: Vehicle): Vehicle {
  const out: Record<string, unknown> = {};
  for (const k of VEHICLE_KEYS) out[k] = v[k];
  for (const k of Object.keys(v)) if (!(k in out)) out[k] = (v as unknown as Record<string, unknown>)[k];
  return out as unknown as Vehicle;
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
  earn(state.companies[veh.ownerId], 'vehicles', sellRefund(state, veh), state.date);
  delete state.vehicles[id];
  fleetRemovals++;
  fleetChanged();
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
  const hub = veh.hubId != null ? state.buildings[veh.hubId] : undefined;
  const route = veh.routeId !== null ? state.routes[veh.routeId] : undefined;
  if (!route && !hub) return err('Assign it to a route first');
  const def = VEHICLE_KINDS[veh.kind];
  const first = hub ?? (route!.stops[0] ? state.buildings[route!.stops[0].buildingId] : undefined);
  if (!def || !first || !def.access(state, first)[0]) return err(def?.noAccessError ?? 'Stop has no road access');
  if (assetAge(state, veh) <= AGING_GRACE && !hasNewerModel(state, veh.model)) return err(NO_WEAR);
  if (!canAfford(state.companies[veh.ownerId], replaceCost(state, veh))) return err('Not enough money');
  const { ownerId, kind, stopIndex } = veh;
  const at = { x: Math.round(veh.pos.x), y: Math.round(veh.pos.y) };
  if (hub) {
    // a hub truck stays on its hub and carries on with its job from where the old one stood
    // and keeps its cargo (taken from a hub or a producer, it has nowhere else to go)
    const job = (veh.job ?? null) as HubJob | null;
    const cargo = veh.cargo;
    sellVehicle(ctx, id);
    const model = newestModel(state);
    spend(state.companies[ownerId], 'vehicles', vehiclePrice(state, model), state.date);
    const fresh = newVehicle(state, ownerId, kind, model, at, null);
    joinHub(fresh, hub.id, job);
    fresh.cargo = cargo;
    fresh.stopIndex = stopIndex;
    if (job) fresh.state = 'moving';
    return ok(fresh);
  }
  sellVehicle(ctx, id);
  const bought = buyVehicle(ctx, ownerId, route!.id, kind); // the newest model, no kits
  if (!bought.ok) return bought;
  const fresh = bought.value;
  fresh.pos = { ...at };
  fresh.prevPos = { ...at };
  fresh.stopIndex = stopIndex;
  fresh.path = [];
  fresh.pathIndex = 0;
  return bought;
}

/** The model a kind or vehicle stands for when pricing: a kind means the newest of it on sale. */
function modelFor(state: GameState, x: Vehicle | Vehicle['kind'] | VehicleModelId): VehicleModelId {
  if (typeof x === 'object') return x.model;
  return x === 'truck' ? newestModel(state) : x === 'train' ? 'train' : x;
}

/** Price of a new vehicle at today's prices, rounded; a bare kind prices the newest truck model. */
export function vehiclePrice(state: GameState, kindOrModel: Vehicle['kind'] | VehicleModelId): number {
  return Math.round(atPrices(state, modelSpec(modelFor(state, kindOrModel)).cost));
}

/** What selling `veh` refunds: SELL_REFUND of its own model's price today, rounded. */
export function sellRefund(state: GameState, veh: Vehicle | Vehicle['kind']): number {
  return Math.round(vehiclePrice(state, modelFor(state, veh)) * SELL_REFUND);
}

/** Net price of replacing `veh`: the newest model of its kind less its own refund. */
export function replaceCost(state: GameState, veh: Vehicle | Vehicle['kind']): number {
  const kind = typeof veh === 'object' ? veh.kind : veh;
  return vehiclePrice(state, kind) - sellRefund(state, veh);
}

/** Monthly upkeep of `veh`: its model's maintenance at today's prices × its age factor. */
export function vehicleUpkeep(state: GameState, veh: Vehicle): number {
  return atPrices(state, modelSpec(veh.model).maintenance) * assetUpkeep(state, veh);
}

/**
 * Replaces, in id order, every truck of the route that is older than the newest model, stopping at
 * the first one `owner` cannot afford.
 */
export function upgradeRouteTrucks(ctx: SimContext, routeId: number, owner: OwnerId): Result<{ replaced: number }> {
  const { state } = ctx;
  const route = state.routes[routeId];
  if (!route) return err('No such route');
  if (route.ownerId !== owner) return err('Not your route');
  const ids = Object.values(state.vehicles)
    .filter((v) => v.routeId === routeId && v.kind === 'truck' && hasNewerModel(state, v.model))
    .map((v) => v.id)
    .sort((a, b) => a - b);
  let replaced = 0;
  for (const id of ids) {
    if (!replaceVehicle(ctx, id, owner).ok) break;
    replaced++;
  }
  return ok({ replaced });
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
  if (veh.hubId != null) {
    leaveHub(veh); // off its hub: the hold empties as it would leaving a route
    veh.cargo = {};
  }
  if (veh.routeId !== routeId) {
    veh.cargo = {};
    leaveAutoRoute(veh);
  }
  if (veh.dwell) veh.dwell = 0;
  veh.routeId = routeId;
  fleetChanged();
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

const NO_GOODS: GoodId[] = [];

function cargoTotal(veh: Vehicle): number {
  let n = 0;
  for (const g in veh.cargo) n += veh.cargo[g];
  return n;
}

/**
 * Unload `stop.unload` goods the building accepts (bounded by storageLeft), then load `stop.load`;
 * with `onlyGood` (an auto route's pickup) load just that good if the stop loads it, and with null nothing.
 * `max` caps the units loaded (a hub truck takes only its job's quantity).
 */
function transfer(state: GameState, veh: Vehicle, stop: RouteStop, b: Building, onlyGood?: GoodId | null, max?: number): void {
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
  const goods = onlyGood === undefined ? stop.load : onlyGood !== null && stop.load.includes(onlyGood) ? [onlyGood] : NO_GOODS;
  const k = goods.length;
  let free = veh.capacity - cargoTotal(veh);
  if (max !== undefined && max < free) free = max;
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
  transfer(state, veh, stop, b, route.mode === 'auto' ? autoPickup(veh) : undefined, route.id < 0 ? hubLoadCap(veh) : undefined);
  veh.state = 'loading';
  veh.waitTicks = def.spec.loadTicks;
}

/** Stays at the current stop for another recheck, retrying the transfer there (smart and auto waits). */
function waitHere(state: GameState, veh: Vehicle, route: Route): void {
  const stop = route.stops[veh.stopIndex];
  const b = stop ? state.buildings[stop.buildingId] : undefined;
  if (b) transfer(state, veh, stop, b, route.mode === 'auto' ? null : undefined);
  veh.waitTicks = AUTO_RECHECK_TICKS;
}

/**
 * The end of a dwell. An auto route asks departAuto where to go (or to wait); a manual stop with
 * `minLoad` holds the truck until it is that full or has waited MIN_LOAD_MAX_WAIT_TICKS.
 */
function depart(ctx: SimContext, veh: Vehicle, route: Route, def: VehicleKindDef): void {
  const { state } = ctx;
  const n = route.stops.length;
  // A cleared path means the stops were re-indexed while we dwelt (demolition or edit):
  // head for the current stop instead of skipping past it.
  const atStop = veh.path.length > 0;
  if (route.mode === 'auto' && atStop) {
    const next = departAuto(state, veh, route);
    if (next === 'wait') return waitHere(state, veh, route);
    if (next === veh.stopIndex) return arrive(ctx, veh, route, def); // the job's pickup is here
    noteDeparture(state, veh, route, route.stops[veh.stopIndex]);
    veh.stopIndex = next;
    plan(ctx, veh, route, def);
    return;
  }
  const minLoad = route.mode === 'manual' && atStop ? route.stops[veh.stopIndex].minLoad : undefined;
  if (minLoad && (veh.dwell ?? 0) < MIN_LOAD_MAX_WAIT_TICKS && cargoTotal(veh) < minLoad * veh.capacity && route.stops[veh.stopIndex].load.length > 0) {
    waitHere(state, veh, route);
    veh.dwell = (veh.dwell ?? 0) + AUTO_RECHECK_TICKS;
    return;
  }
  if (veh.dwell) veh.dwell = 0;
  noteDeparture(state, veh, route, atStop ? route.stops[veh.stopIndex] : undefined);
  if (atStop) veh.stopIndex = (veh.stopIndex + 1) % n;
  plan(ctx, veh, route, def);
}

/** A hub truck's dwell end: its job moves on (logistics/jobRoute.ts), then it heads for the next stop or idles. */
function departHub(ctx: SimContext, veh: Vehicle, def: VehicleKindDef): void {
  advanceHubJob(ctx.state, veh);
  const next = hubRoute(ctx.state, veh);
  if (next) {
    plan(ctx, veh, next, def);
    return;
  }
  veh.state = 'idle';
  veh.path = [];
  veh.pathIndex = 0;
}

const EPS = 1e-9;

/** Advances `speed` tiles along the path, crossing several nodes if needed; arrival at the last node. */
function move(ctx: SimContext, veh: Vehicle, route: Route, def: VehicleKindDef, grace: number): void {
  const { map } = ctx.state;
  // an old vehicle is slower (society/aging.ts); the hot path skips the call while it is young
  const age = ctx.state.date.year - veh.builtYear;
  let remaining = age > grace ? veh.speed * agingEfficiency(age) : veh.speed;
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
  // a hub truck's return trip is a one-stop route (its hub); any other route needs two stops
  if (!route || n < (route.id < 0 ? 1 : 2)) {
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
      if (route.id < 0) return departHub(ctx, veh, def);
      depart(ctx, veh, route, def);
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
    tickVehicle(ctx, veh, veh.routeId !== null ? routeOf(state, c, k, veh.routeId) : veh.hubId != null ? hubRoute(state, veh) : undefined, grace);
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
