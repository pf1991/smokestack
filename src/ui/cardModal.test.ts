// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { CARDS_BY_ID } from '../data/cards';
import { PLAYER_ID } from '../sim/companies';
import { choiceCost } from '../sim/politics/cards';
import { formatMoney } from './format';
import { createGame } from '../sim/state';
import { packState, unpackState } from '../game/saves';
import type { GameState, Speed } from '../sim/types';
import { attachCardModal, type CardHost } from './cardModal';

function host(state: GameState, opts: { photo?: boolean; intro?: boolean } = {}) {
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const hooks = new Set<(now: number) => void>();
  const bus = new EventBus();
  const h = {
    uiRoot,
    ctx: { state, bus },
    get state() {
      return state;
    },
    photoActive: opts.photo ?? false,
    introActive: opts.intro ?? false,
    setSpeed(s: Speed) {
      state.speed = s;
    },
    addFrameHook(fn: (now: number) => void) {
      hooks.add(fn);
      return () => hooks.delete(fn);
    },
  };
  const frame = () => {
    for (const fn of [...hooks]) fn(0);
  };
  return { h: h as CardHost & typeof h, uiRoot, frame, hooks };
}

function withCard(cardId = 'founders_parade', cityId: number | null = 0): GameState {
  const s = createGame({ seed: 9 });
  s.date.year = 1906;
  s.speed = 4;
  s.politics.cards.pending.push({ uid: 900, cardId, cityId, openedDay: 0 });
  return s;
}

const live: (() => void)[] = [];
afterEach(() => {
  for (const d of live.splice(0)) d();
  document.body.replaceChildren();
});

function attach(state: GameState, opts?: { photo?: boolean; intro?: boolean }) {
  const t = host(state, opts);
  live.push(attachCardModal(t.h));
  return t;
}

const modal = () => document.querySelector('.card-modal');
const choiceButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.card-choice')];

