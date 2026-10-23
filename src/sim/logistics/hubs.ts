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
import { assignVehicle, newVehicle, reissueVehicle, sellVehicle, vehiclePrice } from '../vehicles';
import { atPrices } from '../society/economy';
import { buildingStorage, hubRange, levelDef, levelRate } from './levels';
import { joinHub } from './jobRoute';
import { managerAt, managerRate } from './managers';
import { newestModel } from './models';
import type { HubJob, HubJobKind, HubState, Skill } from './types';

/**
 * Warehouse hubs (spec §8): a warehouse with its own trucks, dispatched daily (greedily, Manhattan
 * distances, no pathfinding) by the manager posted there. Skill 3+ looks ahead, 4+ balances with
 * overlapping hubs, and hubAutoSizeMonth keeps the fleet to the work.
 */

/** A candidate (and a truck's share of one) must be at least this many units. */
export const HUB_MIN_LOAD = 10;
/** A producer whose output fills this share of its storage is collected first (×FULL_BONUS). */
export const HUB_FULL_RATIO = 0.8;
export const STORE_PRIORITY = 2;
export const STALL_PRIORITY = 1.5;
export const FULL_BONUS = 1.5;
/** Look-ahead (skills 3-5): this many days of output and use are added to what a candidate moves. */
export const LOOKAHEAD_DAYS = 3;
/** A hub keeps this much of a good before it balances any to another hub (skills 4-5). */
export const BALANCE_MIN_STOCK = 100;
export const BALANCE_FACTOR = 0.5;
/** Days of a consumer's use that count as its need when balancing. */
const BALANCE_NEED_DAYS = 30;
/** Hub auto-sizing (spec section 8.4): backlog days to buy, idle trucks per day to sell, money kept (1900 $). */
export const HUB_BACKLOG_DAYS = 10;
export const HUB_IDLE_PER_DAY = 1.5;
export const HUB_RESERVE = 20_000;
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

/** Free room in hub `b`'s fleet: its cap (the level's, or the owner's lower one) less its trucks. */
export function hubRoom(state: GameState, b: Building): number {
  const cap = Math.min(b.hub?.maxTrucks ?? hubCap(b), hubCap(b));
  return Math.max(0, cap - hubTrucks(state, b.id).length);
}

/**
 * Moves an owned truck onto the hub at `warehouseId` (no sale, no charge): it leaves its route as on any
 * reassignment (assignVehicle(null): the hold empties), is re-issued under a new id in newVehicle's
 * shape (vehicles.ts reissueVehicle) and joins the hub idle, without a job, dispatched from where it
 * stands. Refused when the hub's fleet is at its cap. Returns the truck as re-issued.
 */
export function moveToHub(ctx: SimContext, vehicleId: number, warehouseId: number): Result<Vehicle> {
  const { state } = ctx;
  const v = state.vehicles[vehicleId];
  const b = state.buildings[warehouseId];
  if (!v) return err('No such vehicle');
  if (!b || !b.hub) return err('No such hub');
  if (b.ownerId !== v.ownerId) return err('Not your building');
  if (v.kind !== 'truck') return err('Only trucks can join a hub');
  if (v.hubId === b.id) return ok(v);
  if (hubRoom(state, b) === 0) return err('Hub fleet is full');
  const off = assignVehicle(ctx, vehicleId, null);
  if (!off.ok) return off;
  const moved = reissueVehicle(state, vehicleId)!;
  joinHub(moved, b.id);
  moved.state = 'idle';
  return ok(moved);
}

/**
 * The reverse of moveToHub: hub truck `vehicleId` leaves its hub (the hold empties, its job is dropped),
 * is re-issued in newVehicle's shape and runs route `routeId` of its owner. Returns the truck as re-issued.
 */
export function moveToRoute(ctx: SimContext, vehicleId: number, routeId: number): Result<Vehicle> {
  const { state } = ctx;
  const v = state.vehicles[vehicleId];
  if (!v) return err('No such vehicle');
  const route = state.routes[routeId];
  if (!route) return err('No such route');
  if (route.ownerId !== v.ownerId) return err('Not your route');
  if (route.kind !== v.kind) return err('Trucks cannot run rail lines');
  const off = assignVehicle(ctx, vehicleId, null);
  if (!off.ok) return off;
  const moved = reissueVehicle(state, vehicleId)!;
  const on = assignVehicle(ctx, moved.id, routeId);
  return on.ok ? ok(moved) : on;
}

