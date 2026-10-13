/**
 * Leaf helpers for the smoke laws (no card imports, so card tables can use them): compliance and
 * the lobbying delay. The monthly step lives in ./regulation.ts.
 */
import { BUILDINGS } from '../../data/buildings';
import { LAWS, LAW_IDS, LOBBY_DELAY_MONTHS, type LawId } from '../../data/laws';
import { PLAYER_ID } from '../companies';
import type { Building, GameState } from '../types';

/** Scrubber tier fitted to a works (sim/society/upgrades.ts); 0 when none. */
export function scrubberTier(b: Building): number {
  return b.upgrades?.scrubber ?? 0;
}

/** Player polluters below the law's scrubber tier. */
export function nonCompliant(state: GameState, id: LawId): Building[] {
  const tier = LAWS[id].tier;
  return Object.values(state.buildings).filter(
    (b) => b.ownerId === PLAYER_ID && BUILDINGS[b.typeId]?.pollution > 0 && scrubberTier(b) < tier,
  );
}

/** Lobbying for delay: pushes enforcement back LOBBY_DELAY_MONTHS, once per law. False when refused. */
export function lobbyForDelay(state: GameState, id: LawId): boolean {
  const law = state.society.laws[id];
  if (law.lobbied || law.enforcedFrom === null) return false;
  law.lobbied = true;
  law.enforcedFrom += LOBBY_DELAY_MONTHS;
  return true;
}

/** Laws in force (passed and past their enforcement month) at month index `now`. */
export function enforcedLaws(state: GameState, now: number): LawId[] {
  return LAW_IDS.filter((id) => {
    const f = state.society.laws[id].enforcedFrom;
    return f !== null && now >= f;
  });
}
