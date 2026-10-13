import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { FACTION_IDS, type FactionId } from '../../data/factions';
import { closeMonth, LOAN_RATE } from '../finance';
import { maintenanceMonth, productionDay } from '../production';
import { canPlaceBuilding, createGame, findPlacement, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { City, GameState, SimContext, Vehicle } from '../types';
import { vehicleMaintenanceMonth } from '../vehicles';
import { holdElection } from './elections';
import { adjustOpinion } from './factions';
import {
  activeEdicts,
  chooseMayorEdicts,
  churchFactor,
  constructionFactor,
  landPriceFactor,
  loanRate,
  permitRefusal,
  TRUCK_TOLL,
  truckTollsMonth,
} from './mayorEdicts';
import type { MayorEdictId } from './types';

/** A town at (20,20), pop 6000: urbanRadius 7, so the permit zone reaches 11 tiles from the centre. */
function town(money = 1e7, population = 6000): SimContext {
  return testCtx(testState({ width: 80, height: 60, money, cities: [{ x: 20, y: 20, population }] }));
}

/** Sets a town's opinion of `faction` to exactly `value` (through the funnel). */
function setOpinion(state: GameState, city: City, faction: FactionId, value: number): void {
  adjustOpinion(state, faction, city.id, value - city.opinion[faction], 'test', { log: false });
}

function withMayor(state: GameState, city: City, faction: FactionId, op: number): City {
  city.politics.mayor.faction = faction;
  setOpinion(state, city, faction, op);
  return city;
}

// sawmill 3×3: pos (29,19) has its centre at (30.5, 20.5), 10.5 tiles out (inside the zone); (40,19) is rural
const NEAR = { x: 29, y: 19 };
const RURAL = { x: 40, y: 19 };

describe('chooseMayorEdicts', () => {
  const cases: [FactionId, number, MayorEdictId[]][] = [
    ['workers', 50, ['minimum_wage']],
    ['workers', 35, ['minimum_wage']],
    ['workers', 34.9, ['minimum_wage', 'permits_required']],
    ['oldmoney', 50, ['tax_break']],
    ['oldmoney', 49.9, ['truck_tolls']],
    ['reformers', 40, ['smog_limit']],
    ['reformers', 39.9, ['smog_limit', 'permits_required']],
    ['church', 50, []],
    ['church', 49.9, ['truck_tolls']],
    ['baron', 90, ['truck_tolls', 'permits_required']],
    ['baron', 10, ['truck_tolls', 'permits_required']],
  ];
  it.each(cases)('%s mayor at opinion %s picks %j', (faction, op, want) => {
    const { state } = town();
    const city = withMayor(state, state.cities[0], faction, op);
    expect(chooseMayorEdicts(city)).toEqual(want);
  });

  it('is pure: same input, same output, city untouched', () => {
    const { state } = town();
    const city = withMayor(state, state.cities[0], 'reformers', 20);
    const before = JSON.stringify(city);
    expect(chooseMayorEdicts(city)).toEqual(chooseMayorEdicts(city));
    expect(JSON.stringify(city)).toBe(before);
  });

  it('a new game starts with each default mayor\'s edicts', () => {
    const state = createGame({ seed: 7 });
    for (const c of state.cities) expect(c.politics.edicts).toEqual(chooseMayorEdicts(c));
    expect(state.cities[0].politics.edicts).toEqual(['minimum_wage']);
  });

  it('runs after each election', () => {
    const ctx = town();
    const city = ctx.state.cities[0];
    for (let i = 0; i < 6; i++) {
      holdElection(ctx, city);
      expect(city.politics.edicts).toEqual(chooseMayorEdicts(city));
    }
  });

  it('reformers below 30 in a town over 20,000 add permits even if the mayor did not', () => {
    const { state } = town(1e7, 25000);
    const city = withMayor(state, state.cities[0], 'oldmoney', 60);
    city.politics.edicts = chooseMayorEdicts(city);
    setOpinion(state, city, 'reformers', 29);
    expect(activeEdicts(city)).toEqual(['tax_break', 'permits_required']);
    setOpinion(state, city, 'reformers', 30);
    expect(activeEdicts(city)).toEqual(['tax_break']);
    // a small town is spared
    const small = town().state;
    const c2 = small.cities[0];
    setOpinion(small, c2, 'reformers', 0);
    expect(activeEdicts(c2)).toEqual([]);
  });
});

describe('permits', () => {
  function permitTown(mayorOp: number): SimContext {
    const ctx = town();
    const city = withMayor(ctx.state, ctx.state.cities[0], 'workers', mayorOp);
    city.politics.edicts = ['permits_required'];
    return ctx;
  }

  it('charge a 10% fee for a factory in the zone, shown and charged alike', () => {
    const ctx = permitTown(30);
    const q = must(canPlaceBuilding(ctx.state, 'player', 'sawmill', NEAR));
    expect(q.permit).toBe(2000);
    expect(q.cost).toBe(22000);
    const before = ctx.state.companies.player.money;
    must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    expect(before - ctx.state.companies.player.money).toBe(22000);
  });

  it('a lumber camp pays a $1,200 permit', () => {
    const ctx = permitTown(30);
    ctx.state.map.tiles.forEach((t) => (t.terrain = 'forest'));
    const q = must(canPlaceBuilding(ctx.state, 'player', 'lumber_camp', { x: 29, y: 19 }));
    expect(q.permit).toBe(1200);
    expect(q.cost).toBe(13200);
  });

  it('are refused below 25, naming the faction, the city and the fix', () => {
    const ctx = permitTown(24);
    const r = canPlaceBuilding(ctx.state, 'player', 'sawmill', NEAR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('A permit was refused by the Workers mayor of Town 0. Raise their opinion to 25 or more, or build elsewhere.');
    expect(r.error).toBe(permitRefusal(ctx.state.cities[0], ctx.state.date.year));
    expect(placeBuilding(ctx, 'player', 'sawmill', NEAR).ok).toBe(false);
  });

  it('never touch the Baron', () => {
    const ctx = permitTown(0);
    const city = ctx.state.cities[0];
    setOpinion(ctx.state, city, 'oldmoney', 0);
    setOpinion(ctx.state, city, 'church', 0);
    const q = must(canPlaceBuilding(ctx.state, 'rival', 'sawmill', NEAR));
    expect(q).toEqual({ cost: BUILDINGS.sawmill.cost, permit: 0 });
    const before = ctx.state.companies.rival.money;
    must(placeBuilding(ctx, 'rival', 'sawmill', NEAR));
    expect(before - ctx.state.companies.rival.money).toBe(BUILDINGS.sawmill.cost);
    // findPlacement (the Baron's site search) still finds the refused site
    expect(findPlacement(ctx.state, 'rival', 'sawmill', { x: 30, y: 30 }, 0)).not.toBeNull();
  });
});

describe('no soft-lock', () => {
  /** Every negative lever at once: Baron mayor at 0, reformers below 30 in a big town, old money and church at 0. */
  function worstTown(): SimContext {
    const ctx = town(1e7, 25000);
    const city = withMayor(ctx.state, ctx.state.cities[0], 'baron', 0);
    city.politics.edicts = chooseMayorEdicts(city);
    for (const f of FACTION_IDS) setOpinion(ctx.state, city, f, 0);
    return ctx;
  }

  it('retail and logistics are never refused, and pay no permit', () => {
    const ctx = worstTown();
    const city = ctx.state.cities[0];
    expect(activeEdicts(city)).toContain('permits_required');
    const store = must(canPlaceBuilding(ctx.state, 'player', 'store', { x: 20, y: 20 }));
    expect(store.permit).toBe(0);
    must(placeBuilding(ctx, 'player', 'store', { x: 20, y: 20 }));
    const wh = must(canPlaceBuilding(ctx.state, 'player', 'warehouse', { x: 34, y: 19 }));
    expect(wh.permit).toBe(0);
    // a factory on the same kind of site is refused
    expect(canPlaceBuilding(ctx.state, 'player', 'sawmill', { x: 34, y: 19 }).ok).toBe(false);
  });

  it('a rural site is never refused and pays base price', () => {
    const ctx = worstTown();
    const r = must(canPlaceBuilding(ctx.state, 'player', 'sawmill', { x: 60, y: 19 }));
    expect(r).toEqual({ cost: BUILDINGS.sawmill.cost, permit: 0 });
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 60, y: 19 }));
  });

  it('only the zone is refused: a site just outside urbanRadius + 4 is fine', () => {
    const ctx = worstTown();
    const city = ctx.state.cities[0];
    const edge = city.urbanRadius + 4;
    // centre (x+1.5, 20.5) just outside the zone
    const x = Math.ceil(20 + Math.sqrt(edge * edge - 0.25) - 1.5 + 1e-9);
    expect(canPlaceBuilding(ctx.state, 'player', 'sawmill', { x: x - 1, y: 19 }).ok).toBe(false);
    expect(canPlaceBuilding(ctx.state, 'player', 'sawmill', { x, y: 19 }).ok).toBe(true);
  });
});

