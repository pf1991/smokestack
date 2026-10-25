/**
 * Warehouse ↔ warehouse train trunk (hubs-first §2): rail shuttles surplus shed stock between
 * distant hubs; local hub trucks stay last-mile. Stations are the rail stops; each pairs with a
 * nearby warehouse hub.
 */
import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import type { Result } from '../../core/result';
import { err, ok } from '../../core/result';
import { acceptsGood, storageLeft } from '../inventory';
import { ensureRailLink } from '../rail';
import { legLength } from '../routeHelpers';
import { buildingList } from '../spatial';
import type { Building, GameState, GoodId, OwnerId, Route, SimContext, Vehicle } from '../types';
import { createRoute } from '../vehicles';
import { autoRoutesChanged, newStats } from './autoRoutes';
import {
  BALANCE_FACTOR,
  BALANCE_MIN_STOCK,
  HUB_MIN_LOAD,
  dailyUse,
  hubAttached,
  hubTier,
  overlappingHubs,
  routedGoods,
} from './hubs';
import { shedForStation, stationBesideHub } from './hubPairing';
import { buildingStorage, hubRange } from './levels';
import type { AutoJob, HubJob } from './types';

export { HUB_STATION_GAP, shedForStation, stationBesideHub } from './hubPairing';

/** Days of a consumer's use that count as need (same spirit as truck balance). */
const BALANCE_NEED_DAYS = 30;
/** Added to every rail-leg distance so short hops do not dominate. */
const DIST_BIAS = 8;

/**
 * Creates (or returns) a hub-trunk train route between the stations beside two hubs: ensures a rail
 * link, then an auto train route whose cargo is the sheds (not the stations).
 */
export function linkHubTrunk(ctx: SimContext, owner: OwnerId, hubA: number, hubB: number): Result<Route> {
  const { state } = ctx;
  if (hubA === hubB) return err('Pick two different hubs');
  const a = state.buildings[hubA];
  const b = state.buildings[hubB];
  if (!a || !b) return err('No such building');
  if (a.ownerId !== owner || b.ownerId !== owner) return err('Not your building');
  if (a.typeId !== 'warehouse' || b.typeId !== 'warehouse' || !a.hub || !b.hub) {
    return err('Only hubs can be linked');
  }
  const sa = stationBesideHub(state, a);
  const sb = stationBesideHub(state, b);
  if (!sa || !sb) return err('Each hub needs a train station beside it');

  const linked = ensureRailLink(ctx, owner, sa, sb);
  if (!linked.ok) return linked;

  for (const key in state.routes) {
    const r = state.routes[key];
    if (r.ownerId !== owner || !r.hubTrunk || r.kind !== 'train') continue;
    const ids = new Set(r.stops.map((s) => s.buildingId));
    if (ids.has(sa.id) && ids.has(sb.id)) return ok(r);
  }

  const created = createRoute(
    ctx,
    owner,
    `Hub trunk ${a.id}–${b.id}`,
    [
      { buildingId: sa.id, load: [], unload: [] },
      { buildingId: sb.id, load: [], unload: [] },
    ],
    'train',
  );
  if (!created.ok) return created;
  const route = created.value;
  route.hubTrunk = true;
  route.mode = 'auto';
  route.stats = newStats();
  autoRoutesChanged();
  return ok(route);
}

function cargoTotal(v: Vehicle): number {
  let n = 0;
  for (const g in v.cargo) n += v.cargo[g];
  return n;
}

const byScore = (a: AutoJob, b: AutoJob): number =>
  b.score - a.score || a.from - b.from || a.to - b.to || (a.good < b.good ? -1 : a.good > b.good ? 1 : 0);

/** Shed stock promised on trunk trains still heading for pickup, by `${hubId}:${good}`. */
function trunkPromised(state: GameState, route: Route, trains: Vehicle[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of trains) {
    const j = v.job as HubJob | null;
    if (!j || j.kind !== 'collect' || j.good === null) continue;
    const stop = route.stops[j.from];
    const st = stop ? state.buildings[stop.buildingId] : undefined;
    const shed = st ? shedForStation(state, st) : null;
    if (!shed) continue;
    const key = `${shed.id}:${j.good}`;
    out.set(key, (out.get(key) ?? 0) + j.qty);
  }
  return out;
}

/** Inbound trunk cargo not yet dropped, by `${hubId}:${good}`. */
function trunkInbound(state: GameState, route: Route, trains: Vehicle[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of trains) {
    const j = v.job as HubJob | null;
    if (!j || j.good === null || (j.kind !== 'collect' && j.kind !== 'deliver' && j.kind !== 'balance')) continue;
    const stop = route.stops[j.to];
    const st = stop ? state.buildings[stop.buildingId] : undefined;
    const shed = st ? shedForStation(state, st) : null;
    if (!shed) continue;
    const key = `${shed.id}:${j.good}`;
    out.set(key, (out.get(key) ?? 0) + j.qty);
  }
  return out;
}

/**
 * Rebuilds a trunk route's job board from shed surplus/need (same scoring spirit as truck balance,
 * rail-leg distance; skips overlapping hub pairs — those stay on hub trucks).
 */
