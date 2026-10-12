/**
 * Shared Phase 2 politics types (ruling R-Q1). Later politics tasks import these rather than
 * redefining them. Everything here is plain JSON stored on `GameState.politics`.
 */
import type { FactionId } from '../../data/factions';
import type { GameDate } from '../types';

export type { FactionId };

export type WageLevel = 'low' | 'fair' | 'generous';
export type SafetyLevel = 'minimal' | 'standard' | 'high';
export type UnionStance = 'crush' | 'tolerate' | 'recognise';

export interface CompanyEdicts {
  wage: WageLevel;
  safety: SafetyLevel;
  union: UnionStance;
}

export interface CardInstance {
  uid: number;
  cardId: string;
  cityId: number | null;
  openedDay: number;
}

export interface CardState {
  pending: CardInstance[];
  history: { id: string; year: number }[];
}

export type MayorEdictId = 'permits_required' | 'smog_limit' | 'truck_tolls' | 'minimum_wage' | 'tax_break';

/** One opinion change, as `adjustOpinion` records it. `scope` is a city id or 'national'. */
export interface PoliticsLogEntry {
  date: GameDate;
  faction: FactionId;
  scope: number | 'national';
  delta: number;
  reason: string;
}

/**
 * Bookkeeping for opinion drivers derived from state diffs (ruling R-Q3), refreshed by factionsMonth.
 * `primed` false means the next factionsMonth only takes a snapshot (a migrated save), so buildings
 * that already existed never count as newly placed.
 *
 * Accepted limits of diffing once a month (R-Q3):
 * - reactions land at the month's end, up to a month after the cause;
 * - a building placed and demolished within the same month is never seen;
 * - a removal counts in the towns the building was near at the last month, a placement in the towns
 *   it is near now; a building near two towns counts in both;
 * - an ownership change is neither a placement nor a removal (ids are tracked whatever the owner);
 * - a town that grows over an existing building, or shrinks away from one, does not react;
 * - a finished contract trimmed from `state.contracts` before the month ends (more than
 *   MAX_FINISHED finish in one month) is missed;
 * - sales compare the player's and the Baron's retail revenue only; other companies are ignored.
 */
export interface PoliticsTrack {
  primed: boolean;
  /** every building id, whatever its owner, at the last factionsMonth */
  buildings: number[];
  /** per city id: ids of player buildings that employ workers, within urbanRadius + 4, at the last factionsMonth */
  near: Record<string, number[]>;
  /** ids of finished (done/failed) contracts already counted */
  contractsSeen: number[];
  /** per city id: this month's retail revenue of the player and the Baron (reset monthly) */
  sales: Record<string, { player: number; baron: number }>;
}

/** National opinion of every faction, sampled once a year (at year end) for the politics window's trends. */
export interface OpinionSample {
  year: number;
  national: Record<FactionId, number>;
}

export interface PoliticsState {
  edicts: CompanyEdicts;
  cards: CardState;
  nextCardYear: number;
  log: PoliticsLogEntry[];
  track: PoliticsTrack;
  /** one OpinionSample per ended year, oldest first (capped at HISTORY_CAP) */
  history: OpinionSample[];
}

/** Empty politics for a new game (primed: nothing exists yet) or a migrated save (primed false). */
export function defaultPolitics(primed = true): PoliticsState {
  return {
    edicts: { wage: 'fair', safety: 'standard', union: 'tolerate' },
    cards: { pending: [], history: [] },
    nextCardYear: 1901,
    log: [],
    track: { primed, buildings: [], near: {}, contractsSeen: [], sales: {} },
    history: [],
  };
}
