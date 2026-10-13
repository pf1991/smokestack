/** Price index (Phase 3 Task 8 fills `state.economy`; until then every price is 1900's). */
import type { GameState } from '../types';

export function priceIndex(state: GameState): number {
  return (state as GameState & { economy?: { priceIndex?: number } }).economy?.priceIndex ?? 1;
}
