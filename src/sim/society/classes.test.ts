import { describe, expect, it } from 'vitest';
import { CLASS_DEMAND, DEMAND_PER_1000 } from '../../data/goods';
import { FACTION_IDS, FACTIONS } from '../../data/factions';
import { houseTier } from '../../render/sprites';
import { EventBus } from '../../core/events';
import { checkInvariants } from '../invariants';
import { lifecycleFactor, monthlyDemand } from '../market';
import { factionWeights, voteShares } from '../politics/elections';
import { testState } from '../testkit';
import type { City, SimContext } from '../types';
import { CLASS_CLAMPS, INITIAL_CLASSES, classDemandFactor, classesMonth, newCityClasses, stepClasses } from './classes';

function ctxWith(cities = 1): SimContext {
  const state = testState({ cities: Array.from({ length: cities }, (_, i) => ({ x: 6 + i * 12, y: 10 })) });
  return { state, bus: new EventBus() } as SimContext;
}

const sum = (c: City['classes']) => c.working + c.middle + c.upper;

describe('social classes', () => {
  it('start at 0.75 / 0.2 / 0.05', () => {
    expect(INITIAL_CLASSES).toEqual({ working: 0.75, middle: 0.2, upper: 0.05 });
    expect(newCityClasses()).toEqual(INITIAL_CLASSES);
    expect(newCityClasses()).not.toBe(INITIAL_CLASSES);
    expect(ctxWith().state.cities[0].classes).toEqual(INITIAL_CLASSES);
  });

  it('always sum to 1 and stay within their clamps, whatever the inputs', () => {
    const extremes = [
      { sat: 1, smog: 0, year: 1990 },
      { sat: 0, smog: 1, year: 1900 },
      { sat: 0.5, smog: 0.03, year: 1950 },
    ];
    for (const e of extremes) {
      let c = newCityClasses();
      for (let m = 0; m < 12 * 200; m++) {
        c = stepClasses(c, e.sat, e.smog, e.year);
        expect(Math.abs(sum(c) - 1)).toBeLessThan(1e-9);
        for (const k of ['working', 'middle', 'upper'] as const) {
          expect(c[k]).toBeGreaterThanOrEqual(CLASS_CLAMPS[k][0] - 1e-12);
          expect(c[k]).toBeLessThanOrEqual(CLASS_CLAMPS[k][1] + 1e-12);
        }
      }
    }
  });

  it('applies the brief deltas for one month', () => {
    const c = stepClasses(newCityClasses(), 0.5, 0, 1900);
    expect(c.middle).toBeCloseTo(0.2 + 0.00015 * 1.5, 12);
    expect(c.upper).toBeCloseTo(0.05 + 0.00012 * 0.5, 12);
    expect(c.working).toBeCloseTo(1 - c.middle - c.upper, 12);
    // the post-war boom adds 0.0001 to the middle class from 1945
    expect(stepClasses(newCityClasses(), 0.5, 0, 1944).middle).toBe(c.middle);
    expect(stepClasses(newCityClasses(), 0.5, 0, 1945).middle - c.middle).toBeCloseTo(0.0001, 12);
    // smog flight: −0.00025 × the 0..1 smog figure
    expect(stepClasses(newCityClasses(), 0, 0.4, 1900).upper).toBeCloseTo(0.05 - 0.00025 * 0.4, 12);
  });

  it('pins working at its clamps by moving the middle class first, then the upper (R-S9 clamps)', () => {
    expect(CLASS_CLAMPS).toEqual({ working: [0.2, 0.85], middle: [0.1, 0.6], upper: [0.03, 0.3] });
    const low = stepClasses({ working: 0.2, middle: 0.6, upper: 0.2 }, 1, 0, 1990);
    expect(low.working).toBeCloseTo(0.2, 12);
    expect(low.middle).toBeCloseTo(0.6 - 0.00012, 12);
    expect(low.upper).toBeCloseTo(0.20012, 12);
    const high = stepClasses({ working: 0.85, middle: 0.1, upper: 0.05 }, 0, 1, 1900);
    expect(high.working).toBeCloseTo(0.85, 12);
    expect(high.upper).toBeCloseTo(0.04975, 12);
    expect(high.middle).toBeCloseTo(0.10025, 12);
  });

  it('R-S9 calibration: a clean prosperous town (sat 0.6) reaches upper 0.12–0.15 by 2000; a smoggy one keeps upper near 0.05', () => {
    let clean = newCityClasses();
    let smoggy = newCityClasses();
    for (let y = 1900; y < 2000; y++) {
      for (let m = 0; m < 12; m++) {
        clean = stepClasses(clean, 0.6, 0, y);
        smoggy = stepClasses(smoggy, 0.6, 0.35, y);
      }
    }
    // the R-S9 rates give middle 0.2 + 1200 × 0.00024 + 660 × 0.0001 = 0.554 (the ruling's ~0.40
    // target would need lower rates); upper 0.05 + 1200 × 0.000072 = 0.1364
    expect(clean.middle).toBeCloseTo(0.554, 6);
    expect(clean.upper).toBeCloseTo(0.1364, 6);
    expect(clean.working).toBeCloseTo(0.3096, 6);
    expect(smoggy.upper).toBeGreaterThan(0.03);
    expect(smoggy.upper).toBeLessThan(0.07);
  });

  it('pollution lowers the upper share (the rich flee smog)', () => {
    const ctx = ctxWith(2);
    const [clean, smoggy] = ctx.state.cities;
    for (const c of ctx.state.cities) c.classes = { working: 0.6, middle: 0.25, upper: 0.15 };
    clean.smog.level = 0;
    smoggy.smog.level = 0.1; // ×5 → 0.5
    for (let m = 0; m < 24; m++) classesMonth(ctx);
    expect(smoggy.classes.upper).toBeLessThan(0.15);
    expect(smoggy.classes.upper).toBeLessThan(clean.classes.upper);
    // no market here, so satisfaction is 0: the clean town keeps its upper share
    expect(clean.classes.upper).toBeCloseTo(0.15, 12);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('checkInvariants flags a class mix that does not sum to 1 or leaves its clamps', () => {
    const ctx = ctxWith();
    ctx.state.cities[0].classes = { working: 0.7, middle: 0.2, upper: 0.05 };
    expect(checkInvariants(ctx.state).some((m) => m.includes('classes'))).toBe(true);
    ctx.state.cities[0].classes = { working: 0.9, middle: 0.07, upper: 0.03 };
    expect(checkInvariants(ctx.state).some((m) => m.includes('classes'))).toBe(true);
  });
});

describe('class demand', () => {
  it('a 1900 city at the initial mix keeps its v1 demand (1e-9)', () => {
    const ctx = ctxWith();
    const city = ctx.state.cities[0];
    city.population = 12345;
    for (const g of Object.keys(DEMAND_PER_1000)) {
      for (const year of [1900, 1950, 1999]) {
        const v1 = (city.population / 1000) * DEMAND_PER_1000[g] * lifecycleFactor(g, year) * 1.3;
        expect(Math.abs(monthlyDemand(city, g, year, 1.3) - v1)).toBeLessThan(1e-9);
      }
    }
    for (const g of Object.keys(DEMAND_PER_1000)) expect(classDemandFactor(INITIAL_CLASSES, g)).toBe(1);
  });

  it('uses the brief multipliers', () => {
    for (const g of ['furniture', 'cars', 'computers', 'toys', 'cheese', 'juice']) expect(CLASS_DEMAND[g]).toEqual({ working: 0.6, middle: 1.2, upper: 2.0 });
    for (const g of ['bread', 'clothes']) expect(CLASS_DEMAND[g]).toEqual({ working: 1.2, middle: 1.0, upper: 0.7 });
    for (const g of ['tools', 'radios', 'tvs']) expect(CLASS_DEMAND[g]).toEqual({ working: 1, middle: 1, upper: 1 });
  });

  it('an upper-heavy city demands more cars and less bread', () => {
    const ctx = ctxWith();
    const city = ctx.state.cities[0];
    const cars0 = monthlyDemand(city, 'cars', 1950);
    const bread0 = monthlyDemand(city, 'bread', 1950);
    const tools0 = monthlyDemand(city, 'tools', 1950);
    city.classes = { working: 0.4, middle: 0.35, upper: 0.25 };
    expect(monthlyDemand(city, 'cars', 1950)).toBeGreaterThan(cars0 * 1.3);
    expect(monthlyDemand(city, 'bread', 1950)).toBeLessThan(bread0 * 0.95);
    expect(monthlyDemand(city, 'tools', 1950)).toBeCloseTo(tools0, 9);
    // the exact ratio for cars: (0.4×0.6 + 0.35×1.2 + 0.25×2) / (0.75×0.6 + 0.2×1.2 + 0.05×2)
    expect(classDemandFactor(city.classes, 'cars')).toBeCloseTo((0.24 + 0.42 + 0.5) / (0.45 + 0.24 + 0.1), 12);
  });
});

describe('class votes', () => {
  it('at the initial mix the weights are the factions base weights', () => {
    const ctx = ctxWith();
    const w = factionWeights(ctx.state.cities[0]);
    for (const f of FACTION_IDS) expect(w[f]).toBeCloseTo(FACTIONS[f].weight, 12);
  });

  it('election weights shift with the classes', () => {
    const ctx = ctxWith();
    const city = ctx.state.cities[0];
    const before = voteShares(city);
    city.classes = { working: 0.45, middle: 0.4, upper: 0.15 };
    const w = factionWeights(city);
    const total = FACTION_IDS.reduce((s, f) => s + w[f], 0);
    expect(total).toBeCloseTo(1, 12);
    // workers 0.4×0.6 = 0.24, oldmoney 0.18×3 = 0.54 → capped 0.4, reformers 0.17×2 = 0.34, church 0.2, baron 0.05
    const raw = 0.24 + 0.4 + 0.34 + 0.2 + 0.05;
    expect(w.workers).toBeCloseTo(0.24 / raw, 12);
    expect(w.oldmoney).toBeCloseTo(0.4 / raw, 12);
    expect(w.reformers).toBeCloseTo(0.34 / raw, 12);
    expect(w.church).toBeCloseTo(0.2 / raw, 12);
    const after = voteShares(city);
    expect(after.workers).toBeLessThan(before.workers);
    expect(after.oldmoney).toBeGreaterThan(before.oldmoney);
    expect(after.reformers).toBeGreaterThan(before.reformers);
  });
});

describe('house art by class', () => {
  const mix = (working: number, middle: number, upper: number) => ({ working, middle, upper });

  it('houseTier returns villa for an upper-heavy city', () => {
    expect(houseTier(20000, 1950, 0.6, mix(0.45, 0.3, 0.25), 0.05)).toBe('villa');
    // not when the upper class is small
    expect(houseTier(20000, 1950, 0.6, mix(0.75, 0.2, 0.05), 0.05)).toBe('house');
  });

  it('semis for a middle-class city; terraces stay for the working class', () => {
    expect(houseTier(20000, 1950, 0.6, mix(0.5, 0.45, 0.05), 0.1)).toBe('semi');
    expect(houseTier(20000, 1950, 0.2, mix(0.5, 0.45, 0.05), 0.95)).toBe('terrace');
  });

  it('districts mix: the per-tile pick spreads villas, semis and the base tier', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(houseTier(20000, 1950, 0.6, mix(0.4, 0.4, 0.2), i / 100));
    expect([...seen].sort()).toEqual(['house', 'semi', 'villa']);
  });

  it('big cores keep their blocks and towers', () => {
    const rich = mix(0.3, 0.45, 0.25);
    for (let i = 0; i < 20; i++) {
      expect(houseTier(70000, 1960, 0.2, rich, i / 20)).toBe('tower');
      expect(houseTier(45000, 1930, 0.2, rich, i / 20)).toBe('block');
    }
  });

  it('without classes the v1 rules hold', () => {
    expect(houseTier(16000, 1900, 0.34)).toBe('terrace');
    expect(houseTier(10000, 1990, 0.1)).toBe('house');
  });
});

describe('v6 migration classes', () => {
  it('gives every town the initial class mix', async () => {
    const { migrateSave } = await import('../migrations');
    const o: Record<string, unknown> = { version: 5, date: { year: 1950, month: 3, day: 1, hour: 0 }, cities: [{ pollution: 0.05 }, {}] };
    expect(migrateSave(o, undefined, 6).ok).toBe(true);
    expect((o.cities as { classes: unknown }[]).map((c) => c.classes)).toEqual([INITIAL_CLASSES, INITIAL_CLASSES]);
  });
});

describe('systems order', () => {
  it('classes shift monthly inside the pollution system, before politics votes', async () => {
    const { SYSTEMS } = await import('../systems');
    const ids = SYSTEMS.map((s) => s.id);
    expect(ids.indexOf('pollution')).toBeLessThan(ids.indexOf('politics'));
    const ctx = ctxWith();
    const before = { ...ctx.state.cities[0].classes };
    SYSTEMS.find((s) => s.id === 'pollution')!.onMonth!(ctx);
    expect(ctx.state.cities[0].classes.middle).toBeGreaterThan(before.middle);
  });
});
