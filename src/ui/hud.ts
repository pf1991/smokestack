import type { EventBus } from '../core/events';
import { GREENS_YEAR } from '../data/factions';
import { eraName } from '../sim/eras';
import { monthProfit } from '../sim/finance';
export { eraName };
import type { GameState, NewsItem, Speed, Weather } from '../sim/types';
import { setOverlay } from '../render/overlays';
import { factionOverlay, factionModes, setFactionMode, getFactionMode, type FactionMode } from '../render/factionOverlay';
import { h } from './dom';
import { shortcutFor, shortcutForEvent, withShortcut } from './shortcuts';
import { openHelp } from './help';
import type { PauseScreen } from './menu';
import { iconEl } from './icon';
import { formatMoney } from './format';
import { groupThousands, wholeNumber } from '../core/money';
import { RollingCounter } from './juice';
import { deltaText, pill, tooltip, type Tone } from './kit';
import { openMonth } from './ledger';
import { drawFamilyCrest } from '../render/portrait';
import './hud.css';

export interface HudHandlers {
  onSpeed(s: GameState['speed']): void;
  onOpenPanel(id: string): void;
  onPhoto?(): void;
  /** Opens the game menu on Save, Load or Settings; without it the More menu leaves those out. */
  onMenu?(screen: PauseScreen): void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Speed radios: short text labels (title and aria-label name them with their shortcut). */
const SPEEDS: { speed: Speed; text: string; title: string }[] = [
  { speed: 0, text: 'II', title: withShortcut('Pause', 'pause') },
  { speed: 1, text: '1\u00d7', title: withShortcut('Normal speed', 'speed', '1') },
  { speed: 2, text: '2\u00d7', title: withShortcut('Fast', 'speed', '2') },
  { speed: 4, text: '4\u00d7', title: withShortcut('Faster', 'speed', '4') },
  { speed: 8, text: '8\u00d7', title: withShortcut('Fastest', 'speed', '8') },
];

/** The treasury in full ("$1,234,567,890"): the top bar is the one place the exact balance shows. */
export function hudMoney(n: number): string {
  const r = wholeNumber(n);
  return `${r < 0 ? '-' : ''}$${groupThousands(Math.abs(r))}`;
}

/** Tone of a profit figure: whole dollars either side of zero, neutral at $0. */
function profitTone(v: number): Tone {
  return v >= 0.5 ? 'positive' : v <= -0.5 ? 'negative' : 'neutral';
}

/** Crest canvas side in CSS px; the backing store is drawn at 2x for sharp edges on HiDPI screens. */
const CREST_PX = 24;

export interface HudGroupItem {
  panel: string;
  label: string;
  icon: string;
  /** shown as its own button in the bar, next to the group, instead of inside the dropdown */
  direct?: boolean;
}

export interface HudGroup {
  id: string;
  label: string;
  icon: string;
  items: HudGroupItem[];
}

/**
 * The bar's panel groups, left to right. Data only: a new panel is one more item here (and one
 * more SHORTCUTS entry, or an exemption in menuDrift.test.ts). Routes stays a direct button: the tutorial points at it.
 */
export const GROUPS: HudGroup[] = [
  {
    id: 'company',
    label: 'Company',
    icon: 'top_hat',
    items: [
      { panel: 'finance', label: 'Finance', icon: 'money' },
      { panel: 'goals', label: 'Goals', icon: 'star' },
      { panel: 'exchange', label: 'Exchange', icon: 'bell' },
      { panel: 'family', label: 'Family', icon: 'crown' },
      { panel: 'legacy', label: 'Legacy', icon: 'scroll' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: 'crate',
    items: [
      { panel: 'routes', label: 'Routes', icon: 'route', direct: true },
      { panel: 'fleet', label: 'Fleet', icon: 'truck' },
      { panel: 'contracts', label: 'Contracts', icon: 'permit' },
      { panel: 'managers', label: 'Managers', icon: 'manager' },
    ],
  },
  {
    id: 'world',
    label: 'World',
    icon: 'city',
    items: [
      { panel: 'newspaper', label: 'Newspaper', icon: 'news' },
      { panel: 'politics', label: 'Politics', icon: 'ballot' },
      { panel: 'rival', label: 'Rival', icon: 'factory' },
    ],
  },
];

/** The group whose button carries the newspaper's unread badge. */
const NEWS_PANEL = 'newspaper';

/** "9+" past nine: the badge stays one small disc. */
function badgeText(n: number): string {
  return n > 9 ? '9+' : String(n);
}

/** Icon plus a label that shows only on wide screens (hud.css); the button's aria-label names it. */
function iconLabel(icon: string, label: string): HTMLElement[] {
  return [iconEl(icon, 18), h('span', { class: 'hud-btn-label' }, label)];
}

/**
 * One dropdown: a button with aria-haspopup / aria-expanded and a popup it controls. The Hud keeps
 * at most one open; Esc, a click outside or choosing an item closes it.
 */
interface Dropdown {
  button: HTMLButtonElement;
  menu: HTMLElement;
  wrap: HTMLElement;
}

let menuSeq = 0;

/** Keys an open menu handles itself (navigation and activation). */
const MENU_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '];

const DELTA_MS = 1500;

/** Compass names, clockwise from east in screen space (+y is south). */
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** Vane tooltip: where the wind blows from and how hard, plus "Rain" on rain days. */
export function windLabel(w: Weather): string {
  const mag = Math.hypot(w.windX, w.windY);
  let text: string;
  if (mag < 0.15) text = 'Wind: calm';
  else {
    // named for where it comes from: the opposite of the way it blows
    const from = Math.round(Math.atan2(-w.windY, -w.windX) / (Math.PI / 4));
    const strength = mag < 0.7 ? 'light' : mag < 1.15 ? 'brisk' : 'strong';
    text = `Wind: ${COMPASS[((from % 8) + 8) % 8]}, ${strength}`;
  }
  return w.rain ? `${text}. Rain` : text;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** "Finance (F)" as a label and its key, for the tooltip's key cap. */
function splitShortcut(title: string): { label: string; key: string | null } {
  const m = /^(.*) \(([^()]+)\)$/.exec(title);
  return m ? { label: m[1], key: m[2] } : { label: title, key: null };
}

/**
 * The kit tooltip on a bar button: its label, plus the shortcut as a key cap. The native `title`
 * stays for assistive tech and tests, but is parked while the pointer is over the button so the
 * browser does not show a second, plain tooltip on top of ours.
 */
export function barTip(btn: HTMLElement): () => void {
  const park = () => {
    const t = btn.getAttribute('title');
    if (t === null) return;
    btn.dataset.tip = t;
    btn.removeAttribute('title');
  };
  const restore = () => {
    const t = btn.dataset.tip;
    if (t === undefined) return;
    if (!btn.hasAttribute('title')) btn.setAttribute('title', t);
    delete btn.dataset.tip;
  };
  btn.addEventListener('pointerenter', park);
  btn.addEventListener('pointerleave', restore);
  const off = tooltip(btn, () => {
    const { label, key } = splitShortcut(btn.dataset.tip ?? btn.title);
    return h('span', { class: 'hud-tip' }, label, key ? h('kbd', { class: 'kit-kbd' }, key) : null);
  });
  return () => {
    restore();
    btn.removeEventListener('pointerenter', park);
    btn.removeEventListener('pointerleave', restore);
    off();
  };
}

export class Hud {
  private readonly company: HTMLElement;
  private readonly crest: HTMLCanvasElement;
  private crestName: string | null = null;
  private readonly money: HTMLElement;
  private readonly profit: HTMLElement;
  private profitShown = '';
  private readonly date: HTMLElement;
  private readonly era: HTMLElement;
  private readonly vane: HTMLElement;
  private readonly vaneArrow: HTMLElement;
  private readonly vaneRain: HTMLElement;
  /** the vane shows the weather of a new game or load once, then follows dayStart */
  private vaneStale = true;
  private readonly speedButtons = new Map<Speed, HTMLElement>();
  private lastSpeed: Speed | null = null;
  private readonly counter: RollingCounter;
  private state: GameState | null = null;
  private seeded = false;
  private readonly modeSel: HTMLSelectElement;
  private readonly overlayButtons = new Map<'pollution' | 'factions', HTMLElement>();
  /** whether the faction-mode labels were built for the post-GREENS_YEAR names */
  private modeGreen = false;
  private open: Dropdown | null = null;
  /** news ids up to here have been seen in the newspaper (UI state, not saved) */
  private newsSeenId = -Infinity;
  private newsSeeded = false;
  private unread = 0;
  /** the unread badges: on the World group and on its Newspaper item */
  private readonly badges: HTMLElement[] = [];
  private newsGroupButton: HTMLElement | null = null;
  private newsGroupLabel = '';
  private readonly tips: (() => void)[] = [];
  /** the slot the alerts bell mounts into; empty (and hidden, with its divider) until then */
  readonly alertsSlot: HTMLElement = h('span', { id: 'hud-alerts', class: 'hud-alerts' });

  constructor(root: HTMLElement, private readonly handlers: HudHandlers) {
    this.company = h('div', { class: 'hud-company hud-name' }, '');
    this.crest = h('canvas', { class: 'hud-crest', width: CREST_PX * 2, height: CREST_PX * 2, 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.money = h('div', { class: 'hud-money', title: 'Treasury: cash on hand' }, '$0');
    this.counter = new RollingCounter(this.money, hudMoney);
    this.profit = pill(formatMoney(0), 'neutral');
    this.profit.classList.add('hud-delta');
    this.profit.title = "This month's profit so far";
    this.date = h('div', { class: 'hud-date' }, '');
    this.era = h('div', { class: 'hud-era' }, '');
    this.vaneArrow = iconEl('wind', 18);
    this.vaneRain = iconEl('rain', 16);
    this.vaneRain.hidden = true;
    this.vane = h('div', { class: 'hud-wind', role: 'img', 'aria-label': 'Wind' }, this.vaneArrow, this.vaneRain);

    // .hud-speeds stays for the tutorial's highlight
    const speeds = h('div', { class: 'hud-speed hud-speeds', role: 'radiogroup', 'aria-label': 'Game speed' });
    for (const s of SPEEDS) {
      const btn = h('button', {
        class: 'hud-speed-btn',
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        tabindex: '-1',
        'data-speed': s.speed,
        title: s.title,
        'aria-label': s.title,
        onClick: () => this.chooseSpeed(s.speed),
      }, s.text);
      this.speedButtons.set(s.speed, btn);
      speeds.appendChild(btn);
    }
    speeds.addEventListener('keydown', (e) => this.speedKey(e));
    this.markSpeed(1);

    const groups = h('div', { class: 'hud-groups' });
    for (const g of GROUPS) {
      // a group's direct buttons (Routes) sit joined to the right of its dropdown
      const set = h('div', { class: 'hud-group-set' });
      const menuItems = g.items.filter((i) => !i.direct);
      if (menuItems.length > 0) {
        const title = `${g.label}: ${menuItems.map((i) => i.label).join(', ')}`;
        const dd = this.dropdown(g.label, g.icon, 'hud-group-btn hud-labelled', menuItems.map((it) => this.menuItem(it)), 'menu', title);
        dd.button.dataset.group = g.id;
        if (g.items.some((i) => i.panel === NEWS_PANEL)) {
          this.newsGroupButton = dd.button;
          this.newsGroupLabel = title;
          dd.button.appendChild(this.badge());
        }
        set.appendChild(dd.wrap);
      }
      for (const it of g.items.filter((i) => i.direct)) set.appendChild(this.panelButton(it));
      groups.appendChild(set);
    }

    const layers = h('div', { class: 'hud-layers' });
    const smog = this.toggle('hud-smog', 'smog', 'Smog', withShortcut('Toggle pollution map', 'overlay', 'pollution'), (on) => setOverlay('pollution', on));
    this.overlayButtons.set('pollution', smog);
    const modeSel = h('select', {
      class: 'hud-faction-mode',
      title: 'What the faction map shows',
      'aria-label': 'Faction map mode',
      onChange: () => {
        setFactionMode((modeSel as HTMLSelectElement).value as FactionMode);
        this.closeMenu(true);
      },
    }, ...factionModes(1900).map((m) => h('option', { value: m.value }, m.label)));
    (modeSel as HTMLSelectElement).value = getFactionMode();
    this.modeSel = modeSel as HTMLSelectElement;
    // the faction map's mode select sits in a small popup next to its toggle (shown while the map is on)
    const modes = this.dropdown('Faction map mode', 'ballot', 'hud-factions-mode-btn', [
      h('label', { class: 'hud-menu-field' }, h('span', null, 'Show'), modeSel),
    ], 'group');
    const factions = this.toggle('hud-factions', 'protest', 'Factions', withShortcut('Toggle faction map', 'overlay', 'factions'), (on) => {
      modes.button.hidden = !on;
      if (!on && this.open === modes) this.closeMenu(false);
      setOverlay('factions', on);
    });
    modes.button.hidden = true;
    if (factionOverlay.enabled) {
      // started on by the DEV overlay param
      factions.setAttribute('aria-pressed', 'true');
      factions.classList.add('active');
      modes.button.hidden = false;
    }
    this.overlayButtons.set('factions', factions);
    layers.append(smog, h('div', { class: 'hud-split' }, factions, modes.wrap));

    const more = this.dropdown('More', 'more', 'hud-more-btn', this.moreItems());
    const onMenu = handlers.onMenu;
    const settings = onMenu
      ? h('button', {
        class: 'hud-btn hud-settings-btn',
        type: 'button',
        title: 'Settings',
        'aria-label': 'Settings',
        onClick: () => onMenu('settings'),
      }, ...iconLabel('gear', 'Settings'))
      : null;

    const bar = h('div', { class: 'hud-bar' },
      h('div', { class: 'hud-left' },
        this.crest,
        h('div', { class: 'hud-brand' }, this.company, this.era)),
      h('div', { class: 'hud-center' },
        h('div', { class: 'hud-cash' }, this.money, this.profit),
        h('div', { class: 'hud-clock', title: 'Date' }, this.date, this.vane),
        speeds),
      h('div', { class: 'hud-right' },
        groups,
        layers,
        // the controller mounts the alerts bell here (ui/alertsTray.ts)
        this.alertsSlot,
        settings,
        more.wrap));

    for (const btn of bar.querySelectorAll<HTMLElement>('button:not([role="menuitem"])')) this.tips.push(barTip(btn));

    root.append(bar, h('div', { id: 'ticker', class: 'hud-ticker' }));
  }

  // ------------------------------------------------------------------ speed radios

  private chooseSpeed(speed: Speed): void {
    this.markSpeed(speed);
    this.handlers.onSpeed(speed);
  }

  /** Checks one radio and gives it the group's single tab stop. */
  private markSpeed(speed: Speed): void {
    for (const [s, btn] of this.speedButtons) {
      const on = s === speed;
      btn.setAttribute('aria-checked', String(on));
      btn.setAttribute('tabindex', on ? '0' : '-1');
      btn.classList.toggle('active', on);
    }
  }

  /** Radio-group keys: Left / Right (and Up / Down) move and select, Home / End jump to the ends. */
  private speedKey(e: KeyboardEvent): void {
    const order = SPEEDS.map((s) => s.speed);
    const at = order.findIndex((s) => this.speedButtons.get(s) === e.target);
    if (at < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(order.length - 1, at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = order.length - 1;
    if (next < 0) return;
    // the game would pan the map on the arrows
    e.preventDefault();
    e.stopPropagation();
    this.chooseSpeed(order[next]);
    this.speedButtons.get(order[next])?.focus();
  }

  // ------------------------------------------------------------------ bar parts

  private panelButton(it: HudGroupItem): HTMLElement {
    const title = withShortcut(it.label, 'panel', it.panel);
    return h('button', {
      class: 'hud-btn hud-panel-btn hud-labelled',
      'data-panel': it.panel,
      title,
      'aria-label': title,
      onClick: () => this.openPanel(it.panel),
    }, ...iconLabel(it.icon, it.label));
  }

  private menuItem(it: HudGroupItem): HTMLElement {
    const btn = h('button', {
      class: 'hud-menu-item',
      role: 'menuitem',
      tabindex: '-1',
      'data-panel': it.panel,
      title: withShortcut(it.label, 'panel', it.panel),
      onClick: () => {
        // focus goes back to the group button; a panel that takes focus takes it after this
        this.closeMenu(true);
        this.openPanel(it.panel);
      },
    }, iconEl(it.icon, 18), h('span', { class: 'hud-menu-label' }, it.label));
    const key = shortcutFor('panel', it.panel);
    if (key) btn.appendChild(h('kbd', { class: 'hud-menu-key' }, key));
    if (it.panel === NEWS_PANEL) btn.appendChild(this.badge());
    return btn;
  }

  private actionItem(action: string, icon: string, label: string, run: () => void, key?: string | null): HTMLElement {
    return h('button', {
      class: 'hud-menu-item',
      role: 'menuitem',
      tabindex: '-1',
      'data-action': action,
      title: key ? `${label} (${key})` : label,
      onClick: run,
    }, iconEl(icon, 18), h('span', { class: 'hud-menu-label' }, label), ...(key ? [h('kbd', { class: 'hud-menu-key' }, key)] : []));
  }

  private moreItems(): HTMLElement[] {
    const items = [
      this.actionItem('photo', 'camera', 'Photo mode', () => {
        this.closeMenu(true);
        this.handlers.onPhoto?.();
      }, shortcutFor('photo')),
      this.actionItem('help', 'help', 'Help and controls', () => {
        // focus goes back to More first, so closing the help overlay returns it there
        this.closeMenu(true);
        openHelp();
      }, shortcutFor('help')),
    ];
    const onMenu = this.handlers.onMenu;
    if (onMenu) {
      const screens: [PauseScreen, string, string][] = [['save', 'scroll', 'Save game'], ['load', 'library', 'Load game'], ['settings', 'gear', 'Settings']];
      for (const [screen, icon, label] of screens) {
        items.push(this.actionItem(screen, icon, label, () => {
          this.closeMenu(true);
          onMenu(screen);
        }));
      }
    }
    return items;
  }

  private toggle(cls: string, icon: string, label: string, title: string, apply: (on: boolean) => void): HTMLElement {
    const btn: HTMLElement = h('button', {
      class: `hud-btn hud-toggle ${cls}`,
      title,
      'aria-label': title,
      'aria-pressed': 'false',
      onClick: () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(on));
        btn.classList.toggle('active', on);
        apply(on);
      },
    }, ...iconLabel(icon, label));
    return btn;
  }

  private badge(): HTMLElement {
    const b = h('span', { class: 'hud-badge', 'aria-hidden': 'true' }, '');
    b.hidden = true;
    this.badges.push(b);
    return b;
  }

  // ------------------------------------------------------------------ dropdowns

  /** `title` (tooltip and accessible name) defaults to `label`; groups list their contents in it. */
  private dropdown(label: string, icon: string, cls: string, items: HTMLElement[], role: 'menu' | 'group' = 'menu', title = label): Dropdown {
    const id = `hud-menu-${++menuSeq}`;
    const menu = h('div', { class: 'hud-menu', id, role, 'aria-label': label }, ...items);
    menu.hidden = true;
    const button = h('button', {
      class: `hud-btn ${cls}`,
      title,
      'aria-label': title,
      'aria-haspopup': role === 'menu' ? 'menu' : 'true',
      'aria-expanded': 'false',
      'aria-controls': id,
    }, ...iconLabel(icon, label), h('span', { class: 'hud-caret', 'aria-hidden': 'true' })) as HTMLButtonElement;
    const wrap = h('div', { class: 'hud-dropdown' }, button, menu);
    const dd: Dropdown = { button, menu, wrap };
    button.addEventListener('click', () => {
      if (this.open === dd) this.closeMenu(false);
      else this.openMenu(dd);
    });
    menu.addEventListener('keydown', (e) => this.menuKey(e, dd));
    return dd;
  }

  private openMenu(dd: Dropdown): void {
    this.closeMenu(false);
    this.open = dd;
    dd.menu.hidden = false;
    dd.button.setAttribute('aria-expanded', 'true');
    dd.wrap.classList.add('open');
    window.addEventListener('keydown', this.onWindowKey, true);
    window.addEventListener('pointerdown', this.onWindowPointer, true);
    this.focusables(dd)[0]?.focus();
  }

  /** Closes the open dropdown; `refocus` puts focus back on its button (Esc). */
  private closeMenu(refocus: boolean): void {
    const dd = this.open;
    if (!dd) return;
    this.open = null;
    dd.menu.hidden = true;
    dd.button.setAttribute('aria-expanded', 'false');
    dd.wrap.classList.remove('open');
    window.removeEventListener('keydown', this.onWindowKey, true);
    window.removeEventListener('pointerdown', this.onWindowPointer, true);
    if (refocus) dd.button.focus();
  }

  private focusables(dd: Dropdown): HTMLElement[] {
    return [...dd.menu.querySelectorAll<HTMLElement>('[role="menuitem"], select')];
  }

  /**
   * Esc closes the open dropdown before the game sees the key (it would open the pause menu). Any
   * other game shortcut closes it and goes on to the game (N with World open opens the paper),
   * except the keys that work the menu itself while focus is inside it.
   */
  private readonly onWindowKey = (e: KeyboardEvent): void => {
    const dd = this.open;
    if (!dd) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeMenu(true);
      return;
    }
    const inside = e.target instanceof Node && dd.wrap.contains(e.target);
    if (inside && (MENU_KEYS.includes(e.key) || e.target instanceof HTMLSelectElement)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !shortcutForEvent(e.key)) return;
    this.closeMenu(inside);
  };

  /** A click outside closes the dropdown and stops there: it must not also act on the map. */
  private readonly onWindowPointer = (e: Event): void => {
    if (!this.open || (e.target instanceof Node && this.open.wrap.contains(e.target))) return;
    e.preventDefault();
    e.stopPropagation();
    this.closeMenu(false);
  };

  /**
   * Up / Down / Home / End move through the items; Tab leaves and closes. Navigation and activation
   * keys stop here: the game would pan on the arrows and pause on Space.
   */
  private menuKey(e: KeyboardEvent, dd: Dropdown): void {
    if (MENU_KEYS.includes(e.key)) e.stopPropagation();
    const items = this.focusables(dd);
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') {
      this.closeMenu(false);
      return;
    }
    if (next < 0 || items.length === 0 || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    items[next].focus();
  }

  private openPanel(id: string): void {
    if (id === NEWS_PANEL) this.markNewsRead();
    this.handlers.onOpenPanel(id);
  }

  // ------------------------------------------------------------------ newspaper badge

  /** The newspaper was opened: everything printed so far is read. */
  markNewsRead(): void {
    for (const n of this.state?.news ?? []) this.newsSeenId = Math.max(this.newsSeenId, n.id);
    this.unread = 0;
    this.renderBadges();
  }

  /** Monthly market reports are routine: they print, but do not count as unread news. */
  private noteNews(item: NewsItem): void {
    if (item.id <= this.newsSeenId || item.kind === 'market') return;
    this.unread += 1;
    this.renderBadges();
  }

  private renderBadges(): void {
    const text = badgeText(this.unread);
    for (const b of this.badges) {
      b.hidden = this.unread === 0;
      setText(b, this.unread === 0 ? '' : text);
    }
    const btn = this.newsGroupButton;
    if (btn) {
      const label = this.unread === 0 ? this.newsGroupLabel : `${this.newsGroupLabel}. ${this.unread} unread news`;
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  /** M / K: presses the overlay's button so its pressed state and the map stay in sync. */
  toggleOverlay(id: 'pollution' | 'factions'): void {
    this.overlayButtons.get(id)?.click();
  }

  /** Pops the player's month result when a month closes. Returns an unsubscribe. */
  attach(bus: EventBus): () => void {
    const offMonth = bus.on('monthEnd', (e) => {
      const player = this.state?.companies.player;
      if (!player) return;
      const m = player.ledger.find((l) => l.year === e.date.year && l.month === e.date.month);
      this.popDelta(m ? monthProfit(m) : 0);
    });
    // weather changes once a day: the vane never updates per frame
    const offDay = bus.on('dayStart', () => {
      if (this.state) this.updateVane(this.state.weather);
    });
    const offNews = bus.on('news', (e) => this.noteNews(e.item));
    return () => {
      offMonth();
      offDay();
      offNews();
      this.closeMenu(false);
    };
  }

  private updateVane(w: Weather | undefined): void {
    if (!w) return;
    const label = windLabel(w);
    this.vane.title = label;
    this.vane.setAttribute('aria-label', label);
    const deg = Math.round((Math.atan2(w.windY, w.windX) * 180) / Math.PI);
    this.vaneArrow.style.transform = `rotate(${deg}deg)`;
    this.vaneArrow.style.opacity = Math.hypot(w.windX, w.windY) < 0.15 ? '0.45' : '';
    this.vaneRain.hidden = !w.rain;
  }

  private popDelta(net: number): void {
    const good = net >= 0;
    const el = h('div', { class: `hud-pop ${good ? 'good' : 'bad'}` }, `${good ? '+' : '\u2212'}${formatMoney(Math.abs(net))}`);
    const cash = this.money.parentElement ?? this.money;
    cash.appendChild(el);
    setTimeout(() => el.remove(), DELTA_MS);
  }

  /** Forgets the previous game: the next update snaps the treasury instead of rolling. */
  reset(): void {
    this.state = null;
    this.seeded = false;
    this.vaneStale = true;
    this.newsSeeded = false;
    this.newsSeenId = -Infinity;
    this.unread = 0;
    this.renderBadges();
    this.closeMenu(false);
  }

  /** Advances the treasury roll; call every frame. */
  tick(nowMs: number): void {
    this.counter.tick(nowMs);
  }

  update(state: GameState, nowMs: number = performance.now()): void {
    this.state = state;
    const player = state.companies.player;
    if (this.crestName !== player.name) {
      this.crestName = player.name;
      this.company.textContent = player.name;
      this.company.title = player.name;
      this.drawCrest(player.name);
    }
    if (this.seeded) {
      this.counter.set(player.money, nowMs);
    } else {
      this.seeded = true;
      this.counter.snap(player.money);
    }
    this.money.classList.toggle('negative', player.money < 0);
    this.money.title = `Treasury: ${hudMoney(player.money)} cash on hand`;
    this.updateProfit(state);
    const d = state.date;
    setText(this.date, `${d.day} ${MONTHS[d.month - 1] ?? '???'} ${d.year}`);
    setText(this.era, eraName(d.year));
    if (!this.newsSeeded) {
      // a fresh game or a load: what was printed before this session counts as read
      this.newsSeeded = true;
      this.markNewsRead();
    }
    if (this.vaneStale) {
      this.vaneStale = false;
      this.updateVane(state.weather);
    }
    // the Reformers become the Greens in GREENS_YEAR: relabel the faction-map modes (both ways, for loads)
    const green = d.year >= GREENS_YEAR;
    if (green !== this.modeGreen) {
      this.modeGreen = green;
      const value = this.modeSel.value;
      this.modeSel.replaceChildren(...factionModes(d.year).map((m) => h('option', { value: m.value }, m.label)));
      this.modeSel.value = value;
    }
    if (state.speed !== this.lastSpeed) {
      this.lastSpeed = state.speed;
      this.markSpeed(state.speed);
    }
  }

  /** The open month's profit so far; a month with no ledger entry yet is a neutral $0. */
  private updateProfit(state: GameState): void {
    const open = openMonth(state.companies.player.ledger, state.date);
    const net = open ? monthProfit(open) : 0;
    const tone = profitTone(net);
    const text = deltaText(net);
    const key = `${tone}|${text}`;
    if (key === this.profitShown) return;
    this.profitShown = key;
    this.profit.className = `kit-pill kit-pill--${tone} hud-delta`;
    this.profit.textContent = text;
  }

  private drawCrest(name: string): void {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = this.crest.getContext('2d');
    } catch {
      ctx = null; // no canvas (tests): the name alone carries the brand
    }
    if (!ctx) return;
    ctx.clearRect(0, 0, this.crest.width, this.crest.height);
    drawFamilyCrest(ctx, this.crest.width, name);
  }
}
