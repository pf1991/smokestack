import { BUILDINGS } from '../../data/buildings';
import { assetAge } from '../society/aging';
import { atPrices } from '../society/economy';
import { BARON_ID, companyIds, PLAYER_ID } from '../companies';
import { monthIndex } from '../politics/elections';
import { REGIONAL_RESERVE } from '../regional/firms';
import { rivalChainCount } from '../rival/projects';
import { rivalReserve } from '../rival/shared';
import { connectToRoads, ensureRoadLink } from '../roads';
import { accessTiles, demolishBuilding, findPlacement, placeBuilding } from '../state';
import type { Building, GameState, OwnerId, SimContext, Vec2 } from '../types';
import { vehiclePrice } from '../vehicles';
import { busiestUnmannedWorks, hubOf, isWorks, outputValue, ownedBy } from './aiPost';
import { buyHubTruck, HUB_RESERVE, hubTrucks, setHubAutoSize } from './hubs';
import { nextLevel, startUpgrade, upgradeCost } from './levels';
import { assign, hire, managerAt, managerSalary } from './managers';
import { newestModel } from './models';
import type { Manager } from './types';

/**
 * Phase 4b spec section 9: the Baron and the regional firms adopt levels, hubs and managers through the
 * same public functions as the player (startUpgrade, buyHubTruck, hire, assign). Once a month, after the
 * player's and every system's month, in companyIds order. Each company keeps its own reserve: the Baron
 * BARON_RESERVE_MULTIPLE x rivalReserve, a firm FIRM_RESERVE_MULTIPLE x REGIONAL_RESERVE at today's prices.
 *
 * Balance (Task 8 soak): the Baron's chains are demand-bound, so a level adds upkeep and workers without
 * adding sales. With the spec's 6-month gap and a 2x reserve he spent his cushion on upgrades and went
 * insolvent late in the century on seeds 7 and 42; a 24-month gap and a 20x reserve (he upgrades, opens
 * his hub and hires only from surplus) keep his 2000 real net worth at 0.9-1.9x of the pre-4b base.
 */

/** Months between two of the Baron's upgrades (the spec's 6, tuned for balance: see above), and a firm's. */
export const BARON_UPGRADE_GAP_MONTHS = 24;
export const FIRM_UPGRADE_GAP_MONTHS = 12;
/** A works must be this many years old (since built or renewed) before the AI upgrades it. */
export const UPGRADE_MIN_AGE = 2;
/** The Baron opens a hub from this year, once he runs this many chains. */
export const BARON_HUB_YEAR = 1910;
export const BARON_HUB_CHAINS = 3;
/** A firm opens a hub this many years after its founding. */
export const FIRM_HUB_AGE = 5;
/** Hub trucks the AI buys with its warehouse; hub auto-sizing grows the fleet from there. */
export const AI_HUB_TRUCKS = 2;
/** Managers the Baron employs at most (his hub and his busiest works), and each firm (its hub). */
export const BARON_MAX_MANAGERS = 2;
export const FIRM_MAX_MANAGERS = 1;
/** The AI hires only candidates with at least this logistics skill. */
export const AI_MIN_LOGISTICS = 2;
/** The cash the AI keeps after any logistics purchase, as a multiple of its own reserve: the Baron's rivalReserve (the brief's 2, tuned: see above), a firm's REGIONAL_RESERVE. */
export const BARON_RESERVE_MULTIPLE = 20;
export const FIRM_RESERVE_MULTIPLE = 2;
/** Months a company waits after its warehouse could not be placed or linked by road before it tries again. */
export const HUB_RETRY_MONTHS = 12;
/** It hires only when it can pay this many months of salary and keep its reserve. */
const SALARY_MONTHS = 12;
/** findPlacement radius around the centroid of the owner's buildings. */
const HUB_PLACE_RADIUS = 20;

/** The cash `owner` keeps after any logistics purchase, at today's prices. */
export function aiReserve(state: GameState, owner: OwnerId): number {
  return state.companies[owner]?.kind === 'baron'
    ? BARON_RESERVE_MULTIPLE * rivalReserve(state)
    : FIRM_RESERVE_MULTIPLE * atPrices(state, REGIONAL_RESERVE);
}

/** The cash hub auto-sizing keeps (hubAutoSizeMonth): HUB_RESERVE for the player, aiReserve for the Baron and the firms. */
export function hubReserveOf(state: GameState, owner: OwnerId): number {
  return state.companies[owner]?.kind === 'player' ? atPrices(state, HUB_RESERVE) : aiReserve(state, owner);
}

