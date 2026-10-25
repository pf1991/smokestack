import { describe, expect, it } from 'vitest';
import { dateToDays } from '../clock';
import { checkInvariants } from '../invariants';
import { buildRail, buyTrain, ensureRailLink } from '../rail';
import { buildRoad, lPath, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, SimContext, Vehicle } from '../types';
import { createRoute, updateRoute, vehiclesTick } from '../vehicles';
import { buyHubTruck, footprintGap, hubsDay, openHub, overlappingHubs } from './hubs';
import { hubTrunkDay, linkHubTrunk, shedForStation } from './hubTrunk';
import { assign, hire, refreshMarket } from './managers';
import type { HubJob, Skill } from './types';
import { logisticsDay } from './index';

/** Two distant hubs (ranges do not overlap) with a station beside each, joined by rail. */
function distantHubs(skill: Skill = 4) {
  // warehouses at x=10 and x=70 (centres ~11.5 and ~71.5 → Chebyshev ~60 > 12+12)
  // layout: warehouse y=8–10, road y=11, station y=12–13, rail y=14 (buildings never on road/rail)
  const s = testState({
    width: 100,
    height: 40,
    money: 1e8,
    cities: [{ x: 74, y: 22, population: 3000, name: 'Ashford' }],
  });
  const ctx = testCtx(s);
  refreshMarket(s, 1900);

  const a = must(placeBuilding(ctx, 'player', 'warehouse', { x: 10, y: 8 }));
  const b = must(placeBuilding(ctx, 'player', 'warehouse', { x: 70, y: 8 }));
  const sa = must(placeBuilding(ctx, 'player', 'train_station', { x: 10, y: 12 }));
  const sb = must(placeBuilding(ctx, 'player', 'train_station', { x: 70, y: 12 }));
  expect(footprintGap(a, sa)).toBeLessThanOrEqual(2);
  expect(footprintGap(b, sb)).toBeLessThanOrEqual(2);

  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 11 }, { x: 96, y: 11 })));
  must(buildRoad(ctx, 'player', lPath({ x: 74, y: 11 }, { x: 74, y: 20 })));
  const store = must(placeBuilding(ctx, 'player', 'store', { x: 72, y: 18 }));

  must(buildRail(ctx, 'player', lPath({ x: 10, y: 14 }, { x: 72, y: 14 })));

  s.cities[0].market.bread = { sold30: 0, demand30: 120, pending: 0 };

  must(openHub(ctx, a.id, 'player'));
  must(openHub(ctx, b.id, 'player'));
  manage(ctx, a, skill);
  manage(ctx, b, skill);
  a.input.bread = 300;

  return { s, ctx, a, b, sa, sb, store };
}

function manage(ctx: SimContext, b: Building, skill: Skill): void {
  const L = ctx.state.logistics;
  if (L.market.length === 0) refreshMarket(ctx.state, ctx.state.date.year);
  const m = must(hire(ctx, b.ownerId, L.market[0].id));
  m.skills = { ...m.skills, logistics: skill };
  L.rev++;
  must(assign(ctx, b.ownerId, m.id, b.id));
}

function tick(ctx: SimContext, n = 1): void {
  for (let i = 0; i < n; i++) {
    ctx.state.tick++;
    vehiclesTick(ctx);
  }
}

function until(ctx: SimContext, pred: () => boolean, max = 8000): void {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    tick(ctx);
  }
  throw new Error('condition never met');
}

