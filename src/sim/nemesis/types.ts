/**
 * Phase 4 nemesis types: the Baron as a person (head, traits), the grudges he keeps against the
 * player, and his retaliation bookkeeping. Plain JSON stored on `GameState.nemesis`.
 */
import type { FactionId } from '../../data/factions';
import type { GoodId } from '../types';
import { pick, type RngHolder } from '../rng';

export const BARON_TRAIT_IDS = ['greedy', 'vindictive', 'showman', 'cunning'] as const;
export type BaronTrait = (typeof BARON_TRAIT_IDS)[number];

export type GrudgeKind = 'undercut' | 'contract' | 'shares' | 'city' | 'sabotage_exposed' | 'takeover_bid' | 'rivalry' | 'wake';

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

/** How the Baron looks in his portrait (render/portrait.ts); see baronMood in nemesis/grudges.ts. */
export const BARON_MOODS = ['smug', 'furious', 'scheming', 'gloating'] as const;
export type BaronMood = (typeof BARON_MOODS)[number];

/**
 * the grudge weight below which the Baron never strikes. Lives here (a leaf module) so grudges.ts can
 * read it without importing retaliation.ts; retaliation.ts re-exports it.
 */
export const RETALIATE_AT = 6;

/** the tag on the news item each retaliation prints (NewsItem.tag), which the rival panel lists */
export const NEMESIS_NEWS_TAG = 'nemesis';

export const RETALIATION_KINDS = ['price_war', 'poach', 'fund_opponent', 'smear', 'sabotage', 'hostile_bid', 'poach_manager'] as const;
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
  /** `<cityId>:<goodId>` pairs both the player and the Baron sold last month (price war targets), in city then catalog order */
  contested: string[];
  /** per city id: the month index (year * 12 + month - 1) of the Baron's last poach there */
  poached: Record<string, number>;
  /**
   * the Baron's shares the player bought since the last nemesisMonth (exchange/trading.ts buyShares,
   * through grudges.ts noteShareBuy): one 'shares' grudge per month for the lot, so splitting a buy
   * evades nothing. Absent in older saves (read as 0).
   */
  sharesBought?: number;
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
  /** no sabotage before this dateToDays() day (set when one is exposed; 0 = none) */
  sabotageBanUntil: number;
  succession: { done: boolean; year: number | null };
  track: NemesisTrack;
  /**
   * The Baron's open hostile bid (Task 8): he holds a majority of the player's shares since month
   * index `since` (politics/elections.ts monthIndex); unless bought back below it, the game ends at the
   * end of month `deadline`. Null when none is open. Written only by nemesis/bid.ts.
   */
  bid: { since: number; deadline: number } | null;
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
    sabotageBanUntil: 0,
    succession: { done: false, year: null },
    track: { contractsSeen: contractsSeen.slice(-CONTRACTS_SEEN_CAP), cityYear: {}, contested: [], poached: {} },
    bid: null,
  };
}
