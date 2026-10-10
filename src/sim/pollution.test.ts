import { describe, expect, it } from 'vitest';
import { runDays } from './simulation';
import { cityPollution, pollutionDay, pollutionMonth, pollutionSystem } from './pollution';
import { monthlyGrowth } from './market';
import { placeBuilding } from './state';
import { must, testCtx, testState } from './testkit';

function millCtx() {
  const ctx = testCtx(testState({ width: 40, height: 30, money: 1e7 }));
  const b = must(placeBuilding(ctx, 'player', 'steel_mill', { x: 10, y: 10 }, 'r_steel'));
  b.status = 'ok';
  return { ctx, b };
}
const at = (ctx: ReturnType<typeof testCtx>, x: number, y: number) => ctx.state.map.tiles[y * ctx.state.map.width + x].pollution;

describe('pollution', () => {
  it('steel mill pollutes neighbours, not far tiles', () => {
    const { ctx } = millCtx();
    pollutionDay(ctx);
    expect(at(ctx, 11, 11)).toBeGreaterThan(0);
    expect(at(ctx, 12, 11)).toBeGreaterThan(0);
    expect(at(ctx, 11, 11)).toBeGreaterThan(at(ctx, 13, 11));
    expect(at(ctx, 25, 25)).toBe(0);
    expect(at(ctx, 17, 11)).toBe(0);
  });

  it('only ok buildings pollute, and tiles cap at 100', () => {
    const { ctx, b } = millCtx();
    b.status = 'no_input';
    pollutionDay(ctx);
    expect(at(ctx, 11, 11)).toBe(0);
    b.status = 'ok';
    for (let i = 0; i < 300; i++) pollutionDay(ctx);
    expect(Math.max(...ctx.state.map.tiles.map((t) => t.pollution))).toBeLessThanOrEqual(100);
  });

  it('decays to near zero after 120 idle days', () => {
    const { ctx, b } = millCtx();
    for (let i = 0; i < 30; i++) pollutionDay(ctx);
    b.status = 'idle';
    for (let i = 0; i < 120; i++) pollutionDay(ctx);
    expect(Math.max(...ctx.state.map.tiles.map((t) => t.pollution))).toBeLessThan(5); // saturated 100 × 0.97^120 ≈ 2.6
  });

  it('city pollution reduces growth', () => {
    const ctx = testCtx(testState({ width: 60, height: 30, cities: [{ x: 10, y: 15 }, { x: 45, y: 15 }] }));
    for (const t of ctx.state.map.tiles) if (t.cityId === 0) t.pollution = 80;
    ctx.state.date.day = 30;
    pollutionSystem.onDay(ctx);
    expect(ctx.state.cities[0].pollution).toBeCloseTo(0.8 * 0.97, 3);
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
    expect(ctx.state.cities[0].pollution).toBeGreaterThan(0.1);
  });

  it('is fast: 128x96 map, 60 buildings, under 2 ms per day', () => {
    const ctx = testCtx(testState({ width: 128, height: 96, money: 1e9 }));
    for (let i = 0; i < 60; i++) {
      const b = must(placeBuilding(ctx, 'player', 'steel_mill', { x: 4 + (i % 10) * 12, y: 4 + Math.floor(i / 10) * 14 }, 'r_steel'));
      b.status = 'ok';
    }
    for (let i = 0; i < 20; i++) pollutionDay(ctx);
    const t0 = performance.now();
    const N = 100;
    for (let i = 0; i < N; i++) pollutionDay(ctx);
    const per = (performance.now() - t0) / N;
    console.log('pollutionDay ms/day', per.toFixed(3));
    expect(per).toBeLessThan(2);
  });
});
