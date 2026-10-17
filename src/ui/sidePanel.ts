import { h } from './dom';
import { iconEl } from './icon';
import { loadSettings, saveSettings } from '../game/settings';
import './sidePanel.css';

/**
 * The one side panel: a fixed column on the right edge, between the HUD bar and the build bar,
 * holding every open window as a tab. Only the active tab's window is displayed; the others are
 * `display: none` and keep their content. window.ts's createWindow registers windows here.
 */

/** Most tabs at once; opening one more closes the least recently focused. */
export const MAX_TABS = 6;
export const MIN_PANEL_W = 320;
/** Upper width bound as a fraction of the viewport width. */
export const MAX_PANEL_FRAC = 0.6;
/** Automatic widening for a wide window stops at this fraction of the viewport, so the map keeps 60%. */
export const AUTO_WIDE_FRAC = 0.4;
/** Width of the collapsed rail. */
export const RAIL_W = 28;
/** Below the card modal (4000) and the menu modals (5000). */
const Z_BASE = 100;
const DEFAULT_WIDTH_CSS = 'min(420px, 34vw)';

export interface TabSpec {
  id: string;
  title: string;
  /** the window element (.window); the panel moves it into its body */
  el: HTMLElement;
  /** closes the window (the panel calls this to evict a tab or for the tab's close button) */
  close(): void;
  /**
   * The width the window asks for. Wider than the panel's default, it widens the panel to
   * min(width, AUTO_WIDE_FRAC × viewport) while its tab is active, unless the player dragged a width.
   */
  width?: number;
}

interface Tab {
  spec: TabSpec;
  tabEl: HTMLElement;
  stamp: number;
}

const tabs = new Map<string, Tab>();
let activeId: string | null = null;
let collapsed = false;
let stampTop = 0;

let root: HTMLElement | null = null;
let strip: HTMLElement;
let body: HTMLElement;
let rail: HTMLElement;
let railCount: HTMLElement;
let unlisten: (() => void) | null = null;

/** Clamps a panel width to [MIN_PANEL_W, MAX_PANEL_FRAC × viewport] (the upper bound wins on tiny screens). */
export function clampPanelWidth(w: number, viewportW: number): number {
  return Math.min(Math.max(w, MIN_PANEL_W), MAX_PANEL_FRAC * viewportW);
}

/** Measures the HUD bar bottom and the build bar top from the DOM, with fallbacks (jsdom, collapsed toolbar). */
function measure(): { hudBottom: number; toolbarTop: number } {
  const hud = document.querySelector<HTMLElement>('.hud-bar')?.getBoundingClientRect();
  const tb = document.querySelector<HTMLElement>('.toolbar')?.getBoundingClientRect();
  const hudBottom = hud && hud.height > 0 ? hud.bottom : 64;
  const toolbarTop = tb && tb.height > 0 ? tb.top : window.innerHeight - 40;
  return { hudBottom, toolbarTop };
}

function savedWidth(): number | null {
  return loadSettings().panelWidth;
}

/** The panel's width when expanded: the saved one (re-clamped to this viewport) or the default. */
function applyWidth(): void {
  if (!root) return;
  if (collapsed) {
    root.style.width = `${RAIL_W}px`;
    return;
  }
  const vw = window.innerWidth;
  const w = savedWidth();
  const asked = activeId !== null ? tabs.get(activeId)?.spec.width : undefined;
  if (w !== null) root.style.width = `${clampPanelWidth(w, vw)}px`;
  else if (asked !== undefined && asked > defaultWidthPx(vw)) {
    root.style.width = `${Math.max(defaultWidthPx(vw), Math.min(asked, AUTO_WIDE_FRAC * vw))}px`;
  }
  else root.style.width = DEFAULT_WIDTH_CSS;
}

/** DEFAULT_WIDTH_CSS in px for viewport width `vw`. */
function defaultWidthPx(vw: number): number {
  return Math.min(420, 0.34 * vw);
}

/**
 * Publishes the panel's on-screen width as --side-panel-w on <html> (0px when hidden), so the toast
 * stack (theme.css) moves left of it instead of sliding underneath.
 */
function publishWidth(): void {
  const w = root && !root.hidden ? root.style.width || '0px' : '0px';
  document.documentElement.style.setProperty('--side-panel-w', w);
}

let observer: ResizeObserver | null = null;

