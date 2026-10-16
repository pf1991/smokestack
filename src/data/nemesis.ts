/**
 * Phase 4 nemesis content: the Baron's character traits (which retaliations each favours) and how
 * heavily each grievance weighs on him. See sim/nemesis.
 */
import type { BaronTrait, GrudgeKind, RetaliationKind } from '../sim/nemesis/types';

export interface BaronTraitDef {
  label: string;
  blurb: string;
  /** relative weights (1..3) of the retaliations this trait favours (Task 2 sums them over his traits) */
  actionWeights: Partial<Record<RetaliationKind, number>>;
}

export const BARON_TRAITS: Record<BaronTrait, BaronTraitDef> = {
  greedy: {
    label: 'Greedy',
    blurb: 'Counts every dollar you take from him, and answers with cheaper goods and bigger cheques.',
    actionWeights: { price_war: 3, hostile_bid: 3, poach: 1 },
  },
  vindictive: {
    label: 'Vindictive',
    blurb: 'Never forgets a slight. Expect fires in the night and whispers in the papers.',
    actionWeights: { sabotage: 3, smear: 3, price_war: 1 },
  },
  showman: {
    label: 'Showman',
    blurb: 'Fights in public: speeches, newspaper campaigns and candidates of his own.',
    actionWeights: { smear: 3, fund_opponent: 3, price_war: 1 },
  },
  cunning: {
    label: 'Cunning',
    blurb: 'Works behind the curtain, buying your foremen, your councillors and your shares.',
    actionWeights: { poach: 3, fund_opponent: 2, hostile_bid: 2 },
  },
};

/** The weight a fresh grudge of each kind carries (before any scale). */
export const GRUDGE_WEIGHTS: Record<GrudgeKind, number> = {
  undercut: 2,
  contract: 3,
  shares: 4,
  city: 5,
  sabotage_exposed: 6,
  takeover_bid: 8,
};
