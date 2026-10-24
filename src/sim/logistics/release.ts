import type { GameState, OwnerId } from '../types';
import { fleetChanged } from './jobRoute';

/** Leaf helpers that let a manager's post or employment end when what it hangs on goes (no sim imports but the leaf jobRoute.ts). */

/** The building `id` is gone or gives up its manager: the post clears at once (the manager stays on the payroll). */
export function releaseBuilding(state: GameState, id: number): void {
  const L = state.logistics;
  for (const m of L.managers) {
    if (m.post !== id) continue;
    m.post = null;
    L.rev++;
  }
  if (state.buildings[id]?.hub) releaseHubTrucks(state, id);
}

/**
 * A hub warehouse goes: its trucks are released idle where they stand (D11), never deleted, and keep
 * any cargo aboard; the player can reassign or sell them.
 */
function releaseHubTrucks(state: GameState, hubId: number): void {
  for (const v of Object.values(state.vehicles)) {
    if (v.hubId !== hubId) continue;
    v.hubId = null;
    v.job = null;
    v.state = 'idle';
    v.path = [];
    v.pathIndex = 0;
    v.waitTicks = 0;
    v.stuckNotified = false;
    fleetChanged();
  }
}

/** A closing firm's managers leave the game with it. */
export function releaseCompany(state: GameState, owner: OwnerId): void {
  const L = state.logistics;
  if (!L.managers.some((m) => m.employer === owner)) return;
  for (const m of L.managers) if (m.employer === owner) clearRaise(state, m.id);
  L.managers = L.managers.filter((m) => m.employer !== owner);
  L.rev++;
}

/** Id of the raise card (data/cards/triggered.ts); pinned by a test, since this leaf cannot import the card file. */
export const RAISE_CARD_ID = 'manager_raise';

/**
 * Withdraws the open raise request: `raiseAsk` clears and any pending raise card is spliced out in place
 * (as demolishBuilding does for strike cards), so a card never outlives its manager. With `managerId`, only
 * when that manager is the one asking.
 */
export function clearRaise(state: GameState, managerId?: number): void {
  const L = state.logistics;
  if (managerId !== undefined && L.raiseAsk !== managerId) return;
  L.raiseAsk = null;
  const pending = state.politics.cards.pending;
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i].cardId === RAISE_CARD_ID) pending.splice(i, 1);
}
