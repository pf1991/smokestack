import type { EventBus } from '../core/events';
import { GREENS_YEAR } from '../data/factions';
import { eraName } from '../sim/eras';
import { monthProfit } from '../sim/finance';
export { eraName };
import type { GameState, Speed, Weather } from '../sim/types';
import { setOverlay } from '../render/overlays';
import { factionOverlay, factionModes, setFactionMode, getFactionMode, type FactionMode } from '../render/factionOverlay';
import { h } from './dom';
import { iconEl } from './icon';
import { formatMoney } from './format';
import { RollingCounter } from './juice';
import './hud.css';

export interface HudHandlers {
  onSpeed(s: GameState['speed']): void;
  onOpenPanel(id: string): void;
  onPhoto?(): void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SPEEDS: { speed: Speed; label: string; title: string }[] = [
  { speed: 0, label: '⏸', title: 'Pause' },
  { speed: 1, label: '▶', title: 'Normal speed' },
  { speed: 2, label: '▶▶', title: 'Fast' },
  { speed: 4, label: '▶▶▶', title: 'Faster' },
  { speed: 8, label: '⏩', title: 'Fastest' },
];

const PANELS: { id: string; label: string; icon?: string }[] = [
  { id: 'routes', label: 'Routes' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'finance', label: 'Finance' },
  { id: 'newspaper', label: 'Newspaper' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'rival', label: 'Rival' },
  { id: 'goals', label: 'Goals' },
  { id: 'politics', label: 'Politics', icon: 'ballot' },
  { id: 'family', label: 'Family' },
  { id: 'exchange', label: 'Exchange' },
];

const DELTA_MS = 1500;

/** Compass names, clockwise from east in screen space (+y is south). */
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** Vane tooltip: where the wind blows from and how hard, plus "Rain" on rain days. */
export function windLabel(w: Weather): string {
  const mag = Math.hypot(w.windX, w.windY);
  let text: string;
  if (mag < 0.15) text = 'Wind: calm';
  else {
    // named for where it comes from: the opposite of the way it blows
    const from = Math.round(Math.atan2(-w.windY, -w.windX) / (Math.PI / 4));
    const strength = mag < 0.7 ? 'light' : mag < 1.15 ? 'brisk' : 'strong';
    text = `Wind: ${COMPASS[((from % 8) + 8) % 8]}, ${strength}`;
  }
  return w.rain ? `${text}. Rain` : text;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class Hud {
  private readonly company: HTMLElement;
  private readonly money: HTMLElement;
  private readonly date: HTMLElement;
  private readonly era: HTMLElement;
  private readonly vane: HTMLElement;
  private readonly vaneArrow: HTMLElement;
  private readonly vaneRain: HTMLElement;
  /** the vane shows the weather of a new game or load once, then follows dayStart */
  private vaneStale = true;
  private readonly speedButtons = new Map<Speed, HTMLElement>();
  private lastSpeed: Speed | null = null;
  private readonly counter: RollingCounter;
  private state: GameState | null = null;
  private seeded = false;
  private readonly modeSel: HTMLSelectElement;
  /** whether the faction-mode labels were built for the post-GREENS_YEAR names */
  private modeGreen = false;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.company = h('div', { class: 'hud-company' }, '');
    this.money = h('div', { class: 'hud-money', title: 'Cash on hand' }, '$0');
    this.counter = new RollingCounter(this.money, formatMoney);
    this.date = h('div', { class: 'hud-date' }, '');
    this.era = h('div', { class: 'hud-era' }, '');
    this.vaneArrow = iconEl('wind', 20);
    this.vaneRain = iconEl('rain', 18);
    this.vaneRain.hidden = true;
    this.vane = h('div', { class: 'hud-wind', role: 'img', 'aria-label': 'Wind' }, this.vaneArrow, this.vaneRain);

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
      }, ...(p.icon ? [iconEl(p.icon, 16), ` ${p.label}`] : [p.label]))));

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
    const modeSel = h('select', {
      class: 'hud-faction-mode',
      title: 'What the faction map shows',
      'aria-label': 'Faction map mode',
      onChange: () => setFactionMode((modeSel as HTMLSelectElement).value as FactionMode),
    }, ...factionModes(1900).map((m) => h('option', { value: m.value }, m.label)));
    (modeSel as HTMLSelectElement).value = getFactionMode();
    modeSel.hidden = true;
    this.modeSel = modeSel as HTMLSelectElement;
    const factions = h('button', {
      class: 'hud-panel-btn hud-factions',
      title: 'Toggle faction map',
      'aria-pressed': 'false',
      onClick: () => {
        const on = factions.getAttribute('aria-pressed') !== 'true';
        factions.setAttribute('aria-pressed', String(on));
        factions.classList.toggle('active', on);
        modeSel.hidden = !on;
        setOverlay('factions', on);
      },
    }, iconEl('city', 16), ' Factions');
    if (factionOverlay.enabled) {
      // started on by the DEV overlay param
      factions.setAttribute('aria-pressed', 'true');
      factions.classList.add('active');
      modeSel.hidden = false;
    }
    panels.append(factions, modeSel);
    const photo = h('button', {
      class: 'hud-panel-btn hud-photo',
      title: 'Photo mode (P)',
      'aria-label': 'Photo mode',
      onClick: () => handlers.onPhoto?.(),
    }, iconEl('camera', 16), ' Photo');
    panels.appendChild(photo);

    const bar = h('div', { class: 'hud-bar' },
      h('div', { class: 'hud-brand' }, this.company, this.era),
      h('div', { class: 'hud-cash' }, h('span', { class: 'hud-label' }, 'Treasury'), this.money),
      h('div', { class: 'hud-clock' }, h('span', { class: 'hud-label' }, 'Date'), h('div', { class: 'hud-date-row' }, this.date, this.vane)),
      speeds,
      panels);

    root.append(bar, h('div', { id: 'ticker', class: 'hud-ticker' }));
  }

  /** Pops the player's month result when a month closes. Returns an unsubscribe. */
  attach(bus: EventBus): () => void {
    const offMonth = bus.on('monthEnd', (e) => {
      const player = this.state?.companies.player;
      if (!player) return;
      const m = player.ledger.find((l) => l.year === e.date.year && l.month === e.date.month);
      this.popDelta(m ? monthProfit(m) : 0);
    });
    // weather changes once a day: the vane never updates per frame
    const offDay = bus.on('dayStart', () => {
      if (this.state) this.updateVane(this.state.weather);
    });
    return () => {
      offMonth();
      offDay();
    };
  }

  private updateVane(w: Weather | undefined): void {
    if (!w) return;
    const label = windLabel(w);
    this.vane.title = label;
    this.vane.setAttribute('aria-label', label);
    const deg = Math.round((Math.atan2(w.windY, w.windX) * 180) / Math.PI);
    this.vaneArrow.style.transform = `rotate(${deg}deg)`;
    this.vaneArrow.style.opacity = Math.hypot(w.windX, w.windY) < 0.15 ? '0.45' : '';
    this.vaneRain.hidden = !w.rain;
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
    this.vaneStale = true;
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
    if (this.vaneStale) {
      this.vaneStale = false;
      this.updateVane(state.weather);
    }
    // the Reformers become the Greens in GREENS_YEAR: relabel the faction-map modes (both ways, for loads)
    const green = d.year >= GREENS_YEAR;
    if (green !== this.modeGreen) {
      this.modeGreen = green;
      const value = this.modeSel.value;
      this.modeSel.replaceChildren(...factionModes(d.year).map((m) => h('option', { value: m.value }, m.label)));
      this.modeSel.value = value;
    }
    if (state.speed !== this.lastSpeed) {
      this.lastSpeed = state.speed;
      for (const [s, btn] of this.speedButtons) btn.classList.toggle('active', s === state.speed);
    }
  }
}
