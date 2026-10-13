/**
 * Ruling R-S13: the Baron's insolvency guard, a minimal deterministic stopgap until the Phase 4
 * nemesis AI. Each of his buildings keeps a trailing 12-month earnings record (`earnings12`). While
 * his money is below 0 at month end he demolishes his single worst earner (lowest 12-month total,
 * ties to the lowest id) through the normal demolish path, refund included, and starts no new
 * projects (rival/index.ts). Two refinements keep the guard from dismantling a recovering empire:
 * it only cuts a building that actually lost money over the 12 months, and routes the demolition
 * leaves with fewer than two stops are deleted (their vehicles sold at the normal refund) so idle
 * trucks stop drawing upkeep.
 *
 * A building's monthly earnings are its sales (stores: the revenue they took, `salesThisMonth`) plus,
 * for works, the market value of what it made (output × base price × price index: works sell
 * nothing themselves, so their output stands in for their share of the chain's sales), minus its
 * upkeep and an equal share of the upkeep of every vehicle on a route that stops there.
 */
import { GOODS } from '../../data/goods';
import { BARON_ID } from '../companies';
import { demolishBuilding } from '../state';
import { atPrices } from '../society/economy';
import { buildingMaintenance } from '../society/upgrades';
import type { Building, GameState, SimContext } from '../types';
import { projectIds } from './projects';
import { deleteRoute, vehicleUpkeep } from '../vehicles';

export const EARNINGS_MONTHS = 12;

/** Monthly, before growthMonth clears `producedThisMonth`: appends each Baron building's month to its record. */
export function recordBaronEarnings(ctx: SimContext): void {
  const { state } = ctx;
  // each vehicle's upkeep, split equally over its route's stops
  const fleetShare = new Map<number, number>();
  for (const v of Object.values(state.vehicles)) {
    if (v.ownerId !== BARON_ID || v.routeId === null) continue;
    const stops = state.routes[v.routeId]?.stops ?? [];
    if (stops.length === 0) continue;
    const each = vehicleUpkeep(state, v) / stops.length;
    for (const s of stops) fleetShare.set(s.buildingId, (fleetShare.get(s.buildingId) ?? 0) + each);
  }
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== BARON_ID) continue;
    let made = 0;
    for (const [g, q] of Object.entries(b.producedThisMonth)) made += q * (GOODS[g]?.basePrice ?? 0);
    const month = (b.salesThisMonth ?? 0) + atPrices(state, made) - buildingMaintenance(state, b) - (fleetShare.get(b.id) ?? 0);
    const rec = (b.earnings12 ??= []);
    rec.push(Math.round(month));
    if (rec.length > EARNINGS_MONTHS) rec.splice(0, rec.length - EARNINGS_MONTHS);
    b.salesThisMonth = 0;
  }
}

const total = (b: Building) => (b.earnings12 ?? []).reduce((t, n) => t + n, 0);

/**
 * The Baron's worst-earning building (lowest trailing 12-month earnings, ties to the lowest id), or
 * null. Buildings his project or railway in progress is building are spared.
 */
export function worstBaronBuilding(state: GameState): Building | null {
  const spared = new Set(projectIds(state));
  const rail = state.rivalRail;
  if (rail) for (const id of [rail.sourceId, rail.destId, rail.stationA, rail.stationB]) if (id !== null) spared.add(id);
  let worst: Building | null = null;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== BARON_ID || spared.has(b.id)) continue;
    if (!worst || total(b) < total(worst) || (total(b) === total(worst) && b.id < worst.id)) worst = b;
  }
  return worst;
}

/** True while the Baron's money is below 0 (he starts no new projects). */
export function baronInsolvent(state: GameState): boolean {
  return (state.companies[BARON_ID]?.money ?? 0) < 0;
}

/**
 * Month end: while insolvent, demolish the single worst earner if it lost money over its 12 months,
 * then delete the routes that left with fewer than two stops (selling their vehicles). Returns the
 * demolished building's id, or null.
 */
export function insolvencyGuard(ctx: SimContext): number | null {
  const { state } = ctx;
  if (!baronInsolvent(state)) return null;
  const worst = worstBaronBuilding(state);
  if (!worst || total(worst) >= 0) return null;
  if (!demolishBuilding(ctx, worst.id, BARON_ID).ok) return null;
  for (const r of Object.values(state.routes)) if (r.ownerId === BARON_ID && r.stops.length < 2) deleteRoute(ctx, r.id);
  return worst.id;
}
