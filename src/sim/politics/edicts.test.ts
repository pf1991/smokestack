import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { LANDMARKS } from '../../data/landmarks';
import { LANDMARK_LAYER, landmarksMonth } from '../landmarks';
import { layerAt } from '../layers';
import { monthProfit } from '../finance';
import { maintenanceMonth } from '../production';
import { acceptsGood, handlesCargo } from '../inventory';
import { acceptedGoods, appendStop, offeredGoods, suggestStops } from '../routeHelpers';
import { canPlaceBuilding, createGame, demolishBuilding, HOUSING_TOO_FAR, placeBuilding } from '../state';
import { createRoute } from '../vehicles';
import { housingMonth } from './housing';
import { must, testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { EventBus } from '../../core/events';
import { FACTION_IDS } from '../../data/factions';
import { runAutoplay } from '../../game/autoplay';
import { runDays } from '../simulation';
import { buyPhilanthropy, EDICT_KEYS, edictDrive, EDICTS, edictsMonth, MAX_EDICT_DRIVE, MAX_OPTION_DRIVE, maintenanceFactor, philanthropyBlocker, setEdict } from './edicts';
import { factionsMonth, nationalOpinion, opinionHistoryYear, opinionTrend } from './factions';
import { politicsSystem } from './index';
import type { CompanyEdicts, SafetyLevel, UnionStance, WageLevel } from './types';
import { laborPool, workCity, workforceMonth } from './workforce';

const WAGE: Record<WageLevel, number> = { low: 0.85, fair: 1, generous: 1.25 };
const SAFETY: Record<SafetyLevel, number> = { minimal: 0.95, standard: 1, high: 1.12 };
const UNION: Record<UnionStance, number> = { crush: 1, tolerate: 1, recognise: 1.05 };

function town(money = 1e6): SimContext {
  return testCtx(testState({ width: 80, height: 60, money, cities: [{ x: 20, y: 20, population: 6000 }] }));
}

describe('company edicts', () => {
  it('maintenanceFactor is the product of the three edicts, for every combination', () => {
    for (const wage of Object.keys(WAGE) as WageLevel[]) {
      for (const safety of Object.keys(SAFETY) as SafetyLevel[]) {
        for (const union of Object.keys(UNION) as UnionStance[]) {
          const e: CompanyEdicts = { wage, safety, union };
          expect(maintenanceFactor(e), `${wage}/${safety}/${union}`).toBeCloseTo(WAGE[wage] * SAFETY[safety] * UNION[union], 12);
        }
      }
    }
    expect(maintenanceFactor({ wage: 'fair', safety: 'standard', union: 'tolerate' })).toBe(1);
  });

  it('the defaults are fair, standard, tolerate', () => {
    expect(town().state.politics.edicts).toEqual({ wage: 'fair', safety: 'standard', union: 'tolerate' });
  });

  it('setEdict stores the edict, publishes a one-line politics headline, and refuses nonsense', () => {
    const ctx = town();
    const news = ctx.state.news.length;
    must(setEdict(ctx, 'wage', 'generous'));
    expect(ctx.state.politics.edicts.wage).toBe('generous');
    expect(ctx.state.news.length).toBe(news + 1);
    const item = ctx.state.news.at(-1)!;
    expect(item.kind).toBe('politics');
    expect(item.headline).not.toContain('\n');
    // same value again: ok, no second headline
    must(setEdict(ctx, 'wage', 'generous'));
    expect(ctx.state.news.length).toBe(news + 1);
    expect(setEdict(ctx, 'wage', 'lavish' as WageLevel).ok).toBe(false);
    expect(setEdict(ctx, 'bonus' as keyof CompanyEdicts, 'fair' as never).ok).toBe(false);
    expect(ctx.state.politics.edicts).toEqual({ wage: 'generous', safety: 'standard', union: 'tolerate' });
  });

  it('scales the player building maintenance only, under the maintenance ledger category', () => {
    const ctx = town(1e7);
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 50, y: 40 }));
    must(placeBuilding(ctx, 'rival', 'sawmill', { x: 60, y: 40 }));
    must(setEdict(ctx, 'wage', 'generous'));
    must(setEdict(ctx, 'safety', 'high'));
    must(setEdict(ctx, 'union', 'recognise'));
    const p0 = ctx.state.companies.player.money;
    const r0 = ctx.state.companies.rival.money;
    maintenanceMonth(ctx);
    const upkeep = BUILDINGS.sawmill.maintenance;
    expect(p0 - ctx.state.companies.player.money).toBe(Math.round(upkeep * 1.25 * 1.12 * 1.05));
    expect(r0 - ctx.state.companies.rival.money).toBe(upkeep);
    expect(ctx.state.companies.player.ledger.at(-1)!.expense.maintenance).toBe(Math.round(upkeep * 1.25 * 1.12 * 1.05));
  });

  it('edictsMonth applies each edict national effect', () => {
    const cases: [keyof CompanyEdicts, string, Partial<Record<'workers' | 'oldmoney' | 'reformers', number>>][] = [
      ['wage', 'low', { workers: -0.2, oldmoney: 0.1 }],
      ['wage', 'generous', { workers: 0.2, oldmoney: -0.1 }],
      ['safety', 'minimal', { workers: -0.1, reformers: -0.1 }],
      ['safety', 'high', { workers: 0.1 }],
      ['union', 'crush', { workers: -0.2, oldmoney: 0.1 }],
      ['union', 'recognise', { workers: 0.15, oldmoney: -0.1 }],
    ];
    for (const [key, value, want] of cases) {
      const ctx = town();
      must(setEdict(ctx, key, value as never));
      edictsMonth(ctx);
      const o = ctx.state.cities[0].opinion;
      expect(o.workers, `${key} ${value}`).toBeCloseTo(50 + (want.workers ?? 0), 12);
      expect(o.oldmoney, `${key} ${value}`).toBeCloseTo(50 + (want.oldmoney ?? 0), 12);
      expect(o.reformers, `${key} ${value}`).toBeCloseTo(50 + (want.reformers ?? 0), 12);
    }
    // the defaults do nothing
    const ctx = town();
    edictsMonth(ctx);
    expect(ctx.state.cities[0].opinion).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
  });

  it('generous wages raise national workers opinion over 12 months, relative to fair, net of drift', () => {
    const year = (wage: WageLevel) => {
      const ctx = testCtx(testState({ width: 80, height: 60, cities: [{ x: 20, y: 20, population: 6000 }, { x: 60, y: 40, population: 2000 }] }));
      must(setEdict(ctx, 'wage', wage));
      for (let m = 0; m < 12; m++) politicsSystem.onMonth!(ctx);
      return nationalOpinion(ctx.state, 'workers');
    };
    const fair = year('fair');
    const generous = year('generous');
    expect(fair).toBeCloseTo(50, 10);
    expect(generous - fair).toBeGreaterThan(2);
  });

  it('no single option drives a faction more than 0.4/month', () => {
    for (const k of EDICT_KEYS) {
      for (const v of EDICTS[k].values) {
        for (const d of Object.values((EDICTS[k].options as Record<string, { effects: Record<string, number> }>)[v].effects)) {
          expect(Math.abs(d), `${k} ${v}`).toBeLessThanOrEqual(MAX_OPTION_DRIVE);
        }
      }
    }
    expect(MAX_OPTION_DRIVE).toBe(0.4);
    expect(MAX_EDICT_DRIVE).toBe(0.8);
  });

  it('edictsMonth sums the edicts per faction', () => {
    const ctx = town();
    ctx.state.politics.edicts = { wage: 'low', safety: 'minimal', union: 'crush' };
    edictsMonth(ctx);
    expect(ctx.state.cities[0].opinion.workers).toBeCloseTo(50 - 0.5, 12);
    expect(ctx.state.cities[0].opinion.oldmoney).toBeCloseTo(50.2, 12);
    expect(ctx.state.cities[0].opinion.reformers).toBeCloseTo(49.9, 12);
  });

  it('edictsMonth caps the summed drive per faction at 0.8/month', () => {
    // three options at the per-option limit would sum to 1.2: the cap holds them to 0.8
    const opts = EDICT_KEYS.map((k) => (EDICTS[k].options as Record<string, { effects: Record<string, number> }>)[EDICTS[k].values[0]]);
    const saved = opts.map((o) => o.effects);
    try {
      for (const o of opts) o.effects = { workers: -MAX_OPTION_DRIVE, church: MAX_OPTION_DRIVE };
      const ctx = town();
      ctx.state.politics.edicts = { wage: 'low', safety: 'minimal', union: 'crush' };
      expect(edictDrive(ctx.state.politics.edicts).workers).toBeCloseTo(-0.8, 12);
      edictsMonth(ctx);
      expect(ctx.state.cities[0].opinion.workers).toBeCloseTo(50 - 0.8, 12);
      expect(ctx.state.cities[0].opinion.church).toBeCloseTo(50 + 0.8, 12);
    } finally {
      opts.forEach((o, i) => (o.effects = saved[i]));
    }
  });

  // R-Q11: drift is 2% of the gap to 50, so a constant drive d settles at 50 + 50·d. With the cap,
  // edicts alone settle within [10, 90]; other drivers must not push any town past [8, 92].
  const SETS: Record<string, CompanyEdicts> = {
    harsh: { wage: 'low', safety: 'minimal', union: 'crush' },
    kind: { wage: 'generous', safety: 'high', union: 'recognise' },
  };
  for (const [name, edicts] of Object.entries(SETS)) {
    it(`${name} edicts held for 30 years leave every faction in every town within [8, 92]`, () => {
      const ctx = { state: createGame({ seed: 1234 }), bus: new EventBus() };
      must(runAutoplay(ctx));
      ctx.state.politics.edicts = { ...edicts };
      for (let y = 0; y < 30; y++) {
        runDays(ctx, 360);
        for (const c of ctx.state.cities) {
          for (const f of FACTION_IDS) {
            const v = c.opinion[f];
            expect(v >= 8 && v <= 92, `${ctx.state.date.year} ${c.name} ${f} ${v.toFixed(1)}`).toBe(true);
          }
        }
      }
    }, 120_000);
  }
});

