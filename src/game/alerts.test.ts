import { describe, expect, it } from 'vitest';
import { addDays, dateToDays } from '../sim/clock';
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

  it('stamps each alert with the day its condition was first seen', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const t = new AlertTracker();
    const first = dateToDays(s.date);
    t.collect(s);
    advance(s, 9);
    const a = t.collect(s);
    expect(a[0].since).toBe(first);
    expect(dateToDays(s.date) - a[0].since).toBe(9);
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

  it('a logistics building idle for 30 days raises no alert', () => {
    const s = testState();
    mk(s, 1, 'idle', 'player', 'warehouse');
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 30);
    expect(t.collect(s)).toHaveLength(0);
  });

  it('a stocked store, idle as stores always are, raises no alert', () => {
    const s = testState();
    const b = mk(s, 1, 'idle', 'player', 'store');
    b.input = { furniture: 5 };
    b.output = { furniture: 5 };
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 30);
    expect(t.collect(s)).toHaveLength(0);
  });

  it('a store unstocked for 7 days warns of empty shelves, not at 6', () => {
    const s = testState();
    mk(s, 1, 'idle', 'player', 'store');
    const t = new AlertTracker();
    t.collect(s);
    advance(s, 6);
    expect(t.collect(s)).toHaveLength(0);
    advance(s, 1);
    const a = t.collect(s);
    expect(a).toHaveLength(1);
    expect(a[0].tone).toBe('warning');
    expect(a[0].title).toBe('Store has empty shelves');
    expect(a[0].detail).toBe('Shelves empty: route goods here');
    expect(a[0].target).toEqual({ kind: 'building', id: 1 });
  });

  it('a strike alerts for any category', () => {
    const s = testState();
    const b = mk(s, 1, 'halted', 'player', 'warehouse');
    b.strike = { until: 99999, since: 0, reason: 'wages', cityId: 0, cardUid: null };
    expect(new AlertTracker().collect(s).map((x) => x.title)).toEqual(['Strike at Warehouse']);
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
  describe('edge cases', () => {
    const mkVehicle = (s: GameState, id: number, state: 'idle' | 'moving' = 'idle') => {
      s.vehicles[id] = { id, kind: 'truck', ownerId: 'player', routeId: null, state, model: 'steam_lorry' } as unknown as GameState['vehicles'][number];
    };
    const month = (year: number, m: number, income: number, expense: number) => ({
      year, month: m, income: { sales: income }, expense: { maintenance: expense }, salesByGood: {}, cashEnd: 0, netWorthEnd: 0,
    }) as unknown as GameState['companies']['player']['ledger'][number];
    const contract = (s: GameState, days: number) =>
      s.contracts.push({ id: 9, cityId: 0, goodId: 'bread', qty: 10, delivered: 0, deadline: addDays(s.date, days), reward: 1, status: 'active' });

    it('an idle vehicle alerts at 14 days, not 13', () => {
      const s = testState();
      mkVehicle(s, 5);
      const t = new AlertTracker();
      t.collect(s);
      advance(s, 13);
      expect(t.collect(s)).toHaveLength(0);
      advance(s, 1);
      const a = t.collect(s);
      expect(a).toHaveLength(1);
      expect(a[0].id).toBe('v:5:idle');
      expect(a[0].target).toEqual({ kind: 'vehicle', id: 5 });
    });

    it('"Last month lost" reads the newest closed month and ignores the open one', () => {
      const s = testState();
      const { year, month: m } = s.date;
      const prev = m === 1 ? { y: year - 1, m: 12 } : { y: year, m: m - 1 };
      const older = prev.m === 1 ? { y: prev.y - 1, m: 12 } : { y: prev.y, m: prev.m - 1 };
      s.companies.player.ledger = [month(older.y, older.m, 0, 500), month(prev.y, prev.m, 100, 400), month(year, m, 0, 9999)];
      const a = new AlertTracker().collect(s);
      expect(a.map((x) => x.id)).toEqual([`loss:${prev.y}-${prev.m}`]);
      expect(a[0].title).toMatch(/^Last month lost \$300/);
      expect(a[0].target).toEqual({ kind: 'panel', panel: 'finance' });
    });

    it('no loss alert when the last closed month was profitable, even if the open month is losing', () => {
      const s = testState();
      const { year, month: m } = s.date;
      const prev = m === 1 ? { y: year - 1, m: 12 } : { y: year, m: m - 1 };
      s.companies.player.ledger = [month(prev.y, prev.m, 500, 100), month(year, m, 0, 9999)];
      expect(new AlertTracker().collect(s)).toHaveLength(0);
    });

    it('a pending card raises "A decision awaits" pointing at the newspaper', () => {
      const s = testState();
      s.politics.cards.pending.push({} as never);
      const a = new AlertTracker().collect(s);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ id: 'card', tone: 'info', title: 'A decision awaits', target: { kind: 'panel', panel: 'newspaper' } });
    });

    it('a contract alerts inside 30 days (and on its last day), not at 31', () => {
      for (const [days, n] of [[30, 1], [31, 0], [0, 1]] as const) {
        const s = testState({ cities: [{ x: 5, y: 5, name: 'Ashby' }] });
        contract(s, days);
        const a = new AlertTracker().collect(s);
        expect(a, `due in ${days}`).toHaveLength(n);
        if (n) expect(a[0].title).toBe(`Contract for Ashby due in ${days} days`);
      }
    });

    it('an overdue contract raises no alert', () => {
      const s = testState({ cities: [{ x: 5, y: 5, name: 'Ashby' }] });
      contract(s, -1);
      expect(new AlertTracker().collect(s)).toHaveLength(0);
    });

    it("a strike alert's since is the strike's start", () => {
      const s = testState();
      const b = mk(s, 1, 'halted');
      const today = dateToDays(s.date);
      b.strike = { until: today + 50, since: today - 12, reason: 'wages', cityId: 0, cardUid: null };
      const a = new AlertTracker().collect(s);
      expect(a).toHaveLength(1);
      expect(a[0].since).toBe(today - 12);
    });

    it('a strike past its 120-day cap raises no strike alert', () => {
      const s = testState();
      const b = mk(s, 1, 'halted');
      const today = dateToDays(s.date);
      b.strike = { until: today + 500, since: today - 120, reason: 'wages', cityId: 0, cardUid: null };
      expect(new AlertTracker().collect(s)).toHaveLength(0);
    });

    it('an unstocked store that is upgrading or halted raises no empty-shelves alert', () => {
      for (const status of ['upgrading', 'halted'] as const) {
        const s = testState();
        mk(s, 1, status, 'player', 'store');
        const t = new AlertTracker();
        t.collect(s);
        advance(s, 30);
        expect(t.collect(s), status).toHaveLength(0);
      }
    });
  });
});
