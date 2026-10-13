/**
 * Workforce: every building, of any company, hires from the nearest town within WORK_RADIUS. Each
 * town's labour pool is shared out across the buildings assigned to it; `Building.staffing` is
 * recomputed monthly and scales production (sim/production.ts). Buildings with no town nearby run
 * on travelling crews at REMOTE_STAFFING. Company housing adds HOUSING_POOL hands to the pool of its
 * factory's town. Reads `opinion.workers` only; never writes opinion.
 */
import { BUILDINGS, HOUSING_POOL, HOUSING_RADIUS } from '../../data/buildings';
import { buildingsNear, citiesNear } from '../spatial';
import type { Building, BuildingTypeId, City, GameState, OwnerId, Vec2 } from '../types';
import { healthFactor } from '../society/tiers';

/** How far (tiles, Euclidean from the footprint centre) a building hires from a town. */
export const WORK_RADIUS = 30;
/** Share of a town's people available as industrial hands, before the Workers' opinion scales it. */
export const LABOUR_SHARE = 0.15;
/** Staffing of a building with no town within WORK_RADIUS. */
export const REMOTE_STAFFING = 0.75;
/** A building never falls below this share of its workers, however crowded its town. */
export const MIN_STAFFING = 0.5;

function centre(b: Building): Vec2 {
  const { w, h } = BUILDINGS[b.typeId].size;
  return { x: b.pos.x + w / 2, y: b.pos.y + h / 2 };
}

/** The town `b` hires from: the nearest within WORK_RADIUS of its footprint centre, ties to the lower id. */
export function workCity(state: GameState, b: Building): City | null {
  const c = centre(b);
  // citiesNear is a plain filter: keep the radius finite and non-negative
  const radius = Math.min(Math.max(0, WORK_RADIUS), state.map.width + state.map.height);
  let best: City | null = null;
  let bestD = Infinity;
  // citiesNear returns id order, so a strict `<` keeps the lower id on a tie
  for (const city of citiesNear(state, c, radius)) {
    const d = (city.center.x - c.x) ** 2 + (city.center.y - c.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = city;
    }
  }
  return best;
}

/**
 * The hands a town can offer: LABOUR_SHARE of its people, scaled 0.7..1.3 by the Workers' opinion,
 * times the smog health factor (tier 2+: 1 − 0.5 × clamp(level × 5), society/tiers.ts).
 */
export function laborPool(city: City): number {
  return city.population * LABOUR_SHARE * (0.7 + (0.6 * city.opinion.workers) / 100) * healthFactor(city);
}

/** Chebyshev distance in tiles between two footprints (adjacent = 1, overlapping = 0). */
function footprintGap(a: Vec2, as: { w: number; h: number }, b: Vec2, bs: { w: number; h: number }): number {
  const dx = Math.max(0, b.x - (a.x + as.w - 1), a.x - (b.x + bs.w - 1));
  const dy = Math.max(0, b.y - (a.y + as.h - 1), a.y - (b.y + bs.h - 1));
  return Math.max(dx, dy);
}

/**
 * The factory of `owner` a building of `typeId` at `pos` would serve as company housing: the one
 * whose footprint is nearest (Chebyshev, at most HOUSING_RADIUS tiles), ties to the lower id.
 */
export function housingFactory(state: GameState, owner: OwnerId, typeId: BuildingTypeId, pos: Vec2): Building | null {
  const size = BUILDINGS[typeId].size;
  const centre = { x: pos.x + size.w / 2, y: pos.y + size.h / 2 };
  // centre-to-centre prefilter, generous enough for the largest (4×4) factory
  const near = buildingsNear(state, centre, HOUSING_RADIUS + size.w + 4, owner);
  let best: Building | null = null;
  let bestGap = Infinity;
  for (const f of near) {
    const def = BUILDINGS[f.typeId];
    if (def.category !== 'factory') continue;
    const gap = footprintGap(pos, size, f.pos, def.size);
    if (gap <= HOUSING_RADIUS && gap < bestGap) {
      best = f;
      bestGap = gap;
    }
  }
  return best;
}

/** The town company housing `b` serves: its factory's work town (null without a factory or a town). */
export function housingCity(state: GameState, b: Building): City | null {
  const f = housingFactory(state, b.ownerId, b.typeId, b.pos);
  return f ? workCity(state, f) : null;
}

/** Monthly: assigns every building to a town and sets its staffing. Runs before factionsMonth. */
export function workforceMonth(state: GameState): void {
  const ids = Object.keys(state.buildings).map(Number).sort((a, b) => a - b);
  const assigned = new Map<number, Building[]>();
  /** extra hands per town from company housing */
  const housed = new Map<number, number>();
  for (const id of ids) {
    const b = state.buildings[id];
    if (b.typeId === 'company_housing') {
      const city = housingCity(state, b);
      if (city) housed.set(city.id, (housed.get(city.id) ?? 0) + HOUSING_POOL);
    }
    const city = workCity(state, b);
    if (!city) {
      b.staffing = REMOTE_STAFFING;
      continue;
    }
    const list = assigned.get(city.id);
    if (list) list.push(b);
    else assigned.set(city.id, [b]);
  }
  for (const city of state.cities) {
    const list = assigned.get(city.id);
    if (!list) continue;
    let need = 0;
    for (const b of list) need += BUILDINGS[b.typeId].workers;
    const pool = laborPool(city) + (housed.get(city.id) ?? 0);
    const ratio = need === 0 ? 1 : Math.min(1, pool / need);
    const staffing = Math.max(MIN_STAFFING, ratio);
    for (const b of list) b.staffing = staffing;
  }
}