describe('opinion history', () => {
  it('appends one sample of national opinion per year', () => {
    const ctx = town();
    opinionHistoryYear(ctx);
    expect(ctx.state.politics.history).toEqual([{ year: 1900, national: { workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 } }]);
    expect(politicsSystem.onYear).toBe(opinionHistoryYear);
  });

  it('the trend compares with the latest sample at least 12 months old, else the first, else none', () => {
    const ctx = town();
    const { state } = ctx;
    const sample = (year: number, workers: number) =>
      state.politics.history.push({ year, national: { workers, oldmoney: 50, reformers: 50, church: 50, baron: 35 } });
    expect(opinionTrend(state, 'workers')).toBeNull();
    // one sample, taken at the end of 1900: in 1901 it is under 12 months old
    sample(1900, 40);
    state.date = { year: 1901, month: 6, day: 1, hour: 0 };
    expect(opinionTrend(state, 'workers')).toBeNull();
    // from 1 Jan 1902 it is a year old
    state.date = { year: 1902, month: 1, day: 1, hour: 0 };
    expect(opinionTrend(state, 'workers')).toEqual({ delta: 10, since: 1900 });
    // a 1901 sample is too young in mid-1902: the 1900 one is still the baseline
    sample(1901, 45);
    state.date = { year: 1902, month: 6, day: 1, hour: 0 };
    expect(opinionTrend(state, 'workers')).toEqual({ delta: 10, since: 1900 });
    state.date = { year: 1903, month: 2, day: 1, hour: 0 };
    expect(opinionTrend(state, 'workers')).toEqual({ delta: 5, since: 1901 });
    // two samples, neither a year old (a hand-made history): the change since the first
    state.politics.history = [];
    sample(1902, 30);
    sample(1903, 35);
    state.date = { year: 1903, month: 6, day: 1, hour: 0 };
    expect(opinionTrend(state, 'workers')).toEqual({ delta: 20, since: 1902 });
  });
});

