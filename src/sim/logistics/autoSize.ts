import { atPrices } from '../society/economy';
import type { Route, SimContext } from '../types';
import { buyTruck, sellVehicle, vehiclePrice } from '../vehicles';
import {
  anyTracked, AUTO_BACKLOG_DAYS, AUTO_BAND, AUTO_RESERVE, clampMaxTrucks, newStats, tracksStats, utilisation,
} from './autoRoutes';

/** Route auto-sizing (spec §6.4), monthly: one truck bought or sold per route at most. */

/** Spec §6.4 for one auto-sized route: buy one, sell one, or neither. */
function sizeRoute(ctx: SimContext, route: Route, maxTrucks: number): void {
  const { state } = ctx;
  const stats = route.stats ?? newStats();
  const u = utilisation(stats);
  const trucks = Object.values(state.vehicles).filter((v) => v.routeId === route.id && v.kind === 'truck');
  if (u > AUTO_BAND.high && stats.backlogDays >= AUTO_BACKLOG_DAYS && trucks.length < maxTrucks) {
    const company = state.companies[route.ownerId];
    if (company && company.money > 0 && company.money - vehiclePrice(state, 'truck') >= atPrices(state, AUTO_RESERVE)) {
      buyTruck(ctx, route.ownerId, route.id);
    }
  } else if (u < AUTO_BAND.low && trucks.length > 1) {
    let oldest = trucks[0];
    for (const v of trucks) if (v.builtYear < oldest.builtYear) oldest = v; // ids ascend: ties keep the lowest
    sellVehicle(ctx, oldest.id);
  }
}

/**
 * Monthly, routes in id order: auto-sizes every route with auto-sizing on, then resets every
 * route's counters, keeping last month's loaded share (percent) for the route window.
 */
export function autoSizeRoutesMonth(ctx: SimContext): void {
  const { state } = ctx;
  if (!anyTracked(state)) return;
  for (const key in state.routes) {
    const route = state.routes[key];
    if (route.autoSize?.on) sizeRoute(ctx, route, clampMaxTrucks(route.autoSize.maxTrucks));
    if (!route.stats) continue;
    if (!tracksStats(route)) {
      delete route.stats; // switched back to a plain manual route
      continue;
    }
    const s = route.stats;
    route.stats = { ...newStats(), last: s.loaded + s.empty > 0 ? Math.round(utilisation(s) * 100) : undefined };
    if (route.stats.last === undefined) delete route.stats.last;
  }
}