describe('card modal', () => {
  it('shows the oldest pending card as a clipping and pauses the game', () => {
    const s = withCard();
    s.politics.cards.pending.unshift({ uid: 899, cardId: 'letter_to_editor', cityId: null, openedDay: 0 });
    const t = attach(s);
    t.frame();
    expect(modal()).not.toBeNull();
    expect(s.speed).toBe(0);
    expect(document.querySelector('.card-title')!.textContent).toBe('A Letter to the Editor');
    expect(choiceButtons().map((b) => b.querySelector('.card-choice-label')!.textContent)).toEqual(['Fund a smoke study', 'Let it blow over']);
    // effect chip in the faction's colour, with a sign
    const chip = document.querySelector<HTMLElement>('.card-chip')!;
    expect(chip.textContent).toContain('Reformers');
    expect(chip.textContent).toContain('+4');
    expect(chip.style.getPropertyValue('--faction')).toBe('#5c9a5a');
    expect(document.querySelector('.card-cost img.icon')).not.toBeNull();
  });

  it('fills in the city name', () => {
    const s = withCard();
    const t = attach(s);
    t.frame();
    expect(document.querySelector('.card-title')!.textContent).toBe(`${s.cities[0].name} Founders' Day`);
  });

  it('clicking a choice resolves it and restores the speed', () => {
    const s = withCard();
    const t = attach(s);
    t.frame();
    const m = s.companies[PLAYER_ID].money;
    choiceButtons()[1].click();
    expect(s.politics.cards.pending).toEqual([]);
    expect(s.companies[PLAYER_ID].money).toBe(m - choiceCost(s, CARDS_BY_ID.founders_parade.choices[1]));
    expect(modal()).toBeNull();
    expect(s.speed).toBe(4);
  });

  it('shows the next card at once and restores the speed only after the last', () => {
    const s = withCard();
    s.politics.cards.pending.push({ uid: 901, cardId: 'letter_to_editor', cityId: null, openedDay: 0 });
    const t = attach(s);
    t.frame();
    choiceButtons()[1].click();
    expect(modal()).not.toBeNull();
    expect(s.speed).toBe(0);
    expect(document.querySelector('.card-title')!.textContent).toBe('A Letter to the Editor');
    choiceButtons()[1].click();
    expect(modal()).toBeNull();
    expect(s.speed).toBe(4);
  });

  it('keeps a paused game paused after the card', () => {
    const s = withCard();
    s.speed = 0;
    const t = attach(s);
    t.frame();
    choiceButtons()[1].click();
    expect(s.speed).toBe(0);
  });

  it('disables an unaffordable choice with the reason', () => {
    const s = withCard();
    s.companies[PLAYER_ID].money = 100;
    const t = attach(s);
    t.frame();
    const [a, b] = choiceButtons();
    expect(a.disabled).toBe(true);
    expect(a.textContent).toContain('Not enough money');
    expect(b.disabled).toBe(false);
    a.click();
    expect(s.politics.cards.pending.length).toBe(1);
  });

  it('Esc is swallowed: the card stays and nothing underneath hears it', () => {
    const s = withCard();
    const t = attach(s);
    t.frame();
    let heard = 0;
    const under = () => heard++;
    window.addEventListener('keydown', under);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    window.removeEventListener('keydown', under);
    expect(heard).toBe(0);
    expect(e.defaultPrevented).toBe(true);
    t.frame();
    expect(modal()).not.toBeNull();
    expect(s.speed).toBe(0);
  });

  it('shows the scaled cost that resolving books', () => {
    const s = withCard();
    s.economy.priceIndex = 3; // card scale 3 (the price index, Task 8)
    const t = attach(s);
    t.frame();
    const shown = [...document.querySelectorAll('.card-cost')].map((e) => e.textContent);
    expect(shown).toEqual([formatMoney(9000), `+${formatMoney(6000)}`]);
    const m = s.companies[PLAYER_ID].money;
    choiceButtons()[0].click();
    expect(s.companies[PLAYER_ID].money).toBe(m - 9000);
  });

  it('prints a refusal inside the clipping and keeps the card', () => {
    const s = withCard();
    const t = attach(s);
    t.frame();
    s.companies[PLAYER_ID].money = 10; // the choice was affordable when drawn
    choiceButtons()[0].click();
    expect(document.querySelector('.card-clipping .card-error')!.textContent).toBe('Not enough money');
    expect(s.politics.cards.pending.length).toBe(1);
    expect(choiceButtons()[0].disabled).toBe(true);
  });

  it('traps Tab inside the clipping, from the clipping to the first enabled choice', () => {
    const s = withCard('shop_floor_grumbling');
    s.companies[PLAYER_ID].money = 3000; // the $4,000+ bonus is out of reach
    const t = attach(s);
    t.frame();
    const [bonus, guards, nothing] = choiceButtons();
    expect(bonus.disabled).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.card-clipping'));
    const tab = (shiftKey = false) => {
      const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    };
    tab();
    expect(document.activeElement).toBe(guards);
    tab();
    expect(document.activeElement).toBe(nothing);
    tab();
    expect(document.activeElement).toBe(guards);
    tab(true);
    expect(document.activeElement).toBe(nothing);
    (document.body as HTMLElement).focus();
    tab();
    expect(document.activeElement).toBe(guards);
  });

  it('opens with the clipping focused: Space and Enter there do nothing, on a choice they still work', () => {
    const s = withCard();
    const t = attach(s);
    t.frame();
    const clipping = document.querySelector<HTMLElement>('.card-clipping')!;
    expect(clipping.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(clipping);
    let heard = 0;
    const under = () => heard++;
    window.addEventListener('keydown', under);
    for (const key of [' ', 'Enter']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      clipping.dispatchEvent(e);
      expect(e.defaultPrevented, key).toBe(true);
    }
    expect(heard).toBe(0);
    expect(s.politics.cards.pending.length).toBe(1);
    expect(s.speed).toBe(0);
    // on a focused choice the keys keep their default (button activation) and still stay from the game
    const b = choiceButtons()[1];
    b.focus();
    for (const key of [' ', 'Enter']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      b.dispatchEvent(e);
      expect(e.defaultPrevented, key).toBe(false);
    }
    window.removeEventListener('keydown', under);
    expect(heard).toBe(0);
  });

  it('waits for the cold open and for photo mode to end', () => {
    const s = withCard();
    const t = attach(s, { intro: true, photo: true });
    t.frame();
    expect(modal()).toBeNull();
    expect(s.speed).toBe(4);
    t.h.introActive = false;
    t.frame();
    expect(modal()).toBeNull();
    t.h.photoActive = false;
    t.frame();
    expect(modal()).not.toBeNull();
    expect(s.speed).toBe(0);
  });

  it('waits while the pause menu is open', () => {
    const s = withCard();
    const t = attach(s);
    const menu = document.createElement('div');
    menu.className = 'mn-root mn-modal';
    document.body.appendChild(menu);
    t.frame();
    expect(modal()).toBeNull();
    menu.remove();
    t.frame();
    expect(modal()).not.toBeNull();
  });

  it('keeps the game paused while open even if something resumes it', () => {
    const s = withCard();
    const t = attach(s);
    t.frame();
    s.speed = 2;
    t.frame();
    expect(s.speed).toBe(0);
    choiceButtons()[1].click();
    expect(s.speed).toBe(2);
  });

  it('shows a pending card again after a save is loaded', () => {
    const s = withCard();
    const r = unpackState(packState(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    attach(r.value).frame();
    expect(modal()).not.toBeNull();
    expect(r.value.speed).toBe(0);
  });

  it('detaching removes the modal and the key listener', () => {
    const s = withCard();
    const t = host(s);
    const off = attachCardModal(t.h);
    t.frame();
    off();
    expect(modal()).toBeNull();
    expect(t.hooks.size).toBe(0);
    let heard = 0;
    const under = () => heard++;
    window.addEventListener('keydown', under);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.removeEventListener('keydown', under);
    expect(heard).toBe(1);
  });
});
