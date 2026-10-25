/**
 * Post-tutorial "Next ambitions" brass card: three soft bullets after Free Play tutorial ends
 * (or is skipped). Shown once per browser via localStorage, same pattern as the tutorial.
 */
import { h } from './dom';
import { iconEl } from './icon';
import './tutorial.css';

export const AMBITIONS_CARD_KEY = 'smokestack:ambitions-card';
const HIGHLIGHT = 'tut-highlight';

export interface AmbitionBullet {
  text: string;
  /** CSS selector(s) of HUD/toolbar elements to glow while the card is up */
  highlight: string;
}

/** The three soft next steps after the furniture tutorial. */
export const AMBITION_BULLETS: AmbitionBullet[] = [
  {
    text: 'Open Contracts and take a mayor’s job.',
    highlight: '.hud-group-btn[data-group="operations"], .hud-menu-item[data-panel="contracts"]',
  },
  {
    text: 'From Retail, Trade & Logistics, place a Trading House.',
    highlight: '.tb-tab[data-tab="retail"], .tool-card[data-building="trading_house"]',
  },
  {
    text: 'Open the Codex and look up Wire (Components).',
    highlight: '.hud-group-btn[data-group="world"], .hud-menu-item[data-panel="codex"]',
  },
];

/** True once the player has dismissed the ambitions card (or storage is unreadable). */
export function ambitionsCardStatus(): 'seen' | null {
  try {
    return localStorage.getItem(AMBITIONS_CARD_KEY) === 'seen' ? 'seen' : null;
  } catch {
    return null;
  }
}

function remember(): void {
  try {
    localStorage.setItem(AMBITIONS_CARD_KEY, 'seen');
  } catch {
    // private mode or full storage: the card may show again next time
  }
}

/**
 * Offer the card when Free Play, never dismissed, and the tutorial is already done/skipped
 * (or just finished this session — caller mounts after tutorial ends).
 */
export function shouldOfferAmbitionsCard(
  scenarioId: string | undefined,
  tutorialDone: boolean,
): boolean {
  return scenarioId === 'sandbox' && ambitionsCardStatus() === null && tutorialDone;
}

export class AmbitionsCard {
  private card: HTMLElement | null = null;
  private highlighted: Element[] = [];

  constructor(private readonly root: HTMLElement) {
    this.render();
    this.refreshHighlight();
  }

  get active(): boolean {
    return this.card !== null;
  }

  private dismiss(): void {
    remember();
    this.destroy();
  }

  private render(): void {
    const bullets = AMBITION_BULLETS.map((b) => h('li', null, b.text));
    this.show(
      h('div', { class: 'tut-step' }, 'Next ambitions'),
      h('p', { class: 'tut-text' }, 'The furniture chain is humming. Chase these when you are ready:'),
      h('ul', { class: 'tut-text amb-list' }, ...bullets),
      h(
        'div',
        { class: 'tut-actions' },
        h('button', { class: 'btn', 'data-act': 'got-it', onClick: () => this.dismiss() }, 'Got it'),
        h('button', { class: 'btn', 'data-act': 'next', onClick: () => this.dismiss() }, 'Next ›'),
      ),
    );
  }

  private refreshHighlight(): void {
    this.clearHighlight();
    const sel = AMBITION_BULLETS.map((b) => b.highlight).join(', ');
    this.highlighted = [...this.root.querySelectorAll(sel)];
    for (const el of this.highlighted) el.classList.add(HIGHLIGHT);
  }

  private show(...children: HTMLElement[]): void {
    const card = h(
      'aside',
      { class: 'tut-card brass-card amb-card', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'tut-gear', 'aria-hidden': 'true' }, iconEl('star', 26)),
      h('div', { class: 'tut-body' }, ...children),
    );
    if (this.card) this.card.replaceWith(card);
    else this.root.appendChild(card);
    this.card = card;
  }

  private clearHighlight(): void {
    for (const el of this.highlighted) el.classList.remove(HIGHLIGHT);
    this.highlighted = [];
  }

  /** Removes the card and highlights (idempotent). Does not set localStorage. */
  destroy(): void {
    this.clearHighlight();
    this.card?.remove();
    this.card = null;
  }
}
