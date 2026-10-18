import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { acceptsGood, loadSource, storageLeft } from '../inventory';
import { atPrices } from '../society/economy';
import type { Building, GameState, GoodId, Route, SimContext, Vehicle } from '../types';
import { buyTruck, sellVehicle, vehiclePrice } from '../vehicles';
import { modelSpec, newestModel } from './models';
import type { AutoJob, HubJob, RouteStats } from './types';

/**
 * Automatic routes (spec §6): a daily job board per auto route, the per-departure job pick, and
 * monthly auto-sizing. The only writer of an auto-route truck's `job` (a `'collect'` HubJob whose
 * from/to are stop indices on its route).
 */

/** Jobs under this many units are dropped from the board. */
export const AUTO_MIN_JOB = 5;
/** The board keeps at most this many jobs. */
export const AUTO_JOB_CAP = 16;
/** Added to every job's distance, so short hops do not dominate the board. */
export const DIST_BIAS = 8;
/** A smart wait (manual routes) gives up after this many ticks (10 days). */
export const MIN_LOAD_MAX_WAIT_TICKS = 240;
/** Ticks between rechecks of a waiting truck (smart waits and auto routes alike). */
export const AUTO_RECHECK_TICKS = 24;
/** Auto-sizing keeps the share of loaded departures in this band. */
export const AUTO_BAND = { low: 0.6, high: 0.85 } as const;
/** Days in a month the board must have left a truck load untaken before auto-sizing buys. */
export const AUTO_BACKLOG_DAYS = 10;
/** Auto-sizing never spends below this (1900 $). */
export const AUTO_RESERVE = 20_000;
/** Auto-sizing's truck cap is clamped to this range. */
export const AUTO_MAX_TRUCKS = { min: 1, max: 20 } as const;

export const clampMaxTrucks = (n: number): number =>
  Math.max(AUTO_MAX_TRUCKS.min, Math.min(AUTO_MAX_TRUCKS.max, Math.round(Number.isFinite(n) ? n : AUTO_MAX_TRUCKS.min)));

/** True when a route keeps departure counters: auto routes and auto-sized routes. */
export const tracksStats = (route: Route): boolean => route.mode === 'auto' || route.autoSize?.on === true;

/** An auto-route pickup: a 'collect' HubJob whose from/to are stop indices. */
const isCollect = (j: Vehicle['job']): j is HubJob & { good: GoodId } =>
  !!j && 'kind' in j && j.kind === 'collect' && j.good !== null;

const newStats = (): RouteStats => ({ loaded: 0, empty: 0, backlogDays: 0 });

function cargoTotal(veh: Vehicle): number {
  let n = 0;
  for (const g in veh.cargo) n += veh.cargo[g];
  return n;
}

/** Manhattan distance between two buildings' footprint centres. */
function distance(a: Building, b: Building): number {
  const sa = BUILDINGS[a.typeId].size;
  const sb = BUILDINGS[b.typeId].size;
  return Math.abs(a.pos.x + sa.w / 2 - (b.pos.x + sb.w / 2)) + Math.abs(a.pos.y + sa.h / 2 - (b.pos.y + sb.h / 2));
}

/** The smallest truck on the route sets what "a truck load" is (the newest model without trucks). */
function truckLoad(state: GameState, trucks: Vehicle[]): number {
  if (trucks.length === 0) return modelSpec(newestModel(state)).capacity;
  let cap = Infinity;
  for (const v of trucks) cap = Math.min(cap, v.capacity);
  return cap;
}

const byScore = (a: AutoJob, b: AutoJob): number =>
  b.score - a.score || a.from - b.from || a.to - b.to || (a.good < b.good ? -1 : a.good > b.good ? 1 : 0);

/** Clears a truck's job when it no longer names a loading stop of its route. */
function validJob(veh: Vehicle, route: Route): boolean {
  const j = veh.job;
  if (!j) return false;
  const stop = isCollect(j) ? route.stops[j.from] : undefined;
  if (isCollect(j) && stop && j.to < route.stops.length && stop.load.includes(j.good)) return true;
  veh.job = null;
  return false;
}

