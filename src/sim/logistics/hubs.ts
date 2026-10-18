import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import { err, ok, type Result } from '../../core/result';
import { dateToDays } from '../clock';
import { canAfford, spend } from '../finance';
import { acceptsGood, handlesCargo, storageLeft } from '../inventory';
import { buildingList, buildingsNear } from '../spatial';
import { accessTiles } from '../state';
import type { Building, GameState, GoodId, OwnerId, SimContext, Vehicle } from '../types';
import { newVehicle, vehiclePrice } from '../vehicles';
import { buildingStorage, hubRange, levelDef } from './levels';
import { managerAt } from './managers';
import { newestModel } from './models';
import type { HubJob, HubJobKind, HubState, Skill } from './types';

/**
 * Warehouse hubs (spec §8): a warehouse with its own trucks, dispatched daily (greedily, Manhattan
 * distances, no pathfinding) by the manager posted there. Look-ahead, balancing and hub auto-sizing
 * come with Task 7.
 */

/** A candidate (and a truck's share of one) must be at least this many units. */
export const HUB_MIN_LOAD = 10;
/** A producer whose output fills this share of its storage is collected first (×FULL_BONUS). */
export const HUB_FULL_RATIO = 0.8;
export const STORE_PRIORITY = 2;
export const STALL_PRIORITY = 1.5;
export const FULL_BONUS = 1.5;
/** Added to every distance, so short hops do not dominate. */
const DIST_BIAS = 8;

/** Spec §8.3: what the posted manager's logistics skill buys. */
export const SKILL_TIERS: Record<Skill, { rangeShare: number; every: number; lookAhead: boolean; balance: boolean }> = {
  1: { rangeShare: 1 / 3, every: 7, lookAhead: false, balance: false },
  2: { rangeShare: 1 / 2, every: 5, lookAhead: false, balance: false },
  3: { rangeShare: 2 / 3, every: 3, lookAhead: true, balance: false },
  4: { rangeShare: 5 / 6, every: 2, lookAhead: true, balance: true },
  5: { rangeShare: 1, every: 1, lookAhead: true, balance: true },
};

/** Hub trucks a warehouse may run at its level (0 for anything else). */
export function hubCap(b: Building): number {
  return b.typeId === 'warehouse' ? (levelDef(b)?.hubTrucks ?? 0) : 0;
}

/** The posted manager's tier at `b`, or null when no manager of its owner runs it. */
export function hubTier(state: GameState, b: Building): (typeof SKILL_TIERS)[Skill] | null {
  const m = managerAt(state, b.id);
  return m && m.employer === b.ownerId ? SKILL_TIERS[m.skills.logistics] : null;
}

/** The trucks of hub `hubId`, in id order. */
export function hubTrucks(state: GameState, hubId: number): Vehicle[] {
  return Object.values(state.vehicles).filter((v) => v.hubId === hubId);
}

/** Bumped by openHub; with nextId and the buildings record it keys the hub list cache. */
let hubRev = 0;
const hubLists = new WeakMap<GameState['buildings'], { nextId: number; rev: number; list: Building[] }>();

/** Buildings with a hub, in id order (cached; a demolished one may linger until the next id is taken). */
function hubList(state: GameState): Building[] {
  const c = hubLists.get(state.buildings);
  if (c && c.nextId === state.nextId && c.rev === hubRev) return c.list;
  const list = buildingList(state).filter((b) => b.hub);
  hubLists.set(state.buildings, { nextId: state.nextId, rev: hubRev, list });
  return list;
}

