import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import { unpackState } from '../../game/saves';
import { checkInvariants } from '../invariants';
import { runDays } from '../simulation';
import phase3 from '../__fixtures__/phase3.save.json?raw';
import { runAutoplay } from '../../game/autoplay';
import { companyIds } from '../companies';
import { BANKRUPT_MONTHS } from '../finance';
import { salesGrudges, noteContested } from '../nemesis/grudges';
import { notePoliticsSale } from '../politics/factions';
import { recordSale, sellersInclude } from '../scenarios';
import { atPrices } from '../society/economy';
import { createGame } from '../state';
import { stateHash } from '../hash';
import { testCtx, testState } from '../testkit';
import type { GameState, SimContext, Terrain } from '../types';
import { REGIONAL_FIRMS, REGIONAL_START_MONEY, regionalMonth } from './firms';

const fresh = (seed = 42): SimContext => ({ state: createGame({ seed }), bus: new EventBus() });

/** Runs the regional system's January hook of `year`. */
function january(ctx: SimContext, year: number): void {
  ctx.state.date = { year, month: 1, day: 30, hour: 23 };
  regionalMonth(ctx);
}

const largest = (state: GameState) => [...state.cities].sort((a, b) => b.population - a.population || a.id - b.id)[0];
const owned = (state: GameState, id: string) => ({
  buildings: Object.values(state.buildings).filter((b) => b.ownerId === id),
  routes: Object.values(state.routes).filter((r) => r.ownerId === id),
  vehicles: Object.values(state.vehicles).filter((v) => v.ownerId === id),
});

