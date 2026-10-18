import { describe, expect, it } from 'vitest';
import { addDays, dateToDays } from '../clock';
import { transferOwnership } from '../companies';
import { checkInvariants } from '../invariants';
import { buildRoad, demolishBuilding, lPath, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, GameState, SimContext, Vehicle } from '../types';
import { assignVehicle, createRoute, replaceVehicle, vehiclesTick } from '../vehicles';
import { renewOldAssets } from '../rival/projects';
import {
  buyHubTruck, byCandidate, dailyOutput, dailyUse, footprintGap, hubAttached, hubAutoSizeMonth, hubCandidates, hubsDay, openHub,
  routedGoods, SKILL_TIERS,
  STALL_PRIORITY, STORE_PRIORITY,
} from './hubs';
import { worksDay } from './levels';
import { assign, hire, refreshMarket } from './managers';
import { atPrices } from '../society/economy';
import { vehiclePrice } from '../vehicles';
import { newestModel } from './models';
import type { HubJob, Skill } from './types';

/** Warehouse W (30,9) 3x3, a road along y=12 under every building; a town at (44,20) for stores. */
function setup() {
  const s = testState({ width: 60, height: 30, money: 1e8, cities: [{ x: 44, y: 20, population: 3000, name: 'Ashford' }] });
  const ctx = testCtx(s);
  refreshMarket(s, 1900);
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 12 }, { x: 58, y: 12 })));
  const hub = must(placeBuilding(ctx, 'player', 'warehouse', { x: 30, y: 9 }));
  return { s, ctx, hub };
}

const place = (ctx: SimContext, typeId: string, x: number, y = 9, owner = 'player'): Building =>
  must(placeBuilding(ctx, owner, typeId, { x, y }));

/** Hires the first candidate with logistics `skill` and posts them to `b`. */
function manage(ctx: SimContext, b: Building, skill: Skill): void {
  const L = ctx.state.logistics;
  if (L.market.length === 0) refreshMarket(ctx.state, ctx.state.date.year);
  const m = must(hire(ctx, b.ownerId, L.market[0].id));
  m.skills = { ...m.skills, logistics: skill };
  L.rev++;
  must(assign(ctx, b.ownerId, m.id, b.id));
}

/** Makes today the hub's dispatch day and runs the daily hook. */
function dispatchNow(ctx: SimContext, hub: Building): void {
  hub.hub!.nextDispatchDay = dateToDays(ctx.state.date);
  hubsDay(ctx);
}

const jobs = (s: GameState) =>
  Object.values(s.vehicles).filter((v) => v.job).map((v) => v.job as HubJob);

const tick = (ctx: SimContext, n = 1) => {
  for (let i = 0; i < n; i++) {
    ctx.state.tick++;
    vehiclesTick(ctx);
  }
};
function until(ctx: SimContext, pred: () => boolean, max = 3000): void {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    tick(ctx);
  }
  throw new Error('condition never met');
}

