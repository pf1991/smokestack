// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { currentLedger } from '../sim/finance';
import { createGame } from '../sim/state';
import { Hud, eraName, windLabel } from './hud';
import { factionName, GREENS_YEAR } from '../data/factions';
import { factionModes } from '../render/factionOverlay';

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handlers = { onSpeed: vi.fn(), onOpenPanel: vi.fn() };
  const hud = new Hud(root, handlers);
  const state = createGame({ seed: 1 });
  return { root, handlers, hud, state };
}

describe('Hud', () => {
  it('renames the faction-mode options when the year crosses 1960 (M6)', () => {
    const { root, hud, state } = setup();
    const labels = () => [...root.querySelectorAll<HTMLOptionElement>('.hud-faction-mode option')].map((o) => o.textContent);
    const sel = root.querySelector<HTMLSelectElement>('.hud-faction-mode')!;
    hud.update(state);
    const before = labels();
    expect(before).toContain(factionName('reformers', 1900));
    sel.value = 'reformers';
    state.date = { ...state.date, year: GREENS_YEAR };
    hud.update(state);
    expect(labels()).toEqual(factionModes(GREENS_YEAR).map((m) => m.label));
    expect(labels()).toContain(factionName('reformers', GREENS_YEAR));
    expect(labels()).not.toEqual(before);
    // the selection survives the rebuild
    expect(sel.value).toBe('reformers');
  });

  it('money turns red when negative', () => {
    const { root, hud, state } = setup();
    hud.update(state);
    const money = root.querySelector('.hud-money') as HTMLElement;
    expect(money.classList.contains('negative')).toBe(false);
    state.companies.player.money = -1234;
    hud.update(state, 0);
    hud.tick(10_000);
    expect(money.classList.contains('negative')).toBe(true);
    expect(money.textContent).toContain('-$1,234');
  });

  it('speed click calls onSpeed(4)', () => {
    const { root, handlers, hud, state } = setup();
    hud.update(state);
    (root.querySelector('[data-speed="4"]') as HTMLElement).click();
    expect(handlers.onSpeed).toHaveBeenCalledWith(4);
  });

  it('highlights the active speed and opens panels', () => {
    const { root, handlers, hud, state } = setup();
    state.speed = 2;
    hud.update(state);
    expect(root.querySelector('[data-speed="2"]')!.classList.contains('active')).toBe(true);
    expect(root.querySelector('[data-speed="1"]')!.classList.contains('active')).toBe(false);
    (root.querySelector('[data-panel="finance"]') as HTMLElement).click();
    expect(handlers.onOpenPanel).toHaveBeenCalledWith('finance');
    expect(document.getElementById('ticker')).not.toBeNull();
  });

  it('names eras', () => {
    expect(eraName(1900)).toBe('Steam Age');
    expect(eraName(1955)).toBe('Atomic Age');
    expect(eraName(2000)).toBe('Silicon Age');
  });

  it('monthEnd pops exactly one delta from the ledger', () => {
    const { root, hud, state } = setup();
    hud.update(state);
    const bus = new EventBus();
    hud.attach(bus);
    const m = currentLedger(state.companies.player, state.date);
    m.income.sales = 12_340;
    bus.emit({ type: 'monthEnd', date: { ...state.date } });
    const deltas = root.querySelectorAll('.hud-delta');
    expect(deltas.length).toBe(1);
    expect(deltas[0].classList.contains('good')).toBe(true);
    expect(deltas[0].textContent).toBe('+$12,340');
  });

  it('negative month shows a bad delta', () => {
    const { root, hud, state } = setup();
    hud.update(state);
    const bus = new EventBus();
    hud.attach(bus);
    currentLedger(state.companies.player, state.date).expense.maintenance = 3_100;
    bus.emit({ type: 'monthEnd', date: { ...state.date } });
    const d = root.querySelector('.hud-delta')!;
    expect(d.classList.contains('bad')).toBe(true);
    expect(d.textContent).toBe('\u2212$3,100');
  });

  it('snaps on the first update after reset', () => {
    const { root, hud, state } = setup();
    hud.update(state, 0);
    hud.reset();
    state.companies.player.money = 5_000;
    hud.update(state, 1);
    expect((root.querySelector('.hud-money') as HTMLElement).textContent).toBe('$5,000');
  });

  it('wind vane follows the weather on dayStart only', () => {
    const { root, hud, state } = setup();
    state.weather = { windX: 1, windY: 0, rain: false, rainDays: 0 };
    hud.update(state);
    const bus = new EventBus();
    hud.attach(bus);
    const vane = root.querySelector<HTMLElement>('.hud-wind')!;
    const arrow = vane.querySelector<HTMLElement>('[data-icon="wind"]')!;
    const rain = vane.querySelector<HTMLElement>('[data-icon="rain"]')!;
    expect(vane.title).toBe(windLabel(state.weather));
    expect(arrow.style.transform).toBe('rotate(0deg)');
    expect(rain.hidden).toBe(true);
    state.weather = { windX: 0, windY: 1, rain: true, rainDays: 1 };
    hud.update(state); // per-frame updates leave the vane alone
    expect(arrow.style.transform).toBe('rotate(0deg)');
    bus.emit({ type: 'dayStart', date: { ...state.date } });
    expect(arrow.style.transform).toBe('rotate(90deg)');
    expect(rain.hidden).toBe(false);
    expect(vane.title).toContain('Rain');
  });

  it('names the wind by where it blows from and how hard', () => {
    expect(windLabel({ windX: 1, windY: -0.2, rain: false, rainDays: 0 })).toBe('Wind: west, brisk');
    expect(windLabel({ windX: 0.2, windY: 1, rain: false, rainDays: 0 })).toBe('Wind: north, brisk');
    expect(windLabel({ windX: -0.3, windY: -0.3, rain: true, rainDays: 2 })).toBe('Wind: south-east, light. Rain');
    expect(windLabel({ windX: 0.05, windY: 0, rain: false, rainDays: 0 })).toBe('Wind: calm');
  });
});
