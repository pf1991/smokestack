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
import { repayLoan, spend, takeLoan, LOAN_STEP } from './finance';
import { loadSource, storageLeft } from './inventory';
import { monthlyDemand, salePrice, supplyRatio } from './market';
import { publishNews } from './news';
import { demandModifier } from './production';
import { chance, pick } from './rng';
import { connectToRoads, ensureRoadLink } from './roads';
import { assetValue, demolishBuilding, findPlacement, placeBuilding } from './state';
import type { Building, BuildingTypeId, City, GameState, GoodId, OwnerId, SimContext, Vec2 } from './types';
import { buyTruck, createRoute, TRUCK } from './vehicles';

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

/** Monthly output the rival already delivers of `goodId` into `cityId` (by its routes' sources). */
function rivalSupply(state: GameState, cityId: number, goodId: GoodId): number {
  let total = 0;
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'rival') continue;
    const intoCity = r.stops.some((s) => s.unload.includes(goodId) && state.buildings[s.buildingId]?.cityId === cityId);
    if (!intoCity) continue;
    for (const s of r.stops) {
      if (!s.load.includes(goodId)) continue;
      const b = state.buildings[s.buildingId];
      const rec = b?.recipeId ? RECIPES[b.recipeId] : undefined;
      if (rec?.outputs[goodId]) total += (rec.outputs[goodId] / rec.days) * 30;
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
function chooseProject(state: GameState): Candidate | null {
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

function abandon(ctx: SimContext, reason: string): void {
  const { state } = ctx;
  const project = state.rivalProject;
  if (!project) return;
  block(state, `${project.cityId}:${project.goodId}`);
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
        if (!affordable(state, BUILDINGS.store.cost)) return;
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
      if (!affordable(state, BUILDINGS[node.typeId].cost)) return;
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
        return;
      }
    }
    for (const e of plan.edges) {
      const [a, b] = endpoints(e);
      const r = ensureRoadLink(ctx, 'rival', a, b, RIVAL_RESERVE);
      if (!r.ok) {
        if (r.error !== 'Not enough money') fail(ctx, 'the roads would not meet');
        return;
      }
    }
    state.flags[F_FAILS] = 0;
    project.stage += 1;
    return;
  }

  // routes and trucks: one route per leg, two trucks each when the reserve allows (at least one)
  let complete = true;
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
    for (let n = trucksOn(state, route.id); n < 2 && affordable(state, TRUCK.cost); n++) buyTruck(ctx, 'rival', route.id);
    if (trucksOn(state, route.id) === 0) complete = false;
  }
  if (!complete) return;
  const good = GOODS[project.goodId]?.name ?? project.goodId;
  publishNews(
    ctx,
    'rival',
    `Smogsworth ${good} floods ${city.name}`,
    `Smogsworth Consolidated has opened a ${good.toLowerCase()} line into ${city.name}. ` +
      '"Prices will fall, and so will my competitors," the Baron declared.',
  );
  state.rivalProject = null;
  clearProjectFlags(state);
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

/** The Baron's monthly turn (no-op once he is inactive). */
export function rivalMonth(ctx: SimContext): void {
  const { state } = ctx;
  const rival = state.companies.rival;
  if (!rival.active) return;
  manageLoans(ctx);
  if (!state.rivalProject) {
    const pick = chooseProject(state);
    if (pick) {
      state.rivalProject = { cityId: pick.city.id, goodId: pick.goodId, stage: 0 };
      clearProjectFlags(state);
    }
  }
  if (state.rivalProject) advanceProject(ctx);
  topUpTrucks(ctx);
  repayLoans(ctx);
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
