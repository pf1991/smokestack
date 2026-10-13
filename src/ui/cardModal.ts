/**
 * The event card modal: a pending card shown as a newspaper clipping, answered with one of its
 * choices. It must be answered (Esc does nothing), pauses the game while open and restores the
 * previous speed once the last pending card is answered. Several pending cards show one at a time,
 * oldest first. It waits for the cold open, photo mode and the pause/end menus to finish, and a
 * loaded save with a pending card shows it again (the watcher reads state every frame).
 */
import { CARDS_BY_ID, type CardChoice, type CardEffect } from '../data/cards';
import { FACTIONS, factionName, type FactionId } from '../data/factions';
import { canAffordChoice, cardText, resolveCard } from '../sim/politics/cards';
import type { CardInstance } from '../sim/politics/types';
import type { GameState, SimContext, Speed } from '../sim/types';
import { formatDate } from '../sim/clock';
import { h } from './dom';
import { formatMoney } from './format';
import { iconEl } from './icon';
import './cardModal.css';

/** What the modal needs from the GameController. */
export interface CardHost {
  readonly ctx: SimContext;
  readonly state: GameState;
  readonly photoActive: boolean;
  readonly introActive: boolean;
  setSpeed(s: Speed): void;
  addFrameHook(fn: (now: number) => void): () => void;
}

/** Atlas glyph for each faction's chip. */
export const FACTION_ICON: Record<FactionId, string> = {
  workers: 'tools',
  oldmoney: 'top_hat',
  reformers: 'park',
  church: 'church',
  baron: 'crown',
};

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`.replace('-', '−'));

function oldest(pending: CardInstance[]): CardInstance | undefined {
  let best: CardInstance | undefined;
  for (const p of pending) {
    if (!CARDS_BY_ID[p.cardId]) continue;
    if (!best || p.openedDay < best.openedDay || (p.openedDay === best.openedDay && p.uid < best.uid)) best = p;
  }
  return best;
}

function chip(state: GameState, e: CardEffect, cityName: string | null): HTMLElement {
  const year = state.date.year;
  const where = e.scope === 'national' ? 'all towns' : (cityName ?? 'here');
  const el = h('span', { class: `card-chip ${e.delta >= 0 ? 'card-up' : 'card-down'}`, title: `${factionName(e.faction, year)} opinion ${signed(e.delta)} in ${where}` },
    iconEl(FACTION_ICON[e.faction], 14),
    h('span', { class: 'card-chip-name' }, factionName(e.faction, year)),
    h('b', { class: 'card-chip-delta' }, signed(e.delta)),
    h('span', { class: 'card-chip-where' }, where));
  el.style.setProperty('--faction', FACTIONS[e.faction].color);
  return el;
}

function costEl(c: CardChoice): HTMLElement {
  if (c.cost === 0) return h('span', { class: 'card-cost card-free' }, 'No cost');
  const earns = c.cost < 0;
  return h('span', { class: `card-cost ${earns ? 'card-earn' : 'card-spend'}` },
    iconEl('money', 14),
    earns ? `+${formatMoney(-c.cost)}` : formatMoney(c.cost));
}

/**
 * Watches `state.politics.cards.pending` every frame and shows the oldest card when nothing else
 * holds the screen. Returns a detach function (removes the modal, frame hook and key listener).
 */
export function attachCardModal(host: CardHost): () => void {
  let root: HTMLElement | null = null;
  let openUid: number | null = null;
  /** speed to restore once the last card is answered; null while no card has been shown */
  let resume: Speed | null = null;

  const onKey = (e: KeyboardEvent) => {
    if (!root) return;
    // a card must be answered: Esc never closes it, and no game hotkey (pause menu, speed, tools,
    // photo mode) fires underneath; Tab/Enter/Space still work on the card's own buttons
    if (e.key === 'Escape') e.preventDefault();
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);

  const close = () => {
    root?.remove();
    root = null;
    openUid = null;
  };

  const finish = () => {
    close();
    if (resume !== null && resume > 0) host.setSpeed(resume);
    resume = null;
  };

  const blocked = () =>
    host.introActive || host.photoActive || document.querySelector('.mn-modal') !== null;

  function render(inst: CardInstance): void {
    const { state } = host;
    const card = CARDS_BY_ID[inst.cardId];
    const text = cardText(state, inst);
    const city = state.cities.find((c) => c.id === inst.cityId);
    const choices = card.choices.map((c, i) => {
      const ok = canAffordChoice(state, c);
      const chips = c.effects.map((e) => chip(state, e, city?.name ?? null));
      return h('button', {
        class: `card-choice${ok ? '' : ' card-blocked'}`,
        type: 'button',
        disabled: !ok,
        onClick: () => choose(inst.uid, i),
      },
      h('span', { class: 'card-choice-head' },
        h('span', { class: 'card-choice-label' }, c.label),
        costEl(c)),
      chips.length > 0 || c.note ? h('span', { class: 'card-effects' }, ...chips, c.note ? h('span', { class: 'card-note' }, c.note) : null) : null,
      ok ? null : h('span', { class: 'card-reason' }, 'Not enough money'));
    });
    const clipping = h('article', { class: 'card-clipping', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'card-title', tabindex: '-1' },
      h('div', { class: 'card-masthead' },
        h('span', null, 'The Daily Smokestack'),
        h('span', null, formatDate(state.date))),
      h('h2', { class: 'card-title', id: 'card-title' }, text.title),
      h('p', { class: 'card-body' }, text.body),
      h('div', { class: 'card-rule' }, 'Your answer'),
      h('div', { class: 'card-choices' }, ...choices));
    const next = h('div', { class: 'card-modal' }, h('div', { class: 'card-backdrop' }), h('div', { class: 'card-shadow' }, clipping));
    if (root) root.replaceWith(next);
    // on body like the pause menu, above every window (their z-index climbs with each raise)
    else document.body.appendChild(next);
    root = next;
    openUid = inst.uid;
    clipping.focus({ preventScroll: true });
  }

  function choose(uid: number, i: number): void {
    const r = resolveCard(host.ctx, uid, i);
    if (!r.ok) {
      host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      const inst = host.state.politics.cards.pending.find((p) => p.uid === uid);
      if (inst) render(inst);
      return;
    }
    const nextCard = oldest(host.state.politics.cards.pending);
    if (nextCard) render(nextCard);
    else finish();
  }

  const offFrame = host.addFrameHook(() => {
    const { state } = host;
    const nextCard = oldest(state.politics.cards.pending);
    if (root) {
      // the card was answered elsewhere (or the state replaced): move on
      if (!nextCard) return finish();
      if (nextCard.uid !== openUid) render(nextCard);
      if (state.speed !== 0) {
        resume = state.speed;
        host.setSpeed(0);
      }
      return;
    }
    if (!nextCard || blocked()) return;
    resume = state.speed;
    host.setSpeed(0);
    render(nextCard);
  });

  return () => {
    offFrame();
    window.removeEventListener('keydown', onKey, true);
    close();
  };
}
