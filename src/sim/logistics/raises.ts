import { triggerCard } from '../politics/cards';
import { chance } from '../rng';
import type { SimContext } from '../types';
import { RAISE_CHANCE, raiseCandidate } from './managers';

/**
 * December: if no request is open, the player's longest-waiting manager (4 years or more) asks for a
 * raise with chance 0.3 and the `manager_raise` card opens. Kept apart from managers.ts because the
 * card file imports managers.ts and this one imports the card engine.
 */
export function raiseYear(ctx: SimContext): void {
  const { state } = ctx;
  const L = state.logistics;
  if (L.managers.length === 0) {
    L.raiseAsk = null;
    return;
  }
  // a request whose card has gone (answered elsewhere, withdrawn) no longer blocks the next one
  if (L.raiseAsk !== null && !state.politics.cards.pending.some((p) => p.cardId === 'manager_raise')) L.raiseAsk = null;
  if (L.raiseAsk !== null) return;
  const m = raiseCandidate(state);
  if (!m || !chance(state, RAISE_CHANCE)) return;
  L.raiseAsk = m.id;
  triggerCard(ctx, 'manager', null);
  if (!state.politics.cards.pending.some((p) => p.cardId === 'manager_raise')) L.raiseAsk = null;
}
