/**
 * Phase 4b spec §9: the Baron closes a product that loses money. A product line is a store route that
 * unloads a consumer good at one of his stores, plus every works (and station) that feeds it, traced
 * back through his routes. Once a month, for each good he sells: when it sold in each of the last 12
 * closed ledger months and those 12 months of sales do not cover a year of the upkeep of every building
 * and vehicle on its lines (today's prices), he closes them all: the store routes are deleted (their
 * trucks sold), then each building no route of his hauls from any more is demolished, back up the
 * chain, and he never plans that good again (chooseProject skips the `*:good` block).
 *
 * Why (Task 10 diagnosis): the radio chain is his deepest (10-12 works, three inputs and two mines) and
 * its upkeep exceeded its sales even at peak demand; after radios fade (1965-75) it lost 90-150k a year
 * (1900 $) and its unsold radios filled the shared pool of the stores it shared with bread and furniture.
 * Only the insolvency guard ever cut a building, and only once he was already below 0.
 */
import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { BARON_ID } from '../companies';
import { publishNews } from '../news';
import { buildingMaintenance } from '../society/upgrades';
import { demolishBuilding } from '../state';
import type { Building, GameState, GoodId, Route, SimContext } from '../types';
import { deleteRoute, vehicleUpkeep } from '../vehicles';
import { projectIds } from './projects';
import { scrapOrphanRail } from './railways';
import { stationAccess, STATION_TYPE } from '../rail';
import { block } from './market';

/** Closed ledger months a good's sales are weighed over (it must have sold in every one). */
export const LINE_REVIEW_MONTHS = 12;

const isStore = (b: Building | undefined): boolean => b !== undefined && BUILDINGS[b.typeId]?.category === 'retail';

/** Buildings `owner` must not cut: those of his project or railway under way (a line holding one is not reviewed). */
function spared(state: GameState): Set<number> {
  const out = new Set(projectIds(state));
  const rail = state.rivalRail;
  if (rail) for (const id of [rail.sourceId, rail.destId, rail.stationA, rail.stationB]) if (id !== null) out.add(id);
  return out;
}

export interface ProductLines {
  /** the routes that unload the good at one of the owner's stores */
  storeRoutes: Route[];
  /** every building feeding them (not the stores) */
  members: Set<number>;
  /** the store routes and every route unloading at a member */
  routes: Set<number>;
}

/** The owner's lines selling `good`, traced back from his stores through the routes that feed them. */
export function productLines(state: GameState, good: GoodId, owner = BARON_ID): ProductLines {
  const mine = Object.values(state.routes).filter((r) => r.ownerId === owner);
  const storeRoutes = mine.filter((r) =>
    r.stops.some((s) => s.unload.includes(good) && isStore(state.buildings[s.buildingId]) && state.buildings[s.buildingId].ownerId === owner),
  );
  const members = new Set<number>();
  const routes = new Set<number>(storeRoutes.map((r) => r.id));
  const visit = (id: number): void => {
    const b = state.buildings[id];
    if (members.has(id) || !b || b.ownerId !== owner || isStore(b)) return;
    members.add(id);
    for (const r of mine) {
      if (!r.stops.some((s) => s.buildingId === id && s.unload.length > 0)) continue;
      routes.add(r.id);
      for (const s of r.stops) if (s.buildingId !== id && s.load.length > 0) visit(s.buildingId);
    }
  };
  for (const r of storeRoutes) for (const s of r.stops) if (s.load.includes(good)) visit(s.buildingId);
  return { storeRoutes, members, routes };
}

/** A year of upkeep (today's prices) of every building and vehicle on `lines`. */
export function linesUpkeep(state: GameState, lines: ProductLines): number {
  let monthly = 0;
  for (const id of lines.members) monthly += buildingMaintenance(state, state.buildings[id]);
  for (const v of Object.values(state.vehicles)) if (v.routeId !== null && lines.routes.has(v.routeId)) monthly += vehicleUpkeep(state, v);
  return 12 * monthly;
}

