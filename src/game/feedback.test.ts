import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/events';
import { buildRoad, demolishBuilding, placeBuilding } from '../sim/state';
import { GOODS } from '../data/goods';
import { must, testCtx, testState } from '../sim/testkit';
import { buyTruck, createRoute } from '../sim/vehicles';
import { buyHubTruck } from '../sim/logistics/hubs';
import { attachBaronStrikeToasts, attachStrikeToasts, attachStuckToasts, attachUndercutToasts, reportLostStops, routesUsing, STUCK_TOAST_GAP_MS } from './feedback';

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
  it('a stuck hub truck says "its hub", throttled per hub apart from route-less trucks', () => {
    const { ctx, toasts } = chain();
    ctx.state.companies.player.money = 1e7;
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 2, y: 6 }));
    const h1 = must(buyHubTruck(ctx, 'player', wh.id));
    const h2 = must(buyHubTruck(ctx, 'player', wh.id));
    attachStuckToasts(ctx, () => 0);
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: h1.id });
    ctx.bus.emit({ type: 'vehicleStuck', vehicleId: h2.id });
    expect(toasts).toEqual([`Truck #${h1.id} on its hub is stuck — check its roads`]);
  });

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

describe('strike toasts', () => {
  it('toasts when a works strikes, with an Inspect action', () => {
    const { ctx, a, toasts } = chain();
    const opened: number[] = [];
    let action: (() => void) | undefined;
    ctx.bus.on('toast', (e: Extract<GameEvent, { type: 'toast' }>) => (action = e.action?.run));
    attachStrikeToasts(ctx, (id) => opened.push(id));
    ctx.bus.emit({ type: 'strike', buildingId: a.id, cityId: 99 });
    expect(toasts).toEqual(['Strike! Your Sawmill has downed tools']);
    action!();
    expect(opened).toEqual([a.id]);
  });
});

describe('baron strike toasts', () => {
  it('toasts "Smogsworth strikes: <kind>" with a Rival action', () => {
    const ctx = testCtx();
    const seen: Extract<GameEvent, { type: 'toast' }>[] = [];
    ctx.bus.on('toast', (e) => seen.push(e));
    let opened = 0;
    attachBaronStrikeToasts(ctx, () => opened++);
    ctx.bus.emit({ type: 'baronStrike', kind: 'price_war', cityId: 0 });
    ctx.bus.emit({ type: 'baronStrike', kind: 'smear', cityId: null });
    expect(seen.map((t) => t.message)).toEqual(['Smogsworth strikes: Price war', 'Smogsworth strikes: Smear campaign']);
    expect(seen.every((t) => t.tone === 'bad')).toBe(true);
    expect(seen[0].action!.label).toBe('Rival');
    seen[0].action!.run();
    expect(opened).toBe(1);
  });
});

describe('undercut toasts', () => {
  it('toasts "Undercutting you in <town> — <good>" with a City action', () => {
    const state = testState({ cities: [{ x: 10, y: 10, name: 'Rivermouth' }] });
    const ctx = testCtx(state);
    const seen: Extract<GameEvent, { type: 'toast' }>[] = [];
    ctx.bus.on('toast', (e) => seen.push(e));
    const opened: number[] = [];
    attachUndercutToasts(ctx, (id) => opened.push(id));
    ctx.bus.emit({ type: 'undercut', cityId: 0, goodId: 'furniture' });
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe(`Undercutting you in Rivermouth — ${GOODS.furniture.name}`);
    expect(seen[0].tone).toBe('warning');
    expect(seen[0].action!.label).toBe('City');
    seen[0].action!.run();
    expect(opened).toEqual([0]);
  });
});
