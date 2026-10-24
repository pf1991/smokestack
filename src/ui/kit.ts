import { type Child, h } from './dom';
import { formatMoney } from './format';
import { iconEl } from './icon';
import type { IconId } from '../render/icons';

/** Shared component kit: the vocabulary every panel, bar and tray is built from. */
export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info';

export function button(
  label: string,
  opts: {
    variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
    icon?: IconId;
    shortcut?: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  } = {},
): HTMLElement {
  const variant = opts.variant ?? 'secondary';
  const title = opts.shortcut ? `${opts.title ?? label} (${opts.shortcut})` : opts.title;
  return h(
    'button',
    {
      class: `btn kit-btn kit-btn--${variant}`,
      type: 'button',
      disabled: opts.disabled,
      title,
      onClick: opts.onClick,
    },
    opts.icon ? iconEl(opts.icon, 16) : null,
    h('span', { class: 'kit-btn-label' }, label),
    opts.shortcut ? h('kbd', { class: 'kit-kbd' }, opts.shortcut) : null,
  );
}

export function panelHeader(o: { title: string; summary?: string; tone?: Tone; icon?: IconId }): HTMLElement {
  return h(
    'div',
    { class: 'kit-ph' },
    o.icon ? iconEl(o.icon, 20) : null,
    h('h2', { class: 'kit-ph-title' }, o.title),
    o.summary
      ? h('span', { class: 'kit-ph-summary', 'data-tone': o.tone ?? 'neutral', title: o.summary }, o.summary)
      : null,
  );
}

export function statTile(o: { label: string; value: string; delta?: string; tone?: Tone; title?: string }): HTMLElement {
  return h(
    'div',
    { class: 'kit-stat', title: o.title },
    h('div', { class: 'kit-stat-label' }, o.label),
    h('div', { class: 'kit-stat-value' }, o.value),
    o.delta ? h('div', { class: 'kit-stat-delta', 'data-tone': o.tone ?? 'neutral' }, o.delta) : null,
  );
}

export function statRow(tiles: HTMLElement[]): HTMLElement {
  return h('div', { class: 'kit-stat-row' }, tiles);
}

export function pill(text: string, tone: Tone = 'neutral', icon?: IconId): HTMLElement {
  return h('span', { class: `kit-pill kit-pill--${tone}` }, icon ? iconEl(icon, 12) : null, text);
}

export function meter(value: number, max: number, o: { tone?: Tone; label?: string } = {}): HTMLElement {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  const v = Number.isFinite(value) ? Math.min(Math.max(value, 0), top) : 0;
  const pct = top > 0 ? (v / top) * 100 : 0;
  const fill = h('div', { class: 'kit-meter-fill' });
  fill.style.width = `${pct}%`;
  return h(
    'div',
    {
      class: 'kit-meter',
      role: 'meter',
      'data-tone': o.tone ?? 'neutral',
      'aria-valuemin': '0',
      'aria-valuenow': String(v),
      'aria-valuemax': String(top),
      'aria-label': o.label,
      title: o.label,
    },
    fill,
  );
}

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: T) => Child;
  title?: (row: T) => string;
}

export function dataTable<T>(o: {
  columns: Column<T>[];
  rows: T[];
  emptyText: string;
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
}): HTMLElement {
  const align = (c: Column<T>) => c.align ?? 'left';
  const head = h(
    'tr',
    null,
    o.columns.map((c) => h('th', { 'data-align': align(c), 'data-col': c.key, scope: 'col' }, c.label)),
  );
  const body =
    o.rows.length === 0
      ? [
          h(
            'tr',
            { class: 'kit-empty-row' },
            h('td', { colspan: String(o.columns.length), class: 'kit-empty-row' }, o.emptyText),
          ),
        ]
      : o.rows.map((row) => {
          const clickable = !!o.onRowClick;
          return h(
            'tr',
            {
              'data-key': o.rowKey?.(row),
              class: clickable ? 'kit-row-click' : undefined,
              tabindex: clickable ? '0' : undefined,
              onClick: clickable ? () => o.onRowClick!(row) : undefined,
              onKeydown: clickable
                ? (e: Event) => {
                    const k = (e as KeyboardEvent).key;
                    if (k === 'Enter' || k === ' ') {
                      e.preventDefault();
                      o.onRowClick!(row);
                    }
                  }
                : undefined,
            },
            o.columns.map((c) =>
              h('td', { 'data-align': align(c), 'data-col': c.key, title: c.title?.(row) }, c.render(row)),
            ),
          );
        });
  return h('table', { class: 'kit-table' }, h('thead', null, head), h('tbody', null, body));
}

