import type { EventBus } from '../core/events';
import { eraName } from '../sim/eras';
import { monthProfit } from '../sim/finance';
export { eraName };
import type { GameState, Speed } from '../sim/types';
import { setOverlay } from '../render/overlays';
import { h } from './dom';
import { iconEl } from './icon';
import { formatMoney } from './format';
import { RollingCounter } from './juice';
import './hud.css';

export interface HudHandlers {
  onSpeed(s: GameState['speed']): void;
  onOpenPanel(id: string): void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SPEEDS: { speed: Speed; label: string; title: string }[] = [
  { speed: 0, label: '⏸', title: 'Pause' },
  { speed: 1, label: '▶', title: 'Normal speed' },
  { speed: 2, label: '▶▶', title: 'Fast' },
  { speed: 4, label: '▶▶▶', title: 'Faster' },
  { speed: 8, label: '⏩', title: 'Fastest' },
];

const PANELS: { id: string; label: string }[] = [
  { id: 'routes', label: 'Routes' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'finance', label: 'Finance' },
  { id: 'newspaper', label: 'Newspaper' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'rival', label: 'Rival' },
  { id: 'goals', label: 'Goals' },
];

const DELTA_MS = 1500;

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
  private readonly counter: RollingCounter;
  private state: GameState | null = null;
  private seeded = false;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.company = h('div', { class: 'hud-company' }, '');
    this.money = h('div', { class: 'hud-money', title: 'Cash on hand' }, '$0');
    this.counter = new RollingCounter(this.money, formatMoney);
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

    const smog = h('button', {
      class: 'hud-panel-btn hud-smog',
      title: 'Toggle pollution map',
      'aria-pressed': 'false',
      onClick: () => {
        const on = smog.getAttribute('aria-pressed') !== 'true';
        smog.setAttribute('aria-pressed', String(on));
        smog.classList.toggle('active', on);
        setOverlay('pollution', on);
      },
    }, iconEl('smog', 16), ' Smog');
    panels.appendChild(smog);

    const bar = h('div', { class: 'hud-bar' },
      h('div', { class: 'hud-brand' }, this.company, this.era),
      h('div', { class: 'hud-cash' }, h('span', { class: 'hud-label' }, 'Treasury'), this.money),
      h('div', { class: 'hud-clock' }, h('span', { class: 'hud-label' }, 'Date'), this.date),
      speeds,
      panels);

    root.append(bar, h('div', { id: 'ticker', class: 'hud-ticker' }));
  }

  /** Pops the player's month result when a month closes. Returns an unsubscribe. */
  attach(bus: EventBus): () => void {
    return bus.on('monthEnd', (e) => {
      const player = this.state?.companies.player;
      if (!player) return;
      const m = player.ledger.find((l) => l.year === e.date.year && l.month === e.date.month);
      this.popDelta(m ? monthProfit(m) : 0);
    });
  }

  private popDelta(net: number): void {
    const good = net >= 0;
    const el = h('div', { class: `hud-delta ${good ? 'good' : 'bad'}` }, `${good ? '+' : '\u2212'}${formatMoney(Math.abs(net))}`);
    const cash = this.money.parentElement ?? this.money;
    cash.appendChild(el);
    setTimeout(() => el.remove(), DELTA_MS);
  }

  /** Forgets the previous game: the next update snaps the treasury instead of rolling. */
  reset(): void {
    this.state = null;
    this.seeded = false;
  }

  /** Advances the treasury roll; call every frame. */
  tick(nowMs: number): void {
    this.counter.tick(nowMs);
  }

  update(state: GameState, nowMs: number = performance.now()): void {
    this.state = state;
    const player = state.companies.player;
    setText(this.company, player.name);
    if (this.seeded) {
      this.counter.set(player.money, nowMs);
    } else {
      this.seeded = true;
      this.counter.snap(player.money);
    }
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