/** Makes warehouse `warehouseId` a hub (idempotent). Dispatch days are staggered by id. */
export function openHub(ctx: SimContext, warehouseId: number, owner: OwnerId): Result {
  const { state } = ctx;
  const b = state.buildings[warehouseId];
  if (!b) return err('No such building');
  if (b.ownerId !== owner) return err('Not your building');
  if (b.typeId !== 'warehouse') return err('Only a warehouse can be a hub');
  if (b.hub) return ok();
  const every = (hubTier(state, b) ?? SKILL_TIERS[1]).every;
  const hub: HubState = {
    autoSize: true,
    maxTrucks: hubCap(b),
    nextDispatchDay: dateToDays(state.date) + (b.id % every),
    month: { jobs: 0, idleTruckDays: 0, backlogDays: 0 },
    yesterday: { jobs: 0, idle: 0 },
  };
  b.hub = hub;
  hubRev++;
  return ok();
}

/** Why `owner` cannot buy a hub truck for `b` now, or null. */
export function hubTruckRefusal(state: GameState, b: Building, owner: OwnerId): string | null {
  if (b.ownerId !== owner) return 'Not your building';
  if (b.typeId !== 'warehouse') return 'Only a warehouse can be a hub';
  if (accessTiles(state, b).length === 0) return 'Warehouse has no road access';
  if (hubTrucks(state, b.id).length >= hubCap(b)) return 'Hub fleet is full';
  if (!canAfford(state.companies[owner], vehiclePrice(state, newestModel(state)))) return 'Not enough money';
  return null;
}

/** Buys the newest truck model for the warehouse's hub (opening it first), idle at its access tile. */
export function buyHubTruck(ctx: SimContext, owner: OwnerId, warehouseId: number): Result<Vehicle> {
  const { state } = ctx;
  const b = state.buildings[warehouseId];
  if (!b) return err('No such building');
  const why = hubTruckRefusal(state, b, owner);
  if (why) return err(why);
  const opened = openHub(ctx, warehouseId, owner);
  if (!opened.ok) return opened;
  const model = newestModel(state);
  spend(state.companies[owner], 'vehicles', vehiclePrice(state, model), state.date);
  const v = newVehicle(state, owner, 'truck', model, accessTiles(state, b)[0], null);
  v.hubId = b.id;
  v.job = null;
  v.state = 'idle';
  return ok(v);
}

/** Turns hub auto-sizing on or off (spec §8.4). */
export function setHubAutoSize(ctx: SimContext, warehouseId: number, owner: OwnerId, on: boolean): Result {
  const b = ctx.state.buildings[warehouseId];
  if (!b || !b.hub) return err('No such hub');
  if (b.ownerId !== owner) return err('Not your building');
  b.hub.autoSize = on;
  return ok();
}

// ---------------------------------------------------------------------------
// attachment

/** Largest building side in the catalogue (bounds the spatial query below). */
let maxSide = 0;
function largestSide(): number {
  if (maxSide === 0) for (const d of Object.values(BUILDINGS)) maxSide = Math.max(maxSide, d.size.w, d.size.h);
  return maxSide;
}

/** Chebyshev distance between two footprints, tile to tile (1 for neighbours, 0 when they overlap). */
export function footprintGap(a: Building, b: Building): number {
  const sa = BUILDINGS[a.typeId].size;
  const sb = BUILDINGS[b.typeId].size;
  const dx = Math.max(0, b.pos.x - (a.pos.x + sa.w - 1), a.pos.x - (b.pos.x + sb.w - 1));
  const dy = Math.max(0, b.pos.y - (a.pos.y + sa.h - 1), a.pos.y - (b.pos.y + sb.h - 1));
  return Math.max(dx, dy);
}

/**
 * The owner's buildings within `radius` (Chebyshev, footprint to footprint) of the hub that take
 * cargo, except warehouses, stations and housing (the logistics category), in id order.
 */
export function hubAttached(state: GameState, hub: Building, radius: number): Building[] {
  const s = BUILDINGS[hub.typeId].size;
  const centre = { x: hub.pos.x + s.w / 2, y: hub.pos.y + s.h / 2 };
  // a footprint within `radius` has its centre within radius + both half-sides on each axis
  const reach = Math.SQRT2 * (radius + 1 + (Math.max(s.w, s.h) + largestSide()) / 2);
  return buildingsNear(state, centre, reach, hub.ownerId).filter(
    (b) => b !== hub && BUILDINGS[b.typeId].category !== 'logistics' && handlesCargo(b) && footprintGap(hub, b) <= radius + 1e-9,
  );
}

