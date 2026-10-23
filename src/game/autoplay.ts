/**
 * Debug autoplay (`?autoplay=1`): scripts a furniture chain next to the biggest city through the
 * public sim API so screenshots show trucks, sales and money moving without manual play.
 */
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { buildChain, legRoute } from '../sim/chainBuilder';
import type { Building, City, GameState, RouteStop, SimContext, Vec2 } from '../sim/types';
import { runTicks } from '../sim/simulation';
import { assignVehicle, buyTruck, createRoute, deleteRoute, replaceCost, updateRoute, upgradeRouteTrucks } from '../sim/vehicles';
import { BUILDINGS } from '../data/buildings';
import { connectToRoads, ensureRoadLink } from '../sim/roads';
import { buildingList } from '../sim/spatial';
import { findPlacement, placeBuilding } from '../sim/state';
import { atPrices } from '../sim/society/economy';
import { buyHubTruck, footprintGap } from '../sim/logistics/hubs';
import { nextLevel, startUpgrade, upgradeCost } from '../sim/logistics/levels';
import { assign, hire, managerAt } from '../sim/logistics/managers';
import { hasNewerModel } from '../sim/logistics/models';
import { nameHeir } from '../sim/dynasty/family';
import { livingChildren } from '../sim/dynasty/types';
import { buyBack } from '../sim/exchange/trading';
import { bidOpen } from '../sim/nemesis/bid';

export function biggestCity(cities: City[]): City | undefined {
  return [...cities].sort((a, b) => b.population - a.population)[0];
}

const STAGGER_TICKS = 12;

/**
 * lumber camp → sawmill → furniture factory → store in the biggest city (sim/chainBuilder.ts), each
 * leg with two trucks, the second bought half a day later so they do not drive in lockstep.
 * Returns the chain's buildings (for camera framing) or the first error.
 */
export function runAutoplay(ctx: SimContext): Result<Building[]> {
  const city = biggestCity(ctx.state.cities);
  if (!city) return err('No city');
  const chain = buildChain(ctx, 'player', city, 'furniture', 1);
  if (!chain.ok) return chain;
  runTicks(ctx, STAGGER_TICKS);
  const built = chain.value;
  for (let i = 0; i + 1 < built.length; i++) {
    const id = legRoute(ctx, 'player', built[i], built[i + 1]);
    if (id === null) return err('A leg lost its route');
    const t = buyTruck(ctx, 'player', id);
    if (!t.ok) return t;
  }
  return ok(built);
}

/**
 * Headless heir choice (the soak calls it yearly): the eldest living child with the most of
 * `shrewd`/`charming`, else the eldest. Only through the public API (nameHeir); no-op when childless.
 */
export function autoplayNameHeir(ctx: SimContext): void {
  const d = ctx.state.dynasty;
  const kids = livingChildren(d);
  if (kids.length === 0) return;
  const good = (p: (typeof kids)[number]) => p.traits.filter((t) => t === 'shrewd' || t === 'charming').length;
  let best = kids[0];
  for (const k of kids) if (good(k) > good(best)) best = k;
  if (d.heirId !== best.id) nameHeir(ctx.state, best.id);
}

/**
 * Headless defence against the Baron's hostile bid (the soak calls it monthly): while a bid is open,
 * buys back just enough shares to break his majority, borrowing the shortfall when cash is short.
 * Only through the public API (exchange/trading.ts buyBack: takeLoan, then buyShares). No-op with no
 * bid; when even the loan limit cannot cover it, it tries again next month.
 */
export function autoplayDefend(ctx: SimContext): void {
  if (!bidOpen(ctx.state)) return;
  buyBack(ctx);
}

// ---------------------------------------------------------------------------
// Phase 4b logistics (spec §12): the soak exercises managers, an automatic route, a hub, building levels
// and truck models through the public API only.

/**
 * autoplayLogistics thresholds. Tuned in the Task 9 soak (seeds 7, 42, 1234; base 69d8d86): the brief's
 * 5% hire budget and upgrades to the top level left the player bankrupt (seeds 7, 1234) or the Baron
 * insolvent (42). The player's chains are demand-bound, so a level past 2 adds upkeep, workers and smoke
 * but no sales; a 3% budget keeps payroll small. Cash multiples are of today's prices.
 */
const LOGISTICS = {
  /** managers employed at most, hired in January only */
  maxManagers: 2,
  /** a candidate's monthly salary may be at most this share of last month's sales */
  hireShare: 0.03,
  autoLineYear: 1903,
  autoMaxTrucks: 6,
  hubYear: 1905,
  /** cash (1900 $) the hub step needs */
  hubCash: 120_000,
  hubTrucks: 2,
  /** findPlacement radius for the warehouse and for the cheese chain's pasture */
  hubRadius: 20,
  pastureRadius: 25,
  /** an upgrade needs cash of this many times its cost, and goes no higher than this level */
  upgradeCash: 3,
  upgradeTop: 2,
  /** the auto line's new trucks need cash of this many times the net bill */
  truckCash: 3,
} as const;

