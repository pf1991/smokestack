import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { checkInvariants } from '../invariants';
import { productionDay } from '../production';
import { runDays } from '../simulation';
import { placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, BuildingTypeId, GameState, OwnerId } from '../types';
import { LABOUR_SHARE, MIN_STAFFING, REMOTE_STAFFING, WORK_RADIUS, workCity, workforceMonth } from './workforce';

/** Puts a building straight into state (no placement rules): workforce only reads type and position. */
function put(state: GameState, typeId: BuildingTypeId, x: number, y: number, ownerId: OwnerId = 'player'): Building {
  const b: Building = {
    id: state.nextId++,
    typeId,
    ownerId,
    pos: { x, y },
    recipeId: BUILDINGS[typeId].recipes[0] ?? null,
    input: {},
    output: {},
    progress: 0,
    status: 'idle',
    cityId: null,
    haltedUntil: null,
    producedThisMonth: {},
    staffing: 1,
  };
  state.buildings[b.id] = b;
  return b;
}

describe('workforce', () => {
  it('exact constants', () => {
    expect(WORK_RADIUS).toBe(30);
    expect(REMOTE_STAFFING).toBe(0.75);
    expect(MIN_STAFFING).toBe(0.5);
    expect(LABOUR_SHARE).toBe(0.15);
  });

  it('a lone factory next to a 5,000-person city is fully staffed', () => {
    const state = testState({ width: 80, height: 60, cities: [{ x: 20, y: 20, population: 5000 }] });
    const b = put(state, 'sawmill', 26, 20);
    b.staffing = 0.3;
    workforceMonth(state);
    expect(b.staffing).toBe(1);
    expect(workCity(state, b)?.id).toBe(0);
  });

  it('40 factories next to a 1,000-person city fall to the 0.5 floor', () => {
    const state = testState({ width: 80, height: 60, cities: [{ x: 30, y: 30, population: 1000 }] });
    const bs: Building[] = [];
    for (let i = 0; i < 40; i++) bs.push(put(state, 'sawmill', 15 + (i % 8) * 4, 15 + Math.floor(i / 8) * 4));
    workforceMonth(state);
    // pool 1000 * LABOUR_SHARE (150) against a need of 40 * 60 = 2400: floored at 0.5
    for (const b of bs) expect(b.staffing).toBe(0.5);
  });

  it('shares the pool: ratio = pool / need when above the floor', () => {
    const state = testState({ width: 80, height: 60, cities: [{ x: 30, y: 30, population: 2000 }] });
    // pool 2000 * LABOUR_SHARE (300) against a need of 6 * 60 = 360
    for (let i = 0; i < 6; i++) put(state, 'sawmill', 20 + i * 4, 20);
    workforceMonth(state);
    for (const b of Object.values(state.buildings)) expect(b.staffing).toBeCloseTo((2000 * LABOUR_SHARE) / 360, 12);
  });

  it('a mine 40 tiles from any city works remotely at 0.75', () => {
    const state = testState({ width: 100, height: 40, cities: [{ x: 10, y: 20, population: 50000 }] });
    const b = put(state, 'mine', 50, 20); // centre (51, 21): 41 tiles away
    workforceMonth(state);
    expect(b.staffing).toBe(0.75);
    expect(workCity(state, b)).toBeNull();
  });

  it('workers opinion 0 lowers the pool by 30% compared with 50', () => {
    const pool = (opinion: number) => {
      const state = testState({ width: 80, height: 60, cities: [{ x: 30, y: 30, population: 2000 }] });
      state.cities[0].opinion.workers = opinion;
      for (let i = 0; i < 6; i++) put(state, 'sawmill', 15 + i * 4, 20); // need 360, above both pools
      workforceMonth(state);
      return state.buildings[1].staffing * 360;
    };
    expect(pool(50)).toBeCloseTo(300, 9);
    expect(pool(0)).toBeCloseTo(210, 9);
    expect(pool(0) / pool(50)).toBeCloseTo(0.7, 12);
  });

  it('assigns to the nearest city, ties to the lower id, across companies', () => {
    const state = testState({ width: 80, height: 40, cities: [{ x: 10, y: 20, population: 1000 }, { x: 30, y: 20, population: 50000 }] });
    const tie = put(state, 'mine', 19, 19, 'rival'); // centre (20, 20): 10 from both
    const near1 = put(state, 'mine', 25, 19); // centre (26, 20): nearer city 1
    expect(workCity(state, tie)?.id).toBe(0);
    expect(workCity(state, near1)?.id).toBe(1);
    // fill city 0 so the tie building is visibly short-staffed
    for (let i = 0; i < 20; i++) put(state, 'sawmill', 2 + (i % 4) * 3, 2 + Math.floor(i / 4) * 3, 'rival');
    workforceMonth(state);
    expect(tie.staffing).toBe(MIN_STAFFING);
    expect(near1.staffing).toBe(1);
  });

  it('is deterministic and keeps staffing within [0, 1]', () => {
    const run = () => {
      const state = testState({ width: 80, height: 60, cities: [{ x: 20, y: 20, population: 1500 }, { x: 50, y: 30, population: 3000 }] });
      for (let i = 0; i < 30; i++) put(state, i % 3 === 0 ? 'mine' : 'sawmill', 5 + ((i * 7) % 70), 5 + ((i * 11) % 50), i % 2 ? 'rival' : 'player');
      workforceMonth(state);
      return Object.values(state.buildings).map((b) => b.staffing);
    };
    const a = run();
    expect(run()).toEqual(a);
    for (const s of a) expect(s >= 0 && s <= 1).toBe(true);
  });

  it('the politics system recomputes staffing at the month end', () => {
    const ctx = testCtx(testState({ width: 100, height: 40, money: 1e6, cities: [{ x: 10, y: 20, population: 50000 }] }));
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 70, y: 20 }));
    expect(b.staffing).toBe(1);
    runDays(ctx, 31);
    expect(b.staffing).toBe(REMOTE_STAFFING);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('a newly placed building starts fully staffed', () => {
    const ctx = testCtx(testState({ money: 1e6 }));
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    expect(b.staffing).toBe(1);
  });

  it('checkInvariants rejects staffing outside [0, 1] or non-finite', () => {
    const state = testState({ width: 40, height: 30 });
    const ctx = testCtx(state);
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    expect(checkInvariants(state)).toEqual([]);
    for (const bad of [NaN, -0.1, 1.5, Infinity]) {
      b.staffing = bad;
      expect(checkInvariants(state).some((m) => m.includes('staffing'))).toBe(true);
    }
  });
});

describe('staffing scales production', () => {
  function output30(typeId: BuildingTypeId, staffing: number): number {
    const ctx = testCtx(testState({ terrain: typeId === 'lumber_camp' ? 'forest' : 'grass', money: 1e6 }));
    const b = must(placeBuilding(ctx, 'player', typeId, { x: 5, y: 5 }));
    b.staffing = staffing;
    let made = 0;
    for (let d = 0; d < 30; d++) {
      b.input.wood = 100;
      productionDay(ctx);
      const g = typeId === 'lumber_camp' ? 'wood' : 'lumber';
      made += b.output[g] ?? 0;
      b.output[g] = 0;
    }
    return made;
  }

  it('a factory at staffing 0.5 makes half as much over 30 days', () => {
    expect(output30('sawmill', 1)).toBeCloseTo(150, 9);
    expect(output30('sawmill', 0.5)).toBeCloseTo(75, 9);
  });

  it('an extractor at staffing 0.5 makes half as much over 30 days', () => {
    expect(output30('lumber_camp', 1)).toBeCloseTo(300, 9);
    expect(output30('lumber_camp', 0.5)).toBeCloseTo(150, 9);
  });
});