/** Places the panel between the HUD bar and the build bar, and follows those bars when they resize. */
function layout(): void {
  if (!root) return;
  const { hudBottom, toolbarTop } = measure();
  root.style.top = `${Math.max(0, hudBottom)}px`;
  root.style.bottom = `${Math.max(0, window.innerHeight - toolbarTop)}px`;
  applyWidth();
  publishWidth();
  if (!observer && typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(() => layout());
  for (const sel of ['.hud-bar', '.toolbar']) {
    const el = document.querySelector(sel);
    if (el) observer?.observe(el); // observing an element twice is a no-op
  }
}

function startResize(ev: MouseEvent): void {
  if (!root || collapsed) return;
  ev.preventDefault();
  const startX = ev.clientX;
  const rectW = root.getBoundingClientRect().width;
  const saved = savedWidth();
  const startW = rectW > 0 ? rectW : saved ?? (parseFloat(root.style.width) || defaultWidthPx(window.innerWidth));
  let w = startW;
  root.classList.add('resizing');
  const onMove = (m: MouseEvent) => {
    w = clampPanelWidth(startW + (startX - m.clientX), window.innerWidth);
    if (root) root.style.width = `${w}px`;
    publishWidth();
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    root?.classList.remove('resizing');
    const s = loadSettings();
    s.panelWidth = w;
    saveSettings(s);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

/** The panel element, created on first use (and again if the page body was cleared). */
export function sidePanelEl(): HTMLElement {
  if (root?.isConnected) return root;
  unlisten?.();
  // the page body was cleared (or this is the first use): drop every tab of the old panel
  tabs.clear();
  activeId = null;
  collapsed = false;
  strip = h('div', { class: 'side-panel-tabs', role: 'tablist', 'aria-label': 'Open windows' });
  const collapseBtn = h('button', {
    class: 'side-panel-collapse',
    title: 'Collapse panel',
    'aria-label': 'Collapse panel',
    onClick: () => collapsePanel(),
  }, iconEl('play', 12));
  body = h('div', { class: 'side-panel-body' });
  railCount = h('span', { class: 'side-panel-rail-count' });
  rail = h('button', {
    class: 'side-panel-rail',
    title: 'Expand panel',
    'aria-label': 'Expand panel',
    onClick: () => expandPanel(),
  }, railCount);
  const grip = h('div', { class: 'side-panel-grip', title: 'Drag to resize', 'aria-hidden': 'true', onPointerDown: startResize });
  root = h('aside', {
    class: 'side-panel',
    'aria-label': 'Side panel',
    style: { zIndex: String(Z_BASE) },
  }, grip, h('div', { class: 'side-panel-head' }, strip, collapseBtn), body, rail);
  root.hidden = true;
  document.body.appendChild(root);
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  unlisten = () => window.removeEventListener('resize', onResize);
  return root;
}

/** Shows the active tab's window, hides the rest and refreshes the strip, rail and visibility. */
function render(): void {
  const el = sidePanelEl();
  el.hidden = tabs.size === 0;
  el.classList.toggle('collapsed', collapsed);
  for (const [id, t] of tabs) {
    const on = id === activeId;
    t.spec.el.style.display = on ? '' : 'none';
    t.tabEl.setAttribute('aria-selected', String(on));
    t.tabEl.tabIndex = on ? 0 : -1;
    t.tabEl.classList.toggle('active', on);
  }
  const n = tabs.size;
  railCount.textContent = String(n);
  const label = `Expand panel (${n} ${n === 1 ? 'tab' : 'tabs'})`;
  rail.title = label;
  rail.setAttribute('aria-label', label);
  if (n > 0) layout();
  publishWidth();
}

/** Adds a window as a new tab and makes it active (closing the least recently focused tab past MAX_TABS). */
export function addTab(spec: TabSpec): void {
  sidePanelEl();
  const tabEl = h('div', {
    class: 'side-panel-tab',
    role: 'tab',
    title: spec.title,
    onClick: () => focusTab(spec.id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusTab(spec.id);
      }
    },
  },
  h('span', { class: 'side-panel-tab-title' }, spec.title),
  h('button', {
    class: 'side-panel-tab-close',
    title: `Close ${spec.title}`,
    'aria-label': `Close ${spec.title}`,
    onClick: (ev: Event) => {
      ev.stopPropagation();
      spec.close();
    },
  }, iconEl('close', 12)));
  tabs.set(spec.id, { spec, tabEl, stamp: ++stampTop });
  strip.appendChild(tabEl);
  body.appendChild(spec.el);
  activeId = spec.id;
  collapsed = false;
  while (tabs.size > MAX_TABS) {
    const victim = [...tabs.values()].filter((t) => t.spec.id !== spec.id).sort((a, b) => a.stamp - b.stamp)[0];
    if (!victim) break;
    victim.spec.close();
    // a close() that does not call removeTab would loop forever
    if (tabs.has(victim.spec.id)) removeTab(victim.spec.id);
  }
  render();
}

/** Makes a tab active and expands the panel. */
export function focusTab(id: string): void {
  const t = tabs.get(id);
  if (!t) return;
  t.stamp = ++stampTop;
  activeId = id;
  collapsed = false;
  render();
  // the strip is one scrolling row: bring the focused tab into view (jsdom has no scrollIntoView)
  t.tabEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Removes a tab and its window element; the most recently focused remaining tab becomes active. */
export function removeTab(id: string): void {
  const t = tabs.get(id);
  if (!t) return;
  tabs.delete(id);
  t.tabEl.remove();
  t.spec.el.remove();
  if (activeId === id) {
    const next = [...tabs.values()].sort((a, b) => b.stamp - a.stamp)[0];
    activeId = next ? next.spec.id : null;
  }
  if (tabs.size === 0) collapsed = false;
  render();
}

/** Collapses the panel to its rail (the tabs stay open). */
export function collapsePanel(): void {
  if (tabs.size === 0) return;
  collapsed = true;
  render();
}

/** Expands a collapsed panel. */
export function expandPanel(): void {
  collapsed = false;
  render();
}

/** True when this tab's window is the one on screen (active, panel expanded). */
export function isTabShown(id: string): boolean {
  return tabs.has(id) && activeId === id && !collapsed;
}

/** Closes the active tab (Esc). Returns false when none is on screen (no tabs, or the panel is collapsed). */
export function closeActiveTab(): boolean {
  const t = activeId !== null && !collapsed ? tabs.get(activeId) : undefined;
  if (!t) return false;
  t.spec.close();
  if (tabs.has(t.spec.id)) removeTab(t.spec.id);
  return true;
}
