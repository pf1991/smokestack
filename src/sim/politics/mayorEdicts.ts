/**
 * Mayor edicts and faction levers (Phase 2 Task 6).
 *
 * Each town's mayor issues edicts by faction (`chooseMayorEdicts`, after every election and on
 * migration). They, and the faction levers below, bind the PLAYER only: the Baron calls the same
 * placement and upkeep functions and is untouched in this phase.
 *
 * "The town of a site" (`siteCity`) is the nearest town whose urbanRadius + NEAR_MARGIN covers the
 * footprint centre: permits, land price, community objections and the tax break use it. Sites
 * outside every such zone are rural: no permit and base price, so the player can always build
 * somewhere (no soft-lock). Retail and logistics never need a permit. Minimum wage and truck tolls
 * go by the town a building hires from (`workCity`).
 */
import { BUILDINGS } from '../../data/buildings';
import { factionName } from '../../data/factions';
import { PLAYER_ID } from '../companies';
import { LOAN_RATE, spend } from '../finance';
import { buildingsNear } from '../spatial';
import type { Building, BuildingTypeId, City, GameState, OwnerId, SimContext, Vec2 } from '../types';
import { EDICTS, maintenanceFactor } from './edicts';
import { NEAR_MARGIN, nationalOpinion } from './factions';
import { forcedEdicts, SMOG_TIER_3 } from '../society/tiers';
import { buildingMaintenance } from '../society/upgrades';
import { atPrices } from '../society/economy';
import type { MayorEdictId } from './types';
import { workCity } from './workforce';

export type { MayorEdictId };

/** Permit fee, as a share of the building's base cost. */
export const PERMIT_FEE = 0.1;
/** Below this opinion of the mayor's faction, permits are refused outright. */
export const PERMIT_REFUSE_BELOW = 25;
/**
 * Smog limit: production factor of dirty works in the zone while the town's smog level
 * (`city.smog.level`, the 3-month average) is at or above SMOG_LIMIT_LEVEL, the tier-3 threshold
 * (ruling R-S5; Phase 2 used raw pollution > 0.4, which the Phase 3 smog scale never reaches).
 */
export const SMOG_LIMIT_FACTOR = 0.75;
export const SMOG_LIMIT_LEVEL = SMOG_TIER_3;
/** Monthly toll per player truck per toll town its route stops in. */
export const TRUCK_TOLL = 40;
/** Minimum wage: the floor on the wage edict's upkeep multiplier for player buildings hiring from that town. */
export const MINIMUM_WAGE_FACTOR = 1.1;
/** Tax break: discount on player factories' construction in that town. */
export const TAX_BREAK = 0.25;
/** Reformers demand permits in towns larger than this when their opinion is below REFORMER_PERMIT_BELOW. */
export const REFORMER_PERMIT_POP = 20000;
export const REFORMER_PERMIT_BELOW = 30;
/** Church below this opinion raises community objections: construction × CHURCH_OBJECTION. */
export const CHURCH_OBJECTION_BELOW = 25;
export const CHURCH_OBJECTION = 1.25;

export interface MayorEdictInfo {
  name: string;
  icon: string;
  /** one short line: what it does to the player */
  effect: string;
}

export const MAYOR_EDICTS: Record<MayorEdictId, MayorEdictInfo> = {
  permits_required: {
    name: 'Permits required',
    icon: 'permit',
    effect: `Extractors and factories near town pay a ${PERMIT_FEE * 100}% permit; refused if the mayor's faction is below ${PERMIT_REFUSE_BELOW}`,
  },
  smog_limit: {
    name: 'Smog limit',
    icon: 'smog',
    effect: `Dirty works near town run at ${SMOG_LIMIT_FACTOR * 100}% while smog is at or above ${SMOG_LIMIT_LEVEL * 100}%`,
  },
  truck_tolls: { name: 'Truck tolls', icon: 'toll', effect: `$${TRUCK_TOLL}/month per truck stopping in town` },
  minimum_wage: {
    name: 'Minimum wage',
    icon: 'wage',
    effect: `Wages for works hiring here cost at least ×${MINIMUM_WAGE_FACTOR} upkeep: low and fair wages pay ×${MINIMUM_WAGE_FACTOR}; generous wages already clear it, so nothing stacks`,
  },
  tax_break: { name: 'Tax break', icon: 'money', effect: `Factories in town cost ${TAX_BREAK * 100}% less to build` },
};

