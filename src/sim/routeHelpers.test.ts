import { describe, expect, it } from 'vitest';
import { buildRoad, lPath, placeBuilding } from './state';
import { appendStop, routeThroughput, suggestStop } from './routeHelpers';
import { testCtx, testState, must } from './testkit';
import { buyTruck, createRoute, TRUCK } from './vehicles';

function world() {
  const s = testState();
  const ctx = testCtx(s);
  for (let y = 8; y < 10; y++) for (let x = 2; x < 4; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
  const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 15, y: 10 })));
  return { s, ctx, camp, mill };
}

describe('suggestStop', () => {
  it('camp→sawmill loads wood, unloads wood', () => {
    const { s, camp, mill } = world();
    const first = suggestStop(s, camp.id, []);
    expect(first).toEqual({ buildingId: camp.id, load: ['wood'], unload: [] });
    const second = suggestStop(s, mill.id, [first]);
    expect(second.unload).toEqual(['wood']);
    expect(second.load).toEqual([]);
  });

  it('appendStop makes earlier stops load what the new stop accepts', () => {
    const { s, camp, mill } = world();
    const stops = appendStop(s, appendStop(s, [], camp.id), mill.id);
    expect(stops.map((x) => x.buildingId)).toEqual([camp.id, mill.id]);
    expect(stops[1].unload).toEqual(['wood']);
  });
});

describe('routeThroughput', () => {
  it('scales with trucks', () => {
    const { s, ctx, camp, mill } = world();
    const r = must(createRoute(ctx, 'player', 'R', appendStop(s, appendStop(s, [], camp.id), mill.id)));
    expect(routeThroughput(s, r.id)).toBe(0);
    must(buyTruck(ctx, 'player', r.id));
    const one = routeThroughput(s, r.id);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(TRUCK.capacity * 720);
    must(buyTruck(ctx, 'player', r.id));
    expect(routeThroughput(s, r.id)).toBeCloseTo(one * 2);
  });
});
