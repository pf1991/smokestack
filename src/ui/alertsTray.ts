/**
 * The top-bar alerts bell and its tray (Anno-style notifications). The bell shows how many alerts
 * the game's AlertTracker found, its badge coloured by the worst tone; the tray lists them and a
 * click jumps the camera to the problem and opens its panel. Alerts are re-collected before a jump,
 * so one pointing at a demolished building or a sold vehicle is dropped with a toast instead.
 */
import type { EventBus } from '../core/events';
import { dateToDays } from '../sim/clock';
import type { GameState, Vec2 } from '../sim/types';
import type { Alert, AlertTone } from '../game/alerts';
import { h } from './dom';
import { iconEl } from './icon';
import { emptyState } from './kit';
import { barTip } from './hud';
import { currentUiScale } from './scale';
import { withShortcut } from './shortcuts';
import './alertsTray.css';

/** What the tray needs from the game (GameController provides it). */
export interface AlertsHost {
  readonly ctx: { state: GameState; bus: EventBus };
  readonly uiRoot: HTMLElement;
  /** the alerts found by the last refresh */
  readonly alerts: readonly Alert[];
  /** re-collects the alerts now (and notifies onAlerts listeners) */
  refreshAlerts(): readonly Alert[];
  onAlerts(fn: (alerts: readonly Alert[]) => void): () => void;
  centerOn(tile: Vec2): void;
  openPanel(id: string, arg?: unknown): void;
}

/** CSS px (in the zoomed UI's units) */
const TRAY_W = 360;
const TRAY_MAX_H = 420;
const GAP = 4;
const MARGIN = 8;
const TONE_RANK: Record<AlertTone, number> = { negative: 0, warning: 1, info: 2 };

/** "today", "1 day", "3 days" */
export function alertAge(days: number): string {
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

function worstTone(alerts: readonly Alert[]): AlertTone | null {
  let worst: AlertTone | null = null;
  for (const a of alerts) if (!worst || TONE_RANK[a.tone] < TONE_RANK[worst]) worst = a.tone;
  return worst;
}

/** Where the target is now, or null when it no longer exists. Panel targets have no place. */
function targetPos(state: GameState, a: Alert): Vec2 | null | undefined {
  const t = a.target;
  if (t.kind === 'building') return state.buildings[t.id]?.pos ?? null;
  if (t.kind === 'vehicle') return state.vehicles[t.id]?.pos ?? null;
  return undefined;
}

/** Mounts the bell into `slot`; the returned function removes it and its tray. */
export function mountAlerts(slot: HTMLElement, game: AlertsHost): () => void {
  const badge = h('span', { class: 'alerts-badge', 'aria-hidden': 'true' });
  badge.hidden = true;
  const bell = h('button', {
    class: 'hud-btn alerts-bell',
    type: 'button',
    title: withShortcut('Alerts', 'alerts'),
    'aria-label': 'Alerts (0)',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
  }, iconEl('bell', 18), badge) as HTMLButtonElement;
  slot.appendChild(bell);
  const offTip = barTip(bell);

  let tray: HTMLElement | null = null;
  let list: readonly Alert[] = game.alerts;

  const paintBell = () => {
    const n = list.length;
    bell.setAttribute('aria-label', `Alerts (${n})`);
    badge.hidden = n === 0;
    badge.textContent = n === 0 ? '' : n > 99 ? '99+' : String(n);
    const tone = worstTone(list);
    if (tone) badge.dataset.tone = tone;
    else delete badge.dataset.tone;
  };

  const row = (a: Alert, today: number): HTMLElement =>
    h('button', { class: 'alerts-row', type: 'button', 'data-alert': a.id, 'data-tone': a.tone, role: 'menuitem', onClick: () => choose(a) },
      h('span', { class: 'alerts-row-icon' }, iconEl(a.icon, 18)),
      h('span', { class: 'alerts-row-text' },
        h('span', { class: 'alerts-row-title', title: a.title }, a.title),
        h('span', { class: 'alerts-row-detail' }, a.detail)),
      h('span', { class: 'alerts-row-age' }, alertAge(today - a.since)));

  const paintTray = () => {
    if (!tray) return;
    const today = dateToDays(game.ctx.state.date);
    const body = list.length === 0
      ? emptyState({ icon: 'bell', title: 'All quiet', body: 'Nothing needs your attention. Works, fleet and books are in order.' })
      : h('div', { class: 'alerts-list', role: 'menu', 'aria-label': 'Alerts' }, list.map((a) => row(a, today)));
    tray.replaceChildren(
      h('div', { class: 'alerts-head' },
        h('span', { class: 'alerts-head-title' }, 'Alerts'),
        h('span', { class: 'alerts-head-count' }, list.length === 0 ? '' : String(list.length))),
      body);
  };

  /** Fixed under the bell, right-aligned to it, clamped inside the viewport at any UI scale. */
  const place = () => {
    if (!tray) return;
    const s = currentUiScale();
    const r = bell.getBoundingClientRect();
    const vw = window.innerWidth / s;
    const vh = window.innerHeight / s;
    const w = Math.max(0, Math.min(TRAY_W, vw - 2 * MARGIN));
    const left = Math.max(MARGIN, Math.min(r.right / s - w, vw - w - MARGIN));
    const top = r.bottom / s + GAP;
    tray.style.width = `${w}px`;
    tray.style.left = `${left}px`;
    tray.style.top = `${top}px`;
    tray.style.maxHeight = `${Math.max(120, Math.min(TRAY_MAX_H, vh - top - MARGIN))}px`;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
    bell.focus();
  };
  const onDown = (e: Event) => {
    const t = e.target as Node | null;
    if (t && (tray?.contains(t) || bell.contains(t))) return;
    close();
  };

  const open = () => {
    if (tray) return;
    tray = h('div', { class: 'alerts-tray', role: 'dialog', 'aria-label': 'Alerts' });
    game.uiRoot.appendChild(tray);
    bell.setAttribute('aria-expanded', 'true');
    bell.classList.add('active');
    paintTray();
    place();
    // capture, so Esc closes the tray before the game's keys (pause menu) see it
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('uiscalechange', place);
  };
  function close(): void {
    if (!tray) return;
    tray.remove();
    tray = null;
    bell.setAttribute('aria-expanded', 'false');
    bell.classList.remove('active');
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('uiscalechange', place);
  }

  function choose(a: Alert): void {
    game.refreshAlerts();
    const state = game.ctx.state;
    const pos = targetPos(state, a);
    if (pos === null) {
      // demolished or sold since the tray was drawn: the refresh dropped it
      list = list.filter((x) => x.id !== a.id);
      paintBell();
      paintTray();
      game.ctx.bus.emit({ type: 'toast', message: 'That is no longer there', tone: 'info' });
      return;
    }
    close();
    const t = a.target;
    if (t.kind === 'panel') game.openPanel(t.panel);
    else {
      game.centerOn({ x: pos!.x, y: pos!.y });
      game.openPanel(t.kind, t.id);
    }
  }

  bell.addEventListener('click', () => (tray ? close() : open()));
  const offAlerts = game.onAlerts((a) => {
    list = a;
    paintBell();
    paintTray();
  });
  paintBell();

  return () => {
    close();
    offAlerts();
    offTip();
    bell.remove();
  };
}