describe('hub dispatch', () => {
  it('assigns nothing without a manager, and says the trucks idle', () => {
    const { s, ctx, hub } = setup();
    const mill = place(ctx, 'sawmill', 35);
    mill.output.lumber = 50;
    must(buyHubTruck(ctx, 'player', hub.id));
    dispatchNow(ctx, hub);
    expect(jobs(s)).toEqual([]);
    expect(hub.hub!.yesterday).toEqual({ jobs: 0, idle: 1 });
    expect(s.logistics.stats.hubJobs.player ?? 0).toBe(0);
  });

  it('a logistics-1 manager sees 12 x 1/3 = 4 tiles: 3 tiles out is served, 8 is not; logistics 5 serves both', () => {
    for (const [skill, want] of [[1, 1], [5, 2]] as const) {
      const { s, ctx, hub } = setup();
      const near = place(ctx, 'sawmill', 35);
      const far = place(ctx, 'sawmill', 40);
      expect(footprintGap(hub, near)).toBe(3);
      expect(footprintGap(hub, far)).toBe(8);
      near.staffing = far.staffing = 0; // no look-ahead top-up at skill 5
      near.output.lumber = 15; // under one truck load each
      far.output.lumber = 15;
      must(buyHubTruck(ctx, 'player', hub.id));
      must(buyHubTruck(ctx, 'player', hub.id));
      manage(ctx, hub, skill);
      expect(hubAttached(s, hub, 12 * SKILL_TIERS[skill].rangeShare).map((b) => b.id)).toEqual(skill === 1 ? [near.id] : [near.id, far.id]);
      dispatchNow(ctx, hub);
      const js = jobs(s);
      expect(js).toHaveLength(want);
      expect(js.every((j) => j.kind === 'collect' && j.to === hub.id && j.good === 'lumber')).toBe(true);
      expect(js.map((j) => j.from).sort()).toEqual(skill === 1 ? [near.id] : [near.id, far.id]);
      expect(s.logistics.stats.hubJobs.player).toBe(want);
      expect(hub.hub!.yesterday).toEqual({ jobs: want, idle: 2 - want });
    }
  });

  it('dispatches every 7 days at skill 1 and daily at skill 5', () => {
    for (const [skill, want] of [[1, 2], [5, 14]] as const) {
      const { s, ctx, hub } = setup();
      const mill = place(ctx, 'sawmill', 35);
      const truck = must(buyHubTruck(ctx, 'player', hub.id));
      manage(ctx, hub, skill);
      hub.hub!.nextDispatchDay = dateToDays(s.date);
      let days = 0;
      for (let d = 0; d < 14; d++) {
        mill.output.lumber = 30;
        truck.job = null; // test-only: the truck is back at once
        hubsDay(ctx);
        if (truck.job) days++;
        s.date = addDays(s.date, 1);
      }
      expect(days).toBe(want);
    }
  });

  it('orders candidates by score, then kind, building id and good id (crafted two-store case)', () => {
    const { s, ctx, hub } = setup();
    const a = place(ctx, 'store', 42, 18);
    const b = place(ctx, 'store', 44, 22);
    manage(ctx, hub, 5);
    hub.input.furniture = 40;
    hub.input.tools = 40;
    const p = { pickups: new Map(), hubOut: new Map(), inbound: new Map(), hubIn: new Map() };
    const cands = hubCandidates(s, hub, 12, p);
    expect(cands.map((c) => `${c.to}:${c.good}`).sort()).toEqual([`${a.id}:furniture`, `${a.id}:tools`, `${b.id}:furniture`, `${b.id}:tools`].sort());
    for (let i = 1; i < cands.length; i++) expect(byCandidate(cands[i - 1], cands[i])).toBeLessThan(0);
    // furniture (72) outscores tools (63) at the same store; the nearer store first per good
    expect(cands[0].good).toBe('furniture');
    // ties: deliver before collect, then building id, then good id
    const base = { from: 1, to: 2, left: 20, score: 5 };
    const sorted = [
      { ...base, kind: 'collect' as const, building: 3, good: 'lumber' },
      { ...base, kind: 'deliver' as const, building: 9, good: 'tools' },
      { ...base, kind: 'deliver' as const, building: 4, good: 'tools' },
      { ...base, kind: 'deliver' as const, building: 4, good: 'bread' },
    ].sort(byCandidate);
    expect(sorted.map((c) => `${c.kind}:${c.building}:${c.good}`)).toEqual(['deliver:4:bread', 'deliver:4:tools', 'deliver:9:tools', 'collect:3:lumber']);
  });

  it('a store in a town with unmet demand outranks an equal factory delivery', () => {
    const { s, ctx, hub } = setup();
    const store = place(ctx, 'store', 42, 18);
    const factory = place(ctx, 'furniture_factory', 26);
    factory.input.lumber = 50; // a full batch: plain priority 1
    hub.input.furniture = 20;
    hub.input.lumber = 20;
    const p = { pickups: new Map(), hubOut: new Map(), inbound: new Map(), hubIn: new Map() };
    const plain = hubCandidates(s, hub, 12, p);
    const st = plain.find((c) => c.to === store.id)!;
    const fa = plain.find((c) => c.to === factory.id)!;
    s.cities[0].market.furniture = { sold30: 10, demand30: 40, pending: 0 };
    const short = hubCandidates(s, hub, 12, p);
    expect(short.find((c) => c.to === store.id)!.score).toBeCloseTo(st.score * STORE_PRIORITY);
    // make the factory delivery equal to the store's plain score: the short town then wins
    const equal = short.map((c) => (c.to === factory.id ? { ...c, score: st.score } : c)).sort(byCandidate);
    expect(equal[0].to).toBe(store.id);
    // and a stalled factory (less than one batch) gets the stall priority
    factory.input.lumber = 2;
    const stalled = hubCandidates(s, hub, 12, p).find((c) => c.to === factory.id)!;
    expect(stalled.score / fa.score).toBeCloseTo(STALL_PRIORITY * (stalled.left / fa.left));
  });

  it('never collects a good a route loads there (D2), nor delivers one a route unloads there', () => {
    const { s, ctx, hub } = setup();
    const mill = place(ctx, 'sawmill', 35);
    const factory = place(ctx, 'furniture_factory', 26);
    mill.output.lumber = 50;
    hub.input.lumber = 50;
    must(createRoute(ctx, 'player', 'Line', [
      { buildingId: mill.id, load: ['lumber'], unload: [] },
      { buildingId: factory.id, load: [], unload: ['lumber'] },
    ]));
    expect(routedGoods(s, 'player').loads.has(`${mill.id}:lumber`)).toBe(true);
    must(buyHubTruck(ctx, 'player', hub.id));
    manage(ctx, hub, 5);
    dispatchNow(ctx, hub);
    expect(jobs(s)).toEqual([]);
  });
});

