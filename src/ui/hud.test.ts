// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { currentLedger } from '../sim/finance';
import { createGame } from '../sim/state';
import { Hud, eraName } from './hud';

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handlers = { onSpeed: vi.fn(), onOpenPanel: vi.fn() };
  const hud = new Hud(root, handlers);
  const state = createGame({ seed: 1 });
  return { root, handlers, hud, state };
}

describe('Hud', () => {
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
});
