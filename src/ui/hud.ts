import type { GameState, Speed } from '../sim/types';
import { h } from './dom';
import { formatMoney } from './format';
import './hud.css';

export interface HudHandlers {
  onSpeed(s: GameState['speed']): void;
  onOpenPanel(id: string): void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local era helper (Core rules). */
export function eraName(year: number): string {
  if (year < 1920) return 'Steam Age';
  if (year < 1940) return 'Roaring Age';
  if (year < 1960) return 'Atomic Age';
  if (year < 1980) return 'Space Age';
  return 'Silicon Age';
}

const SPEEDS: { speed: Speed; label: string; title: string }[] = [
  { speed: 0, label: '⏸', title: 'Pause' },
  { speed: 1, label: '▶', title: 'Normal speed' },
  { speed: 2, label: '▶▶', title: 'Fast' },
  { speed: 4, label: '▶▶▶', title: 'Faster' },
  { speed: 8, label: '⏩', title: 'Fastest' },
];

const PANELS: { id: string; label: string }[] = [
  { id: 'routes', label: 'Routes' },
  { id: 'finance', label: 'Finance' },
  { id: 'newspaper', label: 'Newspaper' },
  { id: 'contracts', label: 'Contracts' },
];

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class Hud {
  private readonly company: HTMLElement;
  private readonly money: HTMLElement;
  private readonly date: HTMLElement;
  private readonly era: HTMLElement;
  private readonly speedButtons = new Map<Speed, HTMLElement>();
  private lastSpeed: Speed | null = null;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.company = h('div', { class: 'hud-company' }, '');
    this.money = h('div', { class: 'hud-money', title: 'Cash on hand' }, '$0');
    this.date = h('div', { class: 'hud-date' }, '');
    this.era = h('div', { class: 'hud-era' }, '');

    const speeds = h('div', { class: 'hud-speeds' });
    for (const s of SPEEDS) {
      const btn = h('button', {
        class: 'hud-speed',
        'data-speed': s.speed,
        title: s.title,
        'aria-label': s.title,
        onClick: () => handlers.onSpeed(s.speed),
      }, s.label);
      this.speedButtons.set(s.speed, btn);
      speeds.appendChild(btn);
    }

    const panels = h('div', { class: 'hud-panels' },
      PANELS.map((p) => h('button', {
        class: 'hud-panel-btn',
        'data-panel': p.id,
        onClick: () => handlers.onOpenPanel(p.id),
      }, p.label)));

    const bar = h('div', { class: 'hud-bar' },
      h('div', { class: 'hud-brand' }, this.company, this.era),
      h('div', { class: 'hud-cash' }, h('span', { class: 'hud-label' }, 'Treasury'), this.money),
      h('div', { class: 'hud-clock' }, h('span', { class: 'hud-label' }, 'Date'), this.date),
      speeds,
      panels);

    root.append(bar, h('div', { id: 'ticker', class: 'hud-ticker' }));
  }

  update(state: GameState): void {
    const player = state.companies.player;
    setText(this.company, player.name);
    setText(this.money, formatMoney(player.money));
    this.money.classList.toggle('negative', player.money < 0);
    const d = state.date;
    setText(this.date, `${d.day} ${MONTHS[d.month - 1] ?? '???'} ${d.year}`);
    setText(this.era, eraName(d.year));
    if (state.speed !== this.lastSpeed) {
      this.lastSpeed = state.speed;
      for (const [s, btn] of this.speedButtons) btn.classList.toggle('active', s === state.speed);
    }
  }
}
