import type { GameState, OwnerId } from '../types';

/** Leaf helpers that let a manager's post or employment end when what it hangs on goes (no sim imports). */

/** The building `id` is gone or gives up its manager: the post clears at once (the manager stays on the payroll). */
export function releaseBuilding(state: GameState, id: number): void {
  const L = state.logistics;
  for (const m of L.managers) {
    if (m.post !== id) continue;
    m.post = null;
    L.rev++;
  }
}

/** A closing firm's managers leave the game with it. */
export function releaseCompany(state: GameState, owner: OwnerId): void {
  const L = state.logistics;
  if (!L.managers.some((m) => m.employer === owner)) return;
  L.managers = L.managers.filter((m) => m.employer !== owner);
  L.rev++;
}
