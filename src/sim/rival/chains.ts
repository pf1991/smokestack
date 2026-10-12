import { BUILDINGS } from '../../data/buildings';
import { RECIPES } from '../../data/recipes';
import type { BuildingTypeId, GameState, GoodId } from '../types';

export interface ChainNode {
  typeId: BuildingTypeId;
  recipeId: string;
  /** the good this node supplies to its consumers */
  good: GoodId;
}

export interface ChainEdge {
  /** node index; producer */
  from: number;
  /** node index of the consumer, or -1 for the store */
  to: number;
  good: GoodId;
}

export interface ChainPlan {
  /** post-order: every producer comes before its consumers; the last node makes the target good */
  nodes: ChainNode[];
  edges: ChainEdge[];
}

function firstRecipeFor(goodId: GoodId, state: GameState): { recipeId: string; typeId: BuildingTypeId } | null {
  for (const r of Object.values(RECIPES)) {
    if (r.outputs[goodId] === undefined || !state.unlocked.includes(r.id)) continue;
    const def = Object.values(BUILDINGS).find((d) => d.recipes.includes(r.id) && state.unlocked.includes(d.id));
    if (def) return { recipeId: r.id, typeId: def.id };
  }
  return null;
}

export function planChain(goodId: GoodId, state: GameState): ChainPlan | null {
  const nodes: ChainNode[] = [];
  const edges: ChainEdge[] = [];
  const byGood = new Map<GoodId, number>();
  const visit = (g: GoodId, depth: number): number | null => {
    const known = byGood.get(g);
    if (known !== undefined) return known;
    if (depth > 6) return null;
    const rec = firstRecipeFor(g, state);
    if (!rec) return null;
    const inputs: [number, GoodId][] = [];
    for (const input of Object.keys(RECIPES[rec.recipeId].inputs)) {
      const idx = visit(input, depth + 1);
      if (idx === null) return null;
      inputs.push([idx, input]);
    }
    const idx = nodes.length;
    nodes.push({ typeId: rec.typeId, recipeId: rec.recipeId, good: g });
    byGood.set(g, idx);
    for (const [from, good] of inputs) edges.push({ from, to: idx, good });
    return idx;
  };
  const last = visit(goodId, 0);
  if (last === null) return null;
  edges.push({ from: last, to: -1, good: goodId });
  return { nodes, edges };
}

/**
 * The backward chain from extractor(s) to the final factory, using the first unlocked recipe for
 * every good; [] when the good cannot be made yet. `furniture` → lumber_camp, sawmill, furniture_factory.
 */
export function chainFor(goodId: GoodId, state: GameState): BuildingTypeId[] {
  return planChain(goodId, state)?.nodes.map((n) => n.typeId) ?? [];
}

