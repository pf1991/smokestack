import type { Selection } from '../../render/world';
import type { SimContext } from '../../sim/types';
import { h } from '../dom';
import { createWindow } from '../window';

/** The slice of the GameController the inspectors need (lets tests use a small stub). */
export interface InspectorHost {
  ctx: SimContext;
  renderer: { setSelection(s: Selection | null): void };
}

export const REFRESH_MS = 500;

export interface InspectorView {
  el: HTMLElement;
  /** Refreshes the DOM from game state; returns false when the entity no longer exists. */
  update(): boolean;
  /** Releases timers etc. owned by the view. */
  dispose?(): void;
}

const active = new Set<string>();

/**
 * Opens (or raises) a per-entity window that refreshes at 2 Hz and closes itself when `update()`
 * reports the entity gone.
 */
export function openInspector(
  host: InspectorHost,
  opts: { id: string; title: string; width: number; selection?: Selection; build(): InspectorView },
): void {
  if (active.has(opts.id)) {
    createWindow({ id: opts.id, title: opts.title, content: h('div'), width: opts.width }); // raises it
    return;
  }
  const view = opts.build();
  if (!view.update()) return;
  active.add(opts.id);
  let timer = 0;
  const win = createWindow({
    id: opts.id,
    title: opts.title,
    content: view.el,
    width: opts.width,
    onClose: () => {
      clearInterval(timer);
      view.dispose?.();
      active.delete(opts.id);
      if (opts.selection) host.renderer.setSelection(null);
    },
  });
  if (opts.selection) host.renderer.setSelection(opts.selection);
  timer = window.setInterval(() => {
    if (!view.update()) win.close();
  }, REFRESH_MS);
}

/** Sets text only when it changed. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el: HTMLElement, cls: string): void {
  if (el.className !== cls) el.className = cls;
}

export interface Bar {
  el: HTMLElement;
  set(fraction: number, label: string): void;
}

/** A labelled fill bar. */
export function bar(color: string, extraClass = ''): Bar {
  const fill = h('div', { class: 'insp-bar-fill', style: { background: color, width: '0%' } });
  const label = h('span', { class: 'insp-bar-label' });
  const el = h('div', { class: `insp-bar ${extraClass}`.trim() }, fill, label);
  return {
    el,
    set(fraction, text) {
      const w = `${Math.round(Math.min(1, Math.max(0, fraction || 0)) * 100)}%`;
      if (fill.style.width !== w) fill.style.width = w;
      setText(label, text);
    },
  };
}

/** Keeps `container` showing `keys` in order, rebuilding its children only when the key list changes. */
export class KeyedList<T extends { el: HTMLElement }> {
  private sig = '\0';
  items = new Map<string, T>();
  constructor(
    private readonly container: HTMLElement,
    private readonly make: (key: string) => T,
  ) {}

  sync(keys: string[]): void {
    const sig = keys.join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const next = new Map<string, T>();
    for (const k of keys) next.set(k, this.items.get(k) ?? this.make(k));
    this.items = next;
    this.container.replaceChildren(...keys.map((k) => next.get(k)!.el));
  }
}

// Dev-only visual-check hook: `?inspect=building,city,vehicle` opens those inspectors on load.
if (import.meta.env?.DEV && typeof location !== 'undefined') {
  const want = new URLSearchParams(location.search).get('inspect');
  if (want) {
    const poll = window.setInterval(() => {
      const g = (window as unknown as { game?: { ctx?: SimContext; openPanel(id: string, arg?: unknown): void } }).game;
      if (!g?.ctx) return;
      clearInterval(poll);
      const s = g.ctx.state;
      for (const kind of want.split(',')) {
        if (kind === 'building') {
          const b = Object.values(s.buildings).find((x) => x.ownerId === 'player' && x.typeId === 'furniture_factory') ?? Object.values(s.buildings)[0];
          if (b) g.openPanel('building', b.id);
        } else if (kind === 'city') {
          g.openPanel('city', 0);
        } else if (kind === 'vehicle') {
          const v = Object.values(s.vehicles)[0];
          if (v) g.openPanel('vehicle', v.id);
        }
      }
      for (const [i, w] of [...document.querySelectorAll<HTMLElement>('.window')].entries()) {
        w.style.left = `${40 + i * 360}px`;
        w.style.top = '90px';
      }
    }, 100);
  }
}