describe('regional firms', () => {
  it('schedule: furniture 1905, clothes 1920, cheese 1935', () => {
    expect(REGIONAL_FIRMS.map((f) => [f.id, f.year, f.chain])).toEqual([
      ['regional_1', 1905, 'furniture'],
      ['regional_2', 1920, 'clothes'],
      ['regional_3', 1935, 'cheese'],
    ]);
  });

  it('none before 1905; in 1905 the first is founded in the largest city, owning its chain', () => {
    const ctx = fresh();
    const { state } = ctx;
    january(ctx, 1904);
    expect(state.companies.regional_1).toBeUndefined();
    const city = largest(state);
    january(ctx, 1905);
    const c = state.companies.regional_1;
    expect(c).toBeDefined();
    expect(c.kind).toBe('regional');
    expect(c.active).toBe(true);
    expect(c.homeCityId).toBe(city.id);
    expect(c.name).toBe(`${city.name} Mercantile`);
    const { buildings, routes, vehicles } = owned(state, 'regional_1');
    expect(buildings.map((b) => b.typeId).sort()).toEqual(['furniture_factory', 'lumber_camp', 'sawmill', 'store']);
    expect(buildings.find((b) => b.typeId === 'store')!.cityId).toBe(city.id);
    expect(routes).toHaveLength(3);
    expect(vehicles).toHaveLength(3);
    // paid for with its own money: what it spent is what its ledger shows, from the 150,000 start
    const start = atPrices(state, REGIONAL_START_MONEY);
    const m = c.ledger.at(-1)!;
    const spent = Object.values(m.expense).reduce((t, n) => t + (n ?? 0), 0);
    expect(c.money + spent - c.loan).toBe(start);
    // one firm per year, and not again
    january(ctx, 1906);
    expect(Object.keys(state.companies)).toHaveLength(3);
  });

  it("passes over a town where its good is already sold (the player's furniture), for the next largest", () => {
    const ctx = fresh();
    const { state } = ctx;
    const r = runAutoplay(ctx);
    expect(r.ok).toBe(true);
    const playerTown = r.ok ? r.value.at(-1)!.cityId : null;
    expect(playerTown).toBe(largest(state).id);
    january(ctx, 1905);
    const next = [...state.cities].sort((a, b) => b.population - a.population || a.id - b.id)[1];
    expect(state.companies.regional_1.homeCityId).toBe(next.id);
  });

  it('companyIds order is player, rival, regional_1…3; each firm in a different city', () => {
    const ctx = fresh();
    for (const y of [1905, 1920, 1935]) january(ctx, y);
    expect(companyIds(ctx.state)).toEqual(['player', 'rival', 'regional_1', 'regional_2', 'regional_3']);
    const homes = ['regional_1', 'regional_2', 'regional_3'].map((id) => ctx.state.companies[id].homeCityId);
    expect(new Set(homes).size).toBe(3);
    expect(owned(ctx.state, 'regional_2').buildings.map((b) => b.recipeId).sort()).toEqual([null, 'r_clothes', 'r_cotton', 'r_fabric']);
    expect(owned(ctx.state, 'regional_3').buildings.map((b) => b.recipeId).sort()).toEqual([null, 'r_cheese', 'r_milk']);
  });

  it('a firm that cannot build leaves no trace and retries the next year', () => {
    const ctx = fresh();
    const { state } = ctx;
    // no forest anywhere: the lumber camp has no site
    const forest: number[] = [];
    state.map.tiles.forEach((t, i) => {
      if (t.terrain === 'forest') {
        forest.push(i);
        t.terrain = 'mountain' as Terrain;
      }
    });
    state.date = { year: 1905, month: 1, day: 30, hour: 23 };
    const before = stateHash(state);
    regionalMonth(ctx);
    expect(state.companies.regional_1).toBeUndefined();
    expect(stateHash(state)).toBe(before);
    for (const i of forest) state.map.tiles[i].terrain = 'forest';
    january(ctx, 1906);
    expect(state.companies.regional_1?.active).toBe(true);
    expect(state.companies.regional_1.ledger.at(-1)!.year).toBe(1906);
  });

  it('a late start (or a migrated 1950 save) founds the missed firms one per year', () => {
    const ctx = fresh();
    january(ctx, 1951);
    expect(companyIds(ctx.state)).toEqual(['player', 'rival', 'regional_1']);
    january(ctx, 1952);
    january(ctx, 1953);
    expect(companyIds(ctx.state)).toEqual(['player', 'rival', 'regional_1', 'regional_2', 'regional_3']);
  });

  it('a migrated save (phase 3 fixture, moved to 1951) founds one firm at the end of January, then holds invariants', () => {
    const r = unpackState(phase3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ctx: SimContext = { state: r.value, bus: new EventBus() };
    expect(companyIds(ctx.state)).toEqual(['player', 'rival']);
    ctx.state.date = { year: 1951, month: 1, day: 29, hour: 0 };
    runDays(ctx, 3);
    expect(companyIds(ctx.state)).toEqual(['player', 'rival', 'regional_1']);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it(`a firm ${BANKRUPT_MONTHS} months in the red goes inactive and leaves no buildings, routes or vehicles`, () => {
    const ctx = fresh();
    const { state } = ctx;
    january(ctx, 1905);
    const c = state.companies.regional_1;
    c.money = -500_000;
    c.monthsInRed = BANKRUPT_MONTHS;
    state.date = { year: 1905, month: 7, day: 30, hour: 23 };
    regionalMonth(ctx);
    expect(c.active).toBe(false);
    const { buildings, routes, vehicles } = owned(state, 'regional_1');
    expect([buildings.length, routes.length, vehicles.length]).toEqual([0, 0, 0]);
    // an inactive firm does nothing more
    const money = c.money;
    regionalMonth(ctx);
    expect(c.money).toBe(money);
  });

  it('a firm short of cash borrows, like the Baron', () => {
    const ctx = fresh();
    january(ctx, 1905);
    const c = ctx.state.companies.regional_1;
    c.money = 1000;
    ctx.state.date = { year: 1905, month: 3, day: 30, hour: 23 };
    regionalMonth(ctx);
    expect(c.loan).toBeGreaterThan(0);
  });
});

describe('a third seller in town', () => {
  function threeSellers() {
    const ctx = testCtx(testState({ width: 60, height: 30, money: 1e7, cities: [{ x: 10, y: 10, population: 6000 }] }));
    return ctx;
  }

  it('the seller flag knows the player and the Baron both sold, whoever else did', () => {
    const { state } = threeSellers();
    recordSale(state, { ownerId: 'player', cityId: 0, goodId: 'coal', qty: 5 });
    recordSale(state, { ownerId: 'regional_1', cityId: 0, goodId: 'coal', qty: 5 });
    expect(sellersInclude(state, 0, 'coal', 'player', 'rival')).toBe(false);
    recordSale(state, { ownerId: 'rival', cityId: 0, goodId: 'coal', qty: 5 });
    expect(sellersInclude(state, 0, 'coal', 'player', 'rival')).toBe(true);
    recordSale(state, { ownerId: 'player', cityId: 0, goodId: 'wood', qty: 5 });
    expect(state.flags['seller:0:wood']).toBe('player');
  });

  it('a regional firm selling beside the player is no undercut by the Baron', () => {
    const ctx = threeSellers();
    const { state } = ctx;
    // the player and a regional firm sell coal; the Baron sells only wood there
    recordSale(state, { ownerId: 'player', cityId: 0, goodId: 'coal', qty: 5 });
    recordSale(state, { ownerId: 'regional_1', cityId: 0, goodId: 'coal', qty: 5 });
    recordSale(state, { ownerId: 'rival', cityId: 0, goodId: 'wood', qty: 5 });
    notePoliticsSale(state, 'player', 0, 100);
    notePoliticsSale(state, 'regional_1', 0, 100);
    notePoliticsSale(state, 'rival', 0, 100);
    // regional takings are ignored by politics
    expect(state.politics.track.sales['0']).toEqual({ player: 100, baron: 100 });
    salesGrudges(state);
    noteContested(state);
    expect(state.nemesis.grudges.some((g) => g.kind === 'undercut')).toBe(false);
    expect(state.nemesis.track.contested).toEqual([]);
  });
});
