import type { Selection } from '../../render/world';
import { isThirdOwner, ownerColor } from '../../render/ownerColors';
import type { GameState, OwnerId, SimContext } from '../../sim/types';
import { type Child, h } from '../dom';
import { iconEl } from '../icon';
import { card, type Tone } from '../kit';
import type { IconId } from '../../render/icons';
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

/**
 * An owner badge: the owning company's name, `owner-player` / `owner-rival` for the player and the
 * Baron, `owner-regional` plus the firm's own colour (render/ownerColors.ts) for a regional firm.
 */
export function setOwnerBadge(el: HTMLElement, state: GameState, ownerId: OwnerId): void {
  setText(el, state.companies[ownerId]?.name ?? ownerId);
  setClass(el, `insp-badge ${ownerId === 'player' ? 'owner-player' : ownerId === 'rival' ? 'owner-rival' : 'owner-regional'}`);
  const color = isThirdOwner(ownerId) ? ownerColor(ownerId) : '';
  if (el.dataset.ownerColor !== color) {
    el.dataset.ownerColor = color;
    el.style.background = color;
  }
}

/** What each box last showed, so a refresh rebuilds a kit block only when its content changed (see finance.ts). */
const shownKey = new WeakMap<HTMLElement, string>();

/** Replaces `box`'s children with `build()` when `key` differs from the last one shown. */
export function swap(box: HTMLElement, key: string, build: () => HTMLElement): void {
  if (shownKey.get(box) === key) return;
  shownKey.set(box, key);
  box.replaceChildren(build());
}

/** Updates a kit `meter` in place (value clamped to 0..max), touching only what changed. */
export function setMeter(el: HTMLElement, value: number, max: number, tone: Tone = 'neutral', label?: string): void {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  const v = Number.isFinite(value) ? Math.min(Math.max(value, 0), top) : 0;
  const attrs: [string, string][] = [['aria-valuenow', String(v)], ['aria-valuemax', String(top)]];
  if (label !== undefined) attrs.push(['aria-label', label], ['title', label]);
  for (const [k, x] of attrs) if (el.getAttribute(k) !== x) el.setAttribute(k, x);
  if (el.dataset.tone !== tone) el.dataset.tone = tone;
  const fill = el.firstElementChild as HTMLElement | null;
  const w = `${top > 0 ? Number(((v / top) * 100).toFixed(1)) : 0}%`;
  if (fill && fill.style.width !== w) fill.style.width = w;
}

/**
 * A kit card for an inspector section: the title doubles as the section overline (`.p-head`, which
 * tests and the tutorial look for), `cls` names the card.
 */
export function inspCard(title: string, cls: string, children: Child[], icon?: IconId): HTMLElement {
  const c = card({ title, children });
  c.classList.add(...cls.split(' ').filter(Boolean));
  const t = c.querySelector<HTMLElement>('.kit-card-title')!;
  t.classList.add('p-head');
  if (icon) t.prepend(iconEl(icon, 14), ' ');
  return c;
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