describe('construction cost levers', () => {
  it('land price follows Old Money: ×1.25 at 0, ×1 at 50, ×0.75 at 100', () => {
    const { state } = town();
    const city = state.cities[0];
    setOpinion(state, city, 'oldmoney', 0);
    expect(landPriceFactor(city)).toBeCloseTo(1.25, 12);
    setOpinion(state, city, 'oldmoney', 50);
    expect(landPriceFactor(city)).toBe(1);
    setOpinion(state, city, 'oldmoney', 100);
    expect(landPriceFactor(city)).toBeCloseTo(0.75, 12);
  });

  it('church below 25 adds 25% (community objections)', () => {
    const { state } = town();
    const city = state.cities[0];
    setOpinion(state, city, 'church', 25);
    expect(churchFactor(city)).toBe(1);
    setOpinion(state, city, 'church', 24);
    expect(churchFactor(city)).toBe(1.25);
  });

  it('land price, church and tax break combine multiplicatively, in the shown and charged cost', () => {
    const ctx = town();
    const city = withMayor(ctx.state, ctx.state.cities[0], 'oldmoney', 10);
    city.politics.edicts = ['tax_break'];
    setOpinion(ctx.state, city, 'church', 10);
    const f = (1 + (50 - 10) / 200) * 1.25 * 0.75;
    expect(constructionFactor(city, 'sawmill')).toBeCloseTo(f, 12);
    // the tax break is for factories only
    expect(constructionFactor(city, 'store')).toBeCloseTo((1 + 40 / 200) * 1.25, 12);
    const want = Math.round(BUILDINGS.sawmill.cost * f);
    expect(must(canPlaceBuilding(ctx.state, 'player', 'sawmill', NEAR)).cost).toBe(want);
    const before = ctx.state.companies.player.money;
    must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    expect(before - ctx.state.companies.player.money).toBe(want);
    // rural: no town, no levers
    expect(must(canPlaceBuilding(ctx.state, 'player', 'sawmill', RURAL)).cost).toBe(BUILDINGS.sawmill.cost);
  });

  it('affordability uses the adjusted cost', () => {
    const ctx = town(20500);
    const city = ctx.state.cities[0];
    setOpinion(ctx.state, city, 'church', 0);
    expect(canPlaceBuilding(ctx.state, 'player', 'sawmill', RURAL).ok).toBe(true);
    const r = canPlaceBuilding(ctx.state, 'player', 'sawmill', NEAR);
    expect(r.ok ? 'ok' : r.error).toBe('Not enough money');
  });
});

