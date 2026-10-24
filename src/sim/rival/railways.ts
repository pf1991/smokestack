import { BUILDINGS } from '../../data/buildings';
import { buildingStorage } from '../logistics/levels';
import { GOODS } from '../../data/goods';
import { loadSource, storageLeft } from '../inventory';
import { publishNews } from '../news';
import { buildDirectRoad, connectToRoads, ensureRoadLink } from '../roads';
import { buyTrain, ensureRailLink, planRail, RAIL_COST, removeRail, stationAccess, STATION_TYPE, TRAIN } from '../rail';
import { legLength } from '../routeHelpers';
import { demolishBuilding, findPlacement, placeBuilding } from '../state';
import type { Building, City, GameState, GoodId, Route, SimContext, Vec2 } from '../types';
import { assignVehicle, buyTruck, createRoute, deleteRoute, TRUCK, updateRoute } from '../vehicles';
import { affordable, centreOf, cityName, rivalChainCount, trucksOn, unwrap } from './projects';
import { FULL_RATIO, MAX_STALL_MONTHS, rivalReserve } from './shared';
import { modelSpec, newestModel } from '../logistics/models';
import { atPrices } from '../society/economy';

/** A leg is worth a railway from this many tiles of road... */
export const RAIL_MIN_LEG = 25;
/** ...when it already needs this many trucks (or its source is backing up). */
const RAIL_BUSY_TRUCKS = 3;
/** stations are sited along the surveyed track, from this many tiles in from each end... */
const STATION_INSET = 3;
/** ...trying a site every few tiles further in (within this search radius of each) */
const STATION_STEP = 3;
const STATION_NEAR = 4;
/** fallback search radius around the first site; also the shortest feeder drive always accepted */
const STATION_RADIUS = 10;
/** stations closer than this (centre to centre) make no railway worth the name */
const MIN_STATION_GAP = 8;
/** legs (`source>dest`) whose railway was abandoned once; never retried */
const F_RAIL_BLOCKED = 'rivalRailBlocked';
/** route ids of legs measured shorter than RAIL_MIN_LEG (roads only get added, so they stay short) */
const F_RAIL_SHORT = 'rivalRailShort';
/** tile indices of abandoned track that could not be lifted yet (a train stood on it); retried monthly */
const F_RAIL_SCRAP = 'rivalRailScrap';

/**
 * Lifts the Baron's track tile by tile (removeRail refuses a whole batch if any tile has a train on
 * it); tiles still occupied are remembered in F_RAIL_SCRAP and retried next month, so dead track
 * never lingers and `railTiles` stays exact.
 */
function scrapTrack(ctx: SimContext, tiles: number[]): void {
  const { state } = ctx;
  const { map } = state;
  const left: number[] = [];
  for (const i of tiles) {
    const t = map.tiles[i];
    if (!t?.rail || t.railOwner !== 'rival') continue;
    if (!removeRail(ctx, 'rival', [{ x: i % map.width, y: Math.floor(i / map.width) }]).ok) left.push(i);
  }
  if (left.length > 0) state.flags[F_RAIL_SCRAP] = left.join(',');
  else delete state.flags[F_RAIL_SCRAP];
}

export function retryScrap(ctx: SimContext): void {
  const pending = flagList(ctx.state, F_RAIL_SCRAP);
  if (pending.length > 0) scrapTrack(ctx, pending.map(Number));
}

/**
 * After a closed product line's stations are demolished (rival/lines.ts): lifts every connected stretch
 * of the Baron's track reached from `seeds` (tile indices) that no standing station's access tile and no
 * railway under way touches, so dead track stops costing upkeep. Track another line still runs on stays.
 */
