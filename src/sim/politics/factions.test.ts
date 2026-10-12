import { describe, expect, it } from 'vitest';
import { FACTION_IDS } from '../../data/factions';
import { checkInvariants } from '../invariants';
import { runDays } from '../simulation';
import { demolishBuilding, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import { adjustOpinion, factionsMonth, nationalOpinion, notePoliticsSale } from './factions';

function twoTowns() {
  return testCtx(testState({ width: 60, height: 30, money: 1e7, cities: [{ x: 10, y: 10, population: 6000 }, { x: 45, y: 15, population: 2000 }] }));
}

describe('faction opinion', () => {
  it('a new town starts at 50, the Baron at 35', () => {
    const ctx = twoTowns();
    expect(ctx.state.cities[0].opinion).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
  });

  it('drifts 2% toward 50 each month', () => {
    const ctx = twoTowns();
    const c = ctx.state.cities[0];
    adjustOpinion(ctx.state, 'church', 0, 40, 'test');
    expect(c.opinion.church).toBe(90);
    factionsMonth(ctx);
    expect(c.opinion.church).toBeCloseTo(89.2, 10);
    expect(c.opinion.baron).toBeCloseTo(35.3, 10);
  });

  it('clamps to [0, 100]', () => {
    const ctx = twoTowns();
    const c = ctx.state.cities[0];
    adjustOpinion(ctx.state, 'workers', 0, 500, 'up');
    expect(c.opinion.workers).toBe(100);
    adjustOpinion(ctx.state, 'workers', 0, -500, 'down');
    expect(c.opinion.workers).toBe(0);
  });

  it("'national' touches every city", () => {
    const ctx = twoTowns();
    adjustOpinion(ctx.state, 'reformers', 'national', -10, 'smog');
    expect(ctx.state.cities.map((c) => c.opinion.reformers)).toEqual([40, 40]);
    expect(ctx.state.politics.log.at(-1)).toEqual({ date: ctx.state.date, faction: 'reformers', scope: 'national', delta: -10, reason: 'smog' });
  });

  it('nationalOpinion is weighted by population', () => {
    const ctx = twoTowns();
    adjustOpinion(ctx.state, 'workers', 0, 30, 'a'); // 80 in a town of 6000
    adjustOpinion(ctx.state, 'workers', 1, -30, 'b'); // 20 in a town of 2000
    expect(nationalOpinion(ctx.state, 'workers')).toBeCloseTo((80 * 6000 + 20 * 2000) / 8000, 10);
  });

  it('caps the log at 200 entries, oldest dropped, and skips tiny changes', () => {
    const ctx = twoTowns();
    for (let i = 0; i < 205; i++) adjustOpinion(ctx.state, 'church', 0, 1, `r${i}`);
    adjustOpinion(ctx.state, 'church', 0, 0.4, 'tiny');
    const log = ctx.state.politics.log;
    expect(log.length).toBe(200);
    expect(log[0].reason).toBe('r5');
    expect(log.at(-1)!.reason).toBe('r204');
  });

  it('smog costs reformers 4x and workers 2x the city pollution', () => {
    const ctx = twoTowns();
    const c = ctx.state.cities[0];
    // pollution is written only by pollution.ts; set it the way a test fixture would
    Object.assign(c, { pollution: 0.5 });
    factionsMonth(ctx);
    expect(c.opinion.reformers).toBeCloseTo(48, 10);
    expect(c.opinion.workers).toBeCloseTo(49, 10);
    expect(ctx.state.politics.log).toEqual([]); // ambient drivers are not logged
  });

  it('adjustOpinion with { log: false } applies the change without logging it', () => {
    const ctx = twoTowns();
    adjustOpinion(ctx.state, 'church', 0, 5, 'quiet', { log: false });
    expect(ctx.state.cities[0].opinion.church).toBe(55);
    expect(ctx.state.politics.log).toEqual([]);
  });

  it("the Baron's Circle loses 1 where the player outsells the Baron", () => {
    const ctx = twoTowns();
    notePoliticsSale(ctx.state, 'player', 0, 500);
    notePoliticsSale(ctx.state, 'rival', 0, 400);
    notePoliticsSale(ctx.state, 'rival', 1, 400);
    factionsMonth(ctx);
    expect(ctx.state.cities[0].opinion.baron).toBeCloseTo(35.3 - 0.4, 10);
    expect(ctx.state.politics.log).toEqual([]);
    expect(ctx.state.cities[1].opinion.baron).toBeCloseTo(35.3, 10);
    // sales reset each month
    factionsMonth(ctx);
    expect(ctx.state.cities[1].opinion.baron).toBeGreaterThan(35.3);
    expect(Object.keys(ctx.state.politics.track.sales)).toEqual([]);
  });

  it("300 months of a constant player lead keep the Baron's Circle at 25 or above (it settles at 30)", () => {
    const ctx = twoTowns();
    for (let m = 0; m < 300; m++) {
      notePoliticsSale(ctx.state, 'player', 0, 1000);
      notePoliticsSale(ctx.state, 'rival', 0, 10);
      factionsMonth(ctx);
      expect(ctx.state.cities[0].opinion.baron).toBeGreaterThanOrEqual(25);
    }
    expect(ctx.state.cities[0].opinion.baron).toBeCloseTo(30, 0);
  });

  it('a player factory near a town raises workers by 2 the next month; removing it lowers them by 4', () => {
    const ctx = twoTowns();
    const c = ctx.state.cities[0];
    const far = ctx.state.cities[1];
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 18, y: 9 }, 'r_lumber'));
    factionsMonth(ctx);
    expect(c.opinion.workers).toBeCloseTo(52, 10);
    expect(c.opinion.reformers).toBeCloseTo(49, 10); // the sawmill pollutes
    expect(far.opinion.workers).toBe(50);
    factionsMonth(ctx);
    expect(c.opinion.workers).toBeCloseTo(52 - 0.04, 10); // counted once only
    must(demolishBuilding(ctx, b.id, 'player'));
    factionsMonth(ctx);
    expect(c.opinion.workers).toBeCloseTo((52 - 0.04) * 0.98 + 1 - 4, 10);
    expect(far.opinion.workers).toBe(50);
  });

  it("a Baron building does not count, and a migrated save's existing buildings are not new", () => {
    const ctx = twoTowns();
    must(placeBuilding(ctx, 'rival', 'sawmill', { x: 18, y: 9 }, 'r_lumber'));
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 9, y: 18 }, 'r_lumber'));
    ctx.state.politics.track.primed = false;
    factionsMonth(ctx);
    expect(ctx.state.cities[0].opinion.workers).toBe(50);
  });

  it('a finished contract moves workers and church (done) or Old Money (failed), once', () => {
    const ctx = twoTowns();
    const base = { goodId: 'furniture', qty: 10, delivered: 10, deadline: { year: 1901, month: 1, day: 1, hour: 0 }, reward: 1000 };
    ctx.state.contracts.push({ ...base, id: 900, cityId: 0, status: 'done' }, { ...base, id: 901, cityId: 1, status: 'failed' });
    factionsMonth(ctx);
    factionsMonth(ctx);
    const [a, b] = ctx.state.cities;
    expect(a.opinion.workers).toBeCloseTo(51 * 0.98 + 1, 10);
    expect(a.opinion.church).toBeCloseTo(51 * 0.98 + 1, 10);
    expect(b.opinion.oldmoney).toBeCloseTo(48 * 0.98 + 1, 10);
  });

  it('the politics system runs monthly and keeps the state healthy', () => {
    const ctx = twoTowns();
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 18, y: 9 }, 'r_lumber'));
    runDays(ctx, 30);
    expect(ctx.state.cities[0].opinion.workers).toBeGreaterThan(51);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('checkInvariants reports an opinion that is out of range or not finite', () => {
    const ctx = twoTowns();
    const op = ctx.state.cities[1].opinion as Record<string, number>;
    op.church = 101;
    op.baron = NaN;
    const msgs = checkInvariants(ctx.state);
    expect(msgs.some((m) => m.includes('church') && m.includes('101'))).toBe(true);
    expect(msgs.some((m) => m.includes('baron') && m.includes('NaN'))).toBe(true);
    expect(FACTION_IDS.length).toBe(5);
  });
});
