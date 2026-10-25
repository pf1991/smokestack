/**
 * First-game tutorial: a brass hint card that walks a new Free Play player from an empty map to the
 * first furniture sale. Each step has a `done(state)` predicate; the card shows the first unmet step
 * and polls the state on a timer (so it also advances while the game is paused). "Skip" or finishing
 * is remembered in localStorage, so the tutorial is offered once.
 */
import { BUILDINGS } from '../data/buildings';
import { findPath, roadPassable } from '../sim/pathfinding';
import { accessTiles } from '../sim/state';
import type { Building, BuildingTypeId, GameState } from '../sim/types';
import { h } from './dom';
import { iconEl } from './icon';
import './tutorial.css';

export interface TutorialStep {
  id: string;
  /** what to do next (shown on the card) */
  text: string;
  done(state: GameState): boolean;
  /** CSS selector(s) of HUD/toolbar elements to glow while this step is current */
  highlight?: string;
  /** steps without a natural goal (the welcome) also advance with a Next button */
  manual?: boolean;
  /** shown once the step is met, when it is the last one */
  doneText?: string;
}

export const TUTORIAL_KEY = 'smokestack:tutorial';
export type TutorialStatus = 'skipped' | 'done';
const POLL_MS = 400;
const HIGHLIGHT = 'tut-highlight';

const playerBuildings = (s: GameState): Building[] => Object.values(s.buildings).filter((b) => b.ownerId === 'player');
const firstOf = (s: GameState, typeId: BuildingTypeId) => playerBuildings(s).find((b) => b.typeId === typeId);
const has = (typeId: BuildingTypeId) => (s: GameState) => firstOf(s, typeId) !== undefined;
const isStore = (b: Building) => BUILDINGS[b.typeId]?.category === 'retail';

/** True when trucks could drive from `a` to `b` over existing road. */
function roadLinked(s: GameState, a: Building, b: Building): boolean {
  const from = accessTiles(s, a);
  const to = accessTiles(s, b);
  return from.length > 0 && to.length > 0 && findPath(s.map, from[0], to, roadPassable) !== null;
}

/** Lumber camp → sawmill → furniture factory → store are all linked by road. */
function chainLinked(s: GameState): boolean {
  const chain = [firstOf(s, 'lumber_camp'), firstOf(s, 'sawmill'), firstOf(s, 'furniture_factory'), playerBuildings(s).find(isStore)];
  if (chain.some((b) => b === undefined)) return false;
  const bs = chain as Building[];
  for (let i = 0; i + 1 < bs.length; i++) if (!roadLinked(s, bs[i], bs[i + 1])) return false;
  return true;
}

function soldAnything(s: GameState): boolean {
  return Object.entries(s.flags ?? {}).some(([k, v]) => k.startsWith('sold:') && typeof v === 'number' && v > 0);
}

function hasHub(s: GameState): boolean {
  return playerBuildings(s).some((b) => b.typeId === 'warehouse' && b.hub);
}

function hasHubTruck(s: GameState): boolean {
  return Object.values(s.vehicles).some((v) => v.ownerId === 'player' && v.hubId != null);
}