// ---------------------------------------------------------------------------
// routes take precedence (D2)

interface RoutedCache {
  nextId: number;
  seen: { route: GameState['routes'][number]; stops: unknown; owner: OwnerId }[];
  byOwner: Map<OwnerId, { loads: Set<string>; unloads: Set<string> }>;
}
const routedCache = new WeakMap<GameState['routes'], RoutedCache>();
const EMPTY_ROUTED = { loads: new Set<string>(), unloads: new Set<string>() };

function routedStale(state: GameState, c: RoutedCache): boolean {
  if (c.nextId !== state.nextId) return true;
  let n = 0;
  for (const key in state.routes) {
    const r = state.routes[key];
    const s = c.seen[n++];
    if (!s || s.route !== r || s.stops !== r.stops || s.owner !== r.ownerId) return true;
  }
  return n !== c.seen.length;
}

/**
 * `${buildingId}:${good}` keys of what the owner's routes load and unload. Cached on the routes record
 * and nextId, as the vehicle fleet is; stops are replaced (never edited in place), so a stops array,
 * route or owner that changed is seen by identity.
 */
export function routedGoods(state: GameState, owner: OwnerId): { loads: Set<string>; unloads: Set<string> } {
  let c = routedCache.get(state.routes);
  if (!c || routedStale(state, c)) {
    c = { nextId: state.nextId, seen: [], byOwner: new Map() };
    for (const key in state.routes) {
      const r = state.routes[key];
      c.seen.push({ route: r, stops: r.stops, owner: r.ownerId });
      let e = c.byOwner.get(r.ownerId);
      if (!e) c.byOwner.set(r.ownerId, (e = { loads: new Set(), unloads: new Set() }));
      for (const s of r.stops) {
        for (const g of s.load) e.loads.add(`${s.buildingId}:${g}`);
        for (const g of s.unload) e.unloads.add(`${s.buildingId}:${g}`);
      }
    }
    routedCache.set(state.routes, c);
  }
  return c.byOwner.get(owner) ?? EMPTY_ROUTED;
}

// ---------------------------------------------------------------------------
// dispatch (spec §8.2)

interface Candidate {
  kind: HubJobKind;
  from: number;
  to: number;
  /** the producer (collect) or consumer (deliver): the third sort key */
  building: number;
  good: GoodId;
  left: number;
  score: number;
}
const KIND_ORDER: Record<HubJobKind, number> = { deliver: 0, collect: 1, balance: 2, return: 3 };

export const byCandidate = (a: Candidate, b: Candidate): number =>
  b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.building - b.building || (a.good < b.good ? -1 : a.good > b.good ? 1 : 0);

/** Manhattan distance between footprint centres. */
function distance(a: Building, b: Building): number {
  const sa = BUILDINGS[a.typeId].size;
  const sb = BUILDINGS[b.typeId].size;
  return Math.abs(a.pos.x + sa.w / 2 - (b.pos.x + sb.w / 2)) + Math.abs(a.pos.y + sa.h / 2 - (b.pos.y + sb.h / 2));
}

function cargoTotal(v: Vehicle): number {
  let n = 0;
  for (const g in v.cargo) n += v.cargo[g];
  return n;
}

/** Work promised to hub trucks still on their way (all hubs of every owner, keyed by building and good). */
interface Promises {
  /** collects not yet picked up, by `${producer}:${good}` */
  pickups: Map<string, number>;
  /** deliveries not yet loaded at their hub, by `${hub}:${good}` */
  hubOut: Map<string, number>;
  /** deliveries not yet dropped, by `${consumer}:${good}` */
  inbound: Map<string, number>;
  /** collects not yet unloaded at the hub, by hub */
  hubIn: Map<number, number>;
}