/** Building types upgraded in this order (the furniture chain, then the cheese chain, then the hub). */
const UPGRADE_ORDER: Building['typeId'][] = ['furniture_factory', 'sawmill', 'lumber_camp', 'creamery', 'dairy_farm', 'warehouse'];

/** The player's lowest-id building of `typeId`. */
function firstOwned(state: GameState, typeId: Building['typeId']): Building | undefined {
  return buildingList(state).find((b) => b.ownerId === 'player' && b.typeId === typeId);
}

/** Sales income of the last closed ledger month (the current month's entry, if any, is still open). */
function lastMonthSales(state: GameState): number {
  const { year, month } = state.date;
  const ledger = state.companies.player.ledger;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const l = ledger[i];
    if (l.year === year && l.month === month) continue;
    return l.income.sales ?? 0;
  }
  return 0;
}

/** January, under the cap: the most logistics-skilled candidate (then cheapest, then lowest id) whose salary is within `hireShare` of last month's sales. */
function stepHire(ctx: SimContext): boolean {
  const { state } = ctx;
  if (state.date.month !== 1) return false;
  const L = state.logistics;
  if (L.managers.filter((m) => m.employer === 'player').length >= LOGISTICS.maxManagers) return false;
  const budget = LOGISTICS.hireShare * lastMonthSales(state);
  let best: (typeof L.market)[number] | null = null;
  for (const m of L.market) {
    if (atPrices(state, m.salary) > budget) continue;
    if (
      !best || m.skills.logistics > best.skills.logistics ||
      (m.skills.logistics === best.skills.logistics && (m.salary < best.salary || (m.salary === best.salary && m.id < best.id)))
    ) best = m;
  }
  return !!best && hire(ctx, 'player', best.id).ok;
}

/** The furniture chain's three legs (camp → sawmill → factory → store), or null once they are gone. */
function furnitureLegs(ctx: SimContext): { stops: Building[]; legs: number[] } | null {
  const { state } = ctx;
  const camp = firstOwned(state, 'lumber_camp');
  const mill = firstOwned(state, 'sawmill');
  const factory = firstOwned(state, 'furniture_factory');
  if (!camp || !mill || !factory) return null;
  const store = buildingList(state).find((b) => b.ownerId === 'player' && b.typeId === 'store' && legRoute(ctx, 'player', factory, b) !== null);
  if (!store) return null;
  const stops = [camp, mill, factory, store];
  const legs: number[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const id = legRoute(ctx, 'player', stops[i], stops[i + 1]);
    if (id === null) return null;
    legs.push(id);
  }
  return { stops, legs };
}

/** From 1903, once: one auto-sized automatic route over the furniture chain takes the legs' trucks; the legs go. */
function stepAutoLine(ctx: SimContext): boolean {
  const { state } = ctx;
  if (state.date.year < LOGISTICS.autoLineYear) return false;
  if (Object.values(state.routes).some((r) => r.ownerId === 'player' && r.mode === 'auto')) return false;
  const chain = furnitureLegs(ctx);
  if (!chain) return false;
  const [camp, mill, factory, store] = chain.stops;
  const stops: RouteStop[] = [
    { buildingId: camp.id, load: ['wood'], unload: [] },
    { buildingId: mill.id, load: ['lumber'], unload: ['wood'] },
    { buildingId: factory.id, load: ['furniture'], unload: ['lumber'] },
    { buildingId: store.id, load: [], unload: ['furniture'] },
  ];
  const route = createRoute(ctx, 'player', 'Furniture auto line', stops);
  if (!route.ok) return false;
  updateRoute(ctx, route.value.id, { mode: 'auto', autoSize: { on: true, maxTrucks: LOGISTICS.autoMaxTrucks } });
  const legSet = new Set(chain.legs);
  const trucks = Object.values(state.vehicles)
    .filter((v) => v.routeId !== null && legSet.has(v.routeId))
    .sort((a, b) => a.id - b.id);
  for (const v of trucks) assignVehicle(ctx, v.id, route.value.id);
  for (const id of chain.legs) deleteRoute(ctx, id); // empty now: no truck is sold
  return true;
}

const centreOf = (b: Building): Vec2 => ({
  x: b.pos.x + Math.floor(BUILDINGS[b.typeId].size.w / 2),
  y: b.pos.y + Math.floor(BUILDINGS[b.typeId].size.h / 2),
});

/** The best-logistics player manager without a post (ties to the lowest id), or null. */
function unpostedManager(state: GameState): number | null {
  let best: (typeof state.logistics.managers)[number] | null = null;
  for (const m of state.logistics.managers) {
    if (m.employer !== 'player' || m.post !== null) continue;
    if (!best || m.skills.logistics > best.skills.logistics) best = m;
  }
  return best ? best.id : null;
}

/**
 * From 1905, once cash reaches `hubCash`: an unrouted cheese chain in the biggest city (built by the pasture
 * nearest the town so one hub reaches it all) and a warehouse hub at the site near its centroid, or near a
 * member, that is closest to its farthest member, with two hub trucks and the best unposted manager. A hub that has lost its manager
 * (retired, quit or poached) gets the next unposted one.
 */
