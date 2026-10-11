/**
 * Baron Cornelius Smogsworth: the rival tycoon. He plays by the same rules as the player (same
 * placement, road, route and truck API, paying with `'rival'` money) and never cheats: no free
 * buildings, no hidden income. One project at a time, one building per month.
 */
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { BUILDINGS } from '../data/buildings';
import { DEMAND_PER_1000, GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { earn, repayLoan, spend, takeLoan, LOAN_STEP } from './finance';
import { loadSource, storageLeft } from './inventory';
import { monthlyDemand, salePrice, supplyRatio } from './market';
import { publishNews } from './news';
import { demandModifier } from './production';
import { chance, pick } from './rng';
import { buildDirectRoad, connectToRoads, ensureRoadLink } from './roads';
import { buyTrain, ensureRailLink, planRail, RAIL_COST, removeRail, STATION_TYPE, TRAIN } from './rail';
import { legLength } from './routeHelpers';
import { assetValue, demolishBuilding, findPlacement, placeBuilding } from './state';
import type { Building, BuildingTypeId, City, GameState, GoodId, OwnerId, Route, SimContext, Vec2 } from './types';
import { assignVehicle, buyTruck, createRoute, deleteRoute, TRUCK, updateRoute } from './vehicles';

export const RIVAL_RESERVE = 50000;
const LOAN_BELOW = 20000;
const LOAN_CAP = 200000;
const REPAY_ABOVE = 150000;
const MAX_TRUCKS_PER_LEG = 4;
const FULL_RATIO = 0.8;
/** rough allowance for access roads when judging whether a project is affordable */
const ROAD_BUDGET = 10000;
const MAX_FAILS = 2;
export const TAUNT_CHANCE = 0.3;
const TAKEOVER_MULTIPLE = 3;
const TAKEOVER_MIN_WORTH = 1_000_000;
const TAKEOVER_PREMIUM = 1.2;

// flags used to remember a project's details across months (GameState.flags holds primitives only)
const F_BUILDINGS = 'rivalBuildings';
const F_FAILS = 'rivalFails';
const F_BLOCKED = 'rivalBlocked';
const F_STALL = 'rivalStall';
/** months a project may wait for money before it is finished as-is or abandoned */
export const MAX_STALL_MONTHS = 6;

// ---------------------------------------------------------------------------
// chains

interface ChainNode {
  typeId: BuildingTypeId;
  recipeId: string;
  /** the good this node supplies to its consumers */
  good: GoodId;
}

interface ChainEdge {
  /** node index; producer */
  from: number;
  /** node index of the consumer, or -1 for the store */
  to: number;
  good: GoodId;
}

interface ChainPlan {
  /** post-order: every producer comes before its consumers; the last node makes the target good */
  nodes: ChainNode[];
  edges: ChainEdge[];
}

function firstRecipeFor(goodId: GoodId, state: GameState): { recipeId: string; typeId: BuildingTypeId } | null {
  for (const r of Object.values(RECIPES)) {
    if (r.outputs[goodId] === undefined || !state.unlocked.includes(r.id)) continue;
    const def = Object.values(BUILDINGS).find((d) => d.recipes.includes(r.id) && state.unlocked.includes(d.id));
    if (def) return { recipeId: r.id, typeId: def.id };
  }
  return null;
}

function planChain(goodId: GoodId, state: GameState): ChainPlan | null {
  const nodes: ChainNode[] = [];
  const edges: ChainEdge[] = [];
  const byGood = new Map<GoodId, number>();
  const visit = (g: GoodId, depth: number): number | null => {
    const known = byGood.get(g);
    if (known !== undefined) return known;
    if (depth > 6) return null;
    const rec = firstRecipeFor(g, state);
    if (!rec) return null;
    const inputs: [number, GoodId][] = [];
    for (const input of Object.keys(RECIPES[rec.recipeId].inputs)) {
      const idx = visit(input, depth + 1);
      if (idx === null) return null;
      inputs.push([idx, input]);
    }
    const idx = nodes.length;
    nodes.push({ typeId: rec.typeId, recipeId: rec.recipeId, good: g });
    byGood.set(g, idx);
    for (const [from, good] of inputs) edges.push({ from, to: idx, good });
    return idx;
  };
  const last = visit(goodId, 0);
  if (last === null) return null;
  edges.push({ from: last, to: -1, good: goodId });
  return { nodes, edges };
}

/**
 * The backward chain from extractor(s) to the final factory, using the first unlocked recipe for
 * every good; [] when the good cannot be made yet. `furniture` → lumber_camp, sawmill, furniture_factory.
 */
export function chainFor(goodId: GoodId, state: GameState): BuildingTypeId[] {
  return planChain(goodId, state)?.nodes.map((n) => n.typeId) ?? [];
}

// ---------------------------------------------------------------------------
// valuation & takeover

export function netWorth(state: GameState, owner: OwnerId): number {
  const c = state.companies[owner];
  return c.money - c.loan + assetValue(state, owner);
}

export function canTakeover(state: GameState): boolean {
  if (!state.companies.rival.active) return false;
  const mine = netWorth(state, 'player');
  return mine >= TAKEOVER_MIN_WORTH && mine >= TAKEOVER_MULTIPLE * netWorth(state, 'rival');
}

export function takeoverPrice(state: GameState): number {
  return Math.max(0, Math.round(TAKEOVER_PREMIUM * netWorth(state, 'rival')));
}

/** Buys out the Baron: every rival building, route, vehicle and road passes to the player. */
export function takeover(ctx: SimContext): Result<{ price: number }> {
  const { state } = ctx;
  if (!canTakeover(state)) return err('Your net worth must be 3× the Baron’s and at least $1,000,000');
  const price = takeoverPrice(state);
  const player = state.companies.player;
  const rival = state.companies.rival;
  if (player.money < price) return err('Not enough money');
  spend(player, 'events', price, state.date);
  // the deal includes the Baron's treasury and his debts: his cash minus his loan goes to the buyer
  const cash = rival.money - rival.loan;
  if (cash >= 0) earn(player, 'events', cash, state.date);
  else spend(player, 'events', -cash, state.date);
  rival.money = 0;
  rival.loan = 0;
  for (const b of Object.values(state.buildings)) if (b.ownerId === 'rival') b.ownerId = 'player';
  for (const r of Object.values(state.routes)) if (r.ownerId === 'rival') r.ownerId = 'player';
  for (const v of Object.values(state.vehicles)) if (v.ownerId === 'rival') v.ownerId = 'player';
  for (const t of state.map.tiles) {
    if (t.roadOwner === 'rival') t.roadOwner = 'player';
    if (t.railOwner === 'rival') t.railOwner = 'player';
  }
  player.roadTiles += rival.roadTiles;
  player.railTiles += rival.railTiles;
  rival.roadTiles = 0;
  rival.railTiles = 0;
  rival.active = false;
  state.rivalProject = null;
  state.rivalRail = null;
  clearProjectFlags(state);
  state.flags.takeover = true;
  ctx.bus.emit({ type: 'achievement', id: 'baron_busted' });
  publishNews(
    ctx,
    'rival',
    'SMOGSWORTH OUSTED!',
    `${player.name} completes a hostile takeover of Smogsworth Consolidated for ${price.toLocaleString('en-US')} dollars. ` +
      'The Baron was last seen shaking his cane at the board and hailing a cab, monocle dangling.',
  );
  return ok({ price });
}

// ---------------------------------------------------------------------------
// market reading

const tier2Goods = (state: GameState): GoodId[] =>
  Object.keys(DEMAND_PER_1000).filter((g) => GOODS[g]?.tier === 2 && state.unlocked.includes(g));

/** Hops followed back through stations/warehouses when tracing where a good comes from. */
const SUPPLY_DEPTH = 3;

/**
 * Monthly output of `goodId` that reaches `b`'s loading bay: its own recipe output, or, for a
 * station or warehouse, whatever the rival's routes unload there, traced back (≤ SUPPLY_DEPTH hops)
 * to the producing buildings. `seen` keeps every producer counted once.
 */
function sourceRate(state: GameState, b: Building | undefined, goodId: GoodId, depth: number, seen: Set<number>): number {
  if (!b || seen.has(b.id)) return 0;
  seen.add(b.id);
  const rec = b.recipeId ? RECIPES[b.recipeId] : undefined;
  if (rec?.outputs[goodId]) return (rec.outputs[goodId] / rec.days) * 30;
  if (BUILDINGS[b.typeId]?.category !== 'logistics' || depth <= 0) return 0;
  let total = 0;
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'rival' || !r.stops.some((s) => s.buildingId === b.id && s.unload.includes(goodId))) continue;
    for (const s of r.stops) {
      if (s.load.includes(goodId)) total += sourceRate(state, state.buildings[s.buildingId], goodId, depth - 1, seen);
    }
  }
  return total;
}

