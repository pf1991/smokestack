// @vitest-environment jsdom
import { SAVE_VERSION } from '../sim/migrations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTo } from '../game/saves';
import { createGame } from '../sim/state';
import { closeModal, MainMenu, openPauseMenu, showEndScreen } from './menu';
import { buildGoals } from './panels/goals';
import { testState } from '../sim/testkit';
import * as aiClient from '../ai/client';

vi.mock('../ai/client', async (orig) => {
  const m = await orig<typeof import('../ai/client')>();
  return { ...m, aiStatus: vi.fn(m.aiStatus) };
});

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
  it('without a save the menu has no Continue button', () => {
    const { ui } = mount();
    expect(ui.querySelector('.mn-title')?.textContent).toBe('SMOKESTACK');
    expect(btn(ui, 'Continue')).toBeUndefined();
  });

  it('the home buttons: New game primary, Load game, Achievements and Settings quiet', () => {
    const { ui } = mount();
    expect(btn(ui, 'New game').classList.contains('kit-btn--primary')).toBe(true);
    for (const label of ['Load game', 'Achievements', 'Settings']) expect(btn(ui, label).classList.contains('kit-btn--quiet'), label).toBe(true);
  });

  it('with a save, Continue is secondary and loads the autosave', () => {
    saveTo('auto', createGame({ seed: 4, companyName: 'Auto Co' }));
    const { ui, host } = mount();
    const c = btn(ui, 'Continue');
    expect(c.disabled).toBe(false);
    expect(c.classList.contains('kit-btn--secondary')).toBe(true);
    c.click();
    expect(host.startLoaded).toHaveBeenCalledTimes(1);
  });

  it('the Load screen shows a SMOKESTACK I slot as unreadable with Load disabled', () => {
    localStorage.setItem('smokestack:save:slot1', JSON.stringify({ version: 1, map: { tiles: [] } }));
    const { ui } = mount();
    btn(ui, 'Load game').click();
    const slot = [...ui.querySelectorAll('.mn-slot')].find((d) => d.textContent?.includes('Slot 1')) as HTMLElement;
    expect(slot.textContent).toContain('SMOKESTACK I');
    expect(slot.textContent).not.toContain('Empty slot');
    expect((slot.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('New Game starts the chosen scenario with the rival toggle', () => {
    const { ui, host } = mount();
    btn(ui, 'New game').click();
    btn(ui, 'Lumber Baron').click();
    (ui.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    btn(ui, 'Start').click();
    expect(host.startNew).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: 'lumber_baron', rival: false }));
  });

  it('Beat the Baron forces the rival on', () => {
    const { ui } = mount();
    btn(ui, 'New game').click();
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
    localStorage.setItem('smokestack:save:auto:meta', JSON.stringify({ v: SAVE_VERSION, slot: 'auto', date: '1 Jan 1900', company: 'X', money: 1 }));
    const { ui, host } = mount();
    btn(ui, 'Continue').click();
    expect(host.startLoaded).not.toHaveBeenCalled();
    expect(ui.querySelector('.mn-status')?.textContent).toBe('Save file is corrupted');
  });

  it('the end screen uses the kit buttons and a kit table for the Legacy', () => {
    showEndScreen('victory', 'The century is over', { quitToMenu: vi.fn() }, () => {}, createGame({ seed: 7 }));
    const m = document.querySelector('.mn-modal') as HTMLElement;
    expect(m.querySelector('table.kit-table')).not.toBeNull();
    expect(btn(m, 'Main menu').classList.contains('kit-btn--primary')).toBe(true);
    expect(btn(m, 'Look around').classList.contains('kit-btn--secondary')).toBe(true);
    closeModal();
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

describe('settings: Skip intro', () => {
  it('the toggle is stored with the other settings', async () => {
    const { loadSettings } = await import('../game/settings');
    expect(loadSettings().skipIntro).toBe(false);
    const { ui, menu } = mount();
    menu.show('settings');
    const row = [...ui.querySelectorAll('label')].find((l) => l.textContent === 'Skip intro')!;
    const box = row.querySelector('input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(loadSettings().skipIntro).toBe(true);
    expect(loadSettings().volume).toBe(0.6);
  });
});

describe('pause menu: opening straight onto a screen', () => {
  const fakeGame = () => ({ state: { speed: 2 }, setSpeed: vi.fn(), sfx: { setVolume: vi.fn(), setMuted: vi.fn() } });
  const host = { startNew: vi.fn(), startLoaded: vi.fn(), quitToMenu: vi.fn() };
  it('the pause home uses the kit buttons: Resume primary, Quit to menu danger', () => {
    closeModal();
    openPauseMenu(fakeGame() as never, host);
    const m = document.querySelector('.mn-modal') as HTMLElement;
    expect(btn(m, 'Resume').classList.contains('kit-btn--primary')).toBe(true);
    const quit = btn(m, 'Quit to menu');
    expect(quit.classList.contains('kit-btn--danger')).toBe(true);
    quit.click();
    expect(quit.textContent).toContain('click again');
    expect(host.quitToMenu).not.toHaveBeenCalled();
    closeModal();
  });

  it.each([['settings', 'Settings'], ['save', 'Save game'], ['load', 'Load game']] as const)('%s opens the %s screen', (screen, title) => {
    closeModal();
    const game = fakeGame();
    openPauseMenu(game as never, host, screen);
    expect(document.querySelector('.mn-modal h2')?.textContent).toBe(title);
    expect(game.setSpeed).toHaveBeenCalledWith(0);
    // Back still leads to the pause home
    btn(document.body, 'Back').click();
    expect(document.querySelector('.mn-modal h2')?.textContent).toBe('Paused');
    closeModal();
  });
});

describe('settings: Smart events', () => {
  it('defaults on and is stored with the other settings', async () => {
    const { loadSettings, saveSettings } = await import('../game/settings');
    expect(loadSettings().smartEvents).toBe(true);
    saveSettings({ ...loadSettings(), smartEvents: false });
    expect(loadSettings().smartEvents).toBe(false);
    localStorage.clear();
  });

  it('shows "not checked yet" before any health check has run', () => {
    const { ui, menu } = mount();
    menu.show('settings');
    expect(ui.querySelector('.mn-ai-status')?.textContent).toBe('JEV: not checked yet');
  });

  it('explains an offline JEV as needing the self-hosted server', () => {
    // once only: later tests keep the real aiStatus (mockReset would leave it returning undefined)
    vi.mocked(aiClient.aiStatus).mockReturnValueOnce('offline');
    const { ui, menu } = mount();
    menu.show('settings');
    expect(ui.querySelector('.mn-ai-status')?.textContent).toBe('Needs the self-hosted server (see README)');
  });

  it('the offline case leaves the real aiStatus in place for later tests', () => {
    expect(aiClient.aiStatus()).toBeDefined();
  });
});

describe('settings: both branches\' fields', () => {
  afterEach(() => localStorage.clear());

  it('the screen shows every setting, including JEV and the side panel width', () => {
    const { ui, menu } = mount();
    menu.show('settings');
    const labels = [...ui.querySelectorAll('.mn-row > span:first-child')].map((s) => s.textContent);
    expect(labels).toEqual(['Interface scale', 'News ticker', 'Side panel width', 'Master volume', 'Mute all sound',
      'Open the newspaper automatically', 'Skip intro', 'Smart events (JEV)']);
  });

  it('groups the settings in cards: Display, Sound, Gameplay and Smart events', () => {
    const { ui, menu } = mount();
    menu.show('settings');
    const cards = [...ui.querySelectorAll('.kit-card')];
    expect(cards.map((c) => c.querySelector('.kit-card-title')?.textContent)).toEqual(['Display', 'Sound', 'Gameplay', 'Smart events']);
    const rows = (i: number) => [...cards[i].querySelectorAll('.mn-row > span:first-child')].map((s) => s.textContent);
    expect(rows(0)).toEqual(['Interface scale', 'News ticker', 'Side panel width']);
    expect(rows(3)).toEqual(['Smart events (JEV)']);
    expect(cards[3].querySelector('.mn-ai-status')).not.toBeNull();
  });

  it('Reset forgets a dragged side panel width', async () => {
    const { loadSettings, saveSettings } = await import('../game/settings');
    saveSettings({ ...loadSettings(), panelWidth: 512 });
    const { ui, menu } = mount();
    menu.show('settings');
    expect(ui.querySelector('.mn-width-value')?.textContent).toBe('512 px');
    btn(ui, 'Reset').click();
    expect(loadSettings().panelWidth).toBeNull();
    expect(ui.querySelector('.mn-width-value')?.textContent).toBe('Default');
  });

  it.each([
    ['main (JEV)', { volume: 0.3, muted: true, skipIntro: true, smartEvents: false }],
    ['v2/ux', { volume: 0.3, muted: true, skipIntro: true, panelWidth: 500, ticker: 'off', uiScale: 1.15 }],
  ])('loads a settings file saved by %s', async (_name, saved) => {
    const { DEFAULT_SETTINGS, loadSettings } = await import('../game/settings');
    localStorage.setItem('smokestack:settings', JSON.stringify(saved));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, autoNews: true, ...saved });
  });
});