const add = <K>(m: Map<K, number>, k: K, n: number): void => {
  m.set(k, (m.get(k) ?? 0) + n);
};

function promises(trucks: Vehicle[]): Promises {
  const p: Promises = { pickups: new Map(), hubOut: new Map(), inbound: new Map(), hubIn: new Map() };
  for (const v of trucks) {
    const j = v.job as HubJob | null | undefined;
    if (!j || j.good === null || j.kind === 'return') continue;
    const beforePickup = v.stopIndex === 0 && v.state !== 'loading';
    if (j.kind === 'collect') {
      if (beforePickup) add(p.pickups, `${j.from}:${j.good}`, j.qty);
      add(p.hubIn, j.to, j.qty);
    } else {
      if (beforePickup) add(p.hubOut, `${j.from}:${j.good}`, j.qty);
      add(p.inbound, `${j.to}:${j.good}`, j.qty);
    }
  }
  return p;
}

/** Store in a town still short of `good`, or a factory with less than one batch of it: the delivery priority. */
function deliveryPriority(state: GameState, c: Building, good: GoodId): number {
  const cat = BUILDINGS[c.typeId].category;
  if (cat === 'retail') {
    const e = c.cityId !== null ? state.cities[c.cityId]?.market[good] : undefined;
    return e && e.demand30 > e.sold30 ? STORE_PRIORITY : 1;
  }
  const need = c.recipeId ? RECIPES[c.recipeId]?.inputs[good] : undefined;
  return need !== undefined && (c.input[good] ?? 0) < need ? STALL_PRIORITY : 1;
}

/** Today's candidates of `hub` within `radius`, sorted (spec §8.2 steps 1-2). */
export function hubCandidates(state: GameState, hub: Building, radius: number, p: Promises): Candidate[] {
  const routed = routedGoods(state, hub.ownerId);
  const out: Candidate[] = [];
  const attached = hubAttached(state, hub, radius);
  const hubRoom = (g: GoodId) => storageLeft(hub, g) - (p.hubIn.get(hub.id) ?? 0);
  for (const b of attached) {
    const cat = BUILDINGS[b.typeId].category;
    const d = distance(hub, b) + DIST_BIAS;
    if (cat === 'extractor' || cat === 'factory') {
      for (const g in b.output) {
        if (routed.loads.has(`${b.id}:${g}`)) continue;
        const stock = b.output[g];
        const amt = Math.floor(stock) - (p.pickups.get(`${b.id}:${g}`) ?? 0);
        if (amt < HUB_MIN_LOAD || hubRoom(g) < HUB_MIN_LOAD) continue;
        const full = stock >= HUB_FULL_RATIO * buildingStorage(b) ? FULL_BONUS : 1;
        out.push({ kind: 'collect', from: b.id, to: hub.id, building: b.id, good: g, left: amt, score: ((amt * GOODS[g].basePrice) / d) * full });
      }
    }
    if (cat === 'factory' || cat === 'retail') {
      for (const g in hub.input) {
        if (!acceptsGood(b, g) || routed.unloads.has(`${b.id}:${g}`)) continue;
        const stock = Math.floor(hub.input[g]) - (p.hubOut.get(`${hub.id}:${g}`) ?? 0);
        const room = storageLeft(b, g) - (p.inbound.get(`${b.id}:${g}`) ?? 0);
        const qty = Math.min(stock, room);
        if (qty < HUB_MIN_LOAD) continue;
        out.push({ kind: 'deliver', from: hub.id, to: b.id, building: b.id, good: g, left: qty, score: ((qty * GOODS[g].basePrice) / d) * deliveryPriority(state, b, g) });
      }
    }
  }
  return out.sort(byCandidate);
}