/**
 * Monthly output the rival already delivers of `goodId` into `cityId` (by its routes' sources,
 * followed back through railway stations to the factories feeding them).
 */
export function rivalSupply(state: GameState, cityId: number, goodId: GoodId): number {
  let total = 0;
  const seen = new Set<number>();
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'rival') continue;
    const intoCity = r.stops.some((s) => s.unload.includes(goodId) && state.buildings[s.buildingId]?.cityId === cityId);
    if (!intoCity) continue;
    for (const s of r.stops) {
      if (s.load.includes(goodId)) total += sourceRate(state, state.buildings[s.buildingId], goodId, SUPPLY_DEPTH, seen);
    }
  }
  return total;
}

function playerSells(state: GameState, cityId: number, goodId: GoodId): boolean {
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'player') continue;
    if (r.stops.some((s) => s.unload.includes(goodId) && state.buildings[s.buildingId]?.cityId === cityId)) return true;
  }
  return Object.values(state.buildings).some(
    (b) => b.ownerId === 'player' && b.cityId === cityId && (loadSource(b)[goodId] ?? 0) > 0,
  );
}

function rivalStoreIn(state: GameState, cityId: number): Building | undefined {
  return Object.values(state.buildings).find(
    (b) => b.ownerId === 'rival' && b.cityId === cityId && BUILDINGS[b.typeId].category === 'retail',
  );
}

