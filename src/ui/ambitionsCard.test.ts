// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/state';
import { Hud } from './hud';
import { Toolbar } from './toolbar';
import {
  AMBITION_BULLETS,
  AMBITIONS_CARD_KEY,
  AmbitionsCard,
  ambitionsCardStatus,
  shouldOfferAmbitionsCard,
} from './ambitionsCard';
import { Tutorial, TUTORIAL_STEPS, tutorialStatus } from './tutorial';

describe('shouldOfferAmbitionsCard', () => {
  beforeEach(() => localStorage.clear());

  it('offers only Free Play when tutorial is done/skipped and card never shown', () => {
    expect(shouldOfferAmbitionsCard('sandbox', true)).toBe(true);
    expect(shouldOfferAmbitionsCard('sandbox', false)).toBe(false);
    expect(shouldOfferAmbitionsCard('lumber_baron', true)).toBe(false);
    localStorage.setItem(AMBITIONS_CARD_KEY, 'seen');
    expect(shouldOfferAmbitionsCard('sandbox', true)).toBe(false);
  });
});

describe('AmbitionsCard', () => {
  let root: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
    new Hud(root, { onSpeed: () => {}, onOpenPanel: () => {} });
    new Toolbar(root, () => {});
  });

  afterEach(() => {
    root.remove();
  });

  const card = () => root.querySelector<HTMLElement>('.amb-card');

  it('mounts a brass card with three bullets and highlights targets', () => {
    const a = new AmbitionsCard(root);
    expect(card()).not.toBeNull();
    expect(card()!.classList.contains('brass-card')).toBe(true);
    expect(card()!.textContent).toContain('Next ambitions');
    for (const b of AMBITION_BULLETS) expect(card()!.textContent).toContain(b.text.slice(0, 12));
    expect(root.querySelectorAll('.tut-highlight').length).toBeGreaterThan(0);
    for (const b of AMBITION_BULLETS) {
      expect(root.querySelectorAll(b.highlight).length, b.highlight).toBeGreaterThan(0);
    }
    a.destroy();
  });

  it('Got it dismisses once and second New Game does not remount when storage is set', () => {
    const a = new AmbitionsCard(root);
    card()!.querySelector<HTMLButtonElement>('[data-act="got-it"]')!.click();
    expect(card()).toBeNull();
    expect(ambitionsCardStatus()).toBe('seen');
    expect(localStorage.getItem(AMBITIONS_CARD_KEY)).toBe('seen');
    expect(a.active).toBe(false);
    expect(shouldOfferAmbitionsCard('sandbox', true)).toBe(false);
    if (shouldOfferAmbitionsCard('sandbox', true)) new AmbitionsCard(root);
    expect(card()).toBeNull();
  });

  it('Next also dismisses and remembers', () => {
    new AmbitionsCard(root);
    card()!.querySelector<HTMLButtonElement>('[data-act="next"]')!.click();
    expect(card()).toBeNull();
    expect(ambitionsCardStatus()).toBe('seen');
  });

  it('after tutorial finishes this session, card mounts once on Carry on', () => {
    vi.useFakeTimers();
    const state = createGame({ seed: 42, companyName: 'Ambitions Co.', rival: false });
    const ends: string[] = [];
    const t = new Tutorial(root, () => state, {
      onEnd: (status) => {
        ends.push(status);
        if (shouldOfferAmbitionsCard(state.scenarioId, true)) new AmbitionsCard(root);
      },
    });
    for (const step of TUTORIAL_STEPS) vi.spyOn(step, 'done').mockReturnValue(true);
    vi.advanceTimersByTime(1000);
    expect(tutorialStatus()).toBe('done');
    expect(root.querySelector('.amb-card')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(ends).toEqual(['done']);
    expect(root.querySelector('.amb-card')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-act="got-it"]')!.click();
    expect(ambitionsCardStatus()).toBe('seen');
    if (shouldOfferAmbitionsCard(state.scenarioId, true)) new AmbitionsCard(root);
    expect(root.querySelector('.amb-card')).toBeNull();
    t.destroy();
    vi.useRealTimers();
  });

  it('survives a broken localStorage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(ambitionsCardStatus()).toBeNull();
    const a = new AmbitionsCard(root);
    expect(() => card()!.querySelector<HTMLButtonElement>('[data-act="got-it"]')!.click()).not.toThrow();
    expect(card()).toBeNull();
    get.mockRestore();
    set.mockRestore();
    a.destroy();
  });
});