/** Turns hub auto-sizing on or off (spec §8.4). */
export function setHubAutoSize(ctx: SimContext, warehouseId: number, owner: OwnerId, on: boolean): Result {
  const b = ctx.state.buildings[warehouseId];
  if (!b || !b.hub) return err('No such hub');
  if (b.ownerId !== owner) return err('Not your building');
  b.hub.autoSize = on;
  return ok();
}

/** Sets the most trucks hub auto-sizing may run (1 up to the level cap). */
export function setHubMaxTrucks(ctx: SimContext, warehouseId: number, owner: OwnerId, n: number): Result {
  const b = ctx.state.buildings[warehouseId];
  if (!b || !b.hub) return err('No such hub');
  if (b.ownerId !== owner) return err('Not your building');
  b.hub.maxTrucks = Math.max(1, Math.min(hubCap(b), Math.floor(n) || 1));
  return ok();
}

/** The hubs this hub's trucks are carrying goods to right now (balance jobs), in id order. */
export function balancingWith(state: GameState, hub: Building): Building[] {
  const ids = new Set<number>();
  for (const v of hubTrucks(state, hub.id)) {
    const j = v.job as HubJob | null | undefined;
    if (j && j.kind === 'balance') ids.add(j.to);
  }
  return [...ids].sort((a, b) => a - b).map((id) => state.buildings[id]).filter((b) => b !== undefined);
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

/** True when `b` makes nothing today: upgrading, on strike or halted. */
const stopped = (b: Building): boolean => b.works !== undefined || b.status === 'halted' || b.status === 'upgrading';

/** What a works makes (or uses) of `good` per day at its level, manager and staffing; 0 while it is stopped. */
function worksPerDay(state: GameState, b: Building, good: GoodId, side: 'outputs' | 'inputs'): number {
  if (stopped(b)) return 0;
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  const n = recipe?.[side][good];
  return recipe && n ? ((n / recipe.days) * levelRate(b) * managerRate(state, b) * b.staffing) : 0;
}

/** Expected output of `good` per day at `b` (spec section 8.2 look-ahead). */
export function dailyOutput(state: GameState, b: Building, good: GoodId): number {
  const cat = BUILDINGS[b.typeId].category;
  return cat === 'extractor' || cat === 'factory' ? worksPerDay(state, b, good, 'outputs') : 0;
}

/** Stores per town, built once per dispatch (a store's demand is its town's split evenly). */
type StoreCount = Map<number, number>;
function storeCounts(state: GameState): StoreCount {
  const m: StoreCount = new Map();
  for (const b of buildingList(state)) if (b.cityId !== null && BUILDINGS[b.typeId].category === 'retail') add(m, b.cityId, 1);
  return m;
}

/** Expected use of `good` per day at `b`: a factory's inputs, or a store's share of its town's demand30 / 30. */
export function dailyUse(state: GameState, b: Building, good: GoodId, stores?: StoreCount): number {
  const cat = BUILDINGS[b.typeId].category;
  if (cat === 'factory') return worksPerDay(state, b, good, 'inputs');
  if (cat !== 'retail' || b.cityId === null) return 0;
  const demand = state.cities[b.cityId]?.market[good]?.demand30 ?? 0;
  return demand / 30 / ((stores ?? storeCounts(state)).get(b.cityId) || 1);
}

/** Whole units a consumer can still take of `good`, counting `ahead` days of its own use as room (never above its storage). */
function consumerRoom(state: GameState, c: Building, good: GoodId, inbound: number, ahead: number, stores?: StoreCount): number {
  const left = storageLeft(c, good) - inbound;
  if (ahead === 0) return left;
  return Math.min(Math.floor(left + ahead * dailyUse(state, c, good, stores)), buildingStorage(c));
}

/** Work shared by every hub of one day's dispatch: town store counts and each hub's full-range attached list. */
export interface DayCache {
  stores: StoreCount | null;
  attached: Map<number, Building[]>;
}
export const newDayCache = (): DayCache => ({ stores: null, attached: new Map() });

function fullAttached(state: GameState, hub: Building, day: DayCache): Building[] {
  let l = day.attached.get(hub.id);
  if (!l) day.attached.set(hub.id, (l = hubAttached(state, hub, hubRange(hub))));
  return l;
}

interface Tier {
  lookAhead: boolean;
  balance: boolean;
}
const NO_TIER: Tier = { lookAhead: false, balance: false };

/** Today's candidates of `hub` within `radius`, sorted (spec section 8.2 steps 1-2). */
export function hubCandidates(state: GameState, hub: Building, radius: number, p: Promises, tier: Tier = NO_TIER, day: DayCache = newDayCache()): Candidate[] {
  const routed = routedGoods(state, hub.ownerId);
  const out: Candidate[] = [];
  const attached = fullAttached(state, hub, day).filter((b) => footprintGap(hub, b) <= radius + 1e-9);
  const ahead = tier.lookAhead ? LOOKAHEAD_DAYS : 0;
  const stores = ahead || tier.balance ? (day.stores ??= storeCounts(state)) : undefined;
  const hubRoom = (g: GoodId) => storageLeft(hub, g) - (p.hubIn.get(hub.id) ?? 0);
  for (const b of attached) {
    const cat = BUILDINGS[b.typeId].category;
    const d = distance(hub, b) + DIST_BIAS;
    if (cat === 'extractor' || cat === 'factory') {
      for (const g in b.output) {
        if (routed.loads.has(`${b.id}:${g}`)) continue;
        const stock = b.output[g];
        const soon = ahead ? Math.min(stock + ahead * dailyOutput(state, b, g), buildingStorage(b)) : stock;
        const amt = Math.floor(soon) - (p.pickups.get(`${b.id}:${g}`) ?? 0);
        if (amt < HUB_MIN_LOAD || hubRoom(g) < HUB_MIN_LOAD) continue;
        const full = stock >= HUB_FULL_RATIO * buildingStorage(b) ? FULL_BONUS : 1;
        out.push({ kind: 'collect', from: b.id, to: hub.id, building: b.id, good: g, left: amt, score: ((amt * GOODS[g].basePrice) / d) * full });
      }
    }
    if (cat === 'factory' || cat === 'retail') {
      for (const g in hub.input) {
        if (!acceptsGood(b, g) || routed.unloads.has(`${b.id}:${g}`)) continue;
        const stock = Math.floor(hub.input[g]) - (p.hubOut.get(`${hub.id}:${g}`) ?? 0);
        const room = consumerRoom(state, b, g, p.inbound.get(`${b.id}:${g}`) ?? 0, ahead, stores);
        const qty = Math.min(stock, room);
        if (qty < HUB_MIN_LOAD) continue;
        out.push({ kind: 'deliver', from: hub.id, to: b.id, building: b.id, good: g, left: qty, score: ((qty * GOODS[g].basePrice) / d) * deliveryPriority(state, b, g) });
      }
    }
  }
  if (tier.balance) balanceCandidates(state, hub, p, stores!, out, day);
  return out.sort(byCandidate);
}

/** Centre of a building's footprint. */
const centre = (b: Building) => ({ x: b.pos.x + BUILDINGS[b.typeId].size.w / 2, y: b.pos.y + BUILDINGS[b.typeId].size.h / 2 });

/** The owner's other hubs whose full range overlaps `hub`'s (centres within the sum of both ranges), in id order. */
export function overlappingHubs(state: GameState, hub: Building): Building[] {
  const a = centre(hub);
  const ra = hubRange(hub);
  return hubList(state).filter((o) => {
    if (o === hub || o.ownerId !== hub.ownerId || state.buildings[o.id] !== o || !o.hub) return false;
    const c = centre(o);
    return Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) <= ra + hubRange(o);
  });
}