export function emptyState(o: { icon?: IconId; title: string; body?: string; action?: HTMLElement }): HTMLElement {
  return h(
    'div',
    { class: 'kit-empty' },
    o.icon ? iconEl(o.icon, 32) : null,
    h('div', { class: 'kit-empty-title' }, o.title),
    o.body ? h('p', { class: 'kit-empty-body' }, o.body) : null,
    o.action ?? null,
  );
}

export function card(o: { title?: string; children: Child[]; actions?: HTMLElement[]; tone?: Tone }): HTMLElement {
  return h(
    'div',
    { class: 'kit-card', 'data-tone': o.tone ?? 'neutral' },
    o.title || o.actions?.length
      ? h('div', { class: 'kit-card-head' }, h('h4', { class: 'kit-card-title' }, o.title ?? ''), o.actions ?? null)
      : null,
    h('div', { class: 'kit-card-body' }, o.children),
  );
}

export function section(
  title: string,
  children: Child[],
  o: { collapsible?: boolean; open?: boolean; id?: string } = {},
): HTMLElement {
  if (o.collapsible) {
    const d = h(
      'details',
      { class: 'p-section kit-section kit-section--collapsible', id: o.id },
      h('summary', { class: 'p-head' }, title),
      children,
    ) as HTMLDetailsElement;
    d.open = o.open !== false;
    return d;
  }
  return h('section', { class: 'p-section kit-section', id: o.id }, h('h3', { class: 'p-head' }, title), children);
}

const TIP_DELAY_MS = 250;
let tipEl: HTMLElement | null = null;

function sharedTip(): HTMLElement {
  if (!tipEl || !tipEl.isConnected) {
    tipEl = h('div', { class: 'kit-tip', role: 'tooltip' });
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

export function tooltip(target: HTMLElement, content: () => HTMLElement | string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;

  const hide = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!shown) return;
    shown = false;
    document.removeEventListener('keydown', onKey);
    tipEl?.classList.remove('kit-tip--on');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
  };
  const show = () => {
    const tip = sharedTip();
    const c = content();
    tip.replaceChildren(typeof c === 'string' ? document.createTextNode(c) : c);
    tip.classList.add('kit-tip--on');
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = r.bottom + 6 + t.height <= vh;
    const top = below ? r.bottom + 6 : Math.max(0, r.top - 6 - t.height);
    const left = Math.min(Math.max(0, r.left), Math.max(0, vw - t.width));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    shown = true;
    document.addEventListener('keydown', onKey);
  };
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(show, TIP_DELAY_MS);
  };

  target.addEventListener('pointerenter', arm);
  target.addEventListener('focus', arm);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('blur', hide);
  return () => {
    hide();
    target.removeEventListener('pointerenter', arm);
    target.removeEventListener('focus', arm);
    target.removeEventListener('pointerleave', hide);
    target.removeEventListener('blur', hide);
  };
}

/** "▲ $4,077" for a gain, "▼ $12,000" for a loss, "$0" for zero. */
export function deltaText(v: number): string {
  if (!(Math.abs(v) >= 0.5)) return formatMoney(0);
  return `${v > 0 ? '▲' : '▼'} ${formatMoney(Math.abs(v))}`;
}
