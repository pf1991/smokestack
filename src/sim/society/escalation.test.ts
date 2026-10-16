import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import { migrateSave } from '../migrations';
import { monthlyGrowth } from '../market';
import { growthMonth, productionDay } from '../production';
import { placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { City, SimContext, SmogTier } from '../types';
import { voteShares } from '../politics/elections';
import { adjustOpinion } from '../politics/factions';
import { activeEdicts, chooseMayorEdicts, hasEdict } from '../politics/mayorEdicts';
import { laborPool } from '../politics/workforce';
import {
  blackLungDeaths,
  escalationMonth,
  growthPenalty,
  healthFactor,
  nationalBlackLung,
  protestedBuildings,
  protestSite,
  SMOG_TIER_1,
  SMOG_TIER_2,
  SMOG_TIER_3,
  SMOG_TIER_4,
  SMOG_TIER_THRESHOLDS,
  stepSmogTier,
} from './escalation';

/** A town at (20,20), pop 6000: urbanRadius 7, so its zone reaches 11 tiles from the centre. */
function town(population = 6000): SimContext {
  return testCtx(testState({ width: 80, height: 60, money: 1e7, cities: [{ x: 20, y: 20, population }] }));
}
const NEAR = { x: 29, y: 19 };
const RURAL = { x: 40, y: 19 };

/** Runs `n` monthly steps with the town's pollution held at `p` (the EMA converges onto it). */
function months(city: City, p: number, n: number): void {
  for (let i = 0; i < n; i++) {
    city.pollution = p;
    stepSmogTier(city);
  }
}

/** Puts a town at `tier` with its level just above that tier's threshold. */
function atTier(city: City, tier: SmogTier): City {
  city.smog = { tier, months: 0, blackLung: 0, level: tier === 0 ? 0 : SMOG_TIER_THRESHOLDS[tier] + 0.005 };
  city.pollution = city.smog.level;
  return city;
}

describe('thresholds (ruling R-S2)', () => {
  it('are 0.03 / 0.06 / 0.10 / 0.135 on the level', () => {
    expect([SMOG_TIER_1, SMOG_TIER_2, SMOG_TIER_3, SMOG_TIER_4]).toEqual([0.03, 0.06, 0.1, 0.135]);
    expect(SMOG_TIER_THRESHOLDS).toEqual([0, 0.03, 0.06, 0.1, 0.135]);
  });

  it('the level is a monthly EMA: level = 0.5 × level + 0.5 × pollution', () => {
    const city = town().state.cities[0];
    city.smog.level = 0.02;
    city.pollution = 0.1;
    stepSmogTier(city);
    expect(city.smog.level).toBeCloseTo(0.06, 12);
  });
});

describe('tier entry and exit', () => {
  it('enters a tier only after 3 consecutive months above its threshold', () => {
    const city = town().state.cities[0];
    city.smog.level = 0.05;
    months(city, 0.05, 2);
    expect(city.smog.tier).toBe(0);
    expect(city.smog.months).toBe(2);
    months(city, 0.05, 1);
    expect(city.smog.tier).toBe(1);
    expect(city.smog.months).toBe(0);
  });

  it('a dip below the threshold resets the streak', () => {
    const city = town().state.cities[0];
    city.smog.level = 0.05;
    months(city, 0.05, 2);
    // one clean month drags the level under 0.03
    months(city, 0, 1);
    expect(city.smog.level).toBeLessThan(SMOG_TIER_1);
    expect(city.smog.months).toBe(0);
    city.smog.level = 0.05;
    months(city, 0.05, 2);
    expect(city.smog.tier).toBe(0);
  });

  it('climbs one tier per streak, never jumping', () => {
    const city = town().state.cities[0];
    city.smog.level = 0.3;
    months(city, 0.3, 3);
    expect(city.smog.tier).toBe(1);
    months(city, 0.3, 3);
    expect(city.smog.tier).toBe(2);
    months(city, 0.3, 6);
    expect(city.smog.tier).toBe(4);
    months(city, 0.3, 6);
    expect(city.smog.tier).toBe(4);
  });

  it('leaves a tier only after 3 consecutive months below 80% of its threshold', () => {
    const city = atTier(town().state.cities[0], 2);
    // between 0.8 × 0.06 = 0.048 and 0.06: held, no streak either way
    city.smog.level = 0.05;
    months(city, 0.05, 12);
    expect(city.smog.tier).toBe(2);
    expect(city.smog.months).toBe(0);
    city.smog.level = 0.04;
    months(city, 0.04, 2);
    expect(city.smog.tier).toBe(2);
    expect(city.smog.months).toBe(-2);
    months(city, 0.04, 1);
    expect(city.smog.tier).toBe(1);
    // 0.04 is above tier 1's exit (0.024): it stays at 1
    months(city, 0.04, 12);
    expect(city.smog.tier).toBe(1);
  });

  it('eases all the way back to clean when smog falls (never locks a town out)', () => {
    const city = atTier(town().state.cities[0], 4);
    months(city, 0, 12);
    expect(city.smog.tier).toBe(0);
  });
});

describe('tier effects stack', () => {
  it('tier 0 does nothing', () => {
    const ctx = town();
    const city = ctx.state.cities[0];
    const before = { ...city.opinion };
    escalationMonth(ctx);
    expect(city.opinion).toEqual(before);
    expect(healthFactor(city)).toBe(1);
    expect(growthPenalty(city)).toBe(0);
    expect(ctx.state.news).toHaveLength(0);
  });

  it('tier 1: reformers −0.3 and workers −0.2 a month, unlogged; one editorial a year', () => {
    const ctx = town();
    const city = atTier(ctx.state.cities[0], 1);
    const r = city.opinion.reformers;
    const w = city.opinion.workers;
    const log = ctx.state.politics.log.length;
    escalationMonth(ctx);
    expect(city.opinion.reformers).toBeCloseTo(r - 0.3, 12);
    expect(city.opinion.workers).toBeCloseTo(w - 0.2, 12);
    expect(ctx.state.politics.log.length).toBe(log);
    expect(ctx.state.news.filter((n) => n.kind === 'warning')).toHaveLength(1);
    escalationMonth(ctx);
    expect(ctx.state.news.filter((n) => n.kind === 'warning')).toHaveLength(1);
    ctx.state.date.year++;
    escalationMonth(ctx);
    expect(ctx.state.news.filter((n) => n.kind === 'warning')).toHaveLength(2);
    // no tier-2 effects yet
    expect(city.smog.blackLung).toBe(0);
    expect(healthFactor(city)).toBe(1);
    expect(growthPenalty(city)).toBe(0);
  });

  it('tier 2 adds Black Lung, the growth penalty and the workforce health factor', () => {
    const ctx = town(20000);
    const city = atTier(ctx.state.cities[0], 2);
    const r = city.opinion.reformers;
    escalationMonth(ctx);
    const pool1 = laborPool({ ...city, smog: { ...city.smog, tier: 1 } });
    expect(city.opinion.reformers).toBeCloseTo(r - 0.6, 12); // the drift scales with the tier (R-S4)
    expect(city.smog.blackLung).toBe(Math.round(20000 * city.smog.level * 0.004));
    expect(growthPenalty(city)).toBe(0.004);
    // level ≈ 0.065: h = 0.325, factor 1 − 0.1625
    expect(healthFactor(city)).toBeCloseTo(1 - 0.5 * city.smog.level * 5, 12);
    expect(laborPool(city)).toBeCloseTo(pool1 * healthFactor(city), 6);
    // the health factor bottoms out at 0.5 (level × 5 clamped to 1)
    city.smog.level = 0.5;
    expect(healthFactor(city)).toBe(0.5);
  });

  it('the growth penalty comes off the monthly rate', () => {
    const ctx = town(20000);
    const city = atTier(ctx.state.cities[0], 2);
    const pop = city.population;
    growthMonth(ctx);
    const sat = city.happiness; // growthMonth leaves the average satisfaction here
    expect(city.population).toBe(monthlyGrowth(pop, sat, city.pollution, 0.004));
    expect(city.population).toBeLessThan(monthlyGrowth(pop, sat, city.pollution));
  });

  it('tier 3 adds protests (one news item on entry); tier 4 forces edicts and swings the vote', () => {
    const ctx = town();
    const city = atTier(ctx.state.cities[0], 2);
    city.smog.level = 0.15;
    city.smog.months = 2;
    city.pollution = 0.15;
    escalationMonth(ctx);
    expect(city.smog.tier).toBe(3);
    expect(ctx.state.news.filter((n) => n.kind === 'protest')).toHaveLength(1);
    escalationMonth(ctx);
    expect(ctx.state.news.filter((n) => n.kind === 'protest')).toHaveLength(1);
    expect(growthPenalty(city)).toBe(0.004);
    expect(activeEdicts(city)).not.toContain('smog_limit');

    city.politics.mayor.faction = 'oldmoney';
    city.politics.edicts = chooseMayorEdicts(city);
    const reformers3 = voteShares(city).reformers;
    atTier(city, 4);
    expect(hasEdict(city, 'smog_limit')).toBe(true);
    expect(hasEdict(city, 'permits_required')).toBe(true);
    const reformers4 = voteShares(city).reformers;
    expect(reformers4).toBeGreaterThan(reformers3);
    // shares renormalise: the raw reformer score is exactly ×1.5
    const odds = (s: number) => s / (1 - s);
    expect(odds(reformers4) / odds(reformers3)).toBeCloseTo(1.5, 9);
  });
});

describe('smog editorial', () => {
  it('runs once a year nationally, on the worst tier-1+ town', () => {
    const ctx = testCtx(testState({ width: 80, height: 60, cities: [{ x: 20, y: 20, name: 'Ashby' }, { x: 60, y: 40, name: 'Soothill' }] }));
    const [a, b] = ctx.state.cities;
    atTier(a, 1);
    atTier(b, 2);
    escalationMonth(ctx);
    escalationMonth(ctx);
    const warns = () => ctx.state.news.filter((n) => n.kind === 'warning');
    expect(warns()).toHaveLength(1);
    expect(`${warns()[0].headline} ${warns()[0].body}`).toContain('Soothill');
    ctx.state.date.year++;
    atTier(a, 3);
    escalationMonth(ctx);
    expect(warns()).toHaveLength(2);
    expect(`${warns()[1].headline} ${warns()[1].body}`).toContain('Ashby');
  });

  it('none while every town is clean', () => {
    const ctx = testCtx(testState({ width: 80, height: 60, cities: [{ x: 20, y: 20 }, { x: 60, y: 40 }] }));
    escalationMonth(ctx);
    expect(ctx.state.news).toHaveLength(0);
  });
});

describe('smog drift scales with the tier (R-S4)', () => {
  it.each([[1, 0.3, 0.2], [2, 0.6, 0.4], [3, 0.9, 0.6], [4, 1.2, 0.8]] as const)('tier %i: reformers −%f, workers −%f', (tier, dr, dw) => {
    const ctx = town();
    const city = atTier(ctx.state.cities[0], tier);
    const r = city.opinion.reformers;
    const w = city.opinion.workers;
    escalationMonth(ctx);
    expect(city.smog.tier).toBe(tier);
    expect(city.opinion.reformers).toBeCloseTo(r - dr, 12);
    expect(city.opinion.workers).toBeCloseTo(w - dw, 12);
  });
});

describe('tier 4 edicts', () => {
  it('adds smog_limit and permits_required, and drops them with the tier', () => {
    const ctx = town();
    const city = ctx.state.cities[0];
    city.politics.mayor.faction = 'church';
    adjustOpinion(ctx.state, 'church', city.id, 80 - city.opinion.church, 'test', { log: false });
    city.politics.edicts = chooseMayorEdicts(city);
    expect(activeEdicts(city)).toEqual([]);
    atTier(city, 4);
    expect(activeEdicts(city).sort()).toEqual(['permits_required', 'smog_limit']);
    // the mayor's own edicts are untouched (nothing stored)
    expect(city.politics.edicts).toEqual([]);
    atTier(city, 3);
    expect(activeEdicts(city)).toEqual([]);
  });

  it("keeps them after the tier drops when the mayor's own edicts include them", () => {
    const ctx = town();
    const city = ctx.state.cities[0];
    city.politics.mayor.faction = 'reformers';
    adjustOpinion(ctx.state, 'reformers', city.id, 10 - city.opinion.reformers, 'test', { log: false });
    city.politics.edicts = chooseMayorEdicts(city);
    expect(city.politics.edicts.sort()).toEqual(['permits_required', 'smog_limit']);
    atTier(city, 4);
    expect(activeEdicts(city).sort()).toEqual(['permits_required', 'smog_limit']);
    atTier(city, 2);
    expect(activeEdicts(city).sort()).toEqual(['permits_required', 'smog_limit']);
  });
});

describe('Black Lung', () => {
  it('is round(population × level × 0.004) a month from tier 2, and none below', () => {
    const city = town(30000).state.cities[0];
    atTier(city, 1);
    expect(blackLungDeaths(city)).toBe(0);
    atTier(city, 2);
    city.smog.level = 0.08;
    expect(blackLungDeaths(city)).toBe(Math.round(30000 * 0.08 * 0.004));
  });

  it('accumulates deterministically', () => {
    const run = (): number[] => {
      const ctx = town(25000);
      const city = ctx.state.cities[0];
      const out: number[] = [];
      for (let m = 0; m < 36; m++) {
        city.pollution = 0.04 + 0.08 * Math.abs(Math.sin(m * 0.7));
        escalationMonth(ctx);
        out.push(city.smog.blackLung);
      }
      return out;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a[a.length - 1]).toBeGreaterThan(0);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
  });

  it('nationalBlackLung sums every town', () => {
    const ctx = testCtx(testState({ width: 80, height: 60, cities: [{ x: 20, y: 20 }, { x: 60, y: 40 }] }));
    ctx.state.cities[0].smog.blackLung = 12;
    ctx.state.cities[1].smog.blackLung = 30;
    expect(nationalBlackLung(ctx.state)).toBe(42);
  });
});

describe('protests', () => {
  function setup(tier: SmogTier) {
    const ctx = town();
    atTier(ctx.state.cities[0], tier);
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', NEAR));
    const rural = must(placeBuilding(ctx, 'player', 'sawmill', RURAL));
    const baron = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 29, y: 23 }));
    const farm = must(placeBuilding(ctx, 'player', 'farm', { x: 10, y: 24 }));
    for (const b of [mill, rural, baron]) b.input = { wood: 1000 };
    return { ctx, mill, rural, baron, farm };
  }

  it('runs only player polluters in the zone of a tier-3+ town at ×0.8', () => {
    const { ctx, mill, rural, baron, farm } = setup(3);
    expect([...protestedBuildings(ctx.state)]).toEqual([mill.id]);
    productionDay(ctx);
    expect(mill.progress).toBeCloseTo(0.8, 12);
    expect(rural.output.lumber).toBe(5);
    expect(baron.output.lumber).toBe(5);
    expect(protestedBuildings(ctx.state).has(farm.id)).toBe(false);
  });

  it('is off below tier 3', () => {
    const { ctx, mill } = setup(2);
    expect(protestedBuildings(ctx.state).size).toBe(0);
    productionDay(ctx);
    expect(mill.output.lumber).toBe(5);
  });

  it('the protest site is the largest player polluter in the zone', () => {
    const { ctx, mill } = setup(3);
    expect(protestSite(ctx.state, ctx.state.cities[0])?.id).toBe(mill.id);
    const tools = must(placeBuilding(ctx, 'player', 'toolworks', { x: 10, y: 14 }));
    expect(protestSite(ctx.state, ctx.state.cities[0])?.id).toBe(tools.id);
  });
});