/** The edicts a mayor issues, by faction and that faction's opinion of the player (pure). */
export function chooseMayorEdicts(city: City): MayorEdictId[] {
  const faction = city.politics.mayor.faction;
  const op = city.opinion[faction];
  switch (faction) {
    case 'workers':
      return op < 35 ? ['minimum_wage', 'permits_required'] : ['minimum_wage'];
    case 'oldmoney':
      return op >= 50 ? ['tax_break'] : ['truck_tolls'];
    case 'reformers':
      return op < 40 ? ['smog_limit', 'permits_required'] : ['smog_limit'];
    case 'church':
      return op < 50 ? ['truck_tolls'] : [];
    case 'baron':
      return ['truck_tolls', 'permits_required'];
    default:
      return [];
  }
}

/** True when the Reformers force permits on this town whatever the mayor decreed. */
export function reformersDemandPermits(city: City): boolean {
  return city.population > REFORMER_PERMIT_POP && city.opinion.reformers < REFORMER_PERMIT_BELOW;
}

/**
 * The town's edicts in force: the mayor's (`politics.edicts`, as chooseMayorEdicts issued them),
 * plus permits the Reformers demand, plus the edicts a smog revolt (tier 4, society/tiers.ts)
 * forces. The forced ones are derived, never stored, so they lapse when the tier drops unless the
 * mayor's own edicts hold them. Every reader of a town's edicts goes through here.
 */
export function activeEdicts(city: City): MayorEdictId[] {
  const out = [...(city.politics.edicts ?? [])];
  if (reformersDemandPermits(city) && !out.includes('permits_required')) out.push('permits_required');
  for (const id of forcedEdicts(city)) if (!out.includes(id)) out.push(id);
  return out;
}

export function hasEdict(city: City, id: MayorEdictId): boolean {
  return activeEdicts(city).includes(id);
}

/** The player's loan rate: LOAN_RATE × (1.5 − national Old Money / 100), so 0.06 at 50 and 0.09 at 0. */
export function loanRate(state: GameState): number {
  return LOAN_RATE * (1.5 - nationalOpinion(state, 'oldmoney') / 100);
}

/** The rate `owner` pays on its loan: Old Money's for the player, LOAN_RATE for everyone else. */
export function companyLoanRate(state: GameState, owner: OwnerId): number {
  return owner === PLAYER_ID ? loanRate(state) : LOAN_RATE;
}

/** Old Money's land price in a town: 1 + (50 − opinion) / 200. */
export function landPriceFactor(city: City): number {
  return 1 + (50 - city.opinion.oldmoney) / 200;
}

/** Community objections: ×1.25 where the Church's opinion is below 25. */
export function churchFactor(city: City): number {
  return city.opinion.church < CHURCH_OBJECTION_BELOW ? CHURCH_OBJECTION : 1;
}

/** Every construction-cost multiplier the player meets in `city` for `typeId`. */
export function constructionFactor(city: City, typeId: BuildingTypeId): number {
  let f = landPriceFactor(city) * churchFactor(city);
  if (BUILDINGS[typeId]?.category === 'factory' && hasEdict(city, 'tax_break')) f *= 1 - TAX_BREAK;
  return f;
}

