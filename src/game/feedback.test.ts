import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/events';
import { buildRoad, demolishBuilding, placeBuilding } from '../sim/state';
import { must, testCtx } from '../sim/testkit';
import { buyTruck, createRoute } from '../sim/vehicles';
import { attachStuckToasts, reportLostStops, routesUsing, STUCK_TOAST_GAP_MS } from './feedback';

function chain() {
  const ctx = testCtx();
  const a = must(placeBuilding(ctx, 'player', 'sawmill', { x: 2, y: 2 }));
  const b = must(placeBuilding(ctx, 'player', 'furniture_factory', { x: 10, y: 2 }));
  const c = must(placeBuilding(ctx, 'player', 'sawmill', { x: 18, y: 2 }));
  must(buildRoad(ctx, 'player', Array.from({ length: 22 }, (_, x) => ({ x, y: 5 }))));
  const toasts: string[] = [];
  ctx.bus.on('toast', (e: Extract<GameEvent, { type: 'toast' }>) => toasts.push(e.message));
  return { ctx, a, b, c, toasts };
}

describe('feedback toasts', () => {
  it('stuck toasts are throttled per route', () => {
    const { ctx, a, b, c, toasts } = chain();
    const r1 = must(createRoute(ctx, 'player', 'Timber Run', [
      { buildingId: a.id, load: [], unload: [] },
      { buildingId: b.id, load: [], unload: [] },
    ]));
    const r2 = must(createRoute(ctx, 'player', 'Mill Loop', [
      { buildingId: b.id, load: [], unload: [] },
      { buildingId: c.id, load: [], unload: [] },
    ]));
    const t1 = must(buyTruck(ctx, 'player', r1.id));
    const t1b = must(buyTruck(ctx, 'player', r1.id));
    const t2 = must(buyTruck(ctx, 'player', r2.id));
    let now = 0;
    attachStuckToasts(ctx, () => now);
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: t1.id });
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: t1b.id });
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: t2.id });
    expect(toasts).toEqual([
      `Truck #${t1.id} on Timber Run is stuck — check its roads`,
      `Truck #${t2.id} on Mill Loop is stuck — check its roads`,
    ]);
    now = STUCK_TOAST_GAP_MS - 1;
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: t1.id });
    expect(toasts).toHaveLength(2);
    now = STUCK_TOAST_GAP_MS;
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: t1b.id });
    expect(toasts).toHaveLength(3);
  });

  it('demolishing a stop reports lost stops and idle routes', () => {
    const { ctx, a, b, c, toasts } = chain();
    must(createRoute(ctx, 'player', 'Timber Run', [
      { buildingId: a.id, load: [], unload: [] },
      { buildingId: b.id, load: [], unload: [] },
    ]));
    must(createRoute(ctx, 'player', 'Long Haul', [
      { buildingId: a.id, load: [], unload: [] },
      { buildingId: b.id, load: [], unload: [] },
      { buildingId: c.id, load: [], unload: [] },
    ]));
    const affected = routesUsing(ctx.state, b.id);
    expect(affected.map((r) => r.name)).toEqual(['Timber Run', 'Long Haul']);
    must(demolishBuilding(ctx, b.id, 'player'));
    reportLostStops(ctx, affected);
    expect(toasts).toEqual([
      'Timber Run lost a stop',
      'Timber Run has too few stops — its trucks are idle',
      'Long Haul lost a stop',
    ]);
  });
});