function blocked(state: GameState): string[] {
  const v = state.flags[F_BLOCKED];
  return typeof v === 'string' && v ? v.split(',') : [];
}

function block(state: GameState, key: string): void {
  const list = blocked(state);
  if (!list.includes(key)) list.push(key);
  state.flags[F_BLOCKED] = list.join(',');
}

interface Candidate {
  city: City;
  goodId: GoodId;
  score: number;
  playerThere: boolean;
}

/** The best (city, good) the rival can afford while keeping its reserve, or null. */
export function chooseProject(state: GameState): Candidate | null {
  const money = state.companies.rival.money;
  const blockedKeys = blocked(state);
  const plans = new Map<GoodId, { plan: ChainPlan; cost: number; upkeep: number; capacity: number }>();
  for (const g of tier2Goods(state)) {
    const plan = planChain(g, state);
    if (!plan) continue;
    const cost = plan.nodes.reduce((s, n) => s + BUILDINGS[n.typeId].cost, 0) + plan.edges.length * TRUCK.cost + ROAD_BUDGET;
    const last = RECIPES[plan.nodes[plan.nodes.length - 1].recipeId];
    const upkeep =
      plan.nodes.reduce((s, n) => s + BUILDINGS[n.typeId].maintenance, 0) + plan.edges.length * 2 * TRUCK.maintenance;
    plans.set(g, { plan, cost, upkeep, capacity: ((last.outputs[g] ?? 0) / last.days) * 30 });
  }
  const cands: Candidate[] = [];
  for (const city of state.cities) {
    if (blockedKeys.includes(`${city.id}:*`)) continue;
    const storeCost = rivalStoreIn(state, city.id) ? 0 : BUILDINGS.store.cost;
    for (const [goodId, { cost, upkeep, capacity }] of plans) {
      if (blockedKeys.includes(`${city.id}:${goodId}`)) continue;
      if (cost + storeCost > money - RIVAL_RESERVE) continue;
      const demand = monthlyDemand(city, goodId, state.date.year, demandModifier(state, city.id, goodId));
      const unmet = demand - rivalSupply(state, city.id, goodId);
      if (unmet <= 0) continue;
      const price = salePrice(goodId, supplyRatio(city.market[goodId]));
      // a new chain can only serve as much of the gap as it produces, and must pay its own upkeep
      const score = Math.min(unmet, capacity) * price - upkeep;
      if (score <= 0) continue;
      cands.push({ city, goodId, score, playerThere: playerSells(state, city.id, goodId) });
    }
  }
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.playerThere) - Number(b.playerThere) ||
      a.city.id - b.city.id ||
      (a.goodId < b.goodId ? -1 : a.goodId > b.goodId ? 1 : 0),
  );
  return cands[0] ?? null;
}

