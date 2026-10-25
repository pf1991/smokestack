/**
 * Compact chain health: Inputs (starved), Works (idle), Shelves (empty stores).
 * Pure read of player buildings; reasons mirror game/alerts.ts building rules.
 */
import { BUILDINGS } from '../data/buildings';
import { storeStocked } from '../sim/inventory';
import type { GameState } from '../sim/types';

export type ChainSegmentId = 'inputs' | 'works' | 'shelves';

export interface ChainSegmentScore {
  /** Player buildings in this bucket. */
  total: number;
  /** Broken ones (starved / idle / empty shelves). */
  broken: number;
  /** Lowest-id broken building to jump to, or null when healthy. */
  jumpId: number | null;
}

export interface ChainHealth {
  inputs: ChainSegmentScore;
  works: ChainSegmentScore;
  shelves: ChainSegmentScore;
}

function empty(): ChainSegmentScore {
  return { total: 0, broken: 0, jumpId: null };
}

function noteBroken(seg: ChainSegmentScore, id: number): void {
  seg.broken++;
  if (seg.jumpId === null || id < seg.jumpId) seg.jumpId = id;
}

/** Scores the player's production → retail chain for the HUD strip. */
export function chainHealth(state: GameState): ChainHealth {
  const inputs = empty();
  const works = empty();
  const shelves = empty();

  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'player') continue;
    const category = BUILDINGS[b.typeId]?.category;
    if (category === 'extractor' || category === 'factory') {
      inputs.total++;
      works.total++;
      if (b.status === 'no_input') noteBroken(inputs, b.id);
      if (b.status === 'idle') noteBroken(works, b.id);
    } else if (category === 'retail') {
      shelves.total++;
      const shut = b.status === 'upgrading' || b.status === 'halted';
      if (!shut && !storeStocked(b)) noteBroken(shelves, b.id);
    }
  }

  return { inputs, works, shelves };
}

/** Pill tone for a segment: empty chain is neutral. */
export function segmentTone(seg: ChainSegmentScore): 'neutral' | 'positive' | 'warning' | 'negative' {
  if (seg.total === 0) return 'neutral';
  if (seg.broken === 0) return 'positive';
  if (seg.broken >= seg.total) return 'negative';
  return 'warning';
}

export const CHAIN_SEGMENTS: { id: ChainSegmentId; label: string; short: string }[] = [
  { id: 'inputs', label: 'Inputs', short: 'In' },
  { id: 'works', label: 'Works', short: 'Wk' },
  { id: 'shelves', label: 'Shelves', short: 'Sh' },
];