/** The nearest town whose urbanRadius + NEAR_MARGIN covers the centre of a `typeId` footprint at `pos`. */
export function siteCity(state: GameState, typeId: BuildingTypeId, pos: Vec2): City | null {
  const size = BUILDINGS[typeId]?.size ?? { w: 1, h: 1 };
  const cx = pos.x + size.w / 2;
  const cy = pos.y + size.h / 2;
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of state.cities) {
    const d = (c.center.x - cx) ** 2 + (c.center.y - cy) ** 2;
    const r = c.urbanRadius + NEAR_MARGIN;
    if (d > r * r) continue;
    if (d < bestD || (d === bestD && best !== null && c.id < best.id)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function permitRefusal(city: City, year: number): string {
  return `A permit was refused by the ${factionName(city.politics.mayor.faction, year)} mayor of ${city.name}. Raise their opinion to ${PERMIT_REFUSE_BELOW} or more, or build elsewhere.`;
}

export interface PlacementQuote {
  /** total charged, permit included */
  cost: number;
  /** the permit share of `cost` (0 without one) */
  permit: number;
  /** why the town refuses the placement, or null */
  refusal: string | null;
}

/**
 * What `owner` pays to build `typeId` at `pos`: the catalogue cost at today's prices (every company),
 * then the town's edicts and levers (player only).
 */
export function placementQuote(state: GameState, owner: OwnerId, typeId: BuildingTypeId, pos: Vec2): PlacementQuote {
  const def = BUILDINGS[typeId];
  const price = atPrices(state, def.cost);
  const base = { cost: Math.round(price), permit: 0, refusal: null };
  if (owner !== PLAYER_ID) return base;
  const city = siteCity(state, typeId, pos);
  if (!city) return base;
  const cost = Math.round(price * constructionFactor(city, typeId));
  const industry = def.category === 'extractor' || def.category === 'factory';
  if (!industry || !hasEdict(city, 'permits_required')) return { cost, permit: 0, refusal: null };
  if (city.opinion[city.politics.mayor.faction] < PERMIT_REFUSE_BELOW) {
    return { cost, permit: 0, refusal: permitRefusal(city, state.date.year) };
  }
  const permit = Math.round(price * PERMIT_FEE);
  return { cost: cost + permit, permit, refusal: null };
}

/** Ids of player works held to SMOG_LIMIT_FACTOR today: dirty, and near a smog-limit town at or above SMOG_LIMIT_LEVEL. */
export function smogLimited(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const city of state.cities) {
    if (!((city.smog?.level ?? 0) >= SMOG_LIMIT_LEVEL) || !hasEdict(city, 'smog_limit')) continue;
    for (const b of buildingsNear(state, city.center, city.urbanRadius + NEAR_MARGIN, PLAYER_ID)) {
      if (BUILDINGS[b.typeId].pollution > 0) out.add(b.id);
    }
  }
  return out;
}

/**
 * The player's monthly building upkeep: each building's maintenance (× its scrubber's upkeep,
 * society/upgrades.ts) × the company edicts. A
 * minimum-wage town is a floor on the wage part: there the wage multiplier is at least
 * MINIMUM_WAGE_FACTOR, so 'low' and 'fair' both pay ×1.1 and 'generous' (×1.25) pays its own rate,
 * nothing stacked. Safety and union multiply as usual.
 */
export function playerBuildingUpkeep(state: GameState): number {
  const edicts = state.politics.edicts;
  const normal = maintenanceFactor(edicts);
  // 'fair' wages cost ×1, so this is safety × union × max(wage, floor)
  const minWage = maintenanceFactor({ ...edicts, wage: 'fair' }) * Math.max(EDICTS.wage.options[edicts.wage]?.cost ?? 1, MINIMUM_WAGE_FACTOR);
  const anyMinWage = state.cities.some((c) => hasEdict(c, 'minimum_wage'));
  let total = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== PLAYER_ID) continue;
    const m = buildingMaintenance(state, b);
    const city = anyMinWage ? workCity(state, b) : null;
    total += m * (city && hasEdict(city, 'minimum_wage') ? minWage : normal);
  }
  return total;
}

/** An edict's effect text at price index `index`: money in it is today's (the toll), the rest as written. */
export function mayorEdictEffect(id: MayorEdictId, index = 1): string {
  if (id === 'truck_tolls') return `$${Math.round(TRUCK_TOLL * index).toLocaleString('en-US')}/month per truck stopping in town`;
  return MAYOR_EDICTS[id].effect;
}

/** Monthly: TRUCK_TOLL per player truck per toll town its route stops in (once per town), under 'vehicles'. */
export function truckTollsMonth(ctx: SimContext): void {
  const { state } = ctx;
  const tolled = new Set(state.cities.filter((c) => hasEdict(c, 'truck_tolls')).map((c) => c.id));
  if (tolled.size === 0) return;
  const townOf = new Map<number, number | null>();
  const town = (b: Building): number | null => {
    let id = townOf.get(b.id);
    if (id === undefined) {
      id = workCity(state, b)?.id ?? null;
      townOf.set(b.id, id);
    }
    return id;
  };
  let total = 0;
  for (const v of Object.values(state.vehicles)) {
    if (v.kind !== 'truck' || v.ownerId !== PLAYER_ID || v.routeId === null) continue;
    const route = state.routes[v.routeId];
    if (!route) continue;
    const towns = new Set<number>();
    for (const s of route.stops) {
      const b = state.buildings[s.buildingId];
      const id = b ? town(b) : null;
      if (id !== null && tolled.has(id)) towns.add(id);
    }
    total += TRUCK_TOLL * towns.size;
  }
  if (total > 0) spend(state.companies[PLAYER_ID], 'vehicles', atPrices(state, total), state.date);
}