// ---------------------------------------------------------------------------
// project execution

function projectIds(state: GameState): number[] {
  const v = state.flags[F_BUILDINGS];
  return typeof v === 'string' && v ? v.split(',').map(Number) : [];
}

function clearProjectFlags(state: GameState): void {
  delete state.flags[F_BUILDINGS];
  delete state.flags[F_FAILS];
  delete state.flags[F_STALL];
}

const centreOf = (b: Building): Vec2 => {
  const { w, h } = BUILDINGS[b.typeId].size;
  return { x: b.pos.x + Math.floor(w / 2), y: b.pos.y + Math.floor(h / 2) };
};

/** Mines and wells: scan matching deposit tiles nearest `near`, covering each with the footprint. */
function placeOnDeposit(ctx: SimContext, node: ChainNode, near: Vec2): Building | null {
  const { state } = ctx;
  const { map } = state;
  const { w, h } = BUILDINGS[node.typeId].size;
  const tiles: { x: number; y: number; d: number }[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i].deposit !== node.good) continue;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    tiles.push({ x, y, d: Math.abs(x - near.x) + Math.abs(y - near.y) });
  }
  tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  for (const t of tiles.slice(0, 120)) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const r = placeBuilding(ctx, 'rival', node.typeId, { x: t.x - dx, y: t.y - dy }, node.recipeId);
        if (r.ok) return r.value;
      }
    }
  }
  return null;
}

/** Places one chain building near `near`, searching progressively further out. */
function placeNode(ctx: SimContext, node: ChainNode, near: Vec2): Building | null {
  if (BUILDINGS[node.typeId].requiresDeposit) return placeOnDeposit(ctx, node, near);
  for (const radius of [16, 32, 48]) {
    const pos = findPlacement(ctx.state, 'rival', node.typeId, near, radius);
    if (!pos) continue;
    const r = placeBuilding(ctx, 'rival', node.typeId, pos, node.recipeId);
    if (r.ok) return r.value;
  }
  return null;
}

function cityName(state: GameState, cityId: number): string {
  return state.cities.find((c) => c.id === cityId)?.name ?? 'the provinces';
}

function abandon(ctx: SimContext, reason: string, blockIt = true): void {
  const { state } = ctx;
  const project = state.rivalProject;
  if (!project) return;
  if (blockIt) block(state, `${project.cityId}:${project.goodId}`);
  // routes of this project that never got a truck are dropped (only the rival's own)
  const ids = projectIds(state);
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'rival' || trucksOn(state, r.id) > 0) continue;
    if (r.stops.some((st) => ids.includes(st.buildingId))) deleteRoute(ctx, r.id);
  }
  // tear down chain buildings nobody routes through (stores are kept for future ventures)
  for (const id of projectIds(state)) {
    const b = state.buildings[id];
    if (!b || b.ownerId !== 'rival' || BUILDINGS[b.typeId].category === 'retail') continue;
    if (Object.values(state.routes).some((r) => r.stops.some((s) => s.buildingId === id))) continue;
    demolishBuilding(ctx, id, 'rival');
  }
  const good = GOODS[project.goodId]?.name ?? project.goodId;
  publishNews(
    ctx,
    'rival',
    `Smogsworth abandons ${good.toLowerCase()} scheme`,
    `Baron Smogsworth's plan to sell ${good.toLowerCase()} in ${cityName(state, project.cityId)} has collapsed (${reason}). ` +
      'A spokesman insists the Baron "meant to do that".',
  );
  state.rivalProject = null;
  clearProjectFlags(state);
}

