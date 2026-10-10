// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTo } from '../game/saves';
import { createGame } from '../sim/state';
import { closeModal, MainMenu, showEndScreen } from './menu';
import { buildGoals } from './panels/goals';
import { testState } from '../sim/testkit';

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

function mount(host = { startNew: vi.fn(), startLoaded: vi.fn() }) {
  const ui = document.createElement('div');
  document.body.appendChild(ui);
  const menu = new MainMenu(document.createElement('canvas'), ui, host, { backdrop: false });
  return { ui, menu, host };
}

const btn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text)) as HTMLButtonElement;

describe('main menu', () => {
  it('shows the title and a disabled Continue without an autosave', () => {
    const { ui } = mount();
    expect(ui.querySelector('.mn-title')?.textContent).toBe('SMOKESTACK');
    expect(btn(ui, 'Continue').disabled).toBe(true);
  });

  it('Continue loads the autosave', () => {
    saveTo('auto', createGame({ seed: 4, companyName: 'Auto Co' }));
    const { ui, host } = mount();
    const c = btn(ui, 'Continue');
    expect(c.disabled).toBe(false);
    c.click();
    expect(host.startLoaded).toHaveBeenCalledTimes(1);
  });

  it('New Game starts the chosen scenario with the rival toggle', () => {
    const { ui, host } = mount();
    btn(ui, 'New Game').click();
    btn(ui, 'Lumber Baron').click();
    (ui.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    btn(ui, 'Start').click();
    expect(host.startNew).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: 'lumber_baron', rival: false }));
  });

  it('Beat the Baron forces the rival on', () => {
    const { ui } = mount();
    btn(ui, 'New Game').click();
    btn(ui, 'Beat the Baron').click();
    const rival = ui.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(rival.checked).toBe(true);
    expect(rival.disabled).toBe(true);
  });

  it('destroy removes the menu', () => {
    const { ui, menu } = mount();
    menu.destroy();
    expect(ui.querySelector('.mn-root')).toBeNull();
  });
});

describe('menu error handling and overlays', () => {
  it('Continue with a corrupt autosave shows the error', () => {
    localStorage.setItem('smokestack:save:auto', '{nope');
    localStorage.setItem('smokestack:save:auto:meta', JSON.stringify({ slot: 'auto', date: '1 Jan 1900', company: 'X', money: 1 }));
    const { ui, host } = mount();
    btn(ui, 'Continue').click();
    expect(host.startLoaded).not.toHaveBeenCalled();
    expect(ui.querySelector('.mn-status')?.textContent).toBe('Save file is corrupted');
  });

  it('two end events open one card; closing restores game hotkeys', () => {
    const host = { quitToMenu: vi.fn() };
    const seen: string[] = [];
    const onKey = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', onKey);
    showEndScreen('victory', 'a', host, () => {});
    showEndScreen('gameOver', 'b', host, () => {});
    expect(document.querySelectorAll('.mn-modal')).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(seen).toEqual([]); // swallowed while the card is open
    closeModal();
    expect(document.querySelectorAll('.mn-modal')).toHaveLength(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(seen).toEqual(['x']);
    window.removeEventListener('keydown', onKey);
  });
});

describe('goals panel', () => {
  it('lists the scenario goal with progress', () => {
    const s = testState({ year: 1905 });
    s.scenarioId = 'lumber_baron';
    s.companies.player.money = 500_000;
    const el = buildGoals(s);
    expect(el.textContent).toContain('$500,000');
    expect(el.textContent).toContain('1920');
  });
});
