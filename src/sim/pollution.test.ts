import { describe, expect, it } from 'vitest';
import { runDays } from './simulation';
import { cityPollution, emissionFactor, POLLUTION_CAP, pollutionDay, pollutionMonth, pollutionSystem, smogDay } from './pollution';
import { LANDMARK_LAYER } from './landmarkTiles';
import { layer } from './layers';
import { terrainChanged } from './terrainEpoch';
import type { Terrain } from './types';
import { monthlyGrowth } from './market';
import { placeBuilding } from './state';
import { must, testCtx, testState } from './testkit';

function millCtx() {
  const ctx = testCtx(testState({ width: 40, height: 30, money: 1e7 }));
  const b = must(placeBuilding(ctx, 'player', 'steel_mill', { x: 10, y: 10 }, 'r_steel'));
  b.status = 'ok';
  return { ctx, b };
}
type Ctx = ReturnType<typeof testCtx>;
const at = (ctx: Ctx, x: number, y: number) => ctx.state.map.tiles[y * ctx.state.map.width + x].pollution;
const total = (ctx: Ctx) => ctx.state.map.tiles.reduce((s, t) => s + t.pollution, 0);
const field = (ctx: Ctx) => ctx.state.map.tiles.map((t) => t.pollution);
const setTerrain = (ctx: Ctx, x: number, y: number, t: Terrain) => (ctx.state.map.tiles[y * ctx.state.map.width + x].terrain = t);
/** no wind, no rain: emission, diffusion and decay only */
const calm = (ctx: Ctx) => (ctx.state.weather = { windX: 0, windY: 0, rain: false, rainDays: 0 });

