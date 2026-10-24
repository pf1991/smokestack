import type { BuildingTypeId, GoodId, Inventory } from '../sim/types';
import { BUILDINGS } from './buildings';
import { RECIPES } from './recipes';

/**
 * Production chains, read straight off BUILDINGS x RECIPES: a good added to the catalogue (with a
 * recipe and a building that runs it) shows up here with no code changes.
 */

/** The slice of the catalogue the chain helpers read (tests pass a synthetic one). */
export interface ChainCatalog {
  buildings: Record<string, { recipes: string[] }>;
  recipes: Record<string, { inputs: Inventory; outputs: Inventory }>;
}

const CATALOG: ChainCatalog = { buildings: BUILDINGS, recipes: RECIPES };

export interface ChainVia {
  building: BuildingTypeId;
  recipe: string;
}

export interface ChainNode {
  good: GoodId;
  /** the first producer's building and recipe; null when nothing makes the good */
  via: ChainVia | null;
  inputs: ChainNode[];
}

/** Every building and recipe whose outputs include `good`, in catalogue order. */
export function producersOf(good: GoodId, cat: ChainCatalog = CATALOG): ChainVia[] {
  const out: ChainVia[] = [];
  for (const [building, def] of Object.entries(cat.buildings)) {
    for (const recipe of def.recipes) {
      if ((cat.recipes[recipe]?.outputs[good] ?? 0) > 0) out.push({ building, recipe });
    }
  }
  return out;
}

/** Every building and recipe that takes `good` in, with the recipe's (first) output. */
export function consumersOf(good: GoodId, cat: ChainCatalog = CATALOG): (ChainVia & { output: GoodId })[] {
  const out: (ChainVia & { output: GoodId })[] = [];
  for (const [building, def] of Object.entries(cat.buildings)) {
    for (const recipe of def.recipes) {
      const r = cat.recipes[recipe];
      if (!r || !((r.inputs[good] ?? 0) > 0)) continue;
      for (const output of Object.keys(r.outputs)) out.push({ building, recipe, output });
    }
  }
  return out;
}

/**
 * The recipe tree above `good`: the first producer's recipe, then each input's tree, `depth` levels
 * deep. Raw goods (no-input recipes) have no inputs; a good already on the path is not expanded again.
 */
export function upstreamTree(good: GoodId, depth = 4, cat: ChainCatalog = CATALOG): ChainNode {
  const walk = (g: GoodId, left: number, path: ReadonlySet<GoodId>): ChainNode => {
    const via = producersOf(g, cat)[0] ?? null;
    if (!via || left <= 0 || path.has(g)) return { good: g, via, inputs: [] };
    const next = new Set(path).add(g);
    const ins = Object.keys(cat.recipes[via.recipe]?.inputs ?? {});
    return { good: g, via, inputs: ins.map((i) => walk(i, left - 1, next)) };
  };
  return walk(good, depth, new Set());
}
