// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { createGame } from '../sim/state';
import type { SimContext } from '../sim/types';
import {
  attachSystemsCoach,
  COACH_COMPONENTS,
  COACH_TRADING_HOUSE,
  COACH_WAREHOUSE,
  hasSoldConsumer,
  monthLooksProfitable,
} from './feedback';
import { coachStorageKey, markCoachSeen } from '../ui/disclosure';
import { placeBuilding } from '../sim/state';
import { must } from '../sim/testkit';
import { findPlacement } from '../sim/state';

function ctx(): SimContext {
  return { state: createGame({ seed: 3 }), bus: new EventBus() };
}

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    get length() { return mem.size; },
    key: () => null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('systems coach helpers', () => {
  it('detects consumer sales and profitable months', () => {
    const s = createGame({ seed: 1 });
    expect(hasSoldConsumer(s)).toBe(false);
    s.flags['sold:furniture'] = 1;
    expect(hasSoldConsumer(s)).toBe(true);
    expect(monthLooksProfitable(s)).toBe(false);
    const { year, month } = s.date;
    s.companies.player.ledger.push({
      year, month, income: { sales: 500 }, expense: { maintenance: 50 },
      salesByGood: {}, cashEnd: 0, netWorthEnd: 0,
    });
    expect(monthLooksProfitable(s)).toBe(true);
  });
});

describe('attachSystemsCoach', () => {
  it('pulses Components once on first component unlock', () => {
    const c = ctx();
    const pulsed: string[] = [];
    const shown: string[] = [];
    attachSystemsCoach(c, {
      pulseTab: (t) => pulsed.push(t),
      showTab: (t) => shown.push(t),
    });
    c.bus.emit({ type: 'unlock', defId: 'machine_shop', kind: 'building' });
    expect(pulsed).toEqual(['components']);
    expect(shown).toEqual(['components']);
    expect(localStorage.getItem(coachStorageKey(COACH_COMPONENTS))).toBe('seen');
    pulsed.length = 0;
    c.bus.emit({ type: 'unlock', defId: 'electronics_works', kind: 'building' });
    expect(pulsed).toEqual([]);
  });

  it('pulses Warehouse once when the player has works but no shed yet', () => {
    const c = ctx();
    const pulsedBuildings: string[] = [];
    attachSystemsCoach(c, {
      pulseBuilding: (id) => pulsedBuildings.push(id),
      pulseTab: () => {},
      showTab: () => {},
    });
    c.bus.emit({ type: 'dayStart', date: c.state.date });
    expect(pulsedBuildings).toEqual([]);
    const pos = findPlacement(c.state, 'player', 'sawmill', c.state.cities[0]!.center, 40)!;
    must(placeBuilding(c, 'player', 'sawmill', pos));
    c.bus.emit({ type: 'dayStart', date: c.state.date });
    expect(pulsedBuildings).toEqual(['warehouse']);
    expect(localStorage.getItem(coachStorageKey(COACH_WAREHOUSE))).toBe('seen');
    pulsedBuildings.length = 0;
    c.bus.emit({ type: 'dayStart', date: c.state.date });
    expect(pulsedBuildings).toEqual([]);
  });

  it('pulses Trading House once when a consumer chain is profitable', () => {
    const c = ctx();
    const pulsedTabs: string[] = [];
    const pulsedBuildings: string[] = [];
    attachSystemsCoach(c, {
      pulseTab: (t) => pulsedTabs.push(t),
      pulseBuilding: (id) => pulsedBuildings.push(id),
      showTab: () => {},
    });
    c.bus.emit({ type: 'dayStart', date: c.state.date });
    expect(pulsedBuildings).toEqual([]);
    c.state.flags['sold:furniture'] = 2;
    const { year, month } = c.state.date;
    c.state.companies.player.ledger.push({
      year, month, income: { sales: 800 }, expense: {},
      salesByGood: { furniture: 800 }, cashEnd: 0, netWorthEnd: 0,
    });
    c.bus.emit({ type: 'dayStart', date: c.state.date });
    expect(pulsedBuildings).toEqual(['trading_house']);
    expect(pulsedTabs).toContain('retail');
    expect(localStorage.getItem(coachStorageKey(COACH_TRADING_HOUSE))).toBe('seen');
    pulsedBuildings.length = 0;
    c.bus.emit({ type: 'dayStart', date: c.state.date });
    expect(pulsedBuildings).toEqual([]);
  });

  it('skips when the coach was already seen', () => {
    markCoachSeen(COACH_COMPONENTS);
    const c = ctx();
    const pulsed: string[] = [];
    attachSystemsCoach(c, { pulseTab: (t) => pulsed.push(t) });
    c.bus.emit({ type: 'unlock', defId: 'machine_shop', kind: 'building' });
    expect(pulsed).toEqual([]);
  });
});

describe('Toolbar.pulseBuilding', () => {
  it('sets data-pulse on the Trading House card', async () => {
    vi.useFakeTimers();
    const { Toolbar } = await import('../ui/toolbar');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tb = new Toolbar(root, () => {});
    tb.pulseBuilding('trading_house', 1000);
    const card = root.querySelector('[data-building="trading_house"]') as HTMLElement;
    expect(card.dataset.pulse).toBe('1');
    vi.advanceTimersByTime(1000);
    expect(card.dataset.pulse).toBeUndefined();
    tb.closeDrawer();
    root.remove();
    vi.useRealTimers();
  });
});