describe('hub trips', () => {
  function trip() {
    const { s, ctx, hub } = setup();
    const mill = place(ctx, 'sawmill', 35);
    const factory = place(ctx, 'furniture_factory', 24);
    const truck = must(buyHubTruck(ctx, 'player', hub.id));
    manage(ctx, hub, 5);
    return { s, ctx, hub, mill, factory, truck };
  }

  it('a collect ends with the goods in the hub and the truck idle at home', () => {
    const { s, ctx, hub, mill, truck } = trip();
    mill.output.lumber = 15;
    dispatchNow(ctx, hub);
    expect((truck.job as HubJob).kind).toBe('collect');
    until(ctx, () => truck.job === null && truck.state === 'idle');
    expect(hub.input.lumber).toBe(15);
    expect(mill.output.lumber ?? 0).toBe(0);
    expect(truck.cargo).toEqual({});
    expect(checkInvariants(s)).toEqual([]);
  });

  it('a delivery ends at the consumer and the truck drives home', () => {
    const { s, ctx, hub, factory, truck } = trip();
    hub.input.lumber = 15;
    dispatchNow(ctx, hub);
    const j = truck.job as HubJob;
    expect([j.kind, j.from, j.to]).toEqual(['deliver', hub.id, factory.id]);
    until(ctx, () => (truck.job as HubJob | null)?.kind === 'return');
    expect(factory.input.lumber).toBe(15);
    until(ctx, () => truck.job === null && truck.state === 'idle');
    expect(truck.cargo).toEqual({});
    const home = { x: Math.round(truck.pos.x), y: Math.round(truck.pos.y) };
    expect(home.y).toBe(12);
    expect(home.x).toBeGreaterThanOrEqual(30);
    expect(home.x).toBeLessThanOrEqual(32);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('demolishing the target mid-trip sends the truck home and its cargo into the hub', () => {
    const { s, ctx, hub, factory, truck } = trip();
    hub.input.lumber = 15;
    dispatchNow(ctx, hub);
    until(ctx, () => truck.stopIndex === 1 && truck.state === 'moving' && (truck.cargo.lumber ?? 0) > 0);
    expect(hub.input.lumber ?? 0).toBe(0);
    tick(ctx, 2);
    must(demolishBuilding(ctx, factory.id, 'player'));
    expect(checkInvariants(s)).toEqual([]);
    until(ctx, () => truck.job === null && truck.state === 'idle');
    expect(s.vehicles[truck.id]).toBe(truck);
    expect(hub.input.lumber).toBe(15);
    expect(truck.cargo).toEqual({});
  });

  it('demolishing the hub releases its trucks idle, cargo aboard, none deleted', () => {
    const { s, ctx, hub, mill, truck } = trip();
    const second = must(buyHubTruck(ctx, 'player', hub.id));
    mill.output.lumber = 15;
    dispatchNow(ctx, hub);
    until(ctx, () => truck.stopIndex === 1 && (truck.cargo.lumber ?? 0) > 0 && truck.state === 'moving');
    must(demolishBuilding(ctx, hub.id, 'player'));
    for (const v of [truck, second]) {
      expect(s.vehicles[v.id]).toBe(v);
      expect(v.hubId).toBeNull();
      expect(v.job).toBeNull();
      expect(v.state).toBe('idle');
      expect(v.path).toEqual([]);
    }
    expect(truck.cargo.lumber).toBe(15);
    tick(ctx, 50);
    expect(truck.state).toBe('idle');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('transferOwnership moves the hub, its trucks and their jobs', () => {
    const { s, ctx, hub, mill, truck } = trip();
    mill.output.lumber = 15;
    dispatchNow(ctx, hub);
    const job = truck.job;
    transferOwnership(ctx, 'player', 'rival');
    expect(hub.ownerId).toBe('rival');
    expect(hub.hub).toBeDefined();
    expect(truck.ownerId).toBe('rival');
    expect(truck.hubId).toBe(hub.id);
    expect(truck.job).toBe(job);
    expect(checkInvariants(s)).toEqual([]);
    until(ctx, () => truck.job === null && truck.state === 'idle');
    expect(hub.input.lumber).toBe(15);
  });

  it('caps the fleet at 4 on level 1 and 6 on level 2', () => {
    const { s, ctx, hub } = setup();
    for (let i = 0; i < 4; i++) must(buyHubTruck(ctx, 'player', hub.id));
    expect(buyHubTruck(ctx, 'player', hub.id)).toEqual({ ok: false, error: 'Hub fleet is full' });
    hub.level = 2; // test-only
    for (let i = 0; i < 2; i++) must(buyHubTruck(ctx, 'player', hub.id));
    expect(buyHubTruck(ctx, 'player', hub.id)).toEqual({ ok: false, error: 'Hub fleet is full' });
    const trucks = Object.values(s.vehicles);
    expect(trucks).toHaveLength(6);
    expect(trucks.every((v) => v.hubId === hub.id && v.routeId === null && v.state === 'idle' && v.job === null)).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('assigning a hub truck to a route takes it off the hub; replacing keeps it on', () => {
    const { s, ctx, hub, mill, factory, truck } = trip();
    s.date.year = 1960; // old enough to replace, and a newer model is on sale
    mill.output.lumber = 15;
    dispatchNow(ctx, hub);
    const job = truck.job;
    const fresh = must(replaceVehicle(ctx, truck.id, 'player'));
    expect(s.vehicles[truck.id]).toBeUndefined();
    expect(fresh.hubId).toBe(hub.id);
    expect(fresh.routeId).toBeNull();
    expect(fresh.job).toBe(job);
    expect(fresh.model).not.toBe('steam_lorry');
    const route = must(createRoute(ctx, 'player', 'Line', [
      { buildingId: mill.id, load: ['lumber'], unload: [] },
      { buildingId: factory.id, load: [], unload: ['lumber'] },
    ]));
    must(assignVehicle(ctx, fresh.id, route.id));
    expect(fresh.hubId).toBeNull();
    expect(fresh.job).toBeNull();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('a hub truck loads only its job\'s quantity', () => {
    const { s, ctx, hub, mill, truck } = trip();
    s.logistics.managers = []; // no dispatch: the job is set by hand
    s.logistics.rev++;
    mill.output.lumber = 30;
    truck.job = { kind: 'collect', from: mill.id, to: hub.id, good: 'lumber', qty: 12 };
    truck.state = 'moving';
    until(ctx, () => truck.job === null && truck.state === 'idle');
    expect(hub.input.lumber).toBe(12);
    expect(mill.output.lumber).toBe(18);
  });

  it('replacing a loaded hub truck keeps its cargo and the trip still ends in the hub', () => {
    const { s, ctx, hub, mill, truck } = trip();
    s.date.year = 1960;
    mill.output.lumber = 15;
    dispatchNow(ctx, hub);
    until(ctx, () => truck.stopIndex === 1 && (truck.cargo.lumber ?? 0) > 0 && truck.state === 'moving');
    const fresh = must(replaceVehicle(ctx, truck.id, 'player'));
    expect(fresh.cargo).toEqual({ lumber: 15 });
    until(ctx, () => fresh.job === null && fresh.state === 'idle');
    expect(hub.input.lumber).toBe(15);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('renewOldAssets also replaces an old hub truck', () => {
    const { s, ctx, hub, truck } = trip();
    s.date.year = 1960;
    renewOldAssets(ctx, 'player', 0);
    const trucks = Object.values(s.vehicles) as Vehicle[];
    expect(trucks).toHaveLength(1);
    expect(trucks[0].id).not.toBe(truck.id);
    expect(trucks[0].hubId).toBe(hub.id);
  });
});

describe('look-ahead', () => {
  it('a mill holding 8 and making 2 a day is collected at skill 3 (8 + 3 x 2 = 14) and not at skill 2', () => {
    for (const [skill, want] of [[2, 0], [3, 1]] as const) {
      const { s, ctx, hub } = setup();
      const mill = place(ctx, 'sawmill', 35);
      mill.staffing = 0.4; // r_lumber: 5 a day x 0.4
      mill.output.lumber = 8;
      expect(dailyOutput(s, mill, 'lumber')).toBeCloseTo(2);
      must(buyHubTruck(ctx, 'player', hub.id));
      manage(ctx, hub, skill);
      dispatchNow(ctx, hub);
      expect(jobs(s)).toHaveLength(want);
      if (want) expect(jobs(s)[0]).toMatchObject({ kind: 'collect', good: 'lumber', qty: 14 });
    }
  });

  it('output and use are 0 while the building is upgrading or halted, and a store uses its share of the town demand', () => {
    const { s, ctx } = setup();
    const mill = place(ctx, 'sawmill', 35);
    const store = place(ctx, 'store', 42, 18);
    expect(dailyUse(s, mill, 'wood')).toBeCloseTo(10);
    mill.status = 'halted';
    expect(dailyOutput(s, mill, 'lumber')).toBe(0);
    expect(dailyUse(s, mill, 'wood')).toBe(0);
    mill.status = 'ok';
    mill.works = { toLevel: 2, startDay: 0, untilDay: 99999 };
    expect(dailyOutput(s, mill, 'lumber')).toBe(0);
    s.cities[0].market.bread = { sold30: 0, demand30: 60, pending: 0 };
    expect(dailyUse(s, store, 'bread')).toBeCloseTo(2);
  });
});

describe('hub-to-hub balancing', () => {
  /** Hub A (30,9) holding 300 bread; hub B at x = bx whose store (bx, 18) needs 120 bread a month. */
  function twoHubs(bx: number, skill: Skill) {
    const s = testState({ width: 90, height: 30, money: 1e8, cities: [{ x: bx + 2, y: 20, population: 3000, name: 'Ashford' }] });
    const ctx = testCtx(s);
    refreshMarket(s, 1900);
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 12 }, { x: 88, y: 12 })));
    const a = must(placeBuilding(ctx, 'player', 'warehouse', { x: 30, y: 9 }));
    const b = must(placeBuilding(ctx, 'player', 'warehouse', { x: bx, y: 9 }));
    const store = must(placeBuilding(ctx, 'player', 'store', { x: bx, y: 18 }));
    s.cities[0].market.bread = { sold30: 0, demand30: 120, pending: 0 };
    must(openHub(ctx, b.id, 'player'));
    a.input.bread = 300;
    must(buyHubTruck(ctx, 'player', a.id));
    manage(ctx, a, skill);
    return { s, ctx, a, b, store };
  }

  it('skill 4 sends a balance job to the overlapping hub whose store needs bread; skill 3 does not', () => {
    for (const [skill, want] of [[3, 0], [4, 1]] as const) {
      const { s, ctx, a, b } = twoHubs(50, skill);
      expect(footprintGap(a, b)).toBeGreaterThan(12);
      dispatchNow(ctx, a);
      const js = jobs(s);
      expect(js).toHaveLength(want);
      if (want) {
        expect(js[0]).toMatchObject({ kind: 'balance', from: a.id, to: b.id, good: 'bread' });
        expect(js[0].qty).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('a balance trip ends with the bread in the other hub and the truck back home', () => {
    const { s, ctx, a, b } = twoHubs(50, 4);
    dispatchNow(ctx, a);
    const truck = Object.values(s.vehicles)[0] as Vehicle;
    const qty = (truck.job as HubJob).qty;
    until(ctx, () => truck.job === null && truck.state === 'idle', 6000);
    expect(b.input.bread).toBe(qty);
    expect(a.input.bread).toBe(300 - qty);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('keeps 100 and never sends more than the other hub is short', () => {
    const { s, ctx, a } = twoHubs(50, 4);
    a.input.bread = 150;
    dispatchNow(ctx, a);
    expect(jobs(s)[0].qty).toBeLessThanOrEqual(50);
  });

  it('hubs whose ranges do not overlap never balance', () => {
    const { s, ctx, a } = twoHubs(60, 5);
    dispatchNow(ctx, a);
    expect(jobs(s)).toEqual([]);
  });
});

describe('hub auto-sizing', () => {
  function sized(trucks = 1) {
    const { s, ctx, hub } = setup();
    for (let i = 0; i < trucks; i++) must(buyHubTruck(ctx, 'player', hub.id));
    return { s, ctx, hub, count: () => Object.values(s.vehicles).filter((v) => v.hubId === hub.id).length };
  }
  const price = (s: GameState) => vehiclePrice(s, newestModel(s));

  it('buys one truck at 12 backlog days, then resets the month', () => {
    const { ctx, hub, count } = sized();
    hub.hub!.month.backlogDays = 12;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(2);
    expect(hub.hub!.month).toEqual({ jobs: 0, idleTruckDays: 0, backlogDays: 0 });
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(2);
  });

  it('does not buy under 10 backlog days or with auto-sizing off', () => {
    const { ctx, hub, count } = sized();
    hub.hub!.month.backlogDays = 9;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(1);
    hub.hub!.month.backlogDays = 12;
    hub.hub!.autoSize = false;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(1);
  });

  it('never buys above the cap (maxTrucks or the level)', () => {
    const { ctx, hub, count } = sized(2);
    hub.hub!.maxTrucks = 2;
    hub.hub!.month.backlogDays = 12;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(2);
    hub.hub!.maxTrucks = 99;
    hub.hub!.month.backlogDays = 12;
    hubAutoSizeMonth(ctx);
    hub.hub!.month.backlogDays = 12;
    hubAutoSizeMonth(ctx);
    hub.hub!.month.backlogDays = 12;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(4); // level 1 allows 4
  });

  it('never buys below the reserve, and buys at exactly the reserve', () => {
    const { s, ctx, hub, count } = sized();
    const need = price(s) + atPrices(s, 20000);
    s.companies.player.money = need - 1;
    hub.hub!.month.backlogDays = 12;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(1);
    hub.hub!.month.backlogDays = 12;
    s.companies.player.money = need;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(2);
  });

  it('a company in the red buys nothing', () => {
    const { s, ctx, hub, count } = sized();
    s.companies.player.money = -5000;
    hub.hub!.month.backlogDays = 30;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(1);
  });

  it('sells the oldest truck at 2.0 idle per day, never the last, and not at 1.4', () => {
    const { s, ctx, hub, count } = sized(2);
    const [first, second] = Object.values(s.vehicles) as Vehicle[];
    second.builtYear = first.builtYear - 5;
    hub.hub!.month.idleTruckDays = 42; // 1.4 a day
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(2);
    hub.hub!.month.idleTruckDays = 60;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(1);
    expect(s.vehicles[second.id]).toBeUndefined();
    hub.hub!.month.idleTruckDays = 90;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(1);
  });

  it('makes one change a month even when both signals fire', () => {
    const { ctx, hub, count } = sized(2);
    hub.hub!.month.backlogDays = 12;
    hub.hub!.month.idleTruckDays = 90;
    hubAutoSizeMonth(ctx);
    expect(count()).toBe(3);
  });

  it('is free with no hubs', () => {
    const { s, ctx } = setup();
    hubAutoSizeMonth(ctx);
    expect(Object.keys(s.vehicles)).toHaveLength(0);
  });
});

describe('hub cap after an upgrade', () => {
  it('follows the level table when the works finish', () => {
    const { s, ctx, hub } = setup();
    must(buyHubTruck(ctx, 'player', hub.id));
    expect(hub.hub!.maxTrucks).toBe(4);
    const today = dateToDays(s.date);
    hub.works = { toLevel: 2, startDay: today - 30, untilDay: today + 1 };
    worksDay(ctx);
    expect(hub.level).toBe(2);
    expect(hub.hub!.maxTrucks).toBe(6);
  });
});
