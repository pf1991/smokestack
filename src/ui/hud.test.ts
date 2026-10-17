// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { currentLedger } from '../sim/finance';
import { createGame } from '../sim/state';
import { GROUPS, Hud, eraName, windLabel } from './hud';
import { pollutionOverlay } from '../render/pollutionOverlay';
import { factionOverlay } from '../render/factionOverlay';
import { closeHelp, isHelpOpen } from './help';
import { ICON_IDS } from '../render/icons';
import { factionName, GREENS_YEAR } from '../data/factions';
import { factionModes } from '../render/factionOverlay';

afterEach(() => {
  document.body.replaceChildren();
});

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

describe('one-row bar with grouped menus', () => {
  const key = (k: string, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const group = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`.hud-group-btn[data-group="${id}"]`)!;
  const menuOf = (btn: HTMLElement) => document.getElementById(btn.getAttribute('aria-controls')!)!;

  it('renders one .hud-bar row holding the treasury, the date, the speeds and the groups', () => {
    const { root, hud, state } = setup();
    hud.update(state);
    const bars = root.querySelectorAll('.hud-bar');
    expect(bars).toHaveLength(1);
    const bar = bars[0];
    for (const sel of ['.hud-money', '.hud-date', '.hud-wind', '.hud-speeds', '.hud-groups', '.hud-more-btn']) {
      expect(bar.querySelector(sel), sel).not.toBeNull();
    }
    // the GROUPS data drives the group buttons
    for (const g of GROUPS) expect(group(root, g.id), g.id).not.toBeNull();
    // the old caption labels are gone: one row only
    expect(bar.querySelector('.hud-label')).toBeNull();
  });

  it('Company, then Finance, opens the finance panel and closes the dropdown', () => {
    const { root, handlers } = setup();
    const company = group(root, 'company');
    const menu = menuOf(company);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.hidden).toBe(true);
    expect(company.getAttribute('aria-haspopup')).toBe('menu');
    expect(company.getAttribute('aria-expanded')).toBe('false');
    company.click();
    expect(menu.hidden).toBe(false);
    expect(company.getAttribute('aria-expanded')).toBe('true');
    const finance = menu.querySelector<HTMLElement>('[data-panel="finance"]')!;
    expect(finance.getAttribute('role')).toBe('menuitem');
    finance.click();
    expect(handlers.onOpenPanel).toHaveBeenCalledWith('finance');
    expect(menu.hidden).toBe(true);
    expect(company.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(company);
  });

  it('Esc closes an open dropdown, returns focus to its button and does not reach the game', () => {
    const { root } = setup();
    const world = group(root, 'world');
    world.click();
    const menu = menuOf(world);
    expect(menu.hidden).toBe(false);
    const game = vi.fn();
    window.addEventListener('keydown', game);
    key('Escape', document.activeElement ?? window);
    window.removeEventListener('keydown', game);
    expect(menu.hidden).toBe(true);
    expect(world.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(world);
    expect(game).not.toHaveBeenCalled();
    // with nothing open, Esc goes through to the game again
    const later = vi.fn();
    window.addEventListener('keydown', later);
    key('Escape');
    window.removeEventListener('keydown', later);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('a click outside closes the dropdown; opening another closes the first', () => {
    const { root } = setup();
    const company = group(root, 'company');
    const world = group(root, 'world');
    company.click();
    world.click();
    expect(menuOf(company).hidden).toBe(true);
    expect(menuOf(world).hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menuOf(world).hidden).toBe(true);
  });

  it('Routes is a direct button with data-panel="routes"', () => {
    const { root, handlers } = setup();
    const routes = root.querySelectorAll<HTMLElement>('[data-panel="routes"]');
    expect(routes).toHaveLength(1);
    expect(routes[0].matches('.hud-panel-btn')).toBe(true);
    expect(routes[0].closest('[role="menu"]')).toBeNull();
    routes[0].click();
    expect(handlers.onOpenPanel).toHaveBeenCalledWith('routes');
  });

  it('every panel keeps data-panel, an icon and a shortcut title', () => {
    const { root } = setup();
    for (const [id, title] of [['finance', 'Finance (F)'], ['goals', 'Goals (G)'], ['routes', 'Routes (R)'], ['fleet', 'Fleet (V)'],
      ['contracts', 'Contracts (C)'], ['newspaper', 'Newspaper (N)'], ['politics', 'Politics (O)'], ['rival', 'Rival (X)']]) {
      const el = root.querySelector<HTMLElement>(`[data-panel="${id}"]`);
      expect(el, id).not.toBeNull();
      expect(el!.getAttribute('title')).toBe(title);
      expect(el!.querySelector('.icon'), id).not.toBeNull();
    }
    for (const btn of root.querySelectorAll<HTMLElement>('.hud-bar button')) {
      expect(btn.querySelector('.icon') ?? btn.closest('.hud-speeds'), btn.className).not.toBeNull();
      // icon-only bar buttons need an aria-label; dropdown items always show their label
      if (btn.getAttribute('role') === 'menuitem') expect(btn.querySelector('.hud-menu-label')?.textContent).toBeTruthy();
      else expect(btn.getAttribute('aria-label'), btn.className).toBeTruthy();
    }
    const smog = root.querySelector('.hud-smog')!;
    expect(smog.getAttribute('title')).toBe('Toggle pollution map (M)');
    expect(smog.getAttribute('aria-label')).toBe('Toggle pollution map (M)');
    expect(root.querySelector('.hud-factions')!.getAttribute('title')).toBe('Toggle faction map (K)');
  });

  it('every bar icon is a painted atlas glyph, not the unknown fallback', () => {
    const { root } = setup();
    const used = [...root.querySelectorAll<HTMLElement>('.hud-bar .icon')].map((i) => i.dataset.icon!);
    expect(used.length).toBeGreaterThan(10);
    for (const id of used) expect(ICON_IDS, id).toContain(id);
  });

  it('the unread badge counts news since the newspaper was last opened and resets on open', () => {
    const { root, hud, state } = setup();
    state.news.push({ id: 900, date: { ...state.date }, headline: 'old', body: '', kind: 'random' });
    hud.update(state); // news already printed before this session counts as read
    const bus = new EventBus();
    hud.attach(bus);
    const world = group(root, 'world');
    const badges = () => [...root.querySelectorAll<HTMLElement>('.hud-badge')].filter((b) => !b.hidden);
    expect(badges()).toHaveLength(0);
    for (const id of [901, 902]) {
      const item = { id, date: { ...state.date }, headline: `h${id}`, body: '', kind: 'random' as const };
      state.news.push(item);
      bus.emit({ type: 'news', item });
    }
    expect(world.querySelector('.hud-badge')!.textContent).toBe('2');
    expect(world.querySelector<HTMLElement>('.hud-badge')!.hidden).toBe(false);
    const paperItem = root.querySelector<HTMLElement>('[data-panel="newspaper"]')!;
    expect(paperItem.querySelector('.hud-badge')!.textContent).toBe('2');
    expect(world.getAttribute('aria-label')).toContain('2 unread');
    world.click();
    paperItem.click();
    expect(badges()).toHaveLength(0);
    // an open from elsewhere (N key, the automatic month-end paper) clears it too
    const item = { id: 903, date: { ...state.date }, headline: 'h', body: '', kind: 'random' as const };
    state.news.push(item);
    bus.emit({ type: 'news', item });
    expect(badges().length).toBeGreaterThan(0);
    hud.markNewsRead();
    expect(badges()).toHaveLength(0);
  });

  it('the overlay toggles still flip setOverlay', () => {
    const { root } = setup();
    const smog = root.querySelector<HTMLElement>('.hud-smog')!;
    expect(smog.closest('[role="menu"]')).toBeNull();
    smog.click();
    expect(pollutionOverlay.enabled).toBe(true);
    expect(smog.getAttribute('aria-pressed')).toBe('true');
    smog.click();
    expect(pollutionOverlay.enabled).toBe(false);
    const factions = root.querySelector<HTMLElement>('.hud-factions')!;
    factions.click();
    expect(factionOverlay.enabled).toBe(true);
    // the faction-mode select lives in the Factions dropdown
    const modeBtn = root.querySelector<HTMLButtonElement>('.hud-factions-mode-btn')!;
    expect(modeBtn.hidden).toBe(false);
    modeBtn.click();
    const pop = menuOf(modeBtn);
    expect(pop.hidden).toBe(false);
    expect(pop.querySelector('.hud-faction-mode')).not.toBeNull();
    factions.click();
    expect(factionOverlay.enabled).toBe(false);
    expect(modeBtn.hidden).toBe(true);
  });

  it('More holds Photo, Help, and Save, Load and Settings when the game offers a menu', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onPhoto = vi.fn();
    const onMenu = vi.fn();
    new Hud(root, { onSpeed: vi.fn(), onOpenPanel: vi.fn(), onPhoto, onMenu });
    const more = root.querySelector<HTMLButtonElement>('.hud-more-btn')!;
    const menu = menuOf(more);
    const item = (a: string) => menu.querySelector<HTMLElement>(`[data-action="${a}"]`)!;
    more.click();
    item('photo').click();
    expect(onPhoto).toHaveBeenCalledTimes(1);
    expect(menu.hidden).toBe(true);
    for (const s of ['save', 'load', 'settings'] as const) {
      more.click();
      item(s).click();
      expect(onMenu).toHaveBeenLastCalledWith(s);
    }
    more.click();
    item('help').click();
    expect(isHelpOpen()).toBe(true);
    closeHelp();
    // without a game menu handler the items are left out
    const bare = setup().root;
    const bareMenu = menuOf(bare.querySelector<HTMLElement>('.hud-more-btn')!);
    expect(bareMenu.querySelector('[data-action="save"]')).toBeNull();
    expect(bareMenu.querySelector('[data-action="help"]')).not.toBeNull();
  });

  it('arrow keys move between the items of an open menu', () => {
    const { root } = setup();
    const world = group(root, 'world');
    world.click();
    const items = [...menuOf(world).querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);
    key('ArrowDown', items[0]);
    expect(document.activeElement).toBe(items[1]);
    key('ArrowUp', items[1]);
    key('ArrowUp', items[0]);
    expect(document.activeElement).toBe(items[items.length - 1]);
    // the game never sees the arrows (map pan) or Space (pause) while they work the menu
    const game = vi.fn();
    window.addEventListener('keydown', game);
    key('ArrowDown', document.activeElement!);
    key(' ', document.activeElement!);
    window.removeEventListener('keydown', game);
    expect(game).not.toHaveBeenCalled();
    key('Escape', document.activeElement!);
  });
});
