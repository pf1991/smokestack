import { describe, expect, it } from 'vitest';
import { addDays } from '../sim/clock';
import { testState } from '../sim/testkit';
import type { Building, BuildingStatus, GameState } from '../sim/types';
import { AlertTracker } from './alerts';

function mk(state: GameState, id: number, status: BuildingStatus, ownerId: 'player' | 'rival' = 'player', typeId = 'sawmill'): Building {
  const b = {
    id, typeId, ownerId, pos: { x: 1, y: 1 }, recipeId: null, input: {}, output: {}, progress: 0, status,
    cityId: null, haltedUntil: null, producedThisMonth: {}, staffing: 1, builtYear: 1900, level: 1,
  } as unknown as Building;
  state.buildings[id] = b;
  return b;
}
const advance = (s: GameState, n: number) => { s.date = addDays(s.date, n); };

describe('AlertTracker', () => {
  it('alerts after 7 days of no_input, not 6', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const t = new AlertTracker();
    expect(t.collect(s)).toHaveLength(0);
    advance(s, 6);
    expect(t.collect(s)).toHaveLength(0);
    advance(s, 1);
    const a = t.collect(s);
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe('b:1:no_input');
    expect(a[0].tone).toBe('warning');
    expect(a[0].target).toEqual({ kind: 'building', id: 1 });
  });

  it('restarts the count when a status clears and returns', () => {
    const s = testState();
    const b = mk(s, 1, 'no_input');
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 5);
    b.status = 'ok';
    t.collect(s);
    advance(s, 3);
    b.status = 'no_input';
    t.collect(s);
    advance(s, 6);
    expect(t.collect(s)).toHaveLength(0);
    advance(s, 1);
    expect(t.collect(s)).toHaveLength(1);
  });

  it('puts a strike (negative) ahead of a warning', () => {
    const s = testState();
    mk(s, 1, 'output_full');
    const b = mk(s, 2, 'halted');
    b.strike = { until: 99999, since: 0, reason: 'wages', cityId: 0, cardUid: null };
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 8);
    const a = t.collect(s);
    expect(a.map((x) => x.tone)).toEqual(['negative', 'warning']);
    expect(a[0].title).toMatch(/^Strike at /);
    expect(a[1].title).toMatch(/is backed up$/);
  });

  it('drops a demolished building on the next collect', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 8);
    expect(t.collect(s)).toHaveLength(1);
    delete s.buildings[1];
    expect(t.collect(s)).toHaveLength(0);
  });

  it('ignores rival buildings', () => {
    const s = testState();
    mk(s, 1, 'no_input', 'rival');
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 10);
    expect(t.collect(s)).toHaveLength(0);
  });

  it('does not modify state', () => {
    const s = testState({ cities: [{ x: 5, y: 5 }] });
    mk(s, 1, 'no_input');
    s.contracts.push({ id: 9, cityId: 0, goodId: 'bread', qty: 10, delivered: 0, deadline: addDays(s.date, 10), reward: 1, status: 'active' });
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 8);
    const before = JSON.stringify(s);
    const a = t.collect(s);
    expect(a.length).toBeGreaterThan(1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('flags a due contract and a Baron move this month', () => {
    const s = testState({ cities: [{ x: 5, y: 5, name: 'Ashby' }] });
    s.contracts.push({ id: 9, cityId: 0, goodId: 'bread', qty: 10, delivered: 0, deadline: addDays(s.date, 10), reward: 1, status: 'active' });
    s.nemesis.lastAction = { kind: 'sabotage' as never, year: s.date.year, month: s.date.month };
    const a = new AlertTracker().collect(s);
    expect(a.map((x) => x.id).sort()).toEqual([`baron:${s.date.year}-${s.date.month}`, 'c:9']);
    expect(a.find((x) => x.id === 'c:9')!.title).toBe('Contract for Ashby due in 10 days');
  });

  it('caps at 50', () => {
    const s = testState();
    for (let i = 1; i <= 60; i++) mk(s, i, 'no_input');
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 8);
    expect(t.collect(s)).toHaveLength(50);
  });
});