function stepHub(ctx: SimContext): boolean {
  const { state } = ctx;
  const hub = buildingList(state).find((b) => b.ownerId === 'player' && b.hub);
  if (hub) {
    if (managerAt(state, hub.id)) return false;
    const m = unpostedManager(state);
    return m !== null && assign(ctx, 'player', m, hub.id).ok;
  }
  if (state.date.year < LOGISTICS.hubYear || state.companies.player.money < atPrices(state, LOGISTICS.hubCash)) return false;
  let creamery = firstOwned(state, 'creamery');
  if (!creamery) {
    const city = biggestCity(state.cities);
    if (!city) return false;
    // a compact chain one hub can reach: the creamery (and so the farm) by the pasture nearest the town
    const pasture = findPlacement(state, 'player', 'dairy_farm', city.center, LOGISTICS.pastureRadius) ?? undefined;
    if (!buildChain(ctx, 'player', city, 'cheese', 0, { routes: false, near: pasture }).ok) return false;
    creamery = firstOwned(state, 'creamery');
  }
  const farm = firstOwned(state, 'dairy_farm');
  const store = buildingList(state).filter((b) => b.ownerId === 'player' && b.typeId === 'store').pop(); // the cheese chain's, built last
  if (!creamery || !farm || !store) return false;
  const members = [farm, creamery, store];
  const cs = members.map(centreOf);
  const centroid = { x: Math.round(cs.reduce((t, c) => t + c.x, 0) / 3), y: Math.round(cs.reduce((t, c) => t + c.y, 0) / 3) };
  let wh = firstOwned(state, 'warehouse');
  if (!wh) {
    // the free site nearest the centroid, or nearest a member, whose farthest member is closest (ties: that order)
    let pos: Vec2 | null = null;
    let reach = Infinity;
    for (const near of [centroid, ...cs]) {
      const p = findPlacement(state, 'player', 'warehouse', near, LOGISTICS.hubRadius);
      if (!p) continue;
      const site = { typeId: 'warehouse', pos: p } as Building;
      const r = Math.max(...members.map((b) => footprintGap(site, b)));
      if (r < reach) (pos = p), (reach = r);
    }
    if (!pos) return false;
    const placed = placeBuilding(ctx, 'player', 'warehouse', pos);
    if (!placed.ok) return false;
    wh = placed.value;
  }
  connectToRoads(ctx, wh, { owner: 'player' });
  ensureRoadLink(ctx, 'player', wh, creamery);
  for (let i = 0; i < LOGISTICS.hubTrucks; i++) if (!buyHubTruck(ctx, 'player', wh.id).ok) break;
  const m = unpostedManager(state);
  if (m !== null) assign(ctx, 'player', m, wh.id);
  return true;
}

/** With no works running and cash ≥ `upgradeCash` × its cost: the first building of UPGRADE_ORDER whose next level (up to `upgradeTop`) is on offer. */
function stepUpgrade(ctx: SimContext): boolean {
  const { state } = ctx;
  const mine = buildingList(state).filter((b) => b.ownerId === 'player');
  if (mine.some((b) => b.works)) return false;
  for (const typeId of UPGRADE_ORDER) {
    const b = mine.find((x) => x.typeId === typeId);
    if (!b) continue;
    const next = nextLevel(b);
    if (!next || next.year > state.date.year || next.level > LOGISTICS.upgradeTop) continue;
    if (state.companies.player.money < LOGISTICS.upgradeCash * upgradeCost(state, b)) return false;
    return startUpgrade(ctx, b.id, 'player').ok;
  }
  return false;
}

/** With cash ≥ `truckCash` × the net bill: the auto line's trucks replaced by the newest model once a newer one is on sale. */
function stepTrucks(ctx: SimContext): boolean {
  const { state } = ctx;
  const line = Object.values(state.routes).find((r) => r.ownerId === 'player' && r.mode === 'auto');
  if (!line) return false;
  const old = Object.values(state.vehicles).filter((v) => v.routeId === line.id && v.kind === 'truck' && hasNewerModel(state, v.model));
  if (old.length === 0) return false;
  const bill = old.reduce((t, v) => t + replaceCost(state, v), 0);
  if (state.companies.player.money < LOGISTICS.truckCash * bill) return false;
  return upgradeRouteTrucks(ctx, line.id, 'player').ok;
}

/**
 * Headless logistics (the soak, the fixture script and `skipYears` call it monthly): the first step that
 * applies this month, in order: hire (January, under 2 managers), the furniture auto line (once, from
 * 1903), the cheese hub (once, from 1905), one building upgrade, the auto line's truck models.
 * Each step is skipped while it cannot be afforded. Only through the public API.
 */
export function autoplayLogistics(ctx: SimContext): void {
  if (!ctx.state.companies.player.active) return;
  stepHire(ctx) || stepAutoLine(ctx) || stepHub(ctx) || stepUpgrade(ctx) || stepTrucks(ctx);
}