function hubHasManager(s: GameState): boolean {
  return playerBuildings(s).some((b) => {
    if (b.typeId !== 'warehouse' || !b.hub) return false;
    return s.logistics.managers.some((m) => m.employer === 'player' && m.post === b.id);
  });
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    text: 'Welcome, young industrialist! Let us build a furniture business: timber from the forest, lumber from a sawmill, chairs from a factory, sold in a town store — hauled by a Warehouse hub.',
    manual: true,
    done: (s) => playerBuildings(s).length > 0,
  },
  {
    id: 'lumber_camp',
    text: 'Open the Extract tab and place a Lumber Camp on forest (the dark green woods). More forest under it means more timber.',
    highlight: '.tb-tab[data-tab="extract"], .tool-card[data-building="lumber_camp"]',
    done: has('lumber_camp'),
  },
  {
    id: 'sawmill',
    text: 'From the Refine tab, build a Sawmill on open grass near your camp. It turns wood into lumber.',
    highlight: '.tb-tab[data-tab="refine"], .tool-card[data-building="sawmill"]',
    done: has('sawmill'),
  },
  {
    id: 'furniture_factory',
    text: 'From the Manufacture tab, build a Furniture Factory. Keep it close — your hub will serve a short range.',
    highlight: '.tb-tab[data-tab="manufacture"], .tool-card[data-building="furniture_factory"]',
    done: has('furniture_factory'),
  },
  {
    id: 'store',
    text: 'From Retail, Trade & Logistics, open a Store inside a town. Stores may only be built within the town limits.',
    highlight: '.tb-tab[data-tab="retail"], .tool-card[data-building="store"]',
    done: (s) => playerBuildings(s).some(isStore),
  },
  {
    id: 'roads',
    text: 'Pick Road in the Transport tab and lay roads so the camp, sawmill, factory and store all touch the same network.',
    highlight: '.tb-tab[data-tab="transport"], .tool-card[data-tool="road"]',
    done: chainLinked,
  },
  {
    id: 'warehouse',
    text: 'Still under Retail, Trade & Logistics: place a Warehouse on road so its range circle covers the camp, sawmill, factory and store. Local trucks run from here — no route per hop.',
    highlight: '.tb-tab[data-tab="retail"], .tool-card[data-building="warehouse"]',
    done: has('warehouse'),
  },
  {
    id: 'hub',
    text: 'Click your Warehouse, open Hub, and Buy hub truck. That opens the hub: its trucks collect and deliver nearby.',
    highlight: '.tb-tab[data-tab="retail"], .tool-card[data-building="warehouse"]',
    done: (s) => hasHub(s) && hasHubTruck(s),
  },
  {
    id: 'manager',
    text: 'Open Managers (J): Hire someone, then Assign them to your Warehouse. Without a manager the hub sits idle.',
    highlight: '.hud-group-btn[data-group="operations"], .hud-menu-item[data-panel="managers"], .hud-nav-btn',
    done: hubHasManager,
  },
  {
    id: 'first_sale',
    text: 'Let the clock run (keys 1–4). The hub hauls wood → lumber → furniture into the store. Save Routes (R) for long hauls between distant clusters.',
    highlight: '.hud-speeds',
    done: soldAnything,
  },
  {
    id: 'alerts',
    text: 'When a works starves or a store runs empty, the bell in the top bar lists the trouble. Press T (or click the bell) to open the alerts tray, then click a row to jump to it.',
    highlight: '#hud-alerts, .alerts-bell',
    manual: true,
    done: () => false,
  },
  {
    id: 'codex',
    text: 'Press I (or World → Codex) to open the production-chain codex: every good, what makes it, what it needs, and what towns want. Browse a chain, then carry on.',
    highlight: '.hud-group-btn[data-group="world"], .hud-menu-item[data-panel="codex"]',
    manual: true,
    done: () => false,
    doneText: "Ka-ching! You're in business.",
  },
];

/** 'skipped' or 'done' once the player has dismissed or finished the tutorial; null otherwise. */
export function tutorialStatus(): TutorialStatus | null {
  try {
    const v = localStorage.getItem(TUTORIAL_KEY);
    return v === 'skipped' || v === 'done' ? v : null;
  } catch {
    return null;
  }
}

function remember(status: TutorialStatus): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, status);
  } catch {
    // private mode or full storage: the tutorial just shows again next time
  }
}

/** The tutorial is offered for new Free Play games until it was skipped or finished once. */
export function shouldOfferTutorial(scenarioId: string | undefined): boolean {
  return scenarioId === 'sandbox' && tutorialStatus() === null;
}

export interface TutorialOpts {
  /** Fired once when the tutorial is skipped or the cheer card is closed after finish. */
  onEnd?: (status: TutorialStatus) => void;
}