/**
 * Assigns idle trucks at home (id order) to the candidates in order, each taking up to a truck's free
 * capacity, never promising more than the hub holds or has room for. Returns jobs assigned and whether
 * trucks ran out with work left (a backlog day).
 */
function assign(hub: Building, cands: Candidate[], idle: Vehicle[], p: Promises): { jobs: number; backlog: boolean } {
  let t = 0;
  let jobs = 0;
  const stock = new Map<GoodId, number>();
  // a warehouse's storage is one pool shared by every good
  let room: number | null = null;
  for (const c of cands) {
    if (t >= idle.length) break;
    while (t < idle.length && c.left >= HUB_MIN_LOAD) {
      let limit: number;
      if (c.kind === 'collect') {
        room ??= storageLeft(hub, c.good) - (p.hubIn.get(hub.id) ?? 0);
        limit = Math.min(c.left, room);
      } else {
        if (!stock.has(c.good)) stock.set(c.good, Math.floor(hub.input[c.good] ?? 0) - (p.hubOut.get(`${hub.id}:${c.good}`) ?? 0));
        limit = Math.min(c.left, stock.get(c.good)!);
      }
      if (limit < HUB_MIN_LOAD) break;
      const v = idle[t++];
      const qty = Math.min(v.capacity - cargoTotal(v), limit);
      v.job = { kind: c.kind, from: c.from, to: c.to, good: c.good, qty };
      v.stopIndex = 0;
      v.path = [];
      v.pathIndex = 0;
      v.waitTicks = 0;
      v.stuckNotified = false;
      v.state = 'moving';
      c.left -= qty;
      if (c.kind === 'collect') room! -= qty;
      else stock.set(c.good, stock.get(c.good)! - qty);
      jobs++;
    }
  }
  const backlog = t >= idle.length && cands.some((c) => c.left >= HUB_MIN_LOAD);
  return { jobs, backlog };
}

/** Daily, in hub id order (spec §8.2): free when nobody runs a hub. */
export function hubsDay(ctx: SimContext): void {
  const { state } = ctx;
  const hubs = hubList(state);
  if (hubs.length === 0) return;
  const today = dateToDays(state.date);
  let all: Vehicle[] | null = null;
  let byHub: Map<number, Vehicle[]> | null = null;
  let p: Promises | null = null;
  for (const hub of hubs) {
    const h = hub.hub;
    if (!h || state.buildings[hub.id] !== hub) continue;
    if (!byHub) {
      all = Object.values(state.vehicles).filter((v) => v.hubId != null);
      byHub = new Map();
      for (const v of all) {
        let list = byHub.get(v.hubId!);
        if (!list) byHub.set(v.hubId!, (list = []));
        list.push(v);
      }
    }
    const trucks = byHub.get(hub.id) ?? [];
    const tier = hubTier(state, hub);
    if (hub.works || !tier) {
      h.yesterday = { jobs: 0, idle: trucks.length };
      continue;
    }
    let jobs = 0;
    if (today >= h.nextDispatchDay) {
      p ??= promises(all!);
      const idle = trucks.filter((v) => !v.job && v.capacity - cargoTotal(v) >= HUB_MIN_LOAD);
      const cands = hubCandidates(state, hub, hubRange(hub) * tier.rangeShare, p);
      const r = assign(hub, cands, idle, p);
      jobs = r.jobs;
      if (r.backlog) h.month.backlogDays++;
      if (jobs > 0) p = promises(all!); // the next hub sees today's promises
      h.nextDispatchDay = today + tier.every;
    }
    let idleNow = 0;
    for (const v of trucks) if (!v.job) idleNow++;
    if (jobs > 0) {
      const tally = state.logistics.stats.hubJobs;
      tally[hub.ownerId] = (tally[hub.ownerId] ?? 0) + jobs;
    }
    h.month.jobs += jobs;
    h.month.idleTruckDays += idleNow;
    h.yesterday = { jobs, idle: idleNow };
  }
}
