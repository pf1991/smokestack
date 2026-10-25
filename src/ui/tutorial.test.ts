// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { ensureRoadLink } from '../sim/roads';
import { suggestStops } from '../sim/routeHelpers';
import { runDays } from '../sim/simulation';
import { createGame, findPlacement, placeBuilding } from '../sim/state';
import { connectToRoads, must } from '../sim/testkit';
import type { Building, BuildingTypeId, GameState, SimContext, Vec2 } from '../sim/types';
import { buyTruck, createRoute } from '../sim/vehicles';
import { Hud } from './hud';
import { Toolbar } from './toolbar';
import { shouldOfferTutorial, Tutorial, TUTORIAL_KEY, TUTORIAL_STEPS, tutorialStatus } from './tutorial';

const IDS = [
  'welcome', 'lumber_camp', 'sawmill', 'furniture_factory', 'store', 'roads', 'route', 'truck', 'first_sale', 'alerts', 'codex',
];

/** Index of the first step whose predicate is not yet met (11 = all done). */
const progress = (s: GameState) => {
  const i = TUTORIAL_STEPS.findIndex((st) => !st.done(s));
  return i < 0 ? TUTORIAL_STEPS.length : i;
};

describe('TUTORIAL_STEPS', () => {
  it('has eleven steps in order: furniture chain, then alerts and codex', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual(IDS);
    for (const s of TUTORIAL_STEPS) expect(s.text.length).toBeGreaterThan(10);
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].doneText).toBe("Ka-ching! You're in business.");
    expect(TUTORIAL_STEPS.find((s) => s.id === 'alerts')?.manual).toBe(true);
    expect(TUTORIAL_STEPS.find((s) => s.id === 'codex')?.manual).toBe(true);
  });

  it('predicates follow a real game from empty map to first sale, then stop on alerts', () => {
    const state = createGame({ seed: 42, companyName: 'Tutorial Co.', rival: false });
    const ctx: SimContext = { state, bus: new EventBus() };
    expect(progress(state)).toBe(0);
    const city = state.cities.reduce((a, b) => (b.population > a.population ? b : a));
    const place = (typeId: BuildingTypeId, near: Vec2): Building => {
      const pos = findPlacement(state, 'player', typeId, near, 40);
      if (!pos) throw new Error(`no room for ${typeId}`);
      return must(placeBuilding(ctx, 'player', typeId, pos));
    };
    const camp = place('lumber_camp', city.center);
    expect(progress(state)).toBe(2); // welcome and lumber camp done
    const mill = place('sawmill', camp.pos);
    expect(progress(state)).toBe(3);
    const factory = place('furniture_factory', mill.pos);
    expect(progress(state)).toBe(4);
    const store = place('store', city.center);
    expect(progress(state)).toBe(5);
    const chain = [camp, mill, factory, store];
    for (const b of chain) must(connectToRoads(ctx, b));
    for (let i = 0; i + 1 < chain.length; i++) must(ensureRoadLink(ctx, 'player', chain[i], chain[i + 1]));
    expect(progress(state)).toBe(6); // the chain is linked by road
    const routes = [0, 1, 2].map((i) => must(createRoute(ctx, 'player', `leg ${i}`, suggestStops(state, [chain[i].id, chain[i + 1].id]))));
    expect(progress(state)).toBe(7);
    for (const r of routes) must(buyTruck(ctx, 'player', r.id));
    expect(progress(state)).toBe(8);
    for (let d = 0; d < 120 && progress(state) < 9; d++) runDays(ctx, 1);
    // first sale met; alerts/codex are manual and must not auto-finish
    expect(progress(state)).toBe(9);
    expect(TUTORIAL_STEPS[9].id).toBe('alerts');
    expect(TUTORIAL_STEPS[9].done(state)).toBe(false);
    expect(TUTORIAL_STEPS[10].done(state)).toBe(false);
  });

  it('a step is not done by the rival', () => {
    const state = createGame({ seed: 42, companyName: 'Tutorial Co.', rival: false });
    const ctx: SimContext = { state, bus: new EventBus() };
    const pos = findPlacement(state, 'rival', 'lumber_camp', state.cities[0].center, 40)!;
    must(placeBuilding(ctx, 'rival', 'lumber_camp', pos));
    expect(progress(state)).toBe(0);
  });

  it('every highlight selector matches a real HUD or toolbar element', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    new Hud(root, { onSpeed: () => {}, onOpenPanel: () => {} });
    new Toolbar(root, () => {});
    const withHighlight = TUTORIAL_STEPS.filter((s) => s.highlight);
    expect(withHighlight.length).toBeGreaterThanOrEqual(7);
    for (const s of withHighlight) {
      expect(root.querySelectorAll(s.highlight!).length, `${s.id}: ${s.highlight}`).toBeGreaterThan(0);
    }
    root.remove();
  });
});

