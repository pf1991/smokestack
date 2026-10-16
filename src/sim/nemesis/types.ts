/**
 * Phase 4 nemesis types: the Baron as a person (head, traits), the grudges he keeps against the
 * player, and his retaliation bookkeeping. Plain JSON stored on `GameState.nemesis`.
 */
import type { FactionId } from '../../data/factions';
import type { GoodId } from '../types';
import { pick, type RngHolder } from '../rng';

export const BARON_TRAIT_IDS = ['greedy', 'vindictive', 'showman', 'cunning'] as const;
export type BaronTrait = (typeof BARON_TRAIT_IDS)[number];

export type GrudgeKind = 'undercut' | 'contract' | 'shares' | 'city' | 'sabotage_exposed' | 'takeover_bid';

export interface Grudge {
  kind: GrudgeKind;
  weight: number;
  year: number;
  cityId: number | null;
}

export interface BaronHead {
  name: string;
  born: number;
  generation: 1 | 2;
}

export const RETALIATION_KINDS = ['price_war', 'poach', 'fund_opponent', 'smear', 'sabotage', 'hostile_bid'] as const;
export type RetaliationKind = (typeof RETALIATION_KINDS)[number];

/** A live timed retaliation (Task 2); `untilDay` is a dateToDays() number. */
export type RetaliationEffect =
  | { kind: 'price_war'; cityId: number; goodId: GoodId; untilDay: number }
  | { kind: 'fund_opponent'; cityId: number; faction: FactionId; untilDay: number };

/** Bookkeeping for grudge causes detected from state diffs (nemesis/grudges.ts). */
export interface NemesisTrack {
  /** ids of finished contracts already looked at (capped at CONTRACTS_SEEN_CAP) */
  contractsSeen: number[];
  /** per city id: the year of the last `city` grudge there (at most one per town per year) */
  cityYear: Record<string, number>;
}

export interface NemesisState {
  head: BaronHead;
  /** 2 at start; Junior adds one (Task 4) */
  traits: BaronTrait[];
  /** capped at GRUDGE_CAP, lightest dropped first; written only by nemesis/grudges.ts */
  grudges: Grudge[];
  lastAction: { kind: RetaliationKind; year: number; month: number } | null;
  actionsThisYear: number;
  /** live timed effects (Task 2) */
  effects: RetaliationEffect[];
  succession: { done: boolean; year: number | null };
  track: NemesisTrack;
}

/** the longest seen-contract list the Baron keeps */
export const CONTRACTS_SEEN_CAP = 50;

export const FOUNDER: Readonly<BaronHead> = { name: 'Baron Cornelius Smogsworth', born: 1852, generation: 1 };

/** Rolls two distinct traits with `rng` (two draws). */
export function rollTraits(rng: RngHolder): BaronTrait[] {
  const first = pick(rng, BARON_TRAIT_IDS);
  const second = pick(rng, BARON_TRAIT_IDS.filter((t) => t !== first));
  return [first, second];
}

/** The founding Baron with freshly rolled traits and a clean slate (a new game or a migrated save). */
export function newNemesis(rng: RngHolder, contractsSeen: number[] = []): NemesisState {
  return {
    head: { ...FOUNDER },
    traits: rollTraits(rng),
    grudges: [],
    lastAction: null,
    actionsThisYear: 0,
    effects: [],
    succession: { done: false, year: null },
    track: { contractsSeen: contractsSeen.slice(-CONTRACTS_SEEN_CAP), cityYear: {} },
  };
}