export function scrapOrphanRail(ctx: SimContext, seeds: number[]): void {
  const { state } = ctx;
  const { map } = state;
  const w = map.width;
  const mine = (i: number): boolean => map.tiles[i]?.rail === true && map.tiles[i].railOwner === 'rival';
  const live = new Set<number>(state.rivalRail?.railTiles ?? []);
  for (const b of Object.values(state.buildings)) {
    if (b.typeId === STATION_TYPE) for (const p of stationAccess(state, b)) live.add(p.y * w + p.x);
  }
  const seen = new Set<number>();
  const dead: number[] = [];
  for (const s of seeds) {
    if (seen.has(s) || !mine(s)) continue;
    seen.add(s);
    const stretch: number[] = [];
    let used = false;
    const stack = [s];
    while (stack.length > 0) {
      const i = stack.pop()!;
      stretch.push(i);
      if (live.has(i)) used = true;
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
        const n = ny * w + nx;
        if (!seen.has(n) && mine(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (!used) dead.push(...stretch);
  }
  if (dead.length > 0) scrapTrack(ctx, [...flagList(state, F_RAIL_SCRAP).map(Number), ...dead.sort((a, b) => a - b)]);
}

/** The Baron's railway lines: his train routes. */
export function rivalRailLines(state: GameState): number {
  let n = 0;
  for (const r of Object.values(state.routes)) if (r.ownerId === 'rival' && r.kind === 'train') n++;
  return n;
}

/** One line per two chains: 1 early on, about 3 by the Silicon Age. */
export function maxRivalRailLines(state: GameState): number {
  return Math.floor(rivalChainCount(state) / 2);
}

/** Two stations, `tiles` of track and one train. */
/** A railway's setup cost at today's prices: two stations, the track and a train. */
const railSetupCost = (state: GameState, tiles: number) => atPrices(state, 2 * BUILDINGS[STATION_TYPE].cost + tiles * RAIL_COST + TRAIN.cost);

function flagList(state: GameState, key: string): string[] {
  const v = state.flags[key];
  return typeof v === 'string' && v ? v.split(',') : [];
}

function flagAdd(state: GameState, key: string, item: string): void {
  const list = flagList(state, key);
  if (!list.includes(item)) list.push(item);
  state.flags[key] = list.join(',');
}

interface Leg {
  route: Route;
  source: Building;
  dest: Building;
  good: GoodId;
}

/** A plain rival truck leg: the source loads one good, the destination unloads it, neither is a station. */
function legOf(state: GameState, route: Route): Leg | null {
  if (route.ownerId !== 'rival' || route.kind !== 'truck' || route.stops.length !== 2) return null;
  const [a, b] = route.stops;
  if (a.load.length !== 1 || !b.unload.includes(a.load[0])) return null;
  const source = state.buildings[a.buildingId];
  const dest = state.buildings[b.buildingId];
  if (!source || !dest || source.ownerId !== 'rival' || dest.ownerId !== 'rival') return null;
  if (source.typeId === STATION_TYPE || dest.typeId === STATION_TYPE) return null;
  return { route, source, dest, good: a.load[0] };
}

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Busy legs (≥ 3 trucks, or the source ≥ 80% full of the good) of at least RAIL_MIN_LEG road tiles
 * that the Baron could rail while keeping his reserve, longest first. The road A* runs only for busy
 * legs not already measured short, so a typical month does little or no path search.
 */
function railCandidates(state: GameState): { leg: Leg; length: number }[] {
  const money = state.companies.rival.money;
  if (money - railSetupCost(state, RAIL_MIN_LEG) < rivalReserve(state)) return [];
  const blockedLegs = flagList(state, F_RAIL_BLOCKED);
  const short = flagList(state, F_RAIL_SHORT);
  const out: { leg: Leg; length: number }[] = [];
  for (const route of Object.values(state.routes)) {
    const leg = legOf(state, route);
    if (!leg || short.includes(String(route.id))) continue;
    const { source, dest, good } = leg;
    if (blockedLegs.includes(`${source.id}>${dest.id}`)) continue;
    // a full source only counts when the destination could take a truckload (haulage is the bottleneck)
    const full =
      (loadSource(source)[good] ?? 0) >= FULL_RATIO * buildingStorage(source) &&
      storageLeft(dest, good) >= TRUCK.capacity;
    if (!full && trucksOn(state, route.id) < RAIL_BUSY_TRUCKS) continue;
    const length = legLength(state, source, dest);
    if (length === null) continue;
    if (length < RAIL_MIN_LEG) {
      flagAdd(state, F_RAIL_SHORT, String(route.id));
      continue;
    }
    if (money - railSetupCost(state, length) < rivalReserve(state)) continue;
    out.push({ leg, length });
  }
  return out.sort((a, b) => b.length - a.length || a.leg.route.id - b.leg.route.id);
}

/**
 * Shortest surveyed track (end to end) worth a railway. A long road leg can be a short hop as the crow
 * flies (the road detours round a lake or through a town); a few tiles of track between two stations
 * would save nothing over the direct feeder roads, so such legs are written off.
 */
const MIN_RAIL_PLAN = 20;

/** Starts a railway on the best leg, if the Baron has room for another line. */
export function startRailProject(ctx: SimContext): void {
  const { state } = ctx;
  if (rivalRailLines(state) >= maxRivalRailLines(state)) return;
  for (const { leg, length } of railCandidates(state)) {
    // survey the line once, before buying anything: legs whose ends no track can join (rivers the
    // road bridges, mountains it skirts) are written off for good
    const plan = planRail(state, 'rival', leg.source, leg.dest);
    if (!plan || plan.length < MIN_RAIL_PLAN) {
      flagAdd(state, F_RAIL_BLOCKED, `${leg.source.id}>${leg.dest.id}`);
      continue;
    }
    if (state.companies.rival.money - railSetupCost(state, plan.length) < rivalReserve(state)) continue;
    startRail(state, leg, length, plan);
    return;
  }
}

function startRail(state: GameState, leg: Leg, legTiles: number, plan: Vec2[]): void {
  const anchorsA: Vec2[] = [];
  const anchorsB: Vec2[] = [];
  for (let k = STATION_INSET; k <= Math.floor(plan.length / 3); k += STATION_STEP) {
    anchorsA.push({ x: plan[k].x, y: plan[k].y });
    anchorsB.push({ x: plan[plan.length - 1 - k].x, y: plan[plan.length - 1 - k].y });
  }
  state.rivalRail = {
    routeId: leg.route.id,
    sourceId: leg.source.id,
    destId: leg.dest.id,
    goodId: leg.good,
    legTiles,
    anchorsA,
    anchorsB,
    stage: 0,
    stationA: null,
    stationB: null,
    railTiles: [],
    stall: 0,
  };
}

/** The city a line serves: the destination's own, else the nearest one. */
function railCity(state: GameState, dest: Building | undefined): string {
  if (!dest) return 'the provinces';
  if (dest.cityId !== null) return cityName(state, dest.cityId);
  const c = centreOf(dest);
  let best: City | null = null;
  for (const city of state.cities) if (!best || manhattan(city.center, c) < manhattan(best.center, c)) best = city;
  return best?.name ?? 'the provinces';
}

/**
 * Gives up on the railway: blacklists the leg and removes what the project built (its unused
 * stations and its track). The original truck leg is only touched by the final switch-over, so it
 * keeps running exactly as before.
 */
function abandonRail(ctx: SimContext, reason: string): void {
  const { state } = ctx;
  const p = state.rivalRail;
  if (!p) return;
  flagAdd(state, F_RAIL_BLOCKED, `${p.sourceId}>${p.destId}`);
  scrapTrack(ctx, [...flagList(state, F_RAIL_SCRAP).map(Number), ...p.railTiles]);
  for (const id of [p.stationA, p.stationB]) {
    const b = id === null ? undefined : state.buildings[id];
    if (!b || b.ownerId !== 'rival') continue;
    if (Object.values(state.routes).some((r) => r.stops.some((s) => s.buildingId === b.id))) continue;
    demolishBuilding(ctx, b.id, 'rival');
  }
  const good = (GOODS[p.goodId]?.name ?? p.goodId).toLowerCase();
  publishNews(
    ctx,
    'rival',
    'Smogsworth railway hits the buffers',
    `Baron Smogsworth's railway for ${good} to ${railCity(state, state.buildings[p.destId])} has been shelved (${reason}). ` +
      'His lorries, the Baron insists, were always the better idea.',
  );
  state.rivalRail = null;
}

/** The railway waited a month for money; after MAX_STALL_MONTHS it is abandoned. */
function railStall(ctx: SimContext): void {
  const p = ctx.state.rivalRail;
  if (!p) return;
  p.stall += 1;
  if (p.stall >= MAX_STALL_MONTHS) abandonRail(ctx, 'the money ran dry');
}

/** Road access for a station plus a drivable road between it and the building it serves. */
function roadUpStation(
  ctx: SimContext,
  station: Building,
  served: Building,
  stationFirst: boolean,
  maxFeeder: number,
): 'ok' | 'money' | 'fail' {
  const c = connectToRoads(ctx, station, { owner: 'rival', reserve: rivalReserve(ctx.state) });
  if (!c.ok) return c.error === 'Not enough money' ? 'money' : 'fail';
  const [a, b] = stationFirst ? [station, served] : [served, station];
  const l = ensureRoadLink(ctx, 'rival', a, b, rivalReserve(ctx.state));
  if (!l.ok) return l.error === 'Not enough money' ? 'money' : 'fail';
  // the network may link them only by the very detour the railway is meant to cut: then lay a
  // direct road; a feeder still longer than half the old haul (e.g. round a mountain) is a failure
  let feeder = legLength(ctx.state, a, b);
  if (feeder !== null && feeder <= maxFeeder) return 'ok';
  const d = buildDirectRoad(ctx, 'rival', a, b, rivalReserve(ctx.state));
  if (!d.ok) return d.error === 'Not enough money' ? 'money' : 'fail';
  feeder = legLength(ctx.state, a, b);
  return feeder !== null && feeder <= maxFeeder ? 'ok' : 'fail';
}

/**
 * A station site hugging the surveyed track: near the first candidate that has room (forests,
 * where camps stand, take no stations), else anywhere within STATION_RADIUS of the first.
 */
function stationSite(state: GameState, anchors: Vec2[]): Vec2 | null {
  for (const a of anchors) {
    const pos = findPlacement(state, 'rival', STATION_TYPE, a, STATION_NEAR);
    if (pos) return pos;
  }
  return anchors.length > 0 ? findPlacement(state, 'rival', STATION_TYPE, anchors[0], STATION_RADIUS) : null;
}

/**
 * One step of the railway, like `advanceProject`: a station near the source, a station near the
 * destination, the track between them, then the switch-over (train line, feeders, news).
 */
export function advanceRail(ctx: SimContext): void {
  const { state } = ctx;
  const p = state.rivalRail;
  if (!p) return;
  const route = state.routes[p.routeId];
  const source = state.buildings[p.sourceId];
  const dest = state.buildings[p.destId];
  const leg = route ? legOf(state, route) : null;
  if (!route || !leg || leg.source !== source || leg.dest !== dest || leg.good !== p.goodId) {
    abandonRail(ctx, 'the haulage contract changed');
    return;
  }

  if (p.stage === 0 || p.stage === 1) {
    const served = p.stage === 0 ? source : dest;
    let id = p.stage === 0 ? p.stationA : p.stationB;
    if (id === null) {
      if (!affordable(state, BUILDINGS[STATION_TYPE].cost)) return railStall(ctx);
      const pos = stationSite(state, p.stage === 0 ? p.anchorsA : p.anchorsB);
      const placed = pos ? unwrap(placeBuilding(ctx, 'rival', STATION_TYPE, pos)) : null;
      if (!placed) {
        abandonRail(ctx, 'no site for a station');
        return;
      }
      id = placed.id;
      if (p.stage === 0) p.stationA = id;
      else p.stationB = id;
    }
    const station = state.buildings[id];
    if (!station || station.ownerId !== 'rival') {
      abandonRail(ctx, 'a station was lost');
      return;
    }
    const first = p.stage === 1 && p.stationA !== null ? state.buildings[p.stationA] : undefined;
    if (first && manhattan(centreOf(first), centreOf(station)) < MIN_STATION_GAP) {
      // checked before paying for station B's roads
      abandonRail(ctx, 'the two stations ended up side by side');
      return;
    }
    // feeder A drives source → station A, feeder B drives station B → destination
    const road = roadUpStation(ctx, station, served, p.stage === 1, Math.max(STATION_RADIUS, Math.floor(p.legTiles / 2)));
    if (road === 'money') return railStall(ctx);
    if (road === 'fail') {
      abandonRail(ctx, 'the station could not be served by road');
      return;
    }
    p.stage += 1;
    p.stall = 0;
    return;
  }

  const a = p.stationA === null ? undefined : state.buildings[p.stationA];
  const b = p.stationB === null ? undefined : state.buildings[p.stationB];
  if (!a || !b || a.ownerId !== 'rival' || b.ownerId !== 'rival') {
    abandonRail(ctx, 'a station was lost');
    return;
  }

  if (p.stage === 2) {
    if (manhattan(centreOf(a), centreOf(b)) < MIN_STATION_GAP) {
      abandonRail(ctx, 'the two stations ended up side by side');
      return;
    }
    // keep the train's price in hand too, so finished track never waits long for its locomotive
    const r = ensureRailLink(ctx, 'rival', a, b, rivalReserve(state) + atPrices(state, TRAIN.cost));
    if (!r.ok) {
      if (r.error === 'Not enough money') return railStall(ctx);
      abandonRail(ctx, 'no track could be laid');
      return;
    }
    for (const t of r.value.tiles) p.railTiles.push(t.y * state.map.width + t.x);
    p.stage += 1;
    p.stall = 0;
    return;
  }

  // switch-over: train line A → B; the old leg becomes source → A; a new feeder runs B → destination
  if (!affordable(state, TRAIN.cost)) return railStall(ctx);
  const good = p.goodId;
  const goodName = GOODS[good]?.name ?? good;
  const line = createRoute(
    ctx,
    'rival',
    `Smogsworth ${goodName} Railway`,
    [
      { buildingId: a.id, load: [good], unload: [] },
      { buildingId: b.id, load: [], unload: [good] },
    ],
    'train',
  );
  if (!line.ok) {
    abandonRail(ctx, 'the line failed inspection');
    return;
  }
  if (!buyTrain(ctx, 'rival', line.value.id).ok) {
    deleteRoute(ctx, line.value.id);
    abandonRail(ctx, 'no locomotive could be had');
    return;
  }
  const feeder = createRoute(ctx, 'rival', `Smogsworth ${goodName}`, [
    { buildingId: b.id, load: [good], unload: [] },
    { buildingId: dest.id, load: [], unload: [good] },
  ]);
  const retarget = feeder.ok
    ? updateRoute(ctx, route.id, { stops: [route.stops[0], { buildingId: a.id, load: [], unload: [good] }] })
    : feeder;
  if (!feeder.ok || !retarget.ok) {
    if (feeder.ok) deleteRoute(ctx, feeder.value.id);
    deleteRoute(ctx, line.value.id); // sells only the train this project bought
    abandonRail(ctx, 'the hauliers refused');
    return;
  }
  // half the old fleet (empty trucks first) moves to the far feeder; nobody is sold
  const fleet = Object.values(state.vehicles)
    .filter((v) => v.routeId === route.id)
    .sort((x, y) => Number(Object.keys(x.cargo).length > 0) - Number(Object.keys(y.cargo).length > 0) || x.id - y.id);
  const moving = Math.floor(fleet.length / 2);
  for (const v of fleet.slice(0, moving)) assignVehicle(ctx, v.id, feeder.value.id);
  if (moving === 0 && affordable(state, modelSpec(newestModel(state)).cost)) buyTruck(ctx, 'rival', feeder.value.id);

  const city = railCity(state, dest);
  publishNews(
    ctx,
    'rival',
    `SMOGSWORTH LAYS IRON TO ${city.toUpperCase()}!`,
    `Smogsworth Consolidated has opened a ${p.railTiles.length}-mile railway hauling ${goodName.toLowerCase()} towards ${city}, ` +
      'retiring a crawling convoy of lorries. Puffing a cigar on the footplate, the Baron sneered: "The age of the horse cart is over."',
  );
  state.rivalRail = null;
}

