// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { addDays } from '../sim/clock';
import { testState } from '../sim/testkit';
import type { Building, BuildingStatus, GameState } from '../sim/types';
import { AlertTracker, type Alert } from '../game/alerts';
import { applyUiScale } from './scale';
import { mountAlerts, alertAge, type AlertsHost } from './alertsTray';

function mk(state: GameState, id: number, status: BuildingStatus, pos = { x: 3, y: 4 }): Building {
  const b = {
    id, typeId: 'sawmill', ownerId: 'player', pos, recipeId: null, input: {}, output: {}, progress: 0, status,
    cityId: null, haltedUntil: null, producedThisMonth: {}, staffing: 1, builtYear: 1900, level: 1,
  } as unknown as Building;
  state.buildings[id] = b;
  return b;
}

/** A host with a real tracker over `state`, warmed for `days` so building alerts show. */
function setup(state: GameState, days = 8) {
  const tracker = new AlertTracker();
  tracker.collect(state);
  state.date = addDays(state.date, days);
  const bus = new EventBus();
  const toasts: string[] = [];
  bus.on('toast', (e) => toasts.push(e.message));
  const uiRoot = document.createElement('div');
  uiRoot.id = 'ui';
  const slot = document.createElement('span');
  uiRoot.appendChild(slot);
  document.body.appendChild(uiRoot);
  const subs = new Set<(a: readonly Alert[]) => void>();
  const host = {
    ctx: { state, bus },
    uiRoot,
    alerts: [] as readonly Alert[],
    refreshAlerts(): readonly Alert[] {
      const a = tracker.collect(state);
      host.alerts = a;
      for (const fn of subs) fn(a);
      return a;
    },
    onAlerts(fn: (a: readonly Alert[]) => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    centerOn: vi.fn(),
    openPanel: vi.fn(),
  };
  const typed: AlertsHost = host;
  const off = mountAlerts(slot, typed);
  live.push(() => {
    off();
    uiRoot.remove();
  });
  host.refreshAlerts();
  const bell = slot.querySelector<HTMLButtonElement>('.alerts-bell')!;
  return { host, slot, bell, toasts, uiRoot };
}

const live: (() => void)[] = [];
afterEach(() => {
  for (const d of live.splice(0)) d();
  applyUiScale(1);
  document.body.replaceChildren();
});

const tray = () => document.querySelector<HTMLElement>('.alerts-tray');
const rows = () => [...document.querySelectorAll<HTMLElement>('.alerts-row')];

describe('alerts bell', () => {
  it('badge count matches the alerts and is coloured by the worst tone', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    mk(s, 2, 'output_full');
    mk(s, 3, 'idle');
    const { bell } = setup(s);
    const badge = bell.querySelector<HTMLElement>('.alerts-badge')!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('3');
    expect(badge.dataset.tone).toBe('warning');
    expect(bell.getAttribute('aria-label')).toBe('Alerts (3)');
    expect(bell.title).toBe('Alerts (T)');
  });

  it('shows no badge at 0', () => {
    const { bell, slot } = setup(testState());
    const badge = bell.querySelector<HTMLElement>('.alerts-badge')!;
    expect(badge.hidden).toBe(true);
    expect(bell.getAttribute('aria-label')).toBe('Alerts (0)');
    expect(slot.childElementCount).toBeGreaterThan(0);
    bell.click();
    expect(tray()!.querySelector('.kit-empty')).not.toBeNull();
  });
});

