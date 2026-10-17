import { describe, expect, it } from 'vitest';
import { GRUDGE_WEIGHTS } from '../../data/nemesis';
import { checkInvariants } from '../invariants';
import { notePoliticsSale } from '../politics/factions';
import { recordSale } from '../scenarios';
import { runDays } from '../simulation';
import { createGame, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Contract } from '../types';
import { RETALIATE_AT } from './retaliation';
import { netWorth } from '../rival/takeover';
import { addGrudge, baronMood, RIVALRY_SHARE, GRUDGE_CAP, GRUDGE_DECAY, grudgesYear, grudgeTotal, nemesisMonth, salesGrudges } from './grudges';

function twoTowns() {
  return testCtx(testState({ width: 60, height: 30, money: 1e7, cities: [{ x: 10, y: 10, population: 6000 }, { x: 45, y: 15, population: 2000 }] }));
}

/** Both companies sold coal in town 0 this month, at equal revenue (an undercut, not a rout). */
function contestCoal(ctx: ReturnType<typeof twoTowns>): void {
  recordSale(ctx.state, { ownerId: 'player', cityId: 0, goodId: 'coal', qty: 5 });
  recordSale(ctx.state, { ownerId: 'rival', cityId: 0, goodId: 'coal', qty: 5 });
  notePoliticsSale(ctx.state, 'player', 0, 100);
  notePoliticsSale(ctx.state, 'rival', 0, 100);
}

const contract = (id: number, cityId: number, status: Contract['status']): Contract => ({
  id, cityId, goodId: 'coal', qty: 10, delivered: 10, deadline: { year: 1901, month: 1, day: 1, hour: 0 }, reward: 1000, status,
});

describe('nemesis state', () => {
  it('a new game rolls 2 distinct traits for Baron Cornelius, with no grudges', () => {
    const s = createGame({ seed: 7 });
    expect(s.nemesis.traits).toHaveLength(2);
    expect(new Set(s.nemesis.traits).size).toBe(2);
    expect(s.nemesis.head).toEqual({ name: 'Baron Cornelius Smogsworth', born: 1852, generation: 1 });
    expect(s.nemesis.grudges).toEqual([]);
    expect(grudgeTotal(s)).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });
  it('the traits follow the seed', () => {
    const rolls = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => createGame({ seed }).nemesis.traits.join(',')));
    expect(rolls.size).toBeGreaterThan(1);
    expect(createGame({ seed: 3 }).nemesis.traits).toEqual(createGame({ seed: 3 }).nemesis.traits);
  });
});