function fail(ctx: SimContext, reason: string): void {
  const { state } = ctx;
  const fails = (typeof state.flags[F_FAILS] === 'number' ? (state.flags[F_FAILS] as number) : 0) + 1;
  state.flags[F_FAILS] = fails;
  if (fails >= MAX_FAILS) abandon(ctx, reason);
}

const affordable = (state: GameState, cost: number) => state.companies.rival.money - cost >= RIVAL_RESERVE;

function routeFor(state: GameState, from: Building, to: Building, good: GoodId) {
  return Object.values(state.routes).find(
    (r) =>
      r.ownerId === 'rival' &&
      r.stops.length === 2 &&
      r.stops[0].buildingId === from.id &&
      r.stops[1].buildingId === to.id &&
      r.stops[0].load.includes(good),
  );
}

const trucksOn = (state: GameState, routeId: number) =>
  Object.values(state.vehicles).filter((v) => v.routeId === routeId).length;

function finishProject(ctx: SimContext, city: City, goodId: GoodId): void {
  const good = GOODS[goodId]?.name ?? goodId;
  publishNews(
    ctx,
    'rival',
    `Smogsworth ${good} floods ${city.name}`,
    `Smogsworth Consolidated has opened a ${good.toLowerCase()} line into ${city.name}. ` +
      '"Prices will fall, and so will my competitors," the Baron declared.',
  );
  ctx.state.rivalProject = null;
  clearProjectFlags(ctx.state);
}

/**
 * The project waited a month for money. After MAX_STALL_MONTHS it is finished as-is when every
 * leg already has a truck (`canFinish`), otherwise abandoned (without blacklisting the market).
 */
function stall(ctx: SimContext, city: City, canFinish: boolean): void {
  const { state } = ctx;
  const project = state.rivalProject;
  if (!project) return;
  const n = (typeof state.flags[F_STALL] === 'number' ? (state.flags[F_STALL] as number) : 0) + 1;
  state.flags[F_STALL] = n;
  if (n < MAX_STALL_MONTHS) return;
  if (canFinish) finishProject(ctx, city, project.goodId);
  else abandon(ctx, 'the money ran dry', false);
}