// ---------------------------------------------------------------------------
// levels

/** Once per gap: the busiest works below the highest level of the day, not under works and old enough, when the owner keeps its reserve. */
function aiUpgrade(ctx: SimContext, owner: OwnerId, gapMonths: number): void {
  const { state } = ctx;
  const key = `lastUpgrade:${owner}`;
  const last = state.flags[key];
  const now = monthIndex(state.date);
  if (typeof last === 'number' && now - last < gapMonths) return;
  let best: Building | null = null;
  let bestV = 0;
  for (const b of ownedBy(state, owner)) {
    if (!isWorks(b) || b.works || assetAge(state, b) < UPGRADE_MIN_AGE) continue;
    const next = nextLevel(b);
    if (!next || next.year > state.date.year) continue;
    const v = outputValue(state, b);
    if (v > bestV) (best = b), (bestV = v);
  }
  if (!best) return;
  if (state.companies[owner].money - upgradeCost(state, best) < aiReserve(state, owner)) return;
  if (startUpgrade(ctx, best.id, owner).ok) state.flags[key] = now;
}

// ---------------------------------------------------------------------------
// hubs

/** Monthly salary (today's prices) of the cheapest candidate the AI would hire, or of a 2/1/1 manager when none is on offer. */
function hireSalary(state: GameState): number {
  const m = cheapestCandidate(state);
  return atPrices(state, m ? m.salary : managerSalary({ logistics: AI_MIN_LOGISTICS, production: 1, frugality: 1 }));
}

/** What a hub costs the AI up front: the warehouse, its trucks and a year of a manager's salary (today's prices). */
export function hubCostEstimate(state: GameState, withWarehouse = true): number {
  const warehouse = withWarehouse ? Math.round(atPrices(state, BUILDINGS.warehouse.cost)) : 0;
  return warehouse + AI_HUB_TRUCKS * vehiclePrice(state, newestModel(state)) + SALARY_MONTHS * hireSalary(state);
}

/** Founding year of a firm: its first ledger month (the ledger keeps ten years, so a trimmed one is older still). */
const foundedYear = (state: GameState, owner: OwnerId): number => state.companies[owner].ledger[0]?.year ?? state.date.year;

function wantsHub(state: GameState, owner: OwnerId): boolean {
  if (state.companies[owner].kind === 'baron') return state.date.year >= BARON_HUB_YEAR && rivalChainCount(state) >= BARON_HUB_CHAINS;
  return state.date.year - foundedYear(state, owner) >= FIRM_HUB_AGE;
}

const centre = (b: Building): Vec2 => ({
  x: b.pos.x + Math.floor(BUILDINGS[b.typeId].size.w / 2),
  y: b.pos.y + Math.floor(BUILDINGS[b.typeId].size.h / 2),
});
const manhattan = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The building of `among` nearest `p` (ties to the lowest id). */
function nearest(among: Building[], p: Vec2): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of among) {
    const d = manhattan(centre(b), p);
    if (d < bestD) (best = b), (bestD = d);
  }
  return best;
}

/** Places a warehouse for `owner` at the free site nearest the centroid of its buildings, with road access. */
function placeWarehouse(ctx: SimContext, owner: OwnerId, mine: Building[], reserve: number): Building | null {
  const { state } = ctx;
  let sx = 0;
  let sy = 0;
  for (const b of mine) {
    const c = centre(b);
    sx += c.x;
    sy += c.y;
  }
  const centroid = { x: Math.round(sx / mine.length), y: Math.round(sy / mine.length) };
  // a centroid in open water or wilderness falls back to the building nearest it
  const pos =
    findPlacement(state, owner, 'warehouse', centroid, HUB_PLACE_RADIUS) ??
    findPlacement(state, owner, 'warehouse', centre(nearest(mine, centroid)!), HUB_PLACE_RADIUS);
  if (!pos) return null;
  const placed = placeBuilding(ctx, owner, 'warehouse', pos);
  if (!placed.ok) return null;
  const wh = placed.value;
  if (!connectToRoads(ctx, wh, { owner, reserve }).ok || accessTiles(state, wh).length === 0) {
    demolishBuilding(ctx, wh.id, owner);
    return null;
  }
  return wh;
}

/**
 * Spec §9: a company due a hub and without one places a warehouse near the centroid of its buildings
 * (or reuses a warehouse it has), links it by road to its nearest building, buys AI_HUB_TRUCKS hub trucks
 * and leaves hub auto-sizing on; only when it can pay the warehouse, the trucks and a year of salary and
 * keep its reserve.
 */