describe('pollution', () => {
  it('steel mill pollutes its centre and neighbours, not far tiles', () => {
    const { ctx } = millCtx();
    calm(ctx);
    smogDay(ctx);
    expect(at(ctx, 11, 11)).toBeGreaterThan(0);
    expect(at(ctx, 12, 11)).toBeGreaterThan(0);
    expect(at(ctx, 11, 11)).toBeGreaterThanOrEqual(at(ctx, 12, 11));
    expect(at(ctx, 12, 11)).toBeGreaterThan(at(ctx, 13, 11));
    expect(at(ctx, 25, 25)).toBe(0);
    expect(at(ctx, 17, 11)).toBe(0);
  });

  it('one day of a low-pollution source: the centre holds strictly more than its neighbour', () => {
    const ctx = testCtx(testState({ width: 40, height: 30, money: 1e7 }));
    // textile mill (pollution 2): far below the cap after one day, so the kernel shape shows
    must(placeBuilding(ctx, 'player', 'textile_mill', { x: 10, y: 10 }, 'r_fabric')).status = 'ok';
    calm(ctx);
    smogDay(ctx);
    expect(at(ctx, 11, 11)).toBeLessThan(POLLUTION_CAP);
    expect(at(ctx, 11, 11)).toBeGreaterThan(at(ctx, 12, 11));
    expect(at(ctx, 12, 11)).toBeGreaterThan(at(ctx, 13, 11));
    expect(at(ctx, 13, 11)).toBeGreaterThan(0);
  });

  it('pollutionDay is the old name of smogDay', () => {
    expect(pollutionDay).toBe(smogDay);
  });

  it('emissionFactor is 1 until scrubbers exist', () => {
    const { ctx, b } = millCtx();
    expect(emissionFactor(ctx.state, b)).toBe(1);
  });

  it('only ok buildings pollute, and tiles cap at 100', () => {
    const { ctx, b } = millCtx();
    b.status = 'no_input';
    smogDay(ctx);
    expect(at(ctx, 11, 11)).toBe(0);
    b.status = 'ok';
    for (let i = 0; i < 300; i++) smogDay(ctx);
    expect(Math.max(...ctx.state.map.tiles.map((t) => t.pollution))).toBeLessThanOrEqual(100);
  });

  it('decays to near zero after 120 idle days', () => {
    const { ctx, b } = millCtx();
    for (let i = 0; i < 30; i++) smogDay(ctx);
    b.status = 'idle';
    for (let i = 0; i < 120; i++) smogDay(ctx);
    expect(Math.max(...ctx.state.map.tiles.map((t) => t.pollution))).toBeLessThan(5);
  });

  it('is deterministic: two runs give the same field, and a reloaded map continues identically', () => {
    const run = () => {
      const ctx = testCtx(testState({ width: 60, height: 40, money: 1e8 }));
      for (const [x, y] of [[10, 10], [30, 12], [45, 25], [20, 30]]) must(placeBuilding(ctx, 'player', 'steel_mill', { x, y }, 'r_steel')).status = 'ok';
      for (let i = 0; i < 90; i++) pollutionSystem.onDay(ctx);
      return ctx;
    };
    const a = run();
    const b = run();
    expect(field(b)).toEqual(field(a));
    // a clone gets a fresh map (dirty set rebuilt by scan order) and must continue bit-for-bit
    const c = testCtx(JSON.parse(JSON.stringify(a.state)));
    for (let i = 0; i < 60; i++) {
      pollutionSystem.onDay(a);
      pollutionSystem.onDay(c);
    }
    expect(field(c)).toEqual(field(a));
    expect(c.state.weather).toEqual(a.state.weather);
  });

  it('drifts downwind: a constant east wind for 60 days leaves more smog east of the source than west', () => {
    const { ctx } = millCtx();
    ctx.state.weather = { windX: 1, windY: 0, rain: false, rainDays: 0 };
    for (let i = 0; i < 60; i++) smogDay(ctx);
    const east = at(ctx, 12, 11) + at(ctx, 13, 11) + at(ctx, 14, 11);
    const west = at(ctx, 10, 11) + at(ctx, 9, 11) + at(ctx, 8, 11);
    expect(east).toBeGreaterThan(west);
    expect(west).toBeGreaterThan(0); // diffusion still reaches upwind a little
  });

  it('forest absorbs: a forest tile next to a source holds less than grass at the same offset', () => {
    const { ctx } = millCtx();
    calm(ctx);
    setTerrain(ctx, 13, 11, 'forest');
    for (let i = 0; i < 60; i++) smogDay(ctx);
    expect(at(ctx, 13, 11)).toBeLessThan(at(ctx, 9, 11));
  });

  it('a terrain change reported through terrainChanged reaches the cached decay classes', () => {
    const { ctx } = millCtx();
    calm(ctx);
    for (const x of [12, 13, 14]) setTerrain(ctx, x, 11, 'forest');
    for (let i = 0; i < 20; i++) smogDay(ctx);
    for (const x of [12, 13, 14]) setTerrain(ctx, x, 11, 'grass');
    terrainChanged(ctx.state.map);
    const fresh = testCtx(JSON.parse(JSON.stringify(ctx.state))); // a loaded map scans terrain afresh
    for (let i = 0; i < 20; i++) {
      smogDay(ctx);
      smogDay(fresh);
    }
    expect(field(ctx)).toEqual(field(fresh));
  });

  it('parks absorb: a park landmark tile holds less than grass at the same offset', () => {
    const ctx = testCtx(testState({ width: 40, height: 30, money: 1e7, cities: [{ x: 30, y: 25 }] }));
    must(placeBuilding(ctx, 'player', 'steel_mill', { x: 10, y: 10 }, 'r_steel')).status = 'ok';
    calm(ctx);
    const city = ctx.state.cities[0];
    city.landmarks.push({ id: 'park', pos: { x: 13, y: 11 } });
    const l = layer(ctx.state, LANDMARK_LAYER);
    for (const [x, y] of [[13, 11], [14, 11], [13, 12], [14, 12]]) l[y * 40 + x] = city.landmarks.length;
    for (let i = 0; i < 60; i++) smogDay(ctx);
    expect(at(ctx, 13, 11)).toBeLessThan(at(ctx, 9, 11));
  });

  it('rain washes out at least 30% in one day', () => {
    const { ctx, b } = millCtx();
    calm(ctx);
    for (let i = 0; i < 30; i++) smogDay(ctx);
    b.status = 'idle';
    const before = total(ctx);
    ctx.state.weather.rain = true;
    smogDay(ctx);
    expect(total(ctx)).toBeLessThanOrEqual(before * 0.7);
  });

  it('a valley pocket ringed by hills keeps more smog than open grass', () => {
    const ctx = testCtx(testState({ width: 40, height: 30, money: 1e7 }));
    calm(ctx);
    // two identical stamps of smog, one in a pocket at (10,10), one on open grass at (30,10)
    for (const [x, y] of [[9, 10], [11, 10], [10, 9], [10, 11]]) setTerrain(ctx, x, y, 'hills');
    ctx.state.map.tiles[10 * 40 + 10].pollution = 50;
    ctx.state.map.tiles[10 * 40 + 30].pollution = 50;
    const fresh = testCtx(JSON.parse(JSON.stringify(ctx.state))); // the dirty set is built from a scan
    for (let i = 0; i < 20; i++) smogDay(fresh);
    expect(at(fresh, 10, 10)).toBeGreaterThan(at(fresh, 30, 10));
  });

  it('stays bounded: 50 max-emission sources for 365 days never exceed the cap or go NaN', () => {
    // refineries are the dirtiest building (pollution 8), packed 4 tiles apart so their plumes overlap
    const ctx = testCtx(testState({ width: 60, height: 40, money: 1e9, year: 1950 }));
    for (let i = 0; i < 50; i++) {
      const b = must(placeBuilding(ctx, 'player', 'refinery', { x: 2 + (i % 10) * 4, y: 2 + Math.floor(i / 10) * 4 }, 'r_fuel'));
      b.status = 'ok';
    }
    for (let d = 0; d < 365; d++) pollutionSystem.onDay(ctx);
    for (const t of ctx.state.map.tiles) {
      expect(Number.isFinite(t.pollution)).toBe(true);
      expect(t.pollution).toBeGreaterThanOrEqual(0);
      expect(t.pollution).toBeLessThanOrEqual(POLLUTION_CAP);
    }
    expect(Math.max(...ctx.state.map.tiles.map((t) => t.pollution))).toBeGreaterThan(1);
  });

  it('city pollution reduces growth', () => {
    const ctx = testCtx(testState({ width: 60, height: 30, cities: [{ x: 10, y: 15 }, { x: 45, y: 15 }] }));
    for (const t of ctx.state.map.tiles) if (t.cityId === 0) t.pollution = 80;
    ctx.state.date.day = 30;
    pollutionSystem.onDay(ctx);
    // one day of drift and decay (rain or not) leaves most of it
    expect(ctx.state.cities[0].pollution).toBeGreaterThan(0.8 * 0.7 * 0.97 * 0.9);
    expect(ctx.state.cities[0].pollution).toBeLessThan(0.8);
    expect(ctx.state.cities[1].pollution).toBe(0);
    expect(cityPollution(ctx.state, 1)).toBe(0);
    expect(monthlyGrowth(6000, 0.6, ctx.state.cities[0].pollution)).toBeLessThan(monthlyGrowth(6000, 0.6, 0));
  });

  it('happiness blends satisfaction and clean air', () => {
    const ctx = testCtx(testState({ cities: [{ x: 10, y: 10 }] }));
    ctx.state.cities[0].happiness = 0.5; // avg satisfaction written by growthMonth
    ctx.state.cities[0].pollution = 0.5;
    pollutionMonth(ctx);
    expect(ctx.state.cities[0].happiness).toBeCloseTo(0.6 * 0.5 + 0.4 * 0.5);
  });

  it('warning news at most once per year per city', () => {
    const ctx = testCtx(testState({ cities: [{ x: 10, y: 10, name: 'Coalhaven' }] }));
    ctx.state.cities[0].pollution = 0.9;
    pollutionMonth(ctx);
    pollutionMonth(ctx);
    ctx.state.date.month = 6;
    pollutionMonth(ctx);
    const warns = ctx.state.news.filter((n) => n.kind === 'warning');
    expect(warns.length).toBe(1);
    expect(warns[0].headline).toContain('Coalhaven');
    ctx.state.date.year += 1;
    pollutionMonth(ctx);
    expect(ctx.state.news.filter((n) => n.kind === 'warning').length).toBe(2);
  });

  it('is wired into SYSTEMS: city pollution is set before the month closes', () => {
    const ctx = testCtx(testState({ money: 1e7, cities: [{ x: 12, y: 12 }] }));
    for (const t of ctx.state.map.tiles) t.pollution = 60;
    runDays(ctx, 30);
    // a month of wind, decay and rain later (rain days cut 30% each) some smog remains, and the city has it
    expect(ctx.state.cities[0].pollution).toBeGreaterThan(0.001);
    expect(ctx.state.cities[0].pollution).toBeCloseTo(cityPollution(ctx.state, 0), 9);
  });

  it('is fast: 128x96 map, 60 buildings, under 2 ms per day', () => {
    const ctx = testCtx(testState({ width: 128, height: 96, money: 1e9 }));
    for (let i = 0; i < 60; i++) {
      const b = must(placeBuilding(ctx, 'player', 'steel_mill', { x: 4 + (i % 10) * 12, y: 4 + Math.floor(i / 10) * 14 }, 'r_steel'));
      b.status = 'ok';
    }
    for (let i = 0; i < 200; i++) pollutionSystem.onDay(ctx);
    const t0 = performance.now();
    const N = 100;
    for (let i = 0; i < N; i++) pollutionSystem.onDay(ctx);
    const per = (performance.now() - t0) / N;
    console.log('smog ms/day', per.toFixed(3));
    expect(per).toBeLessThan(2);
  });
});