/** One step of the current project. Order of build: store, final factory, then back to the extractors. */
function advanceProject(ctx: SimContext): void {
  const { state } = ctx;
  const project = state.rivalProject;
  if (!project) return;
  const city = state.cities.find((c) => c.id === project.cityId);
  const plan = planChain(project.goodId, state);
  if (!city || !plan) {
    abandon(ctx, 'the plans went missing');
    return;
  }
  // build order indices into plan.nodes: reverse post-order puts every consumer before its producers
  const order = plan.nodes.map((_, i) => i).reverse();
  const ids = projectIds(state);
  // slot 0 = store, slot k (k ≥ 1) = plan.nodes[order[k - 1]]
  const built = ids.map((id) => state.buildings[id]);
  if (built.some((b) => !b || b.ownerId !== 'rival')) {
    abandon(ctx, 'a site was lost');
    return;
  }
  const nodeBuilding = (nodeIdx: number) => built[order.indexOf(nodeIdx) + 1];
  const total = plan.nodes.length + 1;

  if (project.stage < total) {
    let b: Building | null = null;
    if (project.stage === 0) {
      b = rivalStoreIn(state, city.id) ?? null;
      if (!b) {
        if (!affordable(state, BUILDINGS.store.cost)) return stall(ctx, city, false);
        const pos = findPlacement(state, 'rival', 'store', city.center, city.urbanRadius + 2);
        b = pos ? unwrap(placeBuilding(ctx, 'rival', 'store', pos)) : null;
        if (!b) {
          block(state, `${city.id}:*`);
          abandon(ctx, `no room for a store in ${city.name}`);
          return;
        }
      }
    } else {
      const nodeIdx = order[project.stage - 1];
      const node = plan.nodes[nodeIdx];
      if (!affordable(state, BUILDINGS[node.typeId].cost)) return stall(ctx, city, false);
      const consumer = plan.edges.find((e) => e.from === nodeIdx);
      const anchorB = consumer && consumer.to >= 0 ? nodeBuilding(consumer.to) : undefined;
      const anchor = anchorB ? centreOf(anchorB) : city.center;
      b = placeNode(ctx, node, anchor);
      if (!b) {
        fail(ctx, `no site for a ${BUILDINGS[node.typeId].name.toLowerCase()}`);
        return;
      }
    }
    state.flags[F_BUILDINGS] = [...ids, b.id].join(',');
    state.flags[F_FAILS] = 0;
    state.flags[F_STALL] = 0;
    project.stage += 1;
    return;
  }

  const store = built[0];
  const endpoints = (e: ChainEdge): [Building, Building] => [nodeBuilding(e.from), e.to < 0 ? store : nodeBuilding(e.to)];

  if (project.stage === total) {
    // roads: give every building access, then make sure every leg is drivable
    for (const b of built) {
      const r = connectToRoads(ctx, b, { owner: 'rival', reserve: RIVAL_RESERVE });
      if (!r.ok) {
        if (r.error !== 'Not enough money') fail(ctx, 'no road could reach a site');
        else stall(ctx, city, false);
        return;
      }
    }
    for (const e of plan.edges) {
      const [a, b] = endpoints(e);
      const r = ensureRoadLink(ctx, 'rival', a, b, RIVAL_RESERVE);
      if (!r.ok) {
        if (r.error !== 'Not enough money') fail(ctx, 'the roads would not meet');
        else stall(ctx, city, false);
        return;
      }
    }
    state.flags[F_FAILS] = 0;
    state.flags[F_STALL] = 0;
    project.stage += 1;
    return;
  }

  // routes and trucks: one route per leg; every leg gets its first truck before any gets a second
  const routes: number[] = [];
  for (const e of plan.edges) {
    const [a, b] = endpoints(e);
    let route = routeFor(state, a, b, e.good);
    if (!route) {
      const r = createRoute(ctx, 'rival', `Smogsworth ${GOODS[e.good]?.name ?? e.good}`, [
        { buildingId: a.id, load: [e.good], unload: [] },
        { buildingId: b.id, load: [], unload: [e.good] },
      ]);
      if (!r.ok) {
        fail(ctx, 'the hauliers refused');
        return;
      }
      route = r.value;
    }
    routes.push(route.id);
  }
  const before = routes.map((id) => trucksOn(state, id));
  for (const target of [1, 2]) {
    for (const id of routes) if (trucksOn(state, id) < target && affordable(state, TRUCK.cost)) buyTruck(ctx, 'rival', id);
  }
  const allServed = routes.every((id) => trucksOn(state, id) > 0);
  if (allServed) {
    finishProject(ctx, city, project.goodId);
    return;
  }
  if (routes.some((id, i) => trucksOn(state, id) > before[i])) state.flags[F_STALL] = 0;
  else stall(ctx, city, false);
}

function unwrap<T>(r: Result<T>): T | null {
  return r.ok ? r.value : null;
}

/**
 * More trucks for legs whose source is backing up (output ≥ 80% of storage) while the destination
 * still has room for a truckload, i.e. haulage is the bottleneck. At most 4 per leg.
 */
