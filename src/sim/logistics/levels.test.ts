import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { checkInvariants } from '../invariants';
import { productionDay } from '../production';
import { storageLeft } from '../inventory';
import { assetValue, assetValues, placeBuilding } from '../state';
import { atPrices } from '../society/economy';
import { testCtx, testState } from '../testkit';
import type { Building, SimContext } from '../types';
import { buildingStorage, buildingWorkers, hubRange, levelCostShare, levelDef, levelRate, levelSmoke, levelUpkeep } from './levels';
import { newLogistics } from './types';

function place(ctx: SimContext, type: string, x: number, y: number): Building {
  const r = placeBuilding(ctx, 'player', type, { x, y });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('building levels', () => {
  it('a placed sawmill is level 1 and has its catalogue storage', () => {
    const ctx = testCtx(testState());
    const mill = place(ctx, 'sawmill', 5, 5);
    expect(mill.level).toBe(1);
    expect(buildingStorage(mill)).toBe(BUILDINGS.sawmill.storage);
    expect(buildingWorkers(mill)).toBe(BUILDINGS.sawmill.workers);
    expect(levelRate(mill)).toBe(1);
  });

  it('a level 3 sawmill scales storage, workers, rate, upkeep and smoke', () => {
    const ctx = testCtx(testState());
    const mill = place(ctx, 'sawmill', 5, 5);
    expect(BUILDINGS.sawmill.storage).toBe(120);
    expect(BUILDINGS.sawmill.workers).toBe(60);
    mill.level = 3; // test-only assignment
    expect(buildingStorage(mill)).toBe(216);
    expect(buildingWorkers(mill)).toBe(96);
    expect(levelRate(mill)).toBe(1.8);
    expect(levelUpkeep(mill)).toBe(1.6);
    expect(levelSmoke(mill)).toBe(1.6);
    expect(hubRange(mill)).toBe(0);
  });

  it('a level 2 warehouse has range 16 and storage 1,500; a store has no level table', () => {
    const ctx = testCtx(testState({ cities: [{ x: 22, y: 22, population: 5000 }], streets: true }));
    const wh = place(ctx, 'warehouse', 5, 5);
    expect(hubRange(wh)).toBe(12);
    expect(buildingStorage(wh)).toBe(1000);
    wh.level = 2;
    expect(hubRange(wh)).toBe(16);
    expect(buildingStorage(wh)).toBe(1500);
    expect(levelDef(wh)?.hubTrucks).toBe(6);
    let store: Building | null = null;
    for (let y = 16; y < 28 && !store; y++) {
      for (let x = 16; x < 28 && !store; x++) {
        const r = placeBuilding(ctx, 'player', 'store', { x, y });
        if (r.ok) store = r.value;
      }
    }
    if (!store) throw new Error('no store spot');
    expect(levelDef(store)).toBeNull();
    expect(buildingStorage(store)).toBe(BUILDINGS.store.storage);
    expect(hubRange(store)).toBe(0);
  });

  it('a level 2 extractor yields 1.4 times a level 1 twin over 30 days', () => {
    const ctx = testCtx(testState({ terrain: 'forest' }));
    const a = place(ctx, 'lumber_camp', 5, 5);
    const b = place(ctx, 'lumber_camp', 15, 15);
    b.level = 2;
    a.staffing = b.staffing = 1;
    let made1 = 0;
    let made2 = 0;
    for (let d = 0; d < 30; d++) {
      a.output = {};
      b.output = {};
      productionDay(ctx);
      made1 += a.output.wood ?? 0;
      made2 += b.output.wood ?? 0;
    }
    expect(made1).toBeGreaterThan(0);
    expect(made2 / made1).toBeCloseTo(1.4, 6);
  });

  it('storageLeft uses the level storage', () => {
    const ctx = testCtx(testState());
    const wh = place(ctx, 'warehouse', 5, 5);
    expect(storageLeft(wh, 'wood')).toBe(1000);
    wh.level = 3;
    expect(storageLeft(wh, 'wood')).toBe(2000);
  });

  it('newLogistics seeds its own stream from the game seed', () => {
    expect(newLogistics(42, 1900).rngState).toBe(42 ^ 0x4c4f4749);
    expect(newLogistics(42, 1900).rngState).not.toBe(newLogistics(43, 1900).rngState);
  });

  it('invariants flag a bad level, bad works and managers sharing a post', () => {
    const ctx = testCtx(testState());
    const mill = place(ctx, 'sawmill', 5, 5);
    expect(checkInvariants(ctx.state)).toEqual([]);
    mill.level = 9 as never;
    expect(checkInvariants(ctx.state).join()).toContain('level 9');
    mill.level = 1;
    mill.works = { toLevel: 3, startDay: 10, untilDay: 40 };
    expect(checkInvariants(ctx.state).join()).toContain('bad works');
    mill.works = { toLevel: 2, startDay: 10, untilDay: 40 };
    expect(checkInvariants(ctx.state)).toEqual([]);
    delete mill.works;
    const mgr = (id: number, post: number | null) => ({
      id, name: 'M', born: 1870, skills: { logistics: 3, production: 3, frugality: 3 } as const, salary: 100,
      employer: 'player', post, hiredYear: 1900, lastRaiseYear: null,
    });
    ctx.state.logistics.managers = [mgr(1, mill.id), mgr(2, mill.id)];
    expect(checkInvariants(ctx.state).join()).toContain('held by another manager');
    ctx.state.logistics.managers = [mgr(1, mill.id), mgr(1, null)];
    expect(checkInvariants(ctx.state).join()).toContain('duplicate id');
    ctx.state.logistics.managers = [{ ...mgr(1, 999), employer: 'nobody' }];
    expect(checkInvariants(ctx.state).join()).toContain('not a company');
  });
});

describe('book value counts completed levels', () => {
  it('a level-4 works is worth half its cost plus half of each upgrade (0.5 + 0.75 + 1 of its cost)', () => {
    const s = testState({ year: 1960 });
    const ctx = testCtx(s);
    const mill = place(ctx, 'sawmill', 5, 5);
    const cost = BUILDINGS.sawmill.cost;
    expect(levelCostShare(mill)).toBe(0);
    expect(assetValue(s, 'player')).toBe(Math.round(atPrices(s, cost * 0.5)));
    mill.level = 2;
    expect(levelCostShare(mill)).toBe(0.5);
    expect(assetValue(s, 'player')).toBe(Math.round(atPrices(s, cost * 1.5 * 0.5)));
    mill.level = 4;
    expect(levelCostShare(mill)).toBe(2.25);
    expect(assetValue(s, 'player')).toBe(Math.round(atPrices(s, cost * 3.25 * 0.5)));
    expect(assetValues(s).get('player')).toBe(assetValue(s, 'player'));
  });

  it('a level-3 warehouse counts its two upgrades; a building with no levels counts none', () => {
    const s = testState({ year: 1960 });
    const ctx = testCtx(s);
    const wh = place(ctx, 'warehouse', 5, 5);
    wh.level = 3;
    expect(levelCostShare(wh)).toBe(1.25);
    const house = place(ctx, 'train_station', 15, 15);
    expect(levelCostShare(house)).toBe(0);
    const want = Math.round(atPrices(s, BUILDINGS.warehouse.cost * 2.25 * 0.5 + BUILDINGS.train_station.cost * 0.5));
    expect(assetValue(s, 'player')).toBe(want);
    expect(assetValues(s).get('player')).toBe(want);
  });
});