describe('addGrudge', () => {
  it('records the kind weight × scale, the year and the city', () => {
    const ctx = twoTowns();
    addGrudge(ctx.state, 'contract', 1);
    addGrudge(ctx.state, 'shares', null, 0.5);
    expect(ctx.state.nemesis.grudges).toEqual([
      { kind: 'contract', weight: GRUDGE_WEIGHTS.contract, year: 1900, cityId: 1 },
      { kind: 'shares', weight: GRUDGE_WEIGHTS.shares * 0.5, year: 1900, cityId: null },
    ]);
    expect(grudgeTotal(ctx.state)).toBe(3 + 2);
  });
  it(`caps the ledger at ${GRUDGE_CAP} by dropping the lightest grudge`, () => {
    const ctx = twoTowns();
    for (let i = 0; i < GRUDGE_CAP; i++) addGrudge(ctx.state, 'city', 0);
    addGrudge(ctx.state, 'undercut', 0);
    expect(ctx.state.nemesis.grudges).toHaveLength(GRUDGE_CAP);
    expect(ctx.state.nemesis.grudges.some((g) => g.kind === 'undercut')).toBe(false);
    addGrudge(ctx.state, 'takeover_bid', null);
    expect(ctx.state.nemesis.grudges).toHaveLength(GRUDGE_CAP);
    expect(ctx.state.nemesis.grudges.filter((g) => g.kind === 'takeover_bid')).toHaveLength(1);
    expect(grudgeTotal(ctx.state)).toBe((GRUDGE_CAP - 1) * 5 + 8);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
  it('an inactive Baron collects no grudges', () => {
    const ctx = twoTowns();
    ctx.state.companies.rival.active = false;
    addGrudge(ctx.state, 'city', 0);
    expect(ctx.state.nemesis.grudges).toEqual([]);
  });
});

describe('grudge invariants', () => {
  it('flag a weight that is not finite and > 0, and a ledger over the cap', () => {
    const ctx = twoTowns();
    ctx.state.nemesis.grudges.push({ kind: 'city', weight: NaN, year: 1900, cityId: 0 }, { kind: 'city', weight: 0, year: 1900, cityId: 0 });
    for (let i = 0; i < GRUDGE_CAP; i++) ctx.state.nemesis.grudges.push({ kind: 'undercut', weight: 2, year: 1900, cityId: 0 });
    const msgs = checkInvariants(ctx.state);
    expect(msgs.filter((m) => m.startsWith('nemesis:'))).toHaveLength(3);
  });
});

describe('grudgesYear', () => {
  it(`decays every weight by ${GRUDGE_DECAY} and forgets those under 0.5`, () => {
    const ctx = twoTowns();
    ctx.state.companies.rival.money = 1e12; // no rivalry grudge (see 'rivalry')
    addGrudge(ctx.state, 'undercut', 0, 5); // 10
    addGrudge(ctx.state, 'undercut', 0, 0.3); // 0.6 -> 0.48, dropped
    grudgesYear(ctx);
    expect(ctx.state.nemesis.grudges).toEqual([{ kind: 'undercut', weight: 8, year: 1900, cityId: 0 }]);
  });
});

describe('rivalry', () => {
  const worth = (ctx: ReturnType<typeof twoTowns>, player: number, baron: number) => {
    ctx.state.companies.player.money = player;
    ctx.state.companies.rival.money = baron;
    expect(netWorth(ctx.state, 'player')).toBe(player);
    expect(netWorth(ctx.state, 'rival')).toBe(baron);
  };
  const rivalries = (ctx: ReturnType<typeof twoTowns>) => ctx.state.nemesis.grudges.filter((g) => g.kind === 'rivalry').map((g) => g.weight);
  it(`December: a player worth at least ${RIVALRY_SHARE} of the Baron adds a rivalry grudge, after the decay`, () => {
    const ctx = twoTowns();
    worth(ctx, 500_000, 1_000_000);
    addGrudge(ctx.state, 'undercut', 0); // 2 -> 1.6
    grudgesYear(ctx);
    expect(ctx.state.nemesis.grudges).toEqual([
      { kind: 'undercut', weight: 1.6, year: 1900, cityId: 0 },
      { kind: 'rivalry', weight: GRUDGE_WEIGHTS.rivalry, year: 1900, cityId: null },
    ]);
  });
  it('doubles once the player is worth more than the Baron', () => {
    const ctx = twoTowns();
    worth(ctx, 1_000_001, 1_000_000);
    grudgesYear(ctx);
    expect(rivalries(ctx)).toEqual([2 * GRUDGE_WEIGHTS.rivalry]);
    const eq = twoTowns();
    worth(eq, 1_000_000, 1_000_000);
    grudgesYear(eq);
    expect(rivalries(eq)).toEqual([GRUDGE_WEIGHTS.rivalry]);
  });
  it('none while the Baron is worth nothing or less', () => {
    for (const baron of [0, -500_000]) {
      const ctx = twoTowns();
      worth(ctx, 1_000_000, baron);
      grudgesYear(ctx);
      expect(rivalries(ctx), String(baron)).toEqual([]);
    }
  });
  it('none below half his worth, and none while he is out', () => {
    const ctx = twoTowns();
    worth(ctx, 499_999, 1_000_000);
    grudgesYear(ctx);
    expect(rivalries(ctx)).toEqual([]);
    const out = twoTowns();
    worth(out, 2_000_000, 1_000_000);
    out.state.companies.rival.active = false;
    grudgesYear(out);
    expect(rivalries(out)).toEqual([]);
  });
});

describe('grudge causes', () => {
  it('undercut: both sold a good in a town, once per town per month', () => {
    const ctx = twoTowns();
    contestCoal(ctx);
    recordSale(ctx.state, { ownerId: 'player', cityId: 0, goodId: 'lumber', qty: 5 });
    recordSale(ctx.state, { ownerId: 'rival', cityId: 0, goodId: 'lumber', qty: 5 });
    salesGrudges(ctx.state);
    expect(ctx.state.nemesis.grudges.map((g) => [g.kind, g.cityId])).toEqual([['undercut', 0]]);
  });
  it('city: the player outsells the Baron more than 2 to 1 in a town, once per town per year', () => {
    const ctx = twoTowns();
    notePoliticsSale(ctx.state, 'player', 1, 300);
    notePoliticsSale(ctx.state, 'rival', 1, 100);
    // a town the Baron does not sell in is no grudge, nor is a lead of exactly 2 to 1
    notePoliticsSale(ctx.state, 'player', 0, 200);
    salesGrudges(ctx.state);
    expect(ctx.state.nemesis.grudges.map((g) => [g.kind, g.cityId])).toEqual([['city', 1]]);
    ctx.state.politics.track.sales = {};
    notePoliticsSale(ctx.state, 'player', 1, 300);
    notePoliticsSale(ctx.state, 'rival', 1, 100);
    salesGrudges(ctx.state);
    expect(ctx.state.nemesis.grudges).toHaveLength(1);
    ctx.state.date.year = 1901;
    salesGrudges(ctx.state);
    expect(ctx.state.nemesis.grudges.map((g) => [g.kind, g.cityId, g.year])).toEqual([['city', 1, 1900], ['city', 1, 1901]]);
  });
  it('city: a 2-to-1 lead exactly is not enough', () => {
    const ctx = twoTowns();
    notePoliticsSale(ctx.state, 'player', 0, 200);
    notePoliticsSale(ctx.state, 'rival', 0, 100);
    salesGrudges(ctx.state);
    expect(ctx.state.nemesis.grudges).toEqual([]);
  });
  it('contract: a contract finished in a town where the Baron keeps a store, counted once', () => {
    const ctx = twoTowns();
    const store = must(placeBuilding(ctx, 'rival', 'store', { x: 12, y: 12 }));
    expect(store.cityId).toBe(0);
    ctx.state.contracts.push(contract(1, 0, 'done'), contract(2, 1, 'done'), contract(3, 0, 'failed'), contract(4, 0, 'active'));
    nemesisMonth(ctx);
    expect(ctx.state.nemesis.grudges.map((g) => [g.kind, g.cityId])).toEqual([['contract', 0]]);
    nemesisMonth(ctx);
    expect(ctx.state.nemesis.grudges).toHaveLength(1);
    ctx.state.contracts[3].status = 'done';
    nemesisMonth(ctx);
    expect(ctx.state.nemesis.grudges.map((g) => [g.kind, g.cityId])).toEqual([['contract', 0], ['contract', 0]]);
  });
  it('an inactive Baron collects no grudges from any cause', () => {
    const ctx = twoTowns();
    ctx.state.companies.rival.active = false;
    must(placeBuilding(ctx, 'rival', 'store', { x: 12, y: 12 }));
    ctx.state.contracts.push(contract(1, 0, 'done'));
    contestCoal(ctx);
    notePoliticsSale(ctx.state, 'player', 1, 300);
    notePoliticsSale(ctx.state, 'rival', 1, 100);
    salesGrudges(ctx.state);
    nemesisMonth(ctx);
    expect(ctx.state.nemesis.grudges).toEqual([]);
  });
  it('in the running sim, a contested month adds one undercut grudge and a quiet month none', () => {
    const ctx = twoTowns();
    ctx.state.date = { year: 1900, month: 4, day: 30, hour: 0 };
    contestCoal(ctx);
    runDays(ctx, 1);
    expect(ctx.state.date.month).toBe(5);
    expect(ctx.state.nemesis.grudges.map((g) => [g.kind, g.cityId])).toEqual([['undercut', 0]]);
    // the month's seller flags and sales tallies are gone, so the next month adds nothing
    runDays(ctx, 31);
    expect(ctx.state.nemesis.grudges).toHaveLength(1);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
});

describe('baronMood', () => {
  const at = (kind: 'undercut', weight: number) => ({ kind, weight, year: 1900, cityId: null });
  it('is smug, scheming at RETALIATE_AT, furious at 12', () => {
    const s = createGame({ seed: 7 });
    expect(baronMood(s)).toBe('smug');
    s.nemesis.grudges = [at('undercut', RETALIATE_AT - 0.01)];
    expect(baronMood(s)).toBe('smug');
    s.nemesis.grudges = [at('undercut', RETALIATE_AT)];
    expect(baronMood(s)).toBe('scheming');
    s.nemesis.grudges = [at('undercut', 6), at('undercut', 5.99)];
    expect(baronMood(s)).toBe('scheming');
    s.nemesis.grudges = [at('undercut', 6), at('undercut', 6)];
    expect(baronMood(s)).toBe('furious');
  });
  it('gloats for 2 months after a strike, whatever his grudges', () => {
    const s = createGame({ seed: 7 });
    s.nemesis.grudges = [at('undercut', 20)];
    s.date = { year: 1910, month: 11, day: 5, hour: 9 };
    s.nemesis.lastAction = { kind: 'smear', year: 1910, month: 11 };
    expect(baronMood(s)).toBe('gloating');
    s.date = { year: 1911, month: 1, day: 30, hour: 9 };
    expect(baronMood(s)).toBe('gloating');
    s.date = { year: 1911, month: 2, day: 1, hour: 0 };
    expect(baronMood(s)).toBe('furious');
    s.nemesis.grudges = [];
    expect(baronMood(s)).toBe('smug');
  });
});
