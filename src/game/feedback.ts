/** Turns otherwise silent sim outcomes into toasts the player can act on. */
import type { GameState, Route, SimContext } from '../sim/types';
import { ACHIEVEMENTS } from './achievements';
import { BUILDINGS } from '../data/buildings';
import { formatMoney } from '../ui/format';
import { crossedMilestone, showStamp } from '../ui/juice';

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

/**
 * A 'bad' toast when one of the player's works goes on strike (sim/society/strikes.ts); with
 * `inspect`, the toast offers to open the works' inspector. Returns an unsubscribe.
 */
export function attachStrikeToasts(ctx: SimContext, inspect?: (buildingId: number) => void): () => void {
  return ctx.bus.on('strike', (e) => {
    const b = ctx.state.buildings[e.buildingId];
    const city = ctx.state.cities.find((c) => c.id === e.cityId);
    if (!b) return;
    const name = BUILDINGS[b.typeId]?.name ?? 'works';
    ctx.bus.emit({
      type: 'toast',
      message: `Strike! Your ${name}${city ? ` at ${city.name}` : ''} has downed tools`,
      tone: 'bad',
      ...(inspect ? { action: { label: 'Inspect', run: () => inspect(e.buildingId) } } : {}),
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

/**
 * Stamps the screen when the player's treasury crosses a money milestone (checked daily, one stamp
 * per crossing) and when an achievement unlocks. Returns an unsubscribe.
 */
export function attachMilestoneStamps(ctx: SimContext): () => void {
  let prev = ctx.state.companies.player.money;
  const offDay = ctx.bus.on('dayStart', () => {
    const next = ctx.state.companies.player.money;
    const hit = crossedMilestone(prev, next);
    prev = next;
    if (hit !== null) showStamp(`${formatMoney(hit)} treasury`, 'good');
  });
  const offAch = ctx.bus.on('achievement', (e) => {
    const def = ACHIEVEMENTS.find((a) => a.id === e.id);
    showStamp(def?.name ?? e.id, 'good');
  });
  return () => {
    offDay();
    offAch();
  };
}