describe('smog limit', () => {
  function smogTown(pollution: number) {
    const ctx = town();
    const city = ctx.state.cities[0];
    city.politics.edicts = ['smog_limit'];
    city.pollution = pollution;
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    const rural = must(placeBuilding(ctx, 'player', 'sawmill', RURAL));
    const baron = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 29, y: 23 }));
    for (const b of [mill, rural, baron]) b.input = { wood: 1000 };
    return { ctx, mill, rural, baron };
  }

  it('runs dirty player works near the town at 0.75 while its smog is above 0.4', () => {
    const { ctx, mill, rural, baron } = smogTown(0.41);
    // r_lumber takes one day: at full rate a batch completes, at 0.75 it does not
    productionDay(ctx);
    expect(mill.progress).toBeCloseTo(0.75, 12);
    expect(mill.output.lumber ?? 0).toBe(0);
    expect(rural.output.lumber).toBe(5);
    expect(baron.output.lumber).toBe(5);
  });

  it('stacks with staffing: a half-staffed limited works runs at 0.375', () => {
    const { ctx, mill, rural } = smogTown(0.41);
    mill.staffing = 0.5;
    rural.staffing = 0.5;
    productionDay(ctx);
    expect(mill.progress).toBeCloseTo(0.375, 12);
    expect(rural.progress).toBeCloseTo(0.5, 12);
  });

  it('does nothing at or below 0.4', () => {
    const { ctx, mill } = smogTown(0.4);
    productionDay(ctx);
    expect(mill.output.lumber).toBe(5);
  });
});

