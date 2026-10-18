import type { Result } from '../../core/result';
import { BUILDINGS } from '../../data/buildings';
import { buildingStorage } from '../logistics/levels';
import { GOODS } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import { loanStep, repayLoan, repayStep, takeLoan } from '../finance';
import { loadSource, storageLeft } from '../inventory';
import { publishNews } from '../news';
import { connectToRoads, ensureRoadLink } from '../roads';
import { demolishBuilding, findPlacement, placeBuilding } from '../state';
import type { Building, City, GameState, GoodId, OwnerId, SimContext, Vec2 } from '../types';
import { BARON_ID } from '../companies';
import { buyTruck, createRoute, deleteRoute, replaceCost, replaceVehicle, TRUCK } from '../vehicles';
import { assetAge, renewBuilding, renewCost } from '../society/aging';
import { planChain } from './chains';
import type { ChainEdge, ChainNode } from './chains';
import { block, rivalStoreIn } from './market';
import { clearProjectFlags, F_BUILDINGS, F_FAILS, F_STALL, FULL_RATIO, MAX_STALL_MONTHS, rivalReserve } from './shared';
import { atPrices, priceIndex } from '../society/economy';

const LOAN_BELOW = 20000;
const LOAN_CAP = 200000;
const REPAY_ABOVE = 150000;
const MAX_TRUCKS_PER_LEG = 4;
const MAX_FAILS = 2;
// flags used to remember a project's details across months (GameState.flags holds primitives only)
// the project flags and their reset live in shared.ts (takeover.ts clears them without importing this module)
export { clearProjectFlags };

export function projectIds(state: GameState): number[] {
  const v = state.flags[F_BUILDINGS];
  return typeof v === 'string' && v ? v.split(',').map(Number) : [];
}

export const centreOf = (b: Building): Vec2 => {
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

export function cityName(state: GameState, cityId: number): string {
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

/** Whether the Baron can pay `cost` (1900 dollars) and keep RIVAL_RESERVE, both at today's prices. */
export const affordable = (state: GameState, cost: number) => state.companies.rival.money - atPrices(state, cost) >= rivalReserve(state);

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

export const trucksOn = (state: GameState, routeId: number) =>
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
export function advanceProject(ctx: SimContext): void {
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
      const r = connectToRoads(ctx, b, { owner: 'rival', reserve: rivalReserve(state) });
      if (!r.ok) {
        if (r.error !== 'Not enough money') fail(ctx, 'no road could reach a site');
        else stall(ctx, city, false);
        return;
      }
    }
    for (const e of plan.edges) {
      const [a, b] = endpoints(e);
      const r = ensureRoadLink(ctx, 'rival', a, b, rivalReserve(state));
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

export function unwrap<T>(r: Result<T>): T | null {
  return r.ok ? r.value : null;
}

/**
 * More trucks for legs whose source is backing up (output ≥ 80% of storage) while the destination
 * still has room for a truckload, i.e. haulage is the bottleneck. At most 4 per leg. `owner` (the
 * Baron by default; regional firms too) buys only while it keeps `reserve` (today's dollars).
 */
export function topUpTrucks(ctx: SimContext, owner: OwnerId = BARON_ID, reserve = rivalReserve(ctx.state)): void {
  const { state } = ctx;
  for (const route of Object.values(state.routes)) {
    if (route.ownerId !== owner || route.kind !== 'truck') continue;
    const n = trucksOn(state, route.id);
    if (n >= MAX_TRUCKS_PER_LEG || state.companies[owner].money - atPrices(state, TRUCK.cost) < reserve) continue;
    const backedUp = route.stops.some((s) => {
      const b = state.buildings[s.buildingId];
      if (!b || b.ownerId !== owner) return false;
      const cap = buildingStorage(b);
      return s.load.some((g) => {
        if ((loadSource(b)[g] ?? 0) < FULL_RATIO * cap) return false;
        return route.stops.some((d) => {
          const dest = state.buildings[d.buildingId];
          return d.unload.includes(g) && dest !== undefined && storageLeft(dest, g) >= TRUCK.capacity;
        });
      });
    });
    if (backedUp) buyTruck(ctx, owner, route.id);
  }
}

/** Age at which the Baron overhauls a works or replaces a vehicle (society/aging.ts). */
export const RIVAL_RENEW_AGE = 30;

/**
 * The Baron keeps his empire up like any owner must: each month he renews his oldest works and
 * replaces his oldest vehicle once they reach RIVAL_RENEW_AGE, when he can pay and keep his reserve.
 * Regional firms keep theirs up the same way (`owner`, `reserve`).
 */
export function renewOldAssets(ctx: SimContext, owner: OwnerId = BARON_ID, reserve = rivalReserve(ctx.state)): void {
  const { state } = ctx;
  const company = state.companies[owner];
  const oldest = <T extends { id: number; ownerId: string; builtYear: number }>(xs: T[]): T | undefined =>
    xs
      .filter((x) => x.ownerId === owner && assetAge(state, x) >= RIVAL_RENEW_AGE)
      .sort((a, b) => a.builtYear - b.builtYear || a.id - b.id)[0];
  const b = oldest(Object.values(state.buildings));
  if (b && company.money - renewCost(state, b) >= reserve) renewBuilding(ctx, b.id, owner);
  const v = oldest(Object.values(state.vehicles).filter((x) => x.routeId !== null));
  if (v && company.money - replaceCost(state, v.kind) >= reserve) replaceVehicle(ctx, v.id, owner);
}

/** Borrows a loan step while `owner` (the Baron by default) is short of cash and under the loan cap. */
export function manageLoans(ctx: SimContext, owner: OwnerId = BARON_ID): void {
  const c = ctx.state.companies[owner];
  const index = priceIndex(ctx.state);
  if (c.money < LOAN_BELOW * index && c.loan < LOAN_CAP * index) takeLoan(c, loanStep(index), index);
}

/** Repays a loan step while `owner` (the Baron by default) is flush. */
export function repayLoans(ctx: SimContext, owner: OwnerId = BARON_ID): void {
  const c = ctx.state.companies[owner];
  const index = priceIndex(ctx.state);
  if (c.money > REPAY_ABOVE * index && c.loan > 0) repayLoan(c, repayStep(c, index), index);
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

