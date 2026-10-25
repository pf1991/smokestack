// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  attachAchievements,
  chaseChipText,
  checkAchievements,
  DECADE_BLACK_MONTHS,
  loadUnlocked,
  nextChase,
} from './achievements';
import { recordNationalSale, recordSale } from '../sim/scenarios';
import { testCtx, testState } from '../sim/testkit';
import type { Building } from '../sim/types';

beforeEach(() => localStorage.clear());

const sale = (ctx: ReturnType<typeof testCtx>) => {
  recordSale(ctx.state, { ownerId: 'player', cityId: 0, goodId: 'furniture', qty: 2 });
  ctx.bus.emit({ type: 'sale', cityId: 0, goodId: 'furniture', qty: 2, revenue: 100, ownerId: 'player', buildingId: 1 });
};

const MID_GAME = [
  'first_th_sale',
  'first_component',
  'first_hub',
  'first_appliance',
  'survive_price_war',
  'first_scrubber',
  'second_line',
  'decade_black',
];

describe('achievements', () => {
  it('has the original twelve plus mid-game chaseables', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      'baron_busted', 'centennial', 'chain_gang', 'clean_hands', 'contract_killer', 'crash_survivor',
      'first_sale', 'fleet_50', 'millionaire', 'monopoly', 'motor_mogul', 'rail_baron',
      ...MID_GAME,
    ]));
    expect(ids.length).toBe(12 + MID_GAME.length);
    for (const id of MID_GAME) expect(ids).toContain(id);
  });

  it('first_sale achievement fires once', () => {
    const ctx = testCtx(testState());
    const unlocked = new Set<string>();
    expect(checkAchievements(ctx.state, unlocked)).toEqual([]);
    sale(ctx);
    expect(checkAchievements(ctx.state, unlocked)).toEqual(['first_sale']);
    expect(checkAchievements(ctx.state, unlocked)).toEqual([]);
  });

  it('attachAchievements toasts, persists and does not repeat', () => {
    const ctx = testCtx(testState());
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

  it('millionaire and clean_hands count real money: net worth / price index (R-S14)', () => {
    const s = testState({ year: 1990 });
    s.economy.priceIndex = 13;
    s.companies.player.money = 12_000_000; // under $1M in 1900 dollars
    const ids = () => checkAchievements(s, new Set());
    expect(ids()).not.toContain('millionaire');
    expect(ids()).not.toContain('clean_hands');
    s.companies.player.money = 13_100_000;
    expect(ids()).toEqual(expect.arrayContaining(['millionaire', 'clean_hands']));
  });

  it('baron_busted announced by the takeover is recorded without a second fanfare', () => {
    const ctx = testCtx(testState());
    ctx.state.flags.takeover = true;
    const ach: string[] = [];
    ctx.bus.on('achievement', (e) => ach.push(e.id));
    const off = attachAchievements(ctx);
    ctx.bus.emit({ type: 'achievement', id: 'baron_busted' });
    ctx.bus.emit({ type: 'dayStart', date: ctx.state.date });
    expect(ach.filter((i) => i === 'baron_busted')).toHaveLength(1);
    expect(loadUnlocked().has('baron_busted')).toBe(true);
    off();
  });

  it('crash_survivor needs the crash window to have been played; monopoly is a sticky flag', () => {
    const late = testState({ year: 1950 });
    expect(checkAchievements(late, new Set())).not.toContain('crash_survivor');
    late.flags.crashMonths = 36;
    expect(checkAchievements(late, new Set())).toContain('crash_survivor');
    const m = testState();
    m.flags.monopoly = true;
    expect(checkAchievements(m, new Set())).toContain('monopoly');
  });

  it('mid-game: TH sale, component, hub, appliance, price war, scrubber, second line, decade', () => {
    const s = testState();
    const unlocked = new Set<string>();
    expect(checkAchievements(s, unlocked)).toEqual([]);

    recordNationalSale(s, { ownerId: 'player', goodId: 'steel', qty: 2 });
    expect(s.flags.thSales).toBe(2);
    expect(checkAchievements(s, unlocked)).toContain('first_th_sale');

    s.flags['sold:wire'] = 1;
    expect(checkAchievements(s, unlocked)).toContain('first_component');

    s.buildings[1] = { id: 1, ownerId: 'player', typeId: 'warehouse', hub: {} } as unknown as Building;
    expect(checkAchievements(s, unlocked)).toContain('first_hub');

    s.flags['sold:refrigerators'] = 1;
    expect(checkAchievements(s, unlocked)).toContain('first_appliance');

    s.flags.priceWarSurvived = true;
    expect(checkAchievements(s, unlocked)).toContain('survive_price_war');

    s.buildings[2] = { id: 2, ownerId: 'player', typeId: 'steel_mill', upgrades: { scrubber: 1, tallChimney: false } } as unknown as Building;
    expect(checkAchievements(s, unlocked)).toContain('first_scrubber');

    s.flags['sold:furniture'] = 5;
    s.flags['sold:bread'] = 3;
    expect(checkAchievements(s, unlocked)).toContain('second_line');

    s.flags.blackMonths = DECADE_BLACK_MONTHS;
    expect(checkAchievements(s, unlocked)).toContain('decade_black');
  });

  it('chase chip prefers nearest numeric progress, else catalogue order', () => {
    const s = testState();
    s.flags.contractsDone = 3;
    const text = chaseChipText(s, new Set());
    expect(text).toBe('Next: Contract Killer · 3/10');

    const unlocked = new Set(ACHIEVEMENTS.filter((a) => a.progress).map((a) => a.id));
    const chase = nextChase(s, unlocked);
    expect(chase?.def.id).toBe('first_sale');
    expect(chaseChipText(s, unlocked)).toBe('Next: First Sale');

    const all = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(chaseChipText(s, all)).toBeNull();
  });
});