/** Rebuilds `route.jobs` (spec §6.2); `trucks` are the route's vehicles in id order. */
function rebuildBoard(state: GameState, route: Route, trucks: Vehicle[]): void {
  const stats = (route.stats ??= newStats());
  const yesterday = route.jobs;
  if (yesterday && yesterday.length > 0) {
    const load = truckLoad(state, trucks);
    if (yesterday.some((j) => j.qty >= load)) stats.backlogDays++;
  }
  const { stops } = route;
  const n = stops.length;
  // cargo promised to trucks still heading for their pickup, by stop and good
  let promised: Map<string, number> | null = null;
  for (const v of trucks) {
    if (!validJob(v, route)) continue;
    const j = v.job as HubJob;
    const key = `${j.from}:${j.good}`;
    (promised ??= new Map()).set(key, (promised.get(key) ?? 0) + j.qty);
  }
  const jobs: AutoJob[] = [];
  if (n >= 2) {
    for (let i = 0; i < n; i++) {
      const from = state.buildings[stops[i].buildingId];
      if (!from) continue;
      const src = loadSource(from);
      for (const g of stops[i].load) {
        const avail = Math.floor(src[g] ?? 0) - (promised?.get(`${i}:${g}`) ?? 0);
        if (avail < AUTO_MIN_JOB) continue;
        for (let j = 0; j < n; j++) {
          if (j === i || !stops[j].unload.includes(g)) continue;
          const to = state.buildings[stops[j].buildingId];
          if (!to || to === from || !acceptsGood(to, g)) continue;
          const qty = Math.min(avail, storageLeft(to, g));
          if (qty < AUTO_MIN_JOB) continue;
          jobs.push({ from: i, to: j, good: g, qty, score: (qty * GOODS[g].basePrice) / (distance(from, to) + DIST_BIAS) });
        }
      }
    }
    jobs.sort(byScore);
    if (jobs.length > AUTO_JOB_CAP) jobs.length = AUTO_JOB_CAP;
  }
  route.jobs = jobs;
}

/**
 * An auto-sized manual route has no board: a backlog day is a day ending with a truck load waiting
 * at one of its loading stops.
 */
function manualBacklog(state: GameState, route: Route, trucks: Vehicle[]): void {
  const stats = (route.stats ??= newStats());
  const load = truckLoad(state, trucks);
  for (const stop of route.stops) {
    const b = state.buildings[stop.buildingId];
    if (!b) continue;
    const src = loadSource(b);
    if (stop.load.some((g) => (src[g] ?? 0) >= load)) {
      stats.backlogDays++;
      return;
    }
  }
}

/** Each route's vehicles in ascending id order. */
function vehiclesByRoute(state: GameState): Map<number, Vehicle[]> {
  const out = new Map<number, Vehicle[]>();
  for (const v of Object.values(state.vehicles)) {
    if (v.routeId === null) continue;
    let list = out.get(v.routeId);
    if (!list) out.set(v.routeId, (list = []));
    list.push(v);
  }
  return out;
}

/**
 * Bumped by updateRoute whenever a route's mode or auto-sizing changes. With `state.nextId` (a new
 * route takes a new id) and the routes record's identity (a load makes a new one), it tells when the
 * remembered "no route is auto or auto-sized" may be stale, so the daily and monthly hooks cost
 * nothing in a game that never uses automatic routes. Lives outside GameState.
 */
let autoRev = 0;
export function autoRoutesChanged(): void {
  autoRev++;
}
const anyCache = new WeakMap<GameState['routes'], { rev: number; nextId: number; any: boolean }>();

function anyTracked(state: GameState): boolean {
  const c = anyCache.get(state.routes);
  if (c && c.rev === autoRev && c.nextId === state.nextId) return c.any;
  let any = false;
  for (const key in state.routes) {
    if (tracksStats(state.routes[key]) || state.routes[key].stats) { // stats: one more month-end to clear them
      any = true;
      break;
    }
  }
  anyCache.set(state.routes, { rev: autoRev, nextId: state.nextId, any });
  return any;
}

/** Daily: rebuilds every auto route's board in id order; free when no route is auto or auto-sized. */
export function autoRoutesDay(ctx: SimContext): void {
  const { state } = ctx;
  if (!anyTracked(state)) return;
  let byRoute: Map<number, Vehicle[]> | null = null;
  for (const key in state.routes) {
    const route = state.routes[key];
    if (!tracksStats(route)) continue;
    byRoute ??= vehiclesByRoute(state);
    const trucks = byRoute.get(route.id) ?? [];
    if (route.mode === 'auto') rebuildBoard(state, route, trucks);
    else manualBacklog(state, route, trucks);
  }
}

/**
 * Spec §6.3, at the end of an auto truck's dwell at stop `veh.stopIndex`: cargo first (the nearest
 * stop that unloads a carried good and has room; else the nearest that unloads it), then the board
 * (the first job with qty left: the truck promises up to its capacity), else `'wait'`. Returns the
 * next stop index, or `'wait'` when the truck should stay where it is (the caller retries the
 * transfer and checks again later). Sets or clears `veh.job`.
 */
