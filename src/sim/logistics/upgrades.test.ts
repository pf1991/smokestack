import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../../core/events';
import { BUILDINGS } from '../../data/buildings';
import { packState, unpackState } from '../../game/saves';
import { dateToDays } from '../clock';
import { currentLedger } from '../finance';
import { checkInvariants } from '../invariants';
import { productionDay } from '../production';
import { monthIndex } from '../politics/elections';
import { protestSite } from '../society/escalation';
import { monthlyFines } from '../society/regulation';
import { demolishBuilding, demolitionRefund, placeBuilding } from '../state';
import { transferOwnership } from '../companies';
import { startStrike } from '../society/strikes';
import { must, testCtx, testState } from '../testkit';
import type { Building, SimContext } from '../types';
import { logisticsDay } from './index';
import { nextLevel, startUpgrade, upgradeCost, upgradeRefusal, worksDay } from './levels';

function place(ctx: SimContext, type: string, x: number, y: number): Building {
  return must(placeBuilding(ctx, 'player', type, { x, y }));
}

/** One day as the sim runs it: production, then the logistics hooks. */
function day(ctx: SimContext): void {
  productionDay(ctx);
  logisticsDay(ctx);
  ctx.state.date = { ...ctx.state.date, day: ctx.state.date.day + 1 };
  if (ctx.state.date.day > 30) ctx.state.date = { ...ctx.state.date, day: 1, month: ctx.state.date.month + 1 };
}

describe('upgrade price and refusals', () => {
  it('level 2 costs half the build price times the price index', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    ctx.state.economy.priceIndex = 1.5;
    const mill = place(ctx, 'sawmill', 5, 5);
    expect(upgradeCost(ctx.state, mill)).toBe(Math.round(BUILDINGS.sawmill.cost * 0.5 * 1.5));
    expect(nextLevel(mill)?.level).toBe(2);
  });

  it('level 3 arrives in 1920 and level 4 in 1950', () => {
    const ctx = testCtx(testState({ money: 1e9 }));
    const mill = place(ctx, 'sawmill', 5, 5);
    mill.level = 2;
    expect(upgradeRefusal(ctx.state, mill, 'player')).toBe('Level 3 arrives in 1920');
    ctx.state.date.year = 1920;
    expect(upgradeRefusal(ctx.state, mill, 'player')).toBeNull();
    mill.level = 3;
    expect(upgradeRefusal(ctx.state, mill, 'player')).toBe('Level 4 arrives in 1950');
    ctx.state.date.year = 1950;
    expect(upgradeRefusal(ctx.state, mill, 'player')).toBeNull();
    mill.level = 4;
    expect(upgradeRefusal(ctx.state, mill, 'player')).toBe('Already at the top level');
  });

  it('refuses other owners, buildings without levels, a second works and an empty purse', () => {
    const ctx = testCtx(testState({ money: 1e7, cities: [{ x: 22, y: 22, population: 5000 }], streets: true }));
    const mill = place(ctx, 'sawmill', 5, 5);
    expect(upgradeRefusal(ctx.state, mill, 'rival')).toBe('Not your building');
    let store: Building | null = null;
    for (let y = 16; y < 28 && !store; y++) {
      for (let x = 16; x < 28 && !store; x++) {
        const r = placeBuilding(ctx, 'player', 'store', { x, y });
        if (r.ok) store = r.value;
      }
    }
    expect(upgradeRefusal(ctx.state, store!, 'player')).toBe('This building has no levels');
    expect(startUpgrade(ctx, mill.id, 'player').ok).toBe(true);
    expect(upgradeRefusal(ctx.state, mill, 'player')).toBe('Works already under way');
    const second = startUpgrade(ctx, mill.id, 'player');
    expect(second.ok).toBe(false);
    const poor = place(ctx, 'sawmill', 12, 5);
    ctx.state.companies.player.money = 0;
    expect(upgradeRefusal(ctx.state, poor, 'player')).toBe('Not enough money');
  });
});

