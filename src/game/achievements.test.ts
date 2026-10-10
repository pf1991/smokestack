// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, attachAchievements, checkAchievements, loadUnlocked } from './achievements';
import { attachGoalTracking } from '../sim/scenarios';
import { testCtx, testState } from '../sim/testkit';

beforeEach(() => localStorage.clear());

const sale = (ctx: ReturnType<typeof testCtx>) =>
  ctx.bus.emit({ type: 'sale', cityId: 0, goodId: 'furniture', qty: 2, revenue: 100, ownerId: 'player', buildingId: 1 });

describe('achievements', () => {
  it('has the 12 achievements', () => {
    expect(ACHIEVEMENTS.map((a) => a.id).sort()).toEqual(
      ['baron_busted', 'centennial', 'chain_gang', 'clean_hands', 'contract_killer', 'crash_survivor', 'first_sale', 'fleet_50', 'millionaire', 'monopoly', 'motor_mogul', 'rail_baron'].sort(),
    );
  });

  it('first_sale achievement fires once', () => {
    const ctx = testCtx(testState());
    attachGoalTracking(ctx.bus, ctx.state);
    const unlocked = new Set<string>();
    expect(checkAchievements(ctx.state, unlocked)).toEqual([]);
    sale(ctx);
    expect(checkAchievements(ctx.state, unlocked)).toEqual(['first_sale']);
    expect(checkAchievements(ctx.state, unlocked)).toEqual([]);
  });

  it('attachAchievements toasts, persists and does not repeat', () => {
    const ctx = testCtx(testState());
    attachGoalTracking(ctx.bus, ctx.state);
    const toasts: string[] = [];
    const ach: string[] = [];
    ctx.bus.on('toast', (e) => toasts.push(e.message));
    ctx.bus.on('achievement', (e) => ach.push(e.id));
    const off = attachAchievements(ctx);
    sale(ctx);
    ctx.bus.emit({ type: 'dayStart', date: ctx.state.date });
    ctx.bus.emit({ type: 'dayStart', date: ctx.state.date });
    expect(ach).toEqual(['first_sale']);
    expect(toasts.length).toBe(1);
    expect([...loadUnlocked()]).toEqual(['first_sale']);
    off();
  });

  it('baron_busted, millionaire and centennial read state', () => {
    const s = testState({ year: 2000 });
    s.flags.takeover = true;
    s.companies.player.money = 1_500_000;
    expect(checkAchievements(s, new Set())).toEqual(expect.arrayContaining(['baron_busted', 'millionaire', 'centennial']));
  });
});
