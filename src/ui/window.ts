import { h } from './dom';
import { iconEl } from './icon';
import { addTab, collapsePanel, focusTab, isTabShown, removeTab } from './sidePanel';

export interface WindowOptions {
  id: string;
  title: string;
  /** Short label for the side-panel tab (the top-bar menu label); the tooltip and aria-label keep `title`. */
  tabTitle?: string;
  content: HTMLElement;
  onClose?: () => void;
  /** Windows fill the side panel; a width wider than its default widens the panel while this tab is active. */
  width?: number;
}

export interface GameWindow {
  el: HTMLElement;
  close(): void;
  setContent(el: HTMLElement): void;
  /** Collapses the side panel to its rail. */
  dock(): void;
  /** Focuses this window's tab and expands the side panel. */
  undock(): void;
  /** True when this window is not the visible active tab. */
  readonly docked: boolean;
}

/** Viewports this wide or narrower get compact panel layouts (fleet.ts). */
export const COMPACT_WIDTH = 1366;

const open = new Map<string, GameWindow>();

/**
 * Opens a brass-framed window as a tab in the side panel (ui/sidePanel.ts) and makes it active.
 * If a window with the same id is already open, that window is returned and its tab focused.
 */
export function createWindow(opts: WindowOptions): GameWindow {
  let existing = open.get(opts.id);
  if (existing && !existing.el.isConnected) {
    // the page body was cleared under it: retire it (its onClose disposes the panel) and build anew
    existing.close();
    existing = undefined;
  }
  if (existing) {
    focusTab(opts.id);
    return existing;
  }

  const body = h('div', { class: 'window-body' }, opts.content);
  const closeBtn = h('button', {
    class: 'window-close',
    title: 'Close',
    'aria-label': `Close ${opts.title}`,
    onClick: () => win.close(),
  }, iconEl('close', 14));
  const titleBar = h('div', { class: 'window-title' }, h('span', null, opts.title), closeBtn);
  const el = h('div', { class: 'window', role: 'tabpanel', 'aria-label': opts.title }, titleBar, body);

  let closed = false;
  const win: GameWindow = {
    el,
    get docked() {
      return !isTabShown(opts.id);
    },
    dock() {
      if (!closed) collapsePanel();
    },
    undock() {
      if (!closed) focusTab(opts.id);
    },
    close() {
      if (closed) return;
      closed = true;
      open.delete(opts.id);
      removeTab(opts.id);
      opts.onClose?.();
    },
    setContent(content: HTMLElement) {
      body.replaceChildren(content);
    },
  };

  open.set(opts.id, win);
  addTab({ id: opts.id, title: opts.title, tabTitle: opts.tabTitle, el, close: () => win.close(), width: opts.width });
  return win;
}

/** Closes every open window (used when the game is torn down). */
export function closeAllWindows(): void {
  for (const w of [...open.values()]) w.close();
}
