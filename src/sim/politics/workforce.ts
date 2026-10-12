/**
 * Workforce: every building, of any company, hires from the nearest town within WORK_RADIUS. Each
 * town's labour pool is shared out across the buildings assigned to it; `Building.staffing` is
 * recomputed monthly and scales production (sim/production.ts). Buildings with no town nearby run
 * on travelling crews at REMOTE_STAFFING. Reads `opinion.workers` only; never writes opinion.
 */
import { BUILDINGS } from '../../data/buildings';
import { citiesNear } from '../spatial';
import type { Building, City, GameState, Vec2 } from '../types';

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

/** The hands a town can offer: LABOUR_SHARE of its people, scaled 0.7..1.3 by the Workers' opinion. */
export function laborPool(city: City): number {
  return city.population * LABOUR_SHARE * (0.7 + (0.6 * city.opinion.workers) / 100);
}

/** Monthly: assigns every building to a town and sets its staffing. Runs before factionsMonth. */
export function workforceMonth(state: GameState): void {
  const ids = Object.keys(state.buildings).map(Number).sort((a, b) => a - b);
  const assigned = new Map<number, Building[]>();
  for (const id of ids) {
    const b = state.buildings[id];
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
    const pool = laborPool(city);
    const ratio = need === 0 ? 1 : Math.min(1, pool / need);
    const staffing = Math.max(MIN_STAFFING, ratio);
    for (const b of list) b.staffing = staffing;
  }
}