describe('warehouse hub trunk', () => {
  it('shedForStation pairs a station with the nearby warehouse hub', () => {
    const { s, a, sa } = distantHubs();
    expect(shedForStation(s, sa)?.id).toBe(a.id);
  });

  it('linkHubTrunk creates a hub-trunk train route between stations beside the hubs', () => {
    const { ctx, a, b, sa, sb } = distantHubs();
    const route = must(linkHubTrunk(ctx, 'player', a.id, b.id));
    expect(route.kind).toBe('train');
    expect(route.hubTrunk).toBe(true);
    expect(route.mode).toBe('auto');
    expect(route.stops.map((x) => x.buildingId).sort()).toEqual([sa.id, sb.id].sort());
  });

  it('ranges do not overlap, so hub trucks never balance; the trunk train does', () => {
    const { s, ctx, a, b } = distantHubs(4);
    expect(overlappingHubs(s, a).map((h) => h.id)).not.toContain(b.id);

    must(buyHubTruck(ctx, 'player', a.id));
    a.hub!.nextDispatchDay = dateToDays(s.date);
    hubsDay(ctx);
    const truckJobs = Object.values(s.vehicles)
      .filter((v) => v.hubId === a.id && v.job)
      .map((v) => v.job as HubJob);
    expect(truckJobs.filter((j) => j.kind === 'balance')).toEqual([]);

    const route = must(linkHubTrunk(ctx, 'player', a.id, b.id));
    must(buyTrain(ctx, 'player', route.id));
    hubTrunkDay(ctx);
    const train = Object.values(s.vehicles).find((v) => v.kind === 'train') as Vehicle;
    expect(train.job).toMatchObject({ kind: 'collect', good: 'bread' });
    expect((train.job as HubJob).qty).toBeGreaterThanOrEqual(10);
  });

  it('skill 3 does not plan trunk jobs; skill 4 does', () => {
    for (const [skill, want] of [[3, false], [4, true]] as const) {
      const { s, ctx, a, b } = distantHubs(skill);
      const route = must(linkHubTrunk(ctx, 'player', a.id, b.id));
      must(buyTrain(ctx, 'player', route.id));
      hubTrunkDay(ctx);
      const train = Object.values(s.vehicles).find((v) => v.kind === 'train') as Vehicle;
      expect(!!train.job, `skill ${skill}`).toBe(want);
    }
  });

  it('a trunk trip moves bread warehouse → warehouse; hubs stay last-mile (no train stop at sheds)', () => {
    const { s, ctx, a, b, sa, sb } = distantHubs(5);
    const route = must(linkHubTrunk(ctx, 'player', a.id, b.id));
    expect(route.stops.every((st) => [sa.id, sb.id].includes(st.buildingId))).toBe(true);
    expect(route.stops.some((st) => st.buildingId === a.id || st.buildingId === b.id)).toBe(false);

    must(buyTrain(ctx, 'player', route.id));
    hubTrunkDay(ctx);
    const train = Object.values(s.vehicles).find((v) => v.kind === 'train') as Vehicle;
    const qty = (train.job as HubJob).qty;
    const startA = a.input.bread!;
    // route trains do not go idle between jobs; the shed stock moving is the signal
    until(ctx, () => (b.input.bread ?? 0) >= qty && (train.cargo.bread ?? 0) === 0, 20000);
    expect(b.input.bread).toBe(qty);
    expect(a.input.bread).toBe(startA - qty);
    // stations are not the shed — stock lives on the warehouses
    expect(sa.input.bread ?? 0).toBe(0);
    expect(sb.input.bread ?? 0).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('logisticsDay runs trunk dispatch after hubs', () => {
    const { s, ctx, a, b } = distantHubs(4);
    const route = must(linkHubTrunk(ctx, 'player', a.id, b.id));
    must(buyTrain(ctx, 'player', route.id));
    logisticsDay(ctx);
    const train = Object.values(s.vehicles).find((v) => v.kind === 'train') as Vehicle;
    expect(train.job?.good).toBe('bread');
  });

  it('refuses to link hubs that lack a station beside them', () => {
    const s = testState({ width: 80, height: 30, money: 1e8 });
    const ctx = testCtx(s);
    refreshMarket(s, 1900);
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 12 }, { x: 70, y: 12 })));
    const a = must(placeBuilding(ctx, 'player', 'warehouse', { x: 10, y: 9 }));
    const b = must(placeBuilding(ctx, 'player', 'warehouse', { x: 50, y: 9 }));
    must(openHub(ctx, a.id, 'player'));
    must(openHub(ctx, b.id, 'player'));
    expect(linkHubTrunk(ctx, 'player', a.id, b.id)).toEqual({
      ok: false,
      error: 'Each hub needs a train station beside it',
    });
  });

  it('ensureRailLink is used when track is missing between the stations', () => {
    const { s, ctx, a, b, sa, sb } = distantHubs(4);
    // strip the connecting rail between the station access rows, leave local stubs
    for (let x = 13; x < 70; x++) {
      const t = s.map.tiles[14 * s.map.width + x];
      if (t.rail) {
        t.rail = false;
        t.railOwner = null;
        s.companies.player.railTiles--;
      }
    }
    const route = must(linkHubTrunk(ctx, 'player', a.id, b.id));
    expect(route.hubTrunk).toBe(true);
    // path exists again
    expect(ensureRailLink(ctx, 'player', sa, sb).ok).toBe(true);
  });
});

describe('hub trunk vs written train routes', () => {
  it('a plain train route still cannot switch to auto mode', () => {
    const { ctx, sa, sb } = distantHubs();
    const route = must(
      createRoute(
        ctx,
        'player',
        'Coal',
        [
          { buildingId: sa.id, load: ['coal'], unload: [] },
          { buildingId: sb.id, load: [], unload: ['coal'] },
        ],
        'train',
      ),
    );
    expect(updateRoute(ctx, route.id, { mode: 'auto' })).toEqual({
      ok: false,
      error: 'Rail lines run as written',
    });
  });
});
