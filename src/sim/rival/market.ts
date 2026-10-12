import { BUILDINGS } from '../../data/buildings';
import { DEMAND_PER_1000, GOODS } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import { loadSource } from '../inventory';
import { monthlyDemand, salePrice, supplyRatio } from '../market';
import { demandModifier } from '../production';
import type { Building, City, GameState, GoodId } from '../types';
import { TRUCK } from '../vehicles';
import { planChain } from './chains';
import type { ChainPlan } from './chains';
import { F_BLOCKED, RIVAL_RESERVE } from './shared';

/** rough allowance for access roads when judging whether a project is affordable */
const ROAD_BUDGET = 10000;

const tier2Goods = (state: GameState): GoodId[] =>
  Object.keys(DEMAND_PER_1000).filter((g) => GOODS[g]?.tier === 2 && state.unlocked.includes(g));

/** Hops followed back through stations/warehouses when tracing where a good comes from. */
const SUPPLY_DEPTH = 3;

/**
 * Monthly output of `goodId` that reaches `b`'s loading bay: its own recipe output, or, for a
 * station or warehouse, whatever the rival's routes unload there, traced back (≤ SUPPLY_DEPTH hops)
 * to the producing buildings. `seen` keeps every producer counted once.
 */
function sourceRate(state: GameState, b: Building | undefined, goodId: GoodId, depth: number, seen: Set<number>): number {
  if (!b || seen.has(b.id)) return 0;
  seen.add(b.id);
  const rec = b.recipeId ? RECIPES[b.recipeId] : undefined;
  if (rec?.outputs[goodId]) return (rec.outputs[goodId] / rec.days) * 30;
  if (BUILDINGS[b.typeId]?.category !== 'logistics' || depth <= 0) return 0;
  let total = 0;
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'rival' || !r.stops.some((s) => s.buildingId === b.id && s.unload.includes(goodId))) continue;
    for (const s of r.stops) {
      if (s.load.includes(goodId)) total += sourceRate(state, state.buildings[s.buildingId], goodId, depth - 1, seen);
    }
  }
  return total;
}

/**
 * Monthly output the rival already delivers of `goodId` into `cityId` (by its routes' sources,
 * followed back through railway stations to the factories feeding them).
 */
export function rivalSupply(state: GameState, cityId: number, goodId: GoodId): number {
  let total = 0;
  const seen = new Set<number>();
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'rival') continue;
    const intoCity = r.stops.some((s) => s.unload.includes(goodId) && state.buildings[s.buildingId]?.cityId === cityId);
    if (!intoCity) continue;
    for (const s of r.stops) {
      if (s.load.includes(goodId)) total += sourceRate(state, state.buildings[s.buildingId], goodId, SUPPLY_DEPTH, seen);
    }
  }
  return total;
}

function playerSells(state: GameState, cityId: number, goodId: GoodId): boolean {
  for (const r of Object.values(state.routes)) {
    if (r.ownerId !== 'player') continue;
    if (r.stops.some((s) => s.unload.includes(goodId) && state.buildings[s.buildingId]?.cityId === cityId)) return true;
  }
  return Object.values(state.buildings).some(
    (b) => b.ownerId === 'player' && b.cityId === cityId && (loadSource(b)[goodId] ?? 0) > 0,
  );
}

export function rivalStoreIn(state: GameState, cityId: number): Building | undefined {
  return Object.values(state.buildings).find(
    (b) => b.ownerId === 'rival' && b.cityId === cityId && BUILDINGS[b.typeId].category === 'retail',
  );
}

function blocked(state: GameState): string[] {
  const v = state.flags[F_BLOCKED];
  return typeof v === 'string' && v ? v.split(',') : [];
}

export function block(state: GameState, key: string): void {
  const list = blocked(state);
  if (!list.includes(key)) list.push(key);
  state.flags[F_BLOCKED] = list.join(',');
}

interface Candidate {
  city: City;
  goodId: GoodId;
  score: number;
  playerThere: boolean;
}

/** The best (city, good) the rival can afford while keeping its reserve, or null. */
export function chooseProject(state: GameState): Candidate | null {
  const money = state.companies.rival.money;
  const blockedKeys = blocked(state);
  const plans = new Map<GoodId, { plan: ChainPlan; cost: number; upkeep: number; capacity: number }>();
  for (const g of tier2Goods(state)) {
    const plan = planChain(g, state);
    if (!plan) continue;
    const cost = plan.nodes.reduce((s, n) => s + BUILDINGS[n.typeId].cost, 0) + plan.edges.length * TRUCK.cost + ROAD_BUDGET;
    const last = RECIPES[plan.nodes[plan.nodes.length - 1].recipeId];
    const upkeep =
      plan.nodes.reduce((s, n) => s + BUILDINGS[n.typeId].maintenance, 0) + plan.edges.length * 2 * TRUCK.maintenance;
    plans.set(g, { plan, cost, upkeep, capacity: ((last.outputs[g] ?? 0) / last.days) * 30 });
  }
  const cands: Candidate[] = [];
  for (const city of state.cities) {
    if (blockedKeys.includes(`${city.id}:*`)) continue;
    const storeCost = rivalStoreIn(state, city.id) ? 0 : BUILDINGS.store.cost;
    for (const [goodId, { cost, upkeep, capacity }] of plans) {
      if (blockedKeys.includes(`${city.id}:${goodId}`)) continue;
      if (cost + storeCost > money - RIVAL_RESERVE) continue;
      const demand = monthlyDemand(city, goodId, state.date.year, demandModifier(state, city.id, goodId));
      const unmet = demand - rivalSupply(state, city.id, goodId);
      if (unmet <= 0) continue;
      const price = salePrice(goodId, supplyRatio(city.market[goodId]));
      // a new chain can only serve as much of the gap as it produces, and must pay its own upkeep
      const score = Math.min(unmet, capacity) * price - upkeep;
      if (score <= 0) continue;
      cands.push({ city, goodId, score, playerThere: playerSells(state, city.id, goodId) });
    }
  }
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.playerThere) - Number(b.playerThere) ||
      a.city.id - b.city.id ||
      (a.goodId < b.goodId ? -1 : a.goodId > b.goodId ? 1 : 0),
  );
  return cands[0] ?? null;
}

