// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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
    hud.update(state);
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
});
