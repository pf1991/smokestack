/** Turns otherwise silent sim outcomes into toasts the player can act on. */
import type { GameState, Route, SimContext } from '../sim/types';

/** At most one "stuck" toast per route per this many real milliseconds. */
export const STUCK_TOAST_GAP_MS = 10_000;

/**
 * Toasts (tone 'bad') on `vehicleStuck`, throttled per route. `now` is real time in ms.
 * Returns an unsubscribe.
 */
export function attachStuckToasts(ctx: SimContext, now: () => number = () => performance.now()): () => void {
  const last = new Map<number | null, number>();
  return ctx.bus.on('vehicleStuck', (e) => {
    const v = ctx.state.vehicles[e.vehicleId];
    const routeId = v?.routeId ?? null;
    const t = now();
    const prev = last.get(routeId);
    if (prev !== undefined && t - prev < STUCK_TOAST_GAP_MS) return;
    last.set(routeId, t);
    const route = routeId !== null ? ctx.state.routes[routeId] : undefined;
    const name = route?.name ?? 'its route';
    ctx.bus.emit({
      type: 'toast',
      message: `Truck #${e.vehicleId} on ${name} is stuck — check its roads`,
      tone: 'bad',
    });
  });
}

/** Routes that stop at `buildingId` (call before demolishing it). */
export function routesUsing(state: GameState, buildingId: number): Route[] {
  return Object.values(state.routes).filter((r) => r.stops.some((s) => s.buildingId === buildingId));
}

/** After a demolition: tells the player which routes lost a stop and which are now idle. */
export function reportLostStops(ctx: SimContext, affected: Route[]): void {
  for (const before of affected) {
    const route = ctx.state.routes[before.id];
    if (!route) continue;
    ctx.bus.emit({ type: 'toast', message: `${route.name} lost a stop`, tone: 'bad' });
    if (route.stops.length < 2) {
      ctx.bus.emit({ type: 'toast', message: `${route.name} has too few stops — its trucks are idle`, tone: 'bad' });
    }
  }
}