/** `good`'s sales over the owner's last LINE_REVIEW_MONTHS closed ledger months, or null unless it sold in every one. */
export function trailingSales(state: GameState, good: GoodId, owner = BARON_ID): number | null {
  const { year, month } = state.date;
  const closed = state.companies[owner].ledger.filter((m) => m.year < year || (m.year === year && m.month < month));
  if (closed.length < LINE_REVIEW_MONTHS) return null;
  let total = 0;
  for (const m of closed.slice(-LINE_REVIEW_MONTHS)) {
    const s = m.salesByGood[good] ?? 0;
    if (s <= 0) return null;
    total += s;
  }
  return total;
}

/** Deletes the store routes, then demolishes every building no route of the owner hauls from, back up the chain. */
function closeLines(ctx: SimContext, lines: ProductLines, owner: string, keep: Set<number>): void {
  const { state } = ctx;
  const queue: number[] = [];
  // the track beside the line's stations, lifted once they are gone unless another line still uses it
  const rails: number[] = [];
  for (const id of lines.members) {
    const b = state.buildings[id];
    if (b?.typeId === STATION_TYPE) for (const p of stationAccess(state, b)) rails.push(p.y * state.map.width + p.x);
  }
  for (const r of lines.storeRoutes) {
    for (const s of r.stops) if (s.load.length > 0) queue.push(s.buildingId);
    deleteRoute(ctx, r.id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const b = state.buildings[id];
    if (!b || b.ownerId !== owner || isStore(b) || keep.has(id)) continue;
    const mine = Object.values(state.routes).filter((r) => r.ownerId === owner);
    if (mine.some((r) => r.stops.some((s) => s.buildingId === id && s.load.length > 0))) continue;
    for (const r of mine) {
      if (!r.stops.some((s) => s.buildingId === id && s.unload.length > 0)) continue;
      for (const s of r.stops) if (s.buildingId !== id && s.load.length > 0) queue.push(s.buildingId);
    }
    if (!demolishBuilding(ctx, id, owner).ok) continue;
    for (const r of Object.values(state.routes)) if (r.ownerId === owner && r.stops.length < 2) deleteRoute(ctx, r.id);
  }
  if (rails.length > 0) scrapOrphanRail(ctx, rails);
}

/** The Baron's monthly review: closes the lines of every good whose year of sales does not cover their upkeep. */
export function closeLosingLines(ctx: SimContext): GoodId[] {
  const { state } = ctx;
  const owner = BARON_ID;
  const goods = new Set<GoodId>();
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== owner) continue;
    for (const s of r.stops) {
      const b = state.buildings[s.buildingId];
      if (b && b.ownerId === owner && isStore(b)) for (const g of s.unload) goods.add(g);
    }
  }
  const closed: GoodId[] = [];
  const keep = spared(state);
  for (const good of [...goods].sort()) {
    if (state.rivalProject?.goodId === good) continue;
    const sales = trailingSales(state, good, owner);
    if (sales === null) continue;
    const lines = productLines(state, good, owner);
    // a line feeding his project or railway under way is judged once it is built (closing it would strand them)
    if ([...lines.members].some((id) => keep.has(id))) continue;
    // a building on its lines younger than the window (a new works, station or railway) has not had a year to earn
    if ([...lines.members].some((id) => (state.buildings[id].earnings12?.length ?? 0) < LINE_REVIEW_MONTHS)) continue;
    if (sales >= linesUpkeep(state, lines)) continue;
    block(state, `*:${good}`);
    closeLines(ctx, lines, owner, keep);
    closed.push(good);
    const name = (GOODS[good]?.name ?? good).toLowerCase();
    publishNews(
      ctx,
      'rival',
      `Smogsworth quits ${name}`,
      `Baron Smogsworth has shut his ${name} works: the trade no longer pays its keep. "Sentiment is for paupers," he said.`,
    );
  }
  return closed;
}