describe('Tutorial card', () => {
  let root: HTMLElement;
  let state: GameState;
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
    new Hud(root, { onSpeed: () => {}, onOpenPanel: () => {} });
    new Toolbar(root, () => {});
    state = createGame({ seed: 42, companyName: 'Tutorial Co.', rival: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const card = () => root.querySelector<HTMLElement>('.tut-card');

  it('shows a brass hint card for the current step and highlights its target', () => {
    const t = new Tutorial(root, () => state);
    expect(card()).not.toBeNull();
    expect(card()!.classList.contains('brass-card') || card()!.className.includes('tut')).toBe(true);
    expect(card()!.textContent).toContain(TUTORIAL_STEPS[0].text.slice(0, 20));
    expect(card()!.textContent).toContain('1 / 11');
    // welcome advances with Next
    card()!.querySelector<HTMLButtonElement>('[data-act="next"]')!.click();
    expect(t.stepIndex).toBe(1);
    expect(card()!.textContent).toContain('2 / 11');
    expect(root.querySelectorAll('.tut-highlight').length).toBeGreaterThan(0);
    t.destroy();
  });

  it('advances on its own timer as the predicates come true', () => {
    const t = new Tutorial(root, () => state);
    const ctx: SimContext = { state, bus: new EventBus() };
    const pos = findPlacement(state, 'player', 'lumber_camp', state.cities[0].center, 40)!;
    must(placeBuilding(ctx, 'player', 'lumber_camp', pos));
    vi.advanceTimersByTime(1000);
    expect(t.stepIndex).toBe(2);
    expect(card()!.textContent).toContain(TUTORIAL_STEPS[2].text.slice(0, 20));
    t.destroy();
  });

  it('Skip removes the card, clears highlights and remembers the choice', () => {
    const t = new Tutorial(root, () => state);
    card()!.querySelector<HTMLButtonElement>('[data-act="next"]')!.click();
    card()!.querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    expect(card()).toBeNull();
    expect(root.querySelectorAll('.tut-highlight').length).toBe(0);
    expect(localStorage.getItem(TUTORIAL_KEY)).toBe('skipped');
    expect(tutorialStatus()).toBe('skipped');
    expect(shouldOfferTutorial('sandbox')).toBe(false);
    expect(t.active).toBe(false);
    t.destroy();
  });

  it('celebrates the first sale, then remembers it is done', () => {
    const t = new Tutorial(root, () => state);
    state.flags['sold:furniture'] = 2;
    // every predicate true at once: pretend the whole chain exists
    const spy = TUTORIAL_STEPS.map((s) => vi.spyOn(s, 'done').mockReturnValue(true));
    vi.advanceTimersByTime(1000);
    expect(card()!.textContent).toContain("Ka-ching! You're in business.");
    expect(localStorage.getItem(TUTORIAL_KEY)).toBe('done');
    card()!.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(card()).toBeNull();
    for (const s of spy) s.mockRestore();
    t.destroy();
  });

  it('destroy stops the timer and removes the card', () => {
    const t = new Tutorial(root, () => state);
    const getState = vi.fn(() => state);
    const t2 = new Tutorial(root, getState);
    t.destroy();
    t2.destroy();
    getState.mockClear();
    vi.advanceTimersByTime(5000);
    expect(getState).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is offered only for new Free Play games that have not finished or skipped it', () => {
    expect(shouldOfferTutorial('sandbox')).toBe(true);
    expect(shouldOfferTutorial('lumber_baron')).toBe(false);
    localStorage.setItem(TUTORIAL_KEY, 'done');
    expect(shouldOfferTutorial('sandbox')).toBe(false);
  });

  it('survives a broken localStorage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(tutorialStatus()).toBeNull();
    const t = new Tutorial(root, () => state);
    expect(() => card()!.querySelector<HTMLButtonElement>('[data-act="skip"]')!.click()).not.toThrow();
    expect(card()).toBeNull();
    get.mockRestore();
    set.mockRestore();
    t.destroy();
  });
});