function topUpTrucks(ctx: SimContext): void {
  const { state } = ctx;
  for (const route of Object.values(state.routes)) {
    if (route.ownerId !== 'rival' || route.kind !== 'truck') continue;
    const n = trucksOn(state, route.id);
    if (n >= MAX_TRUCKS_PER_LEG || !affordable(state, TRUCK.cost)) continue;
    const backedUp = route.stops.some((s) => {
      const b = state.buildings[s.buildingId];
      if (!b || b.ownerId !== 'rival') return false;
      const cap = BUILDINGS[b.typeId].storage;
      return s.load.some((g) => {
        if ((loadSource(b)[g] ?? 0) < FULL_RATIO * cap) return false;
        return route.stops.some((d) => {
          const dest = state.buildings[d.buildingId];
          return d.unload.includes(g) && dest !== undefined && storageLeft(dest, g) >= TRUCK.capacity;
        });
      });
    });
    if (backedUp) buyTruck(ctx, 'rival', route.id);
  }
}

function manageLoans(ctx: SimContext): void {
  const rival = ctx.state.companies.rival;
  if (rival.money < LOAN_BELOW && rival.loan < LOAN_CAP) takeLoan(rival, LOAN_STEP);
}

function repayLoans(ctx: SimContext): void {
  const rival = ctx.state.companies.rival;
  if (rival.money > REPAY_ABOVE && rival.loan > 0) repayLoan(rival, LOAN_STEP);
}

/**
 * Most manufacturing chains the Baron runs at once: 3 in the Steam Age, one more per later era (7 in
 * the Silicon Age). Without a ceiling his chains feed city growth, which justifies more chains, and the
 * empire snowballs (≈120 buildings and 300 trucks by 1930 in balance runs), out of reach for a
 * takeover and slow to simulate.
 */
export function maxRivalChains(year: number): number {
  return 3 + Math.max(0, Math.min(4, Math.floor((year - 1900) / 20)));
}

/** Chains the rival runs: his buildings making a consumer (tier-2) good. */
export function rivalChainCount(state: GameState): number {
  let n = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'rival' || !b.recipeId) continue;
    const rec = RECIPES[b.recipeId];
    if (rec && Object.keys(rec.outputs).some((g) => GOODS[g]?.tier === 2)) n++;
  }
  return n;
}

/** The Baron's monthly turn (no-op once he is inactive). */
export function rivalMonth(ctx: SimContext): void {
  const { state } = ctx;
  const rival = state.companies.rival;
  if (!rival.active) return;
  manageLoans(ctx);
  retryScrap(ctx);
  if (!state.rivalProject && !state.rivalRail && rivalChainCount(state) < maxRivalChains(state.date.year)) {
    const pick = chooseProject(state);
    if (pick) {
      state.rivalProject = { cityId: pick.city.id, goodId: pick.goodId, stage: 0 };
      clearProjectFlags(state);
    }
  }
  if (state.rivalProject) advanceProject(ctx);
  if (!state.rivalProject && !state.rivalRail) startRailProject(ctx);
  if (state.rivalRail) advanceRail(ctx);
  topUpTrucks(ctx);
  repayLoans(ctx);
}

// ---------------------------------------------------------------------------
// railways

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

