import { describe, expect, it } from 'vitest';
import { err } from '../core/result';
import { unpackState } from '../game/saves';
import { checkInvariants } from './invariants';
import { urbanRadius } from './market';
import { migrateSave, runAfterLoad, SAVE_VERSION, type Migration } from './migrations';
import { runDays } from './simulation';
import { testCtx, testState } from './testkit';

const fixtures = import.meta.glob('./__fixtures__/phase*.save.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phase0 = fixtures['./__fixtures__/phase0.save.json'];
const phase1 = fixtures['./__fixtures__/phase1.save.json'];

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
    const o: Record<string, unknown> = { version: 3, cities: [{ id: 0, name: 'A' }, { id: 1, name: 'B', landmarks: [{ id: 'church', pos: { x: 1, y: 1 } }] }] };
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
  it('is the current version', () => {
    expect(SAVE_VERSION).toBe(5);
  });
  it('gives every city the default opinion and the save default politics', () => {
    const o: Record<string, unknown> = { version: 4, cities: [{ id: 0 }, { id: 1 }] };
    const r = migrateSave(o);
    expect(r.ok).toBe(true);
    expect(o.version).toBe(5);
    for (const c of o.cities as { opinion: unknown }[]) expect(c.opinion).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
    expect(o.politics).toMatchObject({ edicts: { wage: 'fair', safety: 'standard', union: 'tolerate' }, cards: { pending: [], history: [] }, log: [] });
  });
  for (const [name, raw] of [['phase0', phase0], ['phase1', phase1]] as const) {
    it(`${name}.save.json migrates to v5 with every city at 50 (Baron 35) and holds invariants`, () => {
      expect(raw).toBeDefined();
      const r = unpackState(raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const s = r.value;
      expect(s.version).toBe(5);
      expect(s.cities.length).toBeGreaterThan(0);
      for (const c of s.cities) expect(c.opinion).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
      expect(s.politics.edicts).toEqual({ wage: 'fair', safety: 'standard', union: 'tolerate' });
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
