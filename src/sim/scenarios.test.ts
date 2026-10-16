import { describe, expect, it } from 'vitest';
import { SCENARIOS, evaluateGoals, goalProgress, recordSale } from './scenarios';
import { runDays } from './simulation';
import { runAutoplay } from '../game/autoplay';
import { createGame } from './state';
import { testCtx, testState } from './testkit';

describe('scenarios', () => {
  it('lumber_baron won when money >= 1M before 1920, failed after', () => {
    const s = testState({ year: 1915 });
    s.scenarioId = 'lumber_baron';
    expect(evaluateGoals(s)).toEqual({ done: [false], failed: false });
    s.companies.player.money = 1_000_000;
    expect(evaluateGoals(s)).toEqual({ done: [true], failed: false });
    s.companies.player.money = 10;
    s.date.year = 1920;
    expect(evaluateGoals(s)).toEqual({ done: [false], failed: true });
  });

  it('money goals count 1900 dollars: cash / price index (R-S14)', () => {
    const s = testState({ year: 1915 });
    s.scenarioId = 'lumber_baron';
    s.economy.priceIndex = 1.6;
    s.companies.player.money = 1_500_000; // $937,500 in 1900 dollars
    expect(evaluateGoals(s).done).toEqual([false]);
    s.companies.player.money = 1_600_000;
    expect(evaluateGoals(s).done).toEqual([true]);
    const p = goalProgress(s, SCENARIOS.lumber_baron.goals[0]);
    expect(p.label).toBe('Hold $1,000,000 in cash (in 1900 dollars)');
    expect(p.value).toBeCloseTo(1_000_000, 6);
  });

  it('goals system emits victory once and stops the clock', () => {
    const ctx = testCtx(testState({ year: 1905 }));
    ctx.state.scenarioId = 'lumber_baron';
    ctx.state.companies.player.money = 2_000_000;
    const seen: string[] = [];
    ctx.bus.on('victory', (e) => seen.push(e.reason));
    runDays(ctx, 65);
    expect(seen).toHaveLength(1);
    expect(ctx.state.speed).toBe(0);
  });

  it('goals system emits gameOver at the end of December 1919, and a late $1M does not win', () => {
    const ctx = testCtx(testState({ year: 1919 }));
    ctx.state.scenarioId = 'lumber_baron';
    ctx.state.date.month = 11;
    ctx.state.date.day = 1;
    const over: string[] = [];
    const won: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    ctx.bus.on('victory', (e) => won.push(e.reason));
    runDays(ctx, 59); // still in December
    expect(over).toEqual([]);
    runDays(ctx, 1); // end of December 1919
    expect(over.length).toBe(1);
    expect(ctx.state.date.year).toBe(1920);
    ctx.state.speed = 1;
    ctx.state.companies.player.money = 1_000_000;
    runDays(ctx, 70);
    expect(won).toEqual([]);
  });

  it('sandbox and unknown scenarios have no goals; old saves without scenarioId act as sandbox', () => {
    const s = testState();
    s.scenarioId = undefined as unknown as string;
    expect(evaluateGoals(s)).toEqual({ done: [], failed: false });
    expect(Object.keys(SCENARIOS)).toEqual(['sandbox', 'lumber_baron', 'motor_city', 'beat_the_baron', 'boomtown']);
  });

  it('recordSale counts player units and per-city sellers; zero-qty sales are ignored', () => {
    const s = testState({ year: 1910 });
    recordSale(s, { ownerId: 'player', cityId: 0, goodId: 'cars', qty: 3 });
    recordSale(s, { ownerId: 'rival', cityId: 0, goodId: 'cars', qty: 5 });
    recordSale(s, { ownerId: 'rival', cityId: 1, goodId: 'cars', qty: 0 });
    expect(s.flags['sold:cars']).toBe(3);
    expect(s.flags['seller:0:cars']).toBe('both');
    expect(s.flags['seller:1:cars']).toBeUndefined();
  });

  it('motor_city starts in 1910 with its own cash; takeover goal reads the flag', () => {
    const s = createGame({ seed: 3, scenarioId: 'motor_city' });
    expect(s.date.year).toBe(1910);
    expect(s.unlocked).toContain('cars');
    const b = testState({ year: 1930 });
    b.scenarioId = 'beat_the_baron';
    b.flags.takeover = true;
    expect(evaluateGoals(b).done).toEqual([true]);
  });

  it('boomtown checks the biggest city', () => {
    const s = testState({ year: 1950, cities: [{ x: 5, y: 5, population: 50_000 }] });
    s.scenarioId = 'boomtown';
    expect(evaluateGoals(s).done).toEqual([true]);
  });

  it('headless runs count sales inside the sim (no listener needed)', () => {
    const ctx = testCtx(createGame({ seed: 1 }));
    expect(runAutoplay(ctx).ok).toBe(true);
    let units = 0;
    ctx.bus.on('sale', (e) => { if (e.ownerId === 'player') units += e.qty; });
    runDays(ctx, 20);
    expect(units).toBeGreaterThan(0);
    const counted = Object.entries(ctx.state.flags).filter(([k]) => k.startsWith('sold:')).reduce((a, [, v]) => a + Number(v), 0);
    expect(counted).toBe(units);
  });
});
