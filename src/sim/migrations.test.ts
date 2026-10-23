import { describe, expect, it } from 'vitest';
import { err } from '../core/result';
import { unpackState } from '../game/saves';
import { checkInvariants } from './invariants';
import { urbanRadius } from './market';
import { migrateSave, runAfterLoad, SAVE_VERSION, type Migration } from './migrations';
import { runDays } from './simulation';
import { testCtx, testState } from './testkit';
import type { GameState } from './types';
import { defaultWeather } from './weather';

const fixtures = import.meta.glob('./__fixtures__/phase*.save.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phase0 = fixtures['./__fixtures__/phase0.save.json'];
const phase1 = fixtures['./__fixtures__/phase1.save.json'];
const phase2 = fixtures['./__fixtures__/phase2.save.json'];
const phase3 = fixtures['./__fixtures__/phase3.save.json'];
const phase4 = fixtures['./__fixtures__/phase4.save.json'];
const phase4b = fixtures['./__fixtures__/phase4b.save.json'];

describe('migrateSave', () => {
  it('rejects a SMOKESTACK I save', () => {
    expect(migrateSave({ version: 1 })).toEqual(err('Save from SMOKESTACK I cannot be loaded in this version'));
  });
  it('rejects a save from a newer version', () => {
    expect(migrateSave({ version: 99 })).toEqual(err('Save from a newer version of SMOKESTACK'));
  });
  it('rejects a non-numeric version', () => {
    expect(migrateSave({ version: 'x' })).toEqual(err('Save file is corrupted'));
  });
  it('applies migrations in order up to current', () => {
    const seen: number[] = [];
    const ms: Migration[] = [3, 2].map((from) => ({ from, migrate: (o) => { seen.push(from); o[`m${from}`] = true; } }));
    const r = migrateSave({ version: 2 }, ms, 4);
    expect(seen).toEqual([2, 3]);
    expect(r.ok && r.value).toMatchObject({ version: 4, m2: true, m3: true });
  });
  it('fails when a migration step is missing', () => {
    expect(migrateSave({ version: 2 }, [], 3)).toEqual(err('Save from an incompatible version'));
  });
  it('returns corrupted instead of throwing when a migration throws', () => {
    const ms: Migration[] = [{ from: 2, migrate: () => { throw new Error('boom'); } }];
    expect(migrateSave({ version: 2 }, ms, 3)).toEqual(err('Save file is corrupted'));
  });
  it('runAfterLoad turns a throwing afterLoad hook into corrupted', () => {
    const ran: number[] = [];
    const ms: Migration[] = [
      { from: 2, migrate: () => {}, afterLoad: () => { ran.push(2); } },
      { from: 3, migrate: () => {}, afterLoad: () => { throw new Error('boom'); } },
    ];
    expect(runAfterLoad(testState(), ms)).toEqual(err('Save file is corrupted'));
    expect(ran).toEqual([2]);
    expect(runAfterLoad(testState(), ms.slice(0, 1)).ok).toBe(true);
  });
  it('records the migrations it applied', () => {
    const ms: Migration[] = [{ from: 2, migrate: () => {} }];
    const applied: Migration[] = [];
    migrateSave({ version: 2 }, ms, 3, applied);
    expect(applied).toEqual(ms);
  });
});

describe('v2 -> v3: cities spread', () => {
  it('lays streets in the phase 0 fixture city that outgrew its old radius', () => {
    const raw = JSON.parse(phase0) as { version: number; cities: { id: number; population: number; urbanRadius: number; center: { x: number; y: number } }[]; map: { width: number; tiles: unknown[][] } };
    expect(raw.version).toBe(2);
    const city = raw.cities.find((c) => urbanRadius(c.population) > c.urbanRadius + 1)!;
    expect(city).toBeDefined();
    const R = urbanRadius(city.population);
    const roadsIn = (isRoad: (i: number) => boolean) => {
      let n = 0;
      for (let y = city.center.y - R; y <= city.center.y + R; y++)
        for (let x = city.center.x - R; x <= city.center.x + R; x++)
          if ((x - city.center.x) ** 2 + (y - city.center.y) ** 2 <= R * R && isRoad(y * raw.map.width + x)) n++;
      return n;
    };
    const before = roadsIn((i) => ((raw.map.tiles[i][2] as number) & 1) !== 0);
    const r = unpackState(phase0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value;
    expect(s.version).toBe(SAVE_VERSION);
    expect(checkInvariants(s)).toEqual([]);
    expect(roadsIn((i) => s.map.tiles[i].road)).toBeGreaterThan(before);
    expect(s.cities.find((c) => c.id === city.id)!.urbanRadius).toBe(R);
    // no building or rail tile became road
    s.map.tiles.forEach((t, i) => {
      const was = ((raw.map.tiles[i][2] as number) & 1) !== 0;
      if (t.buildingId !== null || t.rail || t.deposit !== null) expect(t.road).toBe(was);
    });
  });
  it('a throwing afterLoad hook makes the load fail cleanly', () => {
    const bad = phase0.replace('"cities":[', '"cities":[null,');
    expect(bad).not.toBe(phase0);
    expect(unpackState(bad)).toEqual(err('Save file is corrupted'));
  });
});

describe('v3 -> v4: landmarks', () => {
  it('gives every city an empty landmark list', () => {
    const o: Record<string, unknown> = { version: 3, date: { year: 1900, month: 4 }, cities: [{ id: 0, name: 'A' }, { id: 1, name: 'B', landmarks: [{ id: 'church', pos: { x: 1, y: 1 } }] }] };
    const r = migrateSave(o);
    expect(r.ok).toBe(true);
    expect(o.version).toBe(SAVE_VERSION);
    expect((o.cities as { landmarks: unknown[] }[]).map((c) => c.landmarks)).toEqual([[], []]);
  });
  it('a phase 0 save loads with landmark lists on every city', () => {
    const r = unpackState(phase0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cities.length).toBeGreaterThan(0);
    for (const c of r.value.cities) expect(c.landmarks).toEqual([]);
  });
  it('a migrated phase 0 save plays on: a month later its towns have landmarks and the state is healthy', () => {
    const r = unpackState(phase0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ctx = testCtx(r.value);
    runDays(ctx, 31);
    expect(ctx.state.cities.some((c) => c.landmarks.length > 0)).toBe(true);
    expect(ctx.state.layers.landmark?.some((v) => v > 0)).toBe(true);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
});

describe('v4 -> v5: politics', () => {
  it('gives every city the default opinion and the save default politics', () => {
    const o: Record<string, unknown> = { version: 4, date: { year: 1900, month: 4 }, cities: [{ id: 0 }, { id: 1 }] };
    const r = migrateSave(o);
    expect(r.ok).toBe(true);
    expect(o.version).toBe(SAVE_VERSION);
    for (const c of o.cities as { opinion: unknown }[]) expect(c.opinion).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
    const cs = o.cities as { politics: { mayor: { name: string; faction: string }; council: string; nextElection: number; edicts: unknown[] } }[];
    for (const c of cs) {
      expect(c.politics).toMatchObject({ council: 'workers', edicts: ['minimum_wage'], mayor: { faction: 'workers' } });
      expect(c.politics.nextElection).toBeGreaterThanOrEqual(1900 * 12 + 3 + 6);
    }
    expect(o.politics).toMatchObject({ edicts: { wage: 'fair', safety: 'standard', union: 'tolerate' }, cards: { pending: [], history: [] }, log: [] });
  });
  it('sets staffing 1 on every raw building', () => {
    const o: Record<string, unknown> = { version: 4, date: { year: 1900, month: 4 }, cities: [], buildings: { 3: { id: 3 }, 7: { id: 7 } } };
    expect(migrateSave(o).ok).toBe(true);
    for (const b of Object.values(o.buildings as Record<string, { staffing: unknown }>)) expect(b.staffing).toBe(1);
  });
  for (const [name, raw] of [['phase0', phase0], ['phase1', phase1]] as const) {
    it(`${name}.save.json migrates to the current version with every city at 50 (Baron 35) and holds invariants`, () => {
      expect(raw).toBeDefined();
      const r = unpackState(raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const s = r.value;
      expect(s.version).toBe(SAVE_VERSION);
      expect(s.cities.length).toBeGreaterThan(0);
      for (const c of s.cities) expect(c.opinion).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
      expect(s.politics.edicts).toEqual({ wage: 'fair', safety: 'standard', union: 'tolerate' });
      expect(Object.keys(s.buildings).length).toBeGreaterThan(0);
      for (const b of Object.values(s.buildings)) expect(b.staffing).toBe(1);
      expect(checkInvariants(s)).toEqual([]);
    });
    it(`${name}.save.json: its existing buildings do not count as new jobs in the first month`, () => {
      const r = unpackState(raw);
      if (!r.ok) throw new Error(r.error);
      const ctx = testCtx(r.value);
      runDays(ctx, 31);
      expect(ctx.state.politics.log.filter((e) => e.reason === 'New jobs' || e.reason === 'Layoffs')).toEqual([]);
      expect(checkInvariants(ctx.state)).toEqual([]);
    });
  }
});

describe('v5 -> v6: smog and society', () => {
  it('gives a raw v5 save the prevailing weather of its month', () => {
    const o: Record<string, unknown> = { version: 5, date: { year: 1930, month: 1 }, cities: [] };
    expect(migrateSave(o).ok).toBe(true);
    expect(o.version).toBe(SAVE_VERSION);
    expect(o.weather).toEqual(defaultWeather(1));
  });
  it('phase2.save.json migrates with a default weather and holds invariants', () => {
    expect(phase2).toBeDefined();
    const raw = JSON.parse(phase2) as { version: number; date: { month: number } };
    expect(raw.version).toBe(5);
    const r = unpackState(phase2);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.version).toBe(SAVE_VERSION);
    expect(r.value.weather).toEqual(defaultWeather(raw.date.month));
    expect(checkInvariants(r.value)).toEqual([]);
    const ctx = testCtx(r.value);
    runDays(ctx, 360);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
  for (const [name, raw] of [['phase0', phase0], ['phase1', phase1], ['phase2', phase2]] as const) {
    it(`${name}.save.json migrates and plays a full year (360 days) with invariants intact`, () => {
      const r = unpackState(raw);
      if (!r.ok) throw new Error(r.error);
      expect(r.value.version).toBe(SAVE_VERSION);
      const ctx = testCtx(r.value);
      runDays(ctx, 360);
      expect(checkInvariants(ctx.state)).toEqual([]);
      expect(ctx.state.map.tiles.some((t) => t.pollution > 0)).toBe(true);
    });
  }
});

describe('v6 -> v7: nemesis', () => {
  it('is the current version', () => {
    expect(SAVE_VERSION).toBe(8);
  });
  it('rolls the old Baron 2 distinct traits from the save rng, with no grudges', () => {
    const o: Record<string, unknown> = { version: 6, rngState: 42, date: { year: 1930, month: 1 }, cities: [] };
    expect(migrateSave(o).ok).toBe(true);
    expect(o.version).toBe(SAVE_VERSION);
    const n = o.nemesis as GameState['nemesis'];
    expect(n.head).toEqual({ name: 'Baron Cornelius Smogsworth', born: 1852, generation: 1 });
    expect(n.traits).toHaveLength(2);
    expect(new Set(n.traits).size).toBe(2);
    expect(n.grudges).toEqual([]);
    expect(n.lastAction).toBeNull();
    expect(n.actionsThisYear).toBe(0);
    expect(n.effects).toEqual([]);
    expect(n.track.poached).toEqual({});
    expect(n.succession).toEqual({ done: false, year: null });
    // the draws advance the save's rng
    expect(o.rngState).not.toBe(42);
    const again: Record<string, unknown> = { version: 6, rngState: 42, date: { year: 1930, month: 1 }, cities: [] };
    migrateSave(again);
    expect((again.nemesis as GameState['nemesis']).traits).toEqual(n.traits);
  });
  it('counts contracts already finished as seen, so they never become grudges', () => {
    const base = { goodId: 'coal', qty: 1, delivered: 1, deadline: { year: 1931, month: 1, day: 1, hour: 0 }, reward: 1 };
    const o: Record<string, unknown> = {
      version: 6, rngState: 1, date: { year: 1930, month: 1 }, cities: [],
      contracts: [{ ...base, id: 3, cityId: 0, status: 'done' }, { ...base, id: 4, cityId: 0, status: 'active' }, { ...base, id: 5, cityId: 0, status: 'failed' }],
    };
    expect(migrateSave(o).ok).toBe(true);
    expect((o.nemesis as GameState['nemesis']).track.contractsSeen).toEqual([3, 5]);
  });
  it('starts the player family with a single founder Josiah, aged 28 at load, named after the company', () => {
    const o: Record<string, unknown> = {
      version: 6, rngState: 42, date: { year: 1930, month: 1 }, cities: [],
      companies: { player: { name: 'Bellows & Daughters' } },
    };
    expect(migrateSave(o).ok).toBe(true);
    const d = o.dynasty as GameState['dynasty'];
    expect(d.head).toMatchObject({ id: 1, name: 'Josiah Bellows', born: 1902, alive: true });
    expect(d.head.traits).toHaveLength(1);
    expect(d).toMatchObject({ spouse: null, children: [], heirId: null, generation: 1, prestige: 0, nextPersonId: 2 });
  });
  it('phase3.save.json migrates with nemesis set, holds invariants and plays a year', () => {
    const raw = JSON.parse(phase3) as { version: number };
    expect(raw.version).toBe(6);
    const r = unpackState(phase3);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.version).toBe(SAVE_VERSION);
    expect(r.value.nemesis.traits).toHaveLength(2);
    expect(r.value.nemesis.grudges).toEqual([]);
    expect(r.value.dynasty.head.name.startsWith('Josiah ')).toBe(true);
    expect(r.value.dynasty.generation).toBe(1);
    expect(checkInvariants(r.value)).toEqual([]);
    const ctx = testCtx(r.value);
    runDays(ctx, 360);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
  it('phase4.save.json (1950: Junior, a second generation, a live exchange) loads, holds invariants and plays a year', () => {
    const raw = JSON.parse(phase4) as { version: number };
    expect(raw.version).toBe(7);
    const r = unpackState(phase4);
    if (!r.ok) throw new Error(r.error);
    const s = r.value;
    expect(s.date.year).toBe(1950);
    expect(s.nemesis.succession.done).toBe(true);
    expect(s.nemesis.head.generation).toBe(2);
    expect(s.dynasty.generation).toBeGreaterThanOrEqual(2);
    expect(Object.values(s.companies).filter((c) => c.kind === 'regional' && c.active).length).toBeGreaterThanOrEqual(2);
    for (const l of Object.values(s.exchange.listings)) expect(Number.isFinite(l.price) && l.price > 0).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
    const ctx = testCtx(s);
    runDays(ctx, 360);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
  it('phase4b.save.json (1950: levels, hubs, managers, auto routes, motor trucks) loads, holds invariants and plays a year', () => {
    const raw = JSON.parse(phase4b) as { version: number };
    expect(raw.version).toBe(8);
    const r = unpackState(phase4b);
    if (!r.ok) throw new Error(r.error);
    const s = r.value;
    expect(s.date.year).toBe(1950);
    expect(Object.values(s.buildings).some((b) => (b.level ?? 1) >= 2)).toBe(true);
    expect(Object.values(s.vehicles).some((v) => v.hubId != null)).toBe(true);
    expect(Object.values(s.vehicles).some((v) => v.model === 'motor_truck')).toBe(true);
    expect(s.logistics.managers.some((m) => m.employer != null)).toBe(true);
    expect(Object.values(s.routes).some((rt) => rt.mode !== 'manual')).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
    const ctx = testCtx(s);
    runDays(ctx, 360);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
  it('phase4.save.json (v7) migrates to v8: level 1, steam lorries at 0.5, manual routes, logistics state', () => {
    const raw = JSON.parse(phase4) as { version: number; logistics?: unknown };
    expect(raw.version).toBe(7);
    expect(raw.logistics).toBeUndefined();
    const r = unpackState(phase4);
    if (!r.ok) throw new Error(r.error);
    const s = r.value;
    expect(s.version).toBe(8);
    expect(Object.keys(s.buildings).length).toBeGreaterThan(0);
    for (const b of Object.values(s.buildings)) expect(b.level).toBe(1);
    for (const v of Object.values(s.vehicles)) {
      expect(v.model).toBe(v.kind === 'train' ? 'train' : 'steam_lorry');
      expect(v.speed).toBe(v.kind === 'train' ? 1 : 0.5);
    }
    for (const rt of Object.values(s.routes)) expect(rt.mode).toBe('manual');
    expect(s.logistics.managers).toEqual([]);
    expect(s.logistics.market.length).toBeGreaterThanOrEqual(4);
    expect(s.logistics.marketYear).toBe(s.date.year);
    expect(checkInvariants(s)).toEqual([]);
    const ctx = testCtx(s);
    runDays(ctx, 360);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
  it('every fixture phase0 to phase4 loads at the current version, holds invariants and plays a year', () => {
    for (const [name, raw] of Object.entries({ phase0, phase1, phase2, phase3, phase4 })) {
      const r = unpackState(raw);
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      expect(r.value.version, name).toBe(SAVE_VERSION);
      expect(checkInvariants(r.value), name).toEqual([]);
      const ctx = testCtx(r.value);
      runDays(ctx, 360);
      expect(checkInvariants(ctx.state), name).toEqual([]);
    }
  });
});