describe('philanthropy', () => {
  it('refuses when the player cannot afford it', () => {
    const ctx = town(20000);
    const r = buyPhilanthropy(ctx, 0, 'park');
    expect(r).toEqual({ ok: false, error: 'Not enough money' });
    expect(ctx.state.cities[0].landmarks).toEqual([]);
  });

  it('places the landmark, spends under events, applies the opinion changes, and refuses a second one', () => {
    const ctx = town();
    const events: unknown[] = [];
    ctx.bus.on('landmarkBuilt', (e) => events.push(e));
    const money = ctx.state.companies.player.money;
    must(buyPhilanthropy(ctx, 0, 'park'));
    const city = ctx.state.cities[0];
    expect(city.landmarks.map((l) => l.id)).toEqual(['park']);
    const pos = city.landmarks[0].pos;
    expect(layerAt(ctx.state, LANDMARK_LAYER, pos.x, pos.y)).toBe(1);
    expect(layerAt(ctx.state, LANDMARK_LAYER, pos.x + 1, pos.y + 1)).toBe(1);
    expect(money - ctx.state.companies.player.money).toBe(25000);
    expect(ctx.state.companies.player.ledger.at(-1)!.expense.events).toBe(25000);
    // and it counts against the month's profit (the finance statement uses the same lists)
    expect(monthProfit(ctx.state.companies.player.ledger.at(-1)!)).toBe(-25000);
    expect(events).toEqual([{ type: 'landmarkBuilt', cityId: 0, id: 'park' }]);
    expect(city.opinion).toEqual({ workers: 52, oldmoney: 50, reformers: 56, church: 56, baron: 35 });
    expect(ctx.state.politics.log.map((e) => [e.faction, e.scope, e.delta])).toEqual([
      ['workers', 0, 2],
      ['reformers', 0, 6],
      ['church', 0, 6],
    ]);
    const again = buyPhilanthropy(ctx, 0, 'park');
    expect(again).toEqual({ ok: false, error: 'Town 0 already has a park' });
    expect(ctx.state.companies.player.money).toBe(money - 25000);
  });

  it('respects the landmark minYear: no library before 1905', () => {
    const ctx = town();
    expect(buyPhilanthropy(ctx, 0, 'library')).toEqual({ ok: false, error: 'Not before 1905' });
    expect(LANDMARKS.park.minYear).toBe(1900);
    expect(LANDMARKS.hospital.minYear).toBe(1900);
  });

  it('library and hospital: their prices and effects', () => {
    const ctx = town();
    ctx.state.date.year = 1905;
    const money = ctx.state.companies.player.money;
    must(buyPhilanthropy(ctx, 0, 'library'));
    must(buyPhilanthropy(ctx, 0, 'hospital'));
    expect(money - ctx.state.companies.player.money).toBe(60000 + 120000);
    expect(ctx.state.cities[0].opinion).toEqual({ workers: 58, oldmoney: 50, reformers: 62, church: 60, baron: 35 });
    expect(ctx.state.cities[0].landmarks.map((l) => l.id)).toEqual(['library', 'hospital']);
    expect(LANDMARKS.park.philanthropy!.cost).toBe(25000);
  });

  it('refuses without a free site, for an unknown town, or for a landmark that cannot be endowed', () => {
    const ctx = town();
    // fill the whole town with road: no 2×2 block is free
    for (const t of ctx.state.map.tiles) if (t.cityId === 0) t.road = true;
    expect(buyPhilanthropy(ctx, 0, 'park')).toEqual({ ok: false, error: 'No free site in Town 0' });
    expect(buyPhilanthropy(ctx, 9, 'park')).toEqual({ ok: false, error: 'Unknown town' });
    expect(buyPhilanthropy(ctx, 0, 'church' as never).ok).toBe(false);
    expect(philanthropyBlocker(ctx.state, 0, 'hospital')).toBe('No free site in Town 0');
  });

  it('an auto-built library cannot be endowed again; parks and hospitals are never auto-built', () => {
    const ctx = testCtx(testState({ width: 120, height: 100, money: 1e6, year: 1950, cities: [{ x: 50, y: 50, population: 90000 }] }));
    for (let i = 0; i < 12; i++) landmarksMonth(ctx);
    const ids = ctx.state.cities[0].landmarks.map((l) => l.id);
    expect(ids).toContain('library');
    expect(ids).not.toContain('park');
    expect(ids).not.toContain('hospital');
    expect(buyPhilanthropy(ctx, 0, 'library')).toEqual({ ok: false, error: 'Town 0 already has a library' });
  });
});