describe('v6 migration', () => {
  it('gives every town a clean smog record with level = its pollution', () => {
    const o: Record<string, unknown> = {
      version: 5,
      date: { year: 1950, month: 3, day: 1, hour: 0 },
      cities: [{ pollution: 0.05 }, { pollution: 0 }],
    };
    const r = migrateSave(o, undefined, 6);
    expect(r.ok).toBe(true);
    expect((o.cities as { smog: unknown }[]).map((c) => c.smog)).toEqual([
      { tier: 0, months: 0, blackLung: 0, level: 0.05 },
      { tier: 0, months: 0, blackLung: 0, level: 0 },
    ]);
  });
});

describe('systems order', () => {
  it('escalation runs in the month before the politics system (an election sees this month’s tier)', async () => {
    const { SYSTEMS } = await import('../systems');
    const ids = SYSTEMS.map((s) => s.id);
    expect(ids.indexOf('pollution')).toBeLessThan(ids.indexOf('politics'));
    const ctx = { state: testState({ width: 80, height: 60, cities: [{ x: 20, y: 20 }] }), bus: new EventBus() };
    const city = ctx.state.cities[0];
    city.smog = { tier: 0, months: 2, blackLung: 0, level: 0.05 };
    city.pollution = 0.05;
    // the pollution system's onMonth runs pollutionMonth then escalationMonth
    SYSTEMS.find((s) => s.id === 'pollution')!.onMonth!(ctx);
    expect(city.smog.tier).toBe(1);
  });
});