describe('works', () => {
  it('charges construction, pauses output for exactly 30 days, then produces at x1.4', () => {
    const ctx = testCtx(testState({ money: 1e7, terrain: 'forest' }));
    const camp = place(ctx, 'lumber_camp', 5, 5);
    const twin = place(ctx, 'lumber_camp', 15, 15);
    camp.staffing = twin.staffing = 1;
    const before = ctx.state.companies.player.money;
    const r = must(startUpgrade(ctx, camp.id, 'player'));
    expect(r.days).toBe(30);
    expect(before - ctx.state.companies.player.money).toBe(r.cost);
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).expense.construction).toBeGreaterThanOrEqual(r.cost);
    expect(camp.status).toBe('upgrading');
    expect(ctx.state.logistics.stats.upgrades.player).toBe(1);
    let paused = 0;
    let level2 = 0;
    let level1 = 0;
    for (let d = 0; d < 40; d++) {
      camp.output = {};
      twin.output = {};
      day(ctx);
      if ((camp.output.wood ?? 0) === 0) paused++;
      else {
        level2 = camp.output.wood!;
        level1 = twin.output.wood!;
        break;
      }
    }
    expect(paused).toBe(30);
    expect(level2 / level1).toBeCloseTo(1.4, 6);
    expect(camp.works).toBeUndefined();
  });

  it('upgrading resets builtYear and emits buildingUpgraded', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const events: GameEvent[] = [];
    (ctx.bus as EventBus).onAny((e) => events.push(e));
    const mill = place(ctx, 'sawmill', 5, 5);
    mill.builtYear = 1880;
    startUpgrade(ctx, mill.id, 'player');
    for (let d = 0; d < 30; d++) day(ctx);
    expect(mill.level).toBe(2);
    expect(mill.builtYear).toBe(ctx.state.date.year);
    expect(mill.status).toBe('idle');
    expect(events.filter((e) => e.type === 'buildingUpgraded')).toEqual([
      { type: 'buildingUpgraded', buildingId: mill.id, level: 2, ownerId: 'player' },
    ]);
  });

  it('a strike or a sabotage halt during works leaves untilDay alone', () => {
    const ctx = testCtx(testState({ width: 100, height: 40, money: 1e7, cities: [{ x: 10, y: 20, population: 1000, name: 'Ashford' }] }));
    const mill = place(ctx, 'sawmill', 30, 20);
    const other = place(ctx, 'sawmill', 40, 20);
    startUpgrade(ctx, mill.id, 'player');
    startUpgrade(ctx, other.id, 'player');
    const until = mill.works!.untilDay;
    startStrike(ctx, mill, ctx.state.cities[0]);
    other.haltedUntil = { ...ctx.state.date, month: ctx.state.date.month + 1 };
    for (let d = 0; d < 5; d++) day(ctx);
    expect(mill.status).toBe('upgrading');
    expect(other.status).toBe('upgrading');
    expect(mill.works!.untilDay).toBe(until);
    expect(other.works!.untilDay).toBe(until);
    for (let d = 0; d < 25; d++) day(ctx);
    expect(mill.level).toBe(2);
    expect(other.level).toBe(2);
  });

  it('survives packState and unpackState and finishes on the same day', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const mill = place(ctx, 'sawmill', 5, 5);
    startUpgrade(ctx, mill.id, 'player');
    for (let d = 0; d < 10; d++) day(ctx);
    const loaded = must(unpackState(packState(ctx.state)));
    const ctx2 = testCtx(loaded);
    expect(loaded.buildings[mill.id].works).toEqual(mill.works);
    let finished = 0;
    for (let d = 0; d < 30 && !finished; d++) {
      day(ctx2);
      day(ctx);
      if (loaded.buildings[mill.id].level === 2) finished = d;
      expect(loaded.buildings[mill.id].level).toBe(mill.level);
    }
    expect(finished).toBeGreaterThan(0);
    expect(dateToDays(ctx2.state.date)).toBe(dateToDays(ctx.state.date));
  });

  it('a takeover mid-works keeps the works and the new owner gets the level', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const mill = place(ctx, 'sawmill', 5, 5);
    startUpgrade(ctx, mill.id, 'player');
    transferOwnership(ctx, 'player', 'rival');
    expect(mill.ownerId).toBe('rival');
    expect(mill.works).toBeDefined();
    for (let d = 0; d < 30; d++) day(ctx);
    expect(mill.level).toBe(2);
    expect(mill.ownerId).toBe('rival');
  });

  it('demolishing mid-works refunds only the demolition refund', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const mill = place(ctx, 'sawmill', 5, 5);
    startUpgrade(ctx, mill.id, 'player');
    const before = ctx.state.companies.player.money;
    must(demolishBuilding(ctx, mill.id, 'player'));
    const gain = ctx.state.companies.player.money - before;
    expect(gain).toBe(demolitionRefund(ctx.state, mill));
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('a works under upgrade emits no smoke', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const mill = place(ctx, 'sawmill', 10, 10);
    mill.status = 'ok';
    startUpgrade(ctx, mill.id, 'player');
    productionDay(ctx);
    expect(mill.status).toBe('upgrading');
    const dirt = ctx.state.map.tiles.reduce((a, t) => a + t.pollution, 0);
    expect(dirt).toBe(0);
  });

  it('worksDay does nothing when no building has works', () => {
    const ctx = testCtx(testState());
    place(ctx, 'sawmill', 5, 5);
    expect(() => worksDay(ctx)).not.toThrow();
  });
});

describe('level smoke reaches the law readers', () => {
  function enforced() {
    const ctx = testCtx(testState({ width: 100, height: 60, money: 1e7, year: 1926, cities: [{ x: 20, y: 20 }] }));
    ctx.state.date = { ...ctx.state.date, year: 1926, month: 6 };
    ctx.state.society.laws.smoke_abatement = { passed: 1925, enforcedFrom: monthIndex(ctx.state.date) - 1, lobbied: false };
    const prev = { ...ctx.state.date, month: 5 };
    currentLedger(ctx.state.companies.player, prev).income.sales = 1e6;
    return ctx;
  }

  it('fines a level 2 works on its higher smoke', () => {
    const ctx = enforced();
    const steel = place(ctx, 'steel_mill', 40, 30);
    const level1 = monthlyFines(ctx.state);
    expect(level1).toBe(BUILDINGS.steel_mill.pollution * 400);
    steel.level = 2;
    expect(monthlyFines(ctx.state)).toBeCloseTo(level1 * 1.3, 9);
  });

  it('ranks the protest site by level smoke', () => {
    const ctx = testCtx(testState({ width: 80, height: 60, money: 1e7, cities: [{ x: 20, y: 20, population: 6000 }] }));
    const first = place(ctx, 'sawmill', 29, 19);
    const second = place(ctx, 'sawmill', 26, 26);
    expect(protestSite(ctx.state, ctx.state.cities[0])?.id).toBe(first.id);
    second.level = 2;
    expect(protestSite(ctx.state, ctx.state.cities[0])?.id).toBe(second.id);
  });
});