export function departAuto(state: GameState, veh: Vehicle, route: Route): number | 'wait' {
  const { stops } = route;
  const n = stops.length;
  const here = veh.stopIndex;
  const at = stops[here] ? state.buildings[stops[here].buildingId] : undefined;
  if (cargoTotal(veh) > 0) {
    if (veh.job) veh.job = null;
    let best = -1;
    let bestD = Infinity;
    let fallback = -1;
    let fallbackD = Infinity;
    for (let j = 0; j < n; j++) {
      const b = state.buildings[stops[j].buildingId];
      if (!b) continue;
      let unloads = false;
      let room = false;
      for (const g in veh.cargo) {
        if (!stops[j].unload.includes(g) || !acceptsGood(b, g)) continue;
        unloads = true;
        if (storageLeft(b, g) > 0) room = true;
      }
      if (!unloads) continue;
      const d = at ? distance(at, b) : Math.abs(veh.pos.x - b.pos.x) + Math.abs(veh.pos.y - b.pos.y);
      if (room && d < bestD) {
        best = j;
        bestD = d;
      }
      if (d < fallbackD) {
        fallback = j;
        fallbackD = d;
      }
    }
    const next = best >= 0 ? best : fallback;
    return next < 0 || next === here ? 'wait' : next;
  }
  for (const job of route.jobs ?? []) {
    if (job.qty <= 0 || job.from >= n || job.to >= n) continue;
    const stop = stops[job.from];
    if (!stop.load.includes(job.good) || !state.buildings[stop.buildingId]) continue;
    veh.job = { kind: 'collect', from: job.from, to: job.to, good: job.good, qty: Math.min(veh.capacity, job.qty) };
    job.qty = Math.max(0, job.qty - veh.capacity);
    return job.from;
  }
  if (veh.job) veh.job = null;
  return 'wait';
}

/**
 * At an auto truck's arrival: the one good it may load here (its job's, when this is the job's
 * pickup), or null to load nothing. The pickup is then done, so the job is cleared (no longer promised).
 */
export function autoPickup(veh: Vehicle): GoodId | null {
  const j = veh.job;
  if (!isCollect(j) || j.from !== veh.stopIndex) return null;
  veh.job = null;
  return j.good;
}

/** Drops every job of a route's trucks and its board (stops or mode changed); the next rebuild starts afresh. */
export function dropAutoJobs(state: GameState, route: Route): void {
  if (route.jobs) route.jobs = [];
  for (const v of Object.values(state.vehicles)) if (v.routeId === route.id && v.job && v.hubId == null) v.job = null;
}

/** A vehicle leaves a route (reassigned): its auto job goes with it. */
export function leaveAutoRoute(veh: Vehicle): void {
  if (veh.job && veh.hubId == null) veh.job = null;
}

/** Counts a departure for auto-sizing and the soak's auto-route gate. */
export function noteDeparture(state: GameState, veh: Vehicle, route: Route): void {
  if (!tracksStats(route)) return;
  const stats = (route.stats ??= newStats());
  if (cargoTotal(veh) > 0) {
    stats.loaded++;
    if (route.mode === 'auto') {
      const tally = state.logistics.stats.autoLoaded;
      tally[veh.ownerId] = (tally[veh.ownerId] ?? 0) + 1;
    }
  } else stats.empty++;
}

/** Share of loaded departures in `stats` (0 with no departures). */
export function utilisation(stats: RouteStats | undefined): number {
  const total = stats ? stats.loaded + stats.empty : 0;
  return total > 0 ? stats!.loaded / total : 0;
}

/** Spec §6.4 for one auto-sized route: buy one, sell one, or neither. */
function sizeRoute(ctx: SimContext, route: Route, maxTrucks: number): void {
  const { state } = ctx;
  const stats = route.stats ?? newStats();
  const u = utilisation(stats);
  const trucks = Object.values(state.vehicles).filter((v) => v.routeId === route.id && v.kind === 'truck');
  if (u > AUTO_BAND.high && stats.backlogDays >= AUTO_BACKLOG_DAYS && trucks.length < maxTrucks) {
    const company = state.companies[route.ownerId];
    if (company && company.money > 0 && company.money - vehiclePrice(state, 'truck') >= atPrices(state, AUTO_RESERVE)) {
      buyTruck(ctx, route.ownerId, route.id);
    }
  } else if (u < AUTO_BAND.low && trucks.length > 1) {
    let oldest = trucks[0];
    for (const v of trucks) if (v.builtYear < oldest.builtYear) oldest = v; // ids ascend: ties keep the lowest
    sellVehicle(ctx, oldest.id);
  }
}

/**
 * Monthly, routes in id order: auto-sizes every route with auto-sizing on, then resets every
 * route's counters, keeping last month's loaded share (percent) for the route window.
 */
export function autoSizeRoutesMonth(ctx: SimContext): void {
  const { state } = ctx;
  if (!anyTracked(state)) return;
  for (const key in state.routes) {
    const route = state.routes[key];
    if (route.autoSize?.on) sizeRoute(ctx, route, clampMaxTrucks(route.autoSize.maxTrucks));
    if (!route.stats) continue;
    if (!tracksStats(route)) {
      delete route.stats; // switched back to a plain manual route
      continue;
    }
    const s = route.stats;
    route.stats = { ...newStats(), last: s.loaded + s.empty > 0 ? Math.round(utilisation(s) * 100) : undefined };
    if (route.stats.last === undefined) delete route.stats.last;
  }
}
