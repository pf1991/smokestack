/**
 * Progressive disclosure for dense side panels (E5): a "Now" summary, optional first-visit
 * coach mark (`smokestack:coach:<panel>`), and a "Show full …" control that reveals tables.
 */
import { button, card, type Tone } from './kit';
import { h, type Child } from './dom';
import './disclosure.css';

export const coachStorageKey = (panel: string): string => `smokestack:coach:${panel}`;

/** True once the player has dismissed this panel's coach (or storage is unreadable). */
export function coachSeen(panel: string): boolean {
  try {
    return localStorage.getItem(coachStorageKey(panel)) === 'seen';
  } catch {
    return true;
  }
}

export function markCoachSeen(panel: string): void {
  try {
    localStorage.setItem(coachStorageKey(panel), 'seen');
  } catch {
    // private mode or full storage: the mark may show again next time
  }
}

export interface NowItem {
  label: string;
  detail?: string;
  tone?: Tone;
}

/** A kit card titled "Now" listing 1–3 decision lines (or a quiet empty line). */
export function nowCard(items: NowItem[], empty = 'Nothing urgent right now.'): HTMLElement {
  const body: Child[] =
    items.length === 0
      ? [h('p', { class: 'disc-empty' }, empty)]
      : [
          h(
            'ul',
            { class: 'disc-now-list' },
            items.map((it) =>
              h(
                'li',
                { class: 'disc-now-item', 'data-tone': it.tone ?? 'neutral' },
                h('span', { class: 'disc-now-label' }, it.label),
                it.detail ? h('span', { class: 'disc-now-detail' }, it.detail) : null,
              ),
            ),
          ),
        ];
  const el = card({ title: 'Now', children: body, tone: items.some((i) => i.tone === 'warning' || i.tone === 'negative') ? 'warning' : 'info' });
  el.classList.add('disc-now');
  el.dataset.disc = 'now';
  return el;
}

export interface DisclosureOpts {
  /** localStorage coach key suffix, e.g. `politics` */
  panelId: string;
  /** Button label when collapsed, e.g. `Show full Politics` */
  expandLabel: string;
  /** Button label when expanded (default: `Hide full …`) */
  collapseLabel?: string;
  /** One-line tip shown once per browser until dismissed */
  coachText: string;
  /** Summary card (typically from `nowCard`) */
  now: HTMLElement;
  /** Dense tables / ledger kept for expand */
  full: HTMLElement;
}

export interface DisclosureView {
  el: HTMLElement;
  /** Replace the Now card contents in place (keeps expand state). */
  setNow(now: HTMLElement): void;
  expanded(): boolean;
  expand(): void;
  collapse(): void;
}

/**
 * Builds summary-first chrome: Now card, optional coach, toggle, and a hidden full block.
 * Expanding or dismissing the coach marks the coach as seen.
 */
export function progressiveDisclosure(opts: DisclosureOpts): DisclosureView {
  const collapseLabel = opts.collapseLabel ?? opts.expandLabel.replace(/^Show /, 'Hide ');
  let expanded = false;
  const nowWrap = h('div', { class: 'disc-now-wrap', 'data-disc': 'now-wrap' }, opts.now);
  const full = opts.full;
  full.classList.add('disc-full');
  full.dataset.disc = 'full';
  full.hidden = true;

  const toggle = button(opts.expandLabel, {
    variant: 'secondary',
    onClick: () => {
      if (expanded) view.collapse();
      else view.expand();
    },
  });
  toggle.classList.add('disc-toggle');
  toggle.dataset.disc = 'toggle';
  toggle.setAttribute('aria-expanded', 'false');

  let coachEl: HTMLElement | null = null;
  const dismissCoach = (): void => {
    markCoachSeen(opts.panelId);
    coachEl?.remove();
    coachEl = null;
  };

  if (!coachSeen(opts.panelId)) {
    coachEl = h(
      'div',
      { class: 'disc-coach', role: 'status', 'data-disc': 'coach' },
      h('p', { class: 'disc-coach-text' }, opts.coachText),
      button('Got it', { variant: 'quiet', onClick: dismissCoach }),
    );
  }

  const el = h(
    'div',
    { class: 'disc', 'data-panel': opts.panelId, 'data-disc': 'root' },
    nowWrap,
    coachEl,
    toggle,
    full,
  );

  const syncToggle = (): void => {
    const label = toggle.querySelector('.kit-btn-label');
    if (label) label.textContent = expanded ? collapseLabel : opts.expandLabel;
    toggle.setAttribute('aria-expanded', String(expanded));
  };

  const view: DisclosureView = {
    el,
    setNow(now: HTMLElement): void {
      nowWrap.replaceChildren(now);
    },
    expanded: () => expanded,
    expand(): void {
      expanded = true;
      full.hidden = false;
      syncToggle();
      dismissCoach();
    },
    collapse(): void {
      expanded = false;
      full.hidden = true;
      syncToggle();
    },
  };
  return view;
}