describe('company housing', () => {
  it('exact catalog values', () => {
    const d = BUILDINGS.company_housing;
    expect([d.category, d.size, d.cost, d.maintenance, d.workers]).toEqual(['logistics', { w: 2, h: 2 }, 8000, 120, 0]);
  });

  it('must stand within 3 tiles of one of the player factories', () => {
    const ctx = town();
    const { state } = ctx;
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 50, y: 40 })).toEqual({ ok: false, error: HOUSING_TOO_FAR });
    must(placeBuilding(ctx, 'rival', 'sawmill', { x: 50, y: 44 }));
    // a rival factory does not count
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 50, y: 40 })).toEqual({ ok: false, error: HOUSING_TOO_FAR });
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 60, y: 40 })); // occupies x 60..62
    // housing at x 54..55: 5 tiles from the sawmill
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 54, y: 40 })).toEqual({ ok: false, error: HOUSING_TOO_FAR });
    // housing at x 55..56: 4 tiles; at x 56..57: 3 tiles
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 55, y: 40 }).ok).toBe(false);
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 56, y: 40 }).ok).toBe(true);
    // diagonally: 3 tiles off in both axes still counts
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 65, y: 45 }).ok).toBe(true);
    expect(canPlaceBuilding(state, 'player', 'company_housing', { x: 66, y: 45 }).ok).toBe(false);
  });

  it('adds 150 hands to its factory town pool and pleases its workers once', () => {
    const ctx = town(1e7);
    const { state } = ctx;
    const city = state.cities[0];
    // 5 sawmills (300 hands) hiring from a town that cannot staff them all
    city.population = 600;
    const mills = [0, 1, 2, 3, 4].map((i) => must(placeBuilding(ctx, 'player', 'sawmill', { x: 30 + i * 4, y: 30 })));
    for (const m of mills) expect(workCity(state, m)?.id).toBe(0);
    factionsMonth(ctx); // jobs counted, track primed
    workforceMonth(state);
    const before = mills[0].staffing;
    const pool = laborPool(city);
    expect(before).toBeCloseTo(Math.max(0.5, pool / 300), 12);
    const w0 = city.opinion.workers;
    must(placeBuilding(ctx, 'player', 'company_housing', { x: 30, y: 34 }));
    workforceMonth(state);
    expect(mills[0].staffing).toBeCloseTo(Math.min(1, (laborPool(city) + 150) / 300), 12);
    expect(mills[0].staffing).toBeLessThan(1);
    expect(mills[0].staffing).toBeGreaterThan(before);
    factionsMonth(ctx);
    // +3 for the housing, no "New jobs" for it; drift is applied first
    const drift = (50 - w0) * 0.02;
    expect(city.opinion.workers).toBeCloseTo(w0 + drift + 3, 10);
    expect(state.politics.log.at(-1)).toMatchObject({ faction: 'workers', scope: 0, delta: 3, reason: 'Company housing' });
    const w1 = city.opinion.workers;
    factionsMonth(ctx);
    expect(city.opinion.workers).toBeCloseTo(w1 + (50 - w1) * 0.02, 10);
  });
});