describe('truck tolls', () => {
  function addTruck(state: GameState, owner: 'player' | 'rival', stopIds: number[]): Vehicle {
    const routeId = state.nextId++;
    state.routes[routeId] = {
      id: routeId, ownerId: owner, name: 'r', color: '#000', kind: 'truck',
      stops: stopIds.map((buildingId) => ({ buildingId, load: [], unload: [] })),
    };
    const v: Vehicle = {
      id: state.nextId++, kind: 'truck', ownerId: owner, routeId, pos: { x: 0, y: 0 }, prevPos: { x: 0, y: 0 },
      path: [], pathIndex: 0, stopIndex: 0, cargo: {}, capacity: 20, state: 'idle', waitTicks: 0, stuckNotified: false,
    };
    state.vehicles[v.id] = v;
    return v;
  }

  it('book $40 a month per player truck per toll town, once per town, under vehicles', () => {
    const ctx = testCtx(testState({ width: 120, height: 60, money: 1e7, cities: [{ x: 20, y: 20 }, { x: 90, y: 20 }] }));
    const { state } = ctx;
    for (const c of state.cities) c.politics.edicts = ['truck_tolls'];
    const a1 = must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    const a2 = must(placeBuilding(ctx, 'player', 'sawmill', { x: 29, y: 24 }));
    const b1 = must(placeBuilding(ctx, 'player', 'sawmill', { x: 75, y: 19 }));
    const far = must(placeBuilding(ctx, 'player', 'sawmill', { x: 55, y: 50 }));
    addTruck(state, 'player', [a1.id, a2.id]); // two stops in town 0: one toll
    addTruck(state, 'player', [a1.id, b1.id]); // both towns: two tolls
    addTruck(state, 'player', [far.id, far.id]); // no town: none
    addTruck(state, 'rival', [a1.id, b1.id]); // the Baron is exempt
    const before = state.companies.player.money;
    const rivalBefore = state.companies.rival.money;
    truckTollsMonth(ctx);
    expect(before - state.companies.player.money).toBe(3 * TRUCK_TOLL);
    expect(state.companies.rival.money).toBe(rivalBefore);
    const ledger = state.companies.player.ledger.at(-1)!;
    expect(ledger.expense.vehicles).toBe(3 * TRUCK_TOLL);
  });

  it('are charged by the monthly vehicle upkeep', () => {
    const ctx = town();
    ctx.state.cities[0].politics.edicts = ['truck_tolls'];
    const a = must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    addTruck(ctx.state, 'player', [a.id, a.id]);
    const without = (() => {
      const c2 = town();
      const b = must(placeBuilding(c2, 'player', 'sawmill', NEAR));
      addTruck(c2.state, 'player', [b.id, b.id]);
      const m = c2.state.companies.player.money;
      vehicleMaintenanceMonth(c2);
      return m - c2.state.companies.player.money;
    })();
    const m = ctx.state.companies.player.money;
    vehicleMaintenanceMonth(ctx);
    expect(m - ctx.state.companies.player.money - without).toBe(TRUCK_TOLL);
  });
});

describe('minimum wage', () => {
  it('raises upkeep ×1.1 for player buildings working in that town; low wages count as fair there', () => {
    const ctx = town();
    const { state } = ctx;
    must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 70, y: 50 })); // remote: no town within 30
    const upkeep = () => {
      const m = state.companies.player.money;
      maintenanceMonth(ctx);
      return m - state.companies.player.money;
    };
    const base = upkeep();
    expect(base).toBe(600);
    state.cities[0].politics.edicts = ['minimum_wage'];
    expect(upkeep()).toBe(Math.round(300 * 1.1 + 300));
    state.politics.edicts.wage = 'low';
    // low counts as fair in the minimum-wage town, still low elsewhere
    expect(upkeep()).toBe(Math.round(300 * 1.1 + 300 * 0.85));
    state.politics.edicts.wage = 'generous';
    expect(upkeep()).toBe(Math.round(300 * 1.25 * 1.1 + 300 * 1.25));
  });
});

describe('Old Money credit', () => {
  it('loanRate is 0.06 at 50 and 0.09 at 0', () => {
    const { state } = town();
    expect(loanRate(state)).toBeCloseTo(0.06, 12);
    setOpinion(state, state.cities[0], 'oldmoney', 0);
    expect(loanRate(state)).toBeCloseTo(0.09, 12);
    setOpinion(state, state.cities[0], 'oldmoney', 100);
    expect(loanRate(state)).toBeCloseTo(0.03, 12);
  });

  it('closeMonth charges the given rate, LOAN_RATE by default', () => {
    const { state } = town();
    const c = state.companies.player;
    c.loan = 120000;
    expect(closeMonth(c, state.date).interest).toBe(Math.round((120000 * LOAN_RATE) / 12));
    expect(closeMonth(c, state.date, 0.09).interest).toBe(900);
  });
});