function retryScrap(ctx: SimContext): void {
  const pending = flagList(ctx.state, F_RAIL_SCRAP);
  if (pending.length > 0) scrapTrack(ctx, pending.map(Number));
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
const railSetupCost = (tiles: number) => 2 * BUILDINGS[STATION_TYPE].cost + tiles * RAIL_COST + TRAIN.cost;

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
  if (money - railSetupCost(RAIL_MIN_LEG) < RIVAL_RESERVE) return [];
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
      (loadSource(source)[good] ?? 0) >= FULL_RATIO * BUILDINGS[source.typeId].storage &&
      storageLeft(dest, good) >= TRUCK.capacity;
    if (!full && trucksOn(state, route.id) < RAIL_BUSY_TRUCKS) continue;
    const length = legLength(state, source, dest);
    if (length === null) continue;
    if (length < RAIL_MIN_LEG) {
      flagAdd(state, F_RAIL_SHORT, String(route.id));
      continue;
    }
    if (money - railSetupCost(length) < RIVAL_RESERVE) continue;
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
function startRailProject(ctx: SimContext): void {
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
    if (state.companies.rival.money - railSetupCost(plan.length) < RIVAL_RESERVE) continue;
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
  const c = connectToRoads(ctx, station, { owner: 'rival', reserve: RIVAL_RESERVE });
  if (!c.ok) return c.error === 'Not enough money' ? 'money' : 'fail';
  const [a, b] = stationFirst ? [station, served] : [served, station];
  const l = ensureRoadLink(ctx, 'rival', a, b, RIVAL_RESERVE);
  if (!l.ok) return l.error === 'Not enough money' ? 'money' : 'fail';
  // the network may link them only by the very detour the railway is meant to cut: then lay a
  // direct road; a feeder still longer than half the old haul (e.g. round a mountain) is a failure
  let feeder = legLength(ctx.state, a, b);
  if (feeder !== null && feeder <= maxFeeder) return 'ok';
  const d = buildDirectRoad(ctx, 'rival', a, b, RIVAL_RESERVE);
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
function advanceRail(ctx: SimContext): void {
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
    const r = ensureRailLink(ctx, 'rival', a, b, RIVAL_RESERVE + TRAIN.cost);
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
  if (moving === 0 && affordable(state, TRUCK.cost)) buyTruck(ctx, 'rival', feeder.value.id);

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

// ---------------------------------------------------------------------------
// taunts

/** `{player}` = the player's company name, `{city}` = a random city. */
export const TAUNTS: readonly string[] = [
  'Your furniture would embarrass a woodpecker.',
  'I have seen sturdier enterprises built of wet cardboard, {player}.',
  'The good people of {city} deserve better than your shoddy wares. They deserve mine.',
  'Competition? I had to have my butler look up the word.',
  'My monocle fogged over with pity upon reading the ledgers of {player}.',
  'I shall buy {city} a brass bandstand with your market share.',
  'Smoke is the smell of money, and you, sir, smell of fresh air.',
  'Your lorries are so slow the bread goes stale before it leaves the county.',
  '{player}? I took it for a laundry.',
  'A gentleman never gloats. Fortunately, I am a Baron.',
  'I take upstarts like {player} with my morning kippers.',
  'Mark my words: by Michaelmas, {city} will be Smogsworth country.',
  'Your factory whistle is flat, sir. Rather like your profits.',
  'I do not undercut my rivals. I merely price them into the history books.',
  'My top hat is worth more than your entire fleet.',
  'Should {player} require employment, my boot-blacking department is hiring.',
  'Progress waits for no man, and it is certainly not waiting for you.',
  'They call me ruthless. I prefer "punctual".',
  'The bankers of {city} laugh at the mere mention of {player}. I taught them the joke.',
  'Enjoy your little empire while it lasts. I have already ordered the wrecking ball.',
];

const TAUNT_BODIES: readonly string[] = [
  'The Baron delivered the remark between puffs of a fat cigar at the {city} Exchange.',
  'Baron Cornelius Smogsworth said so to our reporter on the steps of the {city} Grand Hotel, polishing his monocle.',
  'The quip, made over brandy at the {city} Gentlemen\'s Club, drew polite and slightly frightened laughter.',
  'Smogsworth Consolidated declined to elaborate, but its chimneys in {city} were seen smoking harder than usual.',
];

function fill(text: string, player: string, city: string): string {
  // "Gilded Gear & Co." at the end of a sentence must not end in ".."
  return text.split('{player}').join(player).split('{city}').join(city).replace(/\.\./g, '.');
}

/** Monthly, with probability 0.3: a `rival` news item with one of the Baron's quips. */
export function rivalTaunt(ctx: SimContext): void {
  const { state } = ctx;
  if (!state.companies.rival.active) return;
  if (!chance(state, TAUNT_CHANCE)) return;
  const quip = pick(state, TAUNTS);
  const body = pick(state, TAUNT_BODIES);
  const city = state.cities.length > 0 ? pick(state, state.cities).name : 'town';
  const player = state.companies.player.name;
  publishNews(ctx, 'rival', `Smogsworth: '${fill(quip, player, city)}'`, fill(body, player, city));
}