describe('company housing takes no cargo', () => {
  function site() {
    const ctx = town(1e7);
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 36, y: 30 }));
    const home = must(placeBuilding(ctx, 'player', 'company_housing', { x: 40, y: 30 }));
    const store = must(placeBuilding(ctx, 'player', 'warehouse', { x: 46, y: 30 }));
    return { ctx, mill, home, store };
  }

  it('accepts no goods and offers none', () => {
    const { home } = site();
    expect(handlesCargo(home)).toBe(false);
    expect(acceptsGood(home, 'lumber')).toBe(false);
    expect(acceptedGoods(home)).toEqual([]);
    expect(offeredGoods(home)).toEqual([]);
  });

  it('is refused as a route stop, and never suggested as one', () => {
    const { ctx, mill, home, store } = site();
    // housing first: its refusal comes before any access check
    const r = createRoute(ctx, 'player', 'Bad', [
      { buildingId: home.id, load: [], unload: ['lumber'] },
      { buildingId: mill.id, load: ['lumber'], unload: [] },
    ]);
    expect(r).toEqual({ ok: false, error: 'Company Housing takes no cargo' });
    expect(suggestStops(ctx.state, [mill.id, home.id, store.id]).map((s) => s.buildingId)).toEqual([mill.id, store.id]);
    const stops = suggestStops(ctx.state, [mill.id, store.id]);
    expect(appendStop(ctx.state, stops, home.id)).toEqual(stops);
  });

  it('a housing block whose factory is demolished publishes one politics warning', () => {
    const { ctx, mill } = site();
    housingMonth(ctx);
    const news = ctx.state.news.length;
    must(demolishBuilding(ctx, mill.id, 'player'));
    housingMonth(ctx);
    expect(ctx.state.news.length).toBe(news + 1);
    expect(ctx.state.news.at(-1)).toMatchObject({ kind: 'politics', headline: 'COMPANY HOUSING NEAR TOWN 0 STANDS EMPTY' });
    housingMonth(ctx);
    expect(ctx.state.news.length).toBe(news + 1);
  });
});
