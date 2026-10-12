import { h } from './dom';
import { iconEl } from './icon';
import { dockTabs } from './dock';

export interface WindowOptions {
  id: string;
  title: string;
  content: HTMLElement;
  onClose?: () => void;
  width?: number;
}

export interface GameWindow {
  el: HTMLElement;
  close(): void;
  setContent(el: HTMLElement): void;
  /** Hides the window and shows it as a tab in the dock. */
  dock(): void;
  /** Restores a docked window to a floating slot (may dock the least-recently-focused other window). */
  undock(): void;
  readonly docked: boolean;
}

export const MAX_FLOATING = 2;
export const COMPACT_WIDTH = 1366;
const COMPACT_MAX_W = 420;
const EDGE = 12;
const GAP = 8;
/** Horizontal space reserved at the right edge for the dock strip. */
const DOCK_GUTTER = 140;
const DEFAULT_W = 360;

interface Entry {
  win: GameWindow;
  stamp: number;
  slot: number;
  tab: HTMLElement | null;
  dock(): void;
}

const open = new Map<string, Entry>();
let zTop = 100;
let stampTop = 0;

/**
 * Pure placement. Window `index` 0 sits at the right edge, index 1 to its left. `top` is always
 * at least `hudBottom + 8`. In compact viewports the width is capped at 420 and the bottom edge
 * stays above `toolbarTop - 8` (callers apply the matching max-height).
 */
export function placeWindow(
  viewportW: number,
  _viewportH: number,
  hudBottom: number,
  toolbarTop: number,
  index: number,
  width: number,
  rightInset = EDGE,
): { left: number; top: number; maxHeight?: number } {
  const w = viewportW <= COMPACT_WIDTH ? Math.min(width, COMPACT_MAX_W) : width;
  const top = Math.max(hudBottom + 8, 0);
  const left = Math.max(0, viewportW - rightInset - w - index * (w + GAP));
  if (viewportW <= COMPACT_WIDTH) return { left, top, maxHeight: Math.max(120, toolbarTop - 8 - top) };
  return { left, top };
}

/** Measures the HUD bar bottom and the toolbar top from the DOM, with fallbacks (jsdom, collapsed toolbar). */
function measure(): { hudBottom: number; toolbarTop: number } {
  const hud = document.querySelector<HTMLElement>('.hud-bar')?.getBoundingClientRect();
  const tb = document.querySelector<HTMLElement>('.toolbar')?.getBoundingClientRect();
  const hudBottom = hud && hud.height > 0 ? hud.bottom : 64;
  const toolbarTop = tb && tb.height > 0 ? tb.top : window.innerHeight - 40;
  return { hudBottom, toolbarTop };
}

function floating(): Entry[] {
  return [...open.values()].filter((e) => !e.win.docked);
}

function enforceLimit(keep: Entry): void {
  for (;;) {
    const fl = floating();
    if (fl.length <= MAX_FLOATING) return;
    const victim = fl.filter((e) => e !== keep).sort((a, b) => a.stamp - b.stamp)[0];
    if (!victim) return;
    victim.dock();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Creates a draggable brass-framed window appended to document.body.
 * If a window with the same id is already open, that window is returned (and raised).
 */
export function createWindow(opts: WindowOptions): GameWindow {
  const existing = open.get(opts.id);
  if (existing) {
    existing.stamp = ++stampTop;
    if (existing.win.docked) existing.win.undock();
    existing.win.el.style.zIndex = String(++zTop);
    return existing.win;
  }

  const body = h('div', { class: 'window-body' }, opts.content);
  const closeBtn = h('button', {
    class: 'window-close',
    title: 'Close',
    'aria-label': 'Close',
    onClick: () => win.close(),
  }, iconEl('close', 14));
  const titleBar = h('div', { class: 'window-title' }, h('span', null, opts.title), closeBtn);
  const el = h('div', {
    class: 'window',
    style: { width: opts.width ? `${opts.width}px` : '', zIndex: String(++zTop) },
    onPointerDown: () => {
      el.style.zIndex = String(++zTop);
      entry.stamp = ++stampTop;
    },
  }, titleBar, body);

  let stopDrag: (() => void) | null = null;

  let closed = false;
  let docked = false;

  /** Places the window in the lowest free floating slot. */
  const place = () => {
    const used = new Set(floating().filter((e) => e !== entry).map((e) => e.slot));
    entry.slot = used.has(0) ? 1 : 0;
    const { hudBottom, toolbarTop } = measure();
    const vw = window.innerWidth;
    const w = opts.width ?? DEFAULT_W;
    const p = placeWindow(vw, window.innerHeight, hudBottom, toolbarTop, entry.slot, w, EDGE + DOCK_GUTTER);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    if (p.maxHeight !== undefined) {
      el.style.width = `${Math.min(w, COMPACT_MAX_W)}px`;
      el.style.maxHeight = `${p.maxHeight}px`;
    } else {
      el.style.maxHeight = '';
    }
  };

  const win: GameWindow = {
    el,
    get docked() {
      return docked;
    },
    dock() {
      if (docked || closed) return;
      docked = true;
      stopDrag?.();
      el.style.display = 'none';
      const tab = h('div', { class: 'dock-tab', role: 'tab', title: opts.title },
        h('span', { class: 'dock-tab-title' }, opts.title),
        h('button', {
          class: 'dock-tab-close',
          title: 'Close',
          'aria-label': `Close ${opts.title}`,
          onClick: (ev: Event) => {
            ev.stopPropagation();
            win.close();
          },
        }, iconEl('close', 12)));
      tab.addEventListener('click', () => {
        entry.stamp = ++stampTop;
        win.undock();
      });
      entry.tab = tab;
      dockTabs().appendChild(tab);
    },
    undock() {
      if (!docked || closed) return;
      docked = false;
      entry.tab?.remove();
      entry.tab = null;
      entry.stamp = ++stampTop;
      el.style.display = '';
      el.style.zIndex = String(++zTop);
      enforceLimit(entry);
      place();
    },
    close() {
      if (closed) return;
      closed = true;
      stopDrag?.();
      open.delete(opts.id);
      entry.tab?.remove();
      el.remove();
      opts.onClose?.();
    },
    setContent(content: HTMLElement) {
      body.replaceChildren(content);
    },
  };

  titleBar.addEventListener('pointerdown', (ev) => {
    if (ev.target === closeBtn) return;
    stopDrag?.();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const originLeft = parseFloat(el.style.left) || 0;
    const originTop = parseFloat(el.style.top) || 0;
    const onMove = (m: PointerEvent | MouseEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - titleBar.offsetHeight);
      el.style.left = `${clamp(originLeft + m.clientX - startX, 0, maxLeft)}px`;
      el.style.top = `${clamp(originTop + m.clientY - startY, 0, maxTop)}px`;
    };
    const onUp = () => stopDrag?.();
    stopDrag = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      stopDrag = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  const entry: Entry = { win, stamp: ++stampTop, slot: 0, tab: null, dock: () => win.dock() };
  open.set(opts.id, entry);
  enforceLimit(entry);
  place();
  document.body.appendChild(el);
  return win;
}

/** Closes every open window (used when the game is torn down). */
export function closeAllWindows(): void {
  for (const e of [...open.values()]) e.win.close();
}
