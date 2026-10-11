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

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    text: 'Welcome, young industrialist! Let us build a furniture business: timber from the forest, lumber from a sawmill, chairs from a factory, sold in a town store.',
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
    text: 'From the Manufacture tab, build a Furniture Factory. It turns lumber into fine furniture.',
    highlight: '.tb-tab[data-tab="manufacture"], .tool-card[data-building="furniture_factory"]',
    done: has('furniture_factory'),
  },
  {
    id: 'store',
    text: 'From Retail & Logistics, open a Store inside a town. Stores may only be built within the town limits.',
    highlight: '.tb-tab[data-tab="retail"], .tool-card[data-building="store"]',
    done: (s) => playerBuildings(s).some(isStore),
  },
  {
    id: 'roads',
    text: 'Pick Road in the Transport tab and drag roads so the camp, sawmill, factory and store all touch the road network.',
    highlight: '.tb-tab[data-tab="transport"], .tool-card[data-tool="road"]',
    done: chainLinked,
  },
  {
    id: 'route',
    text: 'Open Routes (R) and create a route: click the lumber camp, then the sawmill. Trucks will load wood at the first stop and unload it at the second.',
    highlight: '.hud-panel-btn[data-panel="routes"], [data-act="new"]',
    done: (s) => Object.values(s.routes).some((r) => r.ownerId === 'player' && r.stops.length >= 2),
  },
  {
    id: 'truck',
    text: 'A route needs wheels: press + on the route to buy a truck ($8,000).',
    highlight: '.hud-panel-btn[data-panel="routes"], [data-act="truck-plus"]',
    done: (s) => Object.values(s.vehicles).some((v) => v.ownerId === 'player'),
  },
  {
    id: 'first_sale',
    text: 'Add routes with trucks for the other legs, sawmill → factory and factory → store, then let the clock run (keys 1–4) until the first sale.',
    highlight: '.hud-speeds',
    done: soldAnything,
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

export class Tutorial {
  private index = 0;
  private finished = false;
  private card: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private highlighted: Element[] = [];
  private shownKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly getState: () => GameState,
  ) {
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
    remember('skipped');
    this.destroy();
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
      h('div', { class: 'tut-gear', 'aria-hidden': 'true' }, '⚙'),
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
  }
}