function rebuildTrunkBoard(state: GameState, route: Route, trains: Vehicle[]): void {
  const { stops } = route;
  const n = stops.length;
  const jobs: AutoJob[] = [];
  const loads: GoodId[][] = Array.from({ length: n }, () => []);
  const unloads: GoodId[][] = Array.from({ length: n }, () => []);
  if (n < 2) {
    route.jobs = jobs;
    return;
  }

  const sheds: (Building | null)[] = stops.map((s) => {
    const st = state.buildings[s.buildingId];
    return st ? shedForStation(state, st) : null;
  });
  const promised = trunkPromised(state, route, trains);
  const inbound = trunkInbound(state, route, trains);
  const stores = new Map<number, number>();
  for (const b of buildingList(state)) {
    if (b.cityId !== null && BUILDINGS[b.typeId].category === 'retail') {
      stores.set(b.cityId, (stores.get(b.cityId) ?? 0) + 1);
    }
  }

  for (let i = 0; i < n; i++) {
    const from = sheds[i];
    if (!from || from.works) continue;
    const tier = hubTier(state, from);
    if (!tier?.balance) continue;
    const routed = routedGoods(state, from.ownerId);
    const mine = new Set(hubAttached(state, from, hubRange(from)));
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const to = sheds[j];
      if (!to || to.works || !hubTier(state, to)) continue;
      // overlapping hubs keep truck balance; the trunk is for long hauls
      if (overlappingHubs(state, from).some((o) => o.id === to.id)) continue;
      const attached = hubAttached(state, to, hubRange(to)).filter((c) => !mine.has(c));
      const stationA = state.buildings[stops[i].buildingId];
      const stationB = state.buildings[stops[j].buildingId];
      if (!stationA || !stationB) continue;
      const rail = legLength(state, stationA, stationB, 'train');
      const d = (rail ?? 1e9) + DIST_BIAS;
      for (const g in from.input) {
        const good = g as GoodId;
        const stock = Math.floor(from.input[good]) - (promised.get(`${from.id}:${good}`) ?? 0);
        if (stock < BALANCE_MIN_STOCK) continue;
        let need = 0;
        for (const c of attached) {
          const cat = BUILDINGS[c.typeId].category;
          if ((cat !== 'factory' && cat !== 'retail') || !acceptsGood(c, good) || routed.unloads.has(`${c.id}:${good}`)) continue;
          const want = Math.min(BALANCE_NEED_DAYS * dailyUse(state, c, good, stores), buildingStorage(c)) - (c.input[good] ?? 0);
          if (want > 0) need += want;
        }
        const there = Math.floor(to.input[good] ?? 0) + (inbound.get(`${to.id}:${good}`) ?? 0);
        const qty = Math.floor(
          Math.min(stock - BALANCE_MIN_STOCK, need - there, storageLeft(to, good) - (inbound.get(`${to.id}:${good}`) ?? 0)),
        );
        if (qty < HUB_MIN_LOAD) continue;
        jobs.push({
          from: i,
          to: j,
          good,
          qty,
          score: ((qty * GOODS[good].basePrice) / d) * BALANCE_FACTOR,
        });
        if (!loads[i].includes(good)) loads[i].push(good);
        if (!unloads[j].includes(good)) unloads[j].push(good);
      }
    }
  }
  jobs.sort(byScore);
  route.jobs = jobs;
  // replace stop lists so departAuto / transfer see the goods (identity change keeps D2 cache honest)
  route.stops = stops.map((s, i) => ({ buildingId: s.buildingId, load: loads[i], unload: unloads[i] }));
}

/** Assigns top board jobs to empty trains that have none yet. */
function assignTrunkTrains(_state: GameState, route: Route, trains: Vehicle[]): void {
  const jobs = route.jobs ?? [];
  for (const v of trains) {
    if (v.job || cargoTotal(v) > 0) continue;
    const job = jobs.find((j) => j.qty >= HUB_MIN_LOAD);
    if (!job) break;
    const qty = Math.min(v.capacity, job.qty);
    if (qty < HUB_MIN_LOAD) continue;
    v.job = { kind: 'collect', from: job.from, to: job.to, good: job.good, qty };
    job.qty -= qty;
    v.stopIndex = job.from;
    v.path = [];
    v.pathIndex = 0;
    v.waitTicks = 0;
    v.stuckNotified = false;
    v.state = 'moving';
  }
}

/** Daily: rebuilds every hub-trunk board and assigns idle trains (free when none exist). */
export function hubTrunkDay(ctx: SimContext): void {
  const { state } = ctx;
  let any = false;
  for (const key in state.routes) {
    if (state.routes[key].hubTrunk) {
      any = true;
      break;
    }
  }
  if (!any) return;

  const byRoute = new Map<number, Vehicle[]>();
  for (const v of Object.values(state.vehicles)) {
    if (v.routeId === null || v.kind !== 'train') continue;
    let list = byRoute.get(v.routeId);
    if (!list) byRoute.set(v.routeId, (list = []));
    list.push(v);
  }

  for (const key in state.routes) {
    const route = state.routes[key];
    if (!route.hubTrunk || route.kind !== 'train' || route.mode !== 'auto') continue;
    const trains = byRoute.get(route.id) ?? [];
    rebuildTrunkBoard(state, route, trains);
    assignTrunkTrains(state, route, trains);
  }
}