export class Tutorial {
  private index = 0;
  private finished = false;
  private ended: TutorialStatus | null = null;
  private card: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private highlighted: Element[] = [];
  private shownKey = '';
  private onEnd: TutorialOpts['onEnd'];

  constructor(
    private readonly root: HTMLElement,
    private readonly getState: () => GameState,
    opts: TutorialOpts = {},
  ) {
    this.onEnd = opts.onEnd;
    this.timer = setInterval(() => this.update(), POLL_MS);
    this.update();
  }

  /** Index of the step on the card (TUTORIAL_STEPS.length once finished). */
  get stepIndex(): number {
    return this.index;
  }

  /** False after Skip, close or destroy. */
  get active(): boolean {
    return this.timer !== null;
  }

  /** Advances past every met step and redraws the card if the step changed. */
  update(): void {
    if (!this.active || this.finished) return;
    const state = this.getState();
    while (this.index < TUTORIAL_STEPS.length && TUTORIAL_STEPS[this.index].done(state)) this.index++;
    if (this.index >= TUTORIAL_STEPS.length) {
      this.finish();
      return;
    }
    this.render();
    this.refreshHighlight();
  }

  private next(): void {
    if (this.index < TUTORIAL_STEPS.length - 1) this.index++;
    this.update();
  }

  private finish(): void {
    this.finished = true;
    this.ended = 'done';
    remember('done');
    this.clearHighlight();
    const last = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
    this.show(
      'done',
      h('div', { class: 'tut-step' }, 'Tutorial complete'),
      h('p', { class: 'tut-text tut-cheer' }, last.doneText ?? 'Well done!'),
      h('div', { class: 'tut-actions' }, h('button', { class: 'btn', 'data-act': 'close', onClick: () => this.destroy() }, 'Carry on')),
    );
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private skip(): void {
    this.ended = 'skipped';
    remember('skipped');
    this.destroy();
  }

  private fireEnd(): void {
    if (this.ended === null || !this.onEnd) return;
    const cb = this.onEnd;
    this.onEnd = undefined;
    cb(this.ended);
  }

  private render(): void {
    const step = TUTORIAL_STEPS[this.index];
    const key = `step:${step.id}`;
    if (key === this.shownKey) return;
    this.show(
      key,
      h('div', { class: 'tut-step' }, `Tutorial · ${this.index + 1} / ${TUTORIAL_STEPS.length}`),
      h('p', { class: 'tut-text' }, step.text),
      h('div', { class: 'tut-actions' },
        h('button', { class: 'tut-skip', 'data-act': 'skip', title: 'Hide the tutorial for good', onClick: () => this.skip() }, 'Skip tutorial'),
        step.manual ? h('button', { class: 'btn', 'data-act': 'next', onClick: () => this.next() }, 'Next ›') : null),
    );
  }

  /** Re-queried on every poll, so controls inside windows opened later (e.g. Routes) glow too. */
  private refreshHighlight(): void {
    this.clearHighlight();
    const sel = TUTORIAL_STEPS[this.index]?.highlight;
    if (!sel) return;
    this.highlighted = [...this.root.querySelectorAll(sel)];
    for (const el of this.highlighted) el.classList.add(HIGHLIGHT);
  }

  private show(key: string, ...children: HTMLElement[]): void {
    this.shownKey = key;
    const card = h('aside', { class: 'tut-card brass-card', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'tut-gear', 'aria-hidden': 'true' }, iconEl('gear', 26)),
      h('div', { class: 'tut-body' }, ...children));
    if (this.card) this.card.replaceWith(card);
    else this.root.appendChild(card);
    this.card = card;
  }

  private clearHighlight(): void {
    for (const el of this.highlighted) el.classList.remove(HIGHLIGHT);
    this.highlighted = [];
  }

  /** Stops polling and removes the card and highlights (idempotent). */
  destroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.clearHighlight();
    this.card?.remove();
    this.card = null;
    this.fireEnd();
  }
}