/** Spec section 8.2 balance: goods this hub holds 100+ of that another hub's consumers need more of than it holds. */
function balanceCandidates(state: GameState, hub: Building, p: Promises, stores: StoreCount, out: Candidate[], day: DayCache): void {
  const others = overlappingHubs(state, hub);
  if (others.length === 0) return;
  const routed = routedGoods(state, hub.ownerId);
  const mine = new Set(fullAttached(state, hub, day));
  for (const o of others) {
    // a hub that nobody runs would just sit on the goods
    if (o.works || !hubTier(state, o)) continue;
    // only the receiver's own consumers count: those in the overlap are served from here too, and
    // counting them on both sides would send the same goods back and forth
    const attached = fullAttached(state, o, day).filter((c) => !mine.has(c));
    const d = distance(hub, o) + DIST_BIAS;
    for (const g in hub.input) {
      const stock = Math.floor(hub.input[g]) - (p.hubOut.get(`${hub.id}:${g}`) ?? 0);
      if (stock < BALANCE_MIN_STOCK) continue;
      let need = 0;
      for (const c of attached) {
        const cat = BUILDINGS[c.typeId].category;
        if ((cat !== 'factory' && cat !== 'retail') || !acceptsGood(c, g) || routed.unloads.has(`${c.id}:${g}`)) continue;
        const want = Math.min(BALANCE_NEED_DAYS * dailyUse(state, c, g, stores), buildingStorage(c)) - (c.input[g] ?? 0);
        if (want > 0) need += want;
      }
      const there = Math.floor(o.input[g] ?? 0) + (p.inbound.get(`${o.id}:${g}`) ?? 0);
      const qty = Math.floor(Math.min(stock - BALANCE_MIN_STOCK, need - there, storageLeft(o, g) - (p.inbound.get(`${o.id}:${g}`) ?? 0)));
      if (qty < HUB_MIN_LOAD) continue;
      out.push({ kind: 'balance', from: hub.id, to: o.id, building: o.id, good: g, left: qty, score: ((qty * GOODS[g].basePrice) / d) * BALANCE_FACTOR });
    }
  }
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
  const day = newDayCache();
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
      const cands = hubCandidates(state, hub, hubRange(hub) * tier.rangeShare, p, tier, day);
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

/** The fewest trucks auto-sizing leaves a hub: one, plus every truck the AI's converted legs brought (logistics/ai.ts). */
function keepTrucks(h: HubState): number {
  let n = 1;
  for (const l of h.legs ?? []) n += l.trucks;
  return n;
}

/** HUB_RESERVE at today's prices: the cash hub auto-sizing keeps by default. */
const hubReserve = (state: GameState): number => atPrices(state, HUB_RESERVE);

/**
 * Monthly, hubs in id order (spec section 8.4): a hub with auto-sizing on buys one truck after 10+ backlog days
 * (below its cap, keeping the reserve), else sells its oldest when its trucks idled 1.5+ a day (never the
 * last one, nor those an AI hub's converted legs brought: keepTrucks); its month counters then reset. Free when nobody runs a hub. `reserveOf` is the cash each owner
 * keeps after a purchase: HUB_RESERVE by default; logistics/index.ts passes the AI's own reserve for the
 * Baron and the firms (ai.ts hubReserveOf).
 */
export function hubAutoSizeMonth(ctx: SimContext, reserveOf: (state: GameState, owner: OwnerId) => number = hubReserve): void {
  const { state } = ctx;
  for (const hub of hubList(state)) {
    const h = hub.hub;
    if (!h || state.buildings[hub.id] !== hub) continue;
    if (h.autoSize) {
      const trucks = hubTrucks(state, hub.id);
      const company = state.companies[hub.ownerId];
      if (h.month.backlogDays >= HUB_BACKLOG_DAYS) {
        if (
          company && company.money > 0 && trucks.length < Math.min(h.maxTrucks, hubCap(hub)) &&
          company.money - vehiclePrice(state, newestModel(state)) >= reserveOf(state, hub.ownerId)
        ) {
          buyHubTruck(ctx, hub.ownerId, hub.id);
        }
      } else if (h.month.idleTruckDays / 30 >= HUB_IDLE_PER_DAY && trucks.length > keepTrucks(h)) {
        // only a truck at home, empty and without a job is sold, so no cargo is ever lost
        let oldest: Vehicle | undefined;
        for (const v of trucks) {
          if (v.job || v.state !== 'idle' || cargoTotal(v) > 0) continue;
          if (!oldest || v.builtYear < oldest.builtYear) oldest = v; // ids ascend: ties keep the lowest
        }
        if (oldest) sellVehicle(ctx, oldest.id);
      }
    }
    h.month = { jobs: 0, idleTruckDays: 0, backlogDays: 0 };
  }
}