function aiHub(ctx: SimContext, owner: OwnerId): void {
  const { state } = ctx;
  if (hubOf(state, owner) || !wantsHub(state, owner)) return;
  const blockedKey = `hubBlocked:${owner}`;
  const blocked = state.flags[blockedKey];
  const now = monthIndex(state.date);
  if (typeof blocked === 'number' && now - blocked < HUB_RETRY_MONTHS) return;
  const mine = ownedBy(state, owner);
  if (mine.length === 0) return;
  const existing = mine.find((b) => b.typeId === 'warehouse' && accessTiles(state, b).length > 0) ?? null;
  const reserve = aiReserve(state, owner);
  const company = state.companies[owner];
  if (company.money - hubCostEstimate(state, !existing) < reserve) return;
  const wh = existing ?? placeWarehouse(ctx, owner, mine, reserve);
  // no site or no road: the same deterministic search would fail again next month, so back off
  if (!wh) {
    state.flags[blockedKey] = now;
    return;
  }
  const others = mine.filter((b) => b.id !== wh.id && b.typeId !== 'warehouse' && accessTiles(state, b).length > 0);
  const link = nearest(others, centre(wh));
  if (link && !ensureRoadLink(ctx, owner, wh, link, reserve).ok) {
    if (!existing) demolishBuilding(ctx, wh.id, owner);
    state.flags[blockedKey] = now;
    return;
  }
  // every purchase keeps the reserve (the roads above pass it too)
  for (let n = hubTrucks(state, wh.id).length; n < AI_HUB_TRUCKS; n++) {
    if (company.money - vehiclePrice(state, newestModel(state)) < reserve || !buyHubTruck(ctx, owner, wh.id).ok) break;
  }
  if (wh.hub) setHubAutoSize(ctx, wh.id, owner, true);
}

// ---------------------------------------------------------------------------
// managers

/** The cheapest market candidate with logistics AI_MIN_LOGISTICS+ (ties to the lowest id), or null. */
function cheapestCandidate(state: GameState): Manager | null {
  let best: Manager | null = null;
  for (const m of state.logistics.market) {
    if (m.skills.logistics < AI_MIN_LOGISTICS) continue;
    if (!best || m.salary < best.salary || (m.salary === best.salary && m.id < best.id)) best = m;
  }
  return best;
}

/**
 * January (spec §9, D8): fills the company's unmanned hub, and for the Baron also his busiest unmanned
 * works: first with a manager it already employs and has not posted, else by hiring the cheapest candidate
 * with logistics 2+ whose year of salary it can pay and keep its reserve, up to its manager cap (the
 * brief's rule: an idle AI hub, D2, gains nothing from a dearer manager).
 */
function aiHire(ctx: SimContext, owner: OwnerId): void {
  const { state } = ctx;
  const baron = state.companies[owner].kind === 'baron';
  const max = baron ? BARON_MAX_MANAGERS : FIRM_MAX_MANAGERS;
  const posts: number[] = [];
  const hub = hubOf(state, owner);
  if (hub && !managerAt(state, hub.id)) posts.push(hub.id);
  if (baron) {
    const w = busiestUnmannedWorks(state, owner);
    if (w) posts.push(w.id);
  }
  for (const post of posts) {
    const mine = state.logistics.managers.filter((m) => m.employer === owner);
    const idle = mine.find((m) => m.post === null);
    if (idle) {
      assign(ctx, owner, idle.id, post);
      continue;
    }
    if (mine.length >= max) return;
    const cand = cheapestCandidate(state);
    if (!cand) return;
    if (state.companies[owner].money - SALARY_MONTHS * atPrices(state, cand.salary) < aiReserve(state, owner)) return;
    const hired = hire(ctx, owner, cand.id);
    if (hired.ok) assign(ctx, owner, hired.value.id, post);
  }
}

/** The month's AI logistics, for the Baron and each active regional firm in companyIds order. */
export function aiLogisticsMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const id of companyIds(state)) {
    const c = state.companies[id];
    if (id === PLAYER_ID || !c.active || (c.kind !== 'baron' && c.kind !== 'regional')) continue;
    aiUpgrade(ctx, id, id === BARON_ID ? BARON_UPGRADE_GAP_MONTHS : FIRM_UPGRADE_GAP_MONTHS);
    aiHub(ctx, id);
    if (state.date.month === 1) aiHire(ctx, id);
  }
}
