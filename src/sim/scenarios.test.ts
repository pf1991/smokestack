import { describe, expect, it } from 'vitest';
import { SCENARIOS, attachGoalTracking, evaluateGoals } from './scenarios';
import { runDays } from './simulation';
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

  it('goals system emits gameOver when the deadline passes', () => {
    const ctx = testCtx(testState({ year: 1919 }));
    ctx.state.scenarioId = 'lumber_baron';
    ctx.state.date.month = 12;
    ctx.state.date.day = 1;
    const over: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    runDays(ctx, 65);
    expect(over.length).toBe(1);
  });

  it('sandbox and unknown scenarios have no goals; old saves without scenarioId act as sandbox', () => {
    const s = testState();
    s.scenarioId = undefined as unknown as string;
    expect(evaluateGoals(s)).toEqual({ done: [], failed: false });
    expect(Object.keys(SCENARIOS)).toEqual(['sandbox', 'lumber_baron', 'motor_city', 'beat_the_baron', 'boomtown']);
  });

  it('tracks sold:<good> from player sale events only', () => {
    const ctx = testCtx(testState({ year: 1910 }));
    attachGoalTracking(ctx.bus, ctx.state);
    const sale = (ownerId: 'player' | 'rival', qty: number) =>
      ctx.bus.emit({ type: 'sale', cityId: 0, goodId: 'cars', qty, revenue: 1, ownerId, buildingId: 1 });
    sale('player', 3);
    sale('rival', 5);
    expect(ctx.state.flags['sold:cars']).toBe(3);
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
});