describe('alerts tray', () => {
  it('lists one row per alert with title, detail and age', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell } = setup(s, 9);
    bell.click();
    expect(tray()).not.toBeNull();
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    expect(rows()).toHaveLength(1);
    const r = rows()[0];
    expect(r.querySelector('.alerts-row-title')!.textContent).toBe('Sawmill is starved');
    expect(r.querySelector('.alerts-row-detail')!.textContent!.length).toBeGreaterThan(0);
    expect(r.querySelector('.alerts-row-age')!.textContent).toBe('9 days');
  });

  it('clicking a building row centres on it, opens its panel and closes the tray', () => {
    const s = testState();
    mk(s, 7, 'no_input', { x: 11, y: 5 });
    const { bell, host } = setup(s);
    bell.click();
    rows()[0].click();
    expect(host.centerOn).toHaveBeenCalledWith({ x: 11, y: 5 });
    expect(host.openPanel).toHaveBeenCalledWith('building', 7);
    expect(tray()).toBeNull();
  });

  it('a panel target opens that panel', () => {
    const s = testState();
    s.politics.cards.pending.push({ uid: 1, cardId: 'x', cityId: null, openedDay: 0 });
    const { bell, host } = setup(s);
    bell.click();
    rows()[0].click();
    expect(host.openPanel).toHaveBeenCalledWith('newspaper');
    expect(host.centerOn).not.toHaveBeenCalled();
  });

  it('a building demolished after the tray opened: no throw, row removed, toast', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    mk(s, 2, 'no_input');
    const { bell, host, toasts } = setup(s);
    bell.click();
    expect(rows()).toHaveLength(2);
    const row = rows().find((r) => r.dataset.alert === 'b:1:no_input')!;
    delete s.buildings[1];
    expect(() => row.click()).not.toThrow();
    expect(toasts).toEqual(['That is no longer there']);
    expect(host.openPanel).not.toHaveBeenCalled();
    expect(host.centerOn).not.toHaveBeenCalled();
    expect(rows().map((r) => r.dataset.alert)).toEqual(['b:2:no_input']);
  });

  it('Esc closes the tray without reaching the game', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell } = setup(s);
    const later = vi.fn();
    window.addEventListener('keydown', later);
    bell.click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', later);
    expect(tray()).toBeNull();
    expect(later).not.toHaveBeenCalled();
    expect(bell.getAttribute('aria-expanded')).toBe('false');
  });

  it('a click outside closes it; a click inside does not', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell } = setup(s);
    bell.click();
    tray()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(tray()).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(tray()).toBeNull();
  });

  it('at UI scale 1.3 the right edge stays inside the viewport', () => {
    applyUiScale(1.3);
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell } = setup(s);
    const vw = window.innerWidth;
    // the bell hard against the right edge, in screen px
    bell.getBoundingClientRect = () => ({ left: vw - 32, right: vw, top: 0, bottom: 52, width: 32, height: 52, x: vw - 32, y: 0, toJSON: () => ({}) });
    bell.click();
    const t = tray()!;
    const left = parseFloat(t.style.left);
    const width = parseFloat(t.style.width);
    expect(Number.isFinite(left) && Number.isFinite(width)).toBe(true);
    expect((left + width) * 1.3).toBeLessThanOrEqual(vw);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(t.style.maxHeight).not.toBe('');
  });
});

describe('alerts tray refresh and focus', () => {
  it('is a dialog of plain buttons, and opening from the keyboard focuses the first row', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell } = setup(s);
    bell.click(); // detail 0: Enter/Space or T
    expect(tray()!.getAttribute('role')).toBe('dialog');
    expect(tray()!.getAttribute('aria-label')).toBe('Alerts');
    expect(tray()!.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
    expect(rows()[0].tagName).toBe('BUTTON');
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('a mouse click on the bell leaves focus alone', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell } = setup(s);
    bell.focus();
    bell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(tray()).not.toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('a refresh with the same alerts and ages does not repaint', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    const { bell, host } = setup(s);
    bell.click();
    const before = rows()[0];
    host.refreshAlerts();
    expect(rows()[0]).toBe(before);
  });

  it('a repaint keeps the focused row focused', () => {
    const s = testState();
    mk(s, 1, 'no_input');
    mk(s, 2, 'no_input');
    const { bell, host } = setup(s);
    bell.click();
    const second = rows().find((r) => r.dataset.alert === 'b:2:no_input')!;
    second.focus();
    s.date = addDays(s.date, 1);
    host.refreshAlerts();
    expect(rows()).not.toContain(second);
    expect((document.activeElement as HTMLElement).dataset.alert).toBe('b:2:no_input');
  });
});

describe('alertAge', () => {
  it('says today, 1 day, N days', () => {
    expect(alertAge(0)).toBe('today');
    expect(alertAge(1)).toBe('1 day');
    expect(alertAge(3)).toBe('3 days');
  });
});
