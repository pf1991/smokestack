import { FACTION_IDS } from '../data/factions';
import { companyIds } from './companies';
import { POP_CAP } from './market';
import { footprint } from './state';
import type { GameState } from './types';

/** Messages for every violated state invariant; empty when the state is healthy. */
export function checkInvariants(state: GameState): string[] {
  const out: string[] = [];
  const { map } = state;

  for (const id of companyIds(state)) {
    const c = state.companies[id];
    if (!Number.isFinite(c.money)) out.push(`company ${id}: money is ${c.money}`);
    if (!Number.isFinite(c.loan)) out.push(`company ${id}: loan is ${c.loan}`);
  }

  for (const city of state.cities) {
    const p = city.population;
    if (!Number.isInteger(p) || p < 500 || p > POP_CAP) out.push(`city ${city.id} (${city.name}): population ${p} outside [500, ${POP_CAP}]`);
    for (const f of FACTION_IDS) {
      const op = city.opinion?.[f];
      if (typeof op !== 'number' || !Number.isFinite(op) || op < 0 || op > 100) out.push(`city ${city.id} (${city.name}): ${f} opinion ${op} outside [0, 100]`);
    }
  }

  for (const v of Object.values(state.vehicles)) {
    if (v.routeId !== null && !state.routes[v.routeId]) out.push(`vehicle ${v.id}: route ${v.routeId} does not exist`);
  }

  for (const r of Object.values(state.routes)) {
    for (const s of r.stops) {
      if (!state.buildings[s.buildingId]) out.push(`route ${r.id}: stop building ${s.buildingId} does not exist`);
    }
  }

  for (const b of Object.values(state.buildings)) {
    for (const t of footprint(b)) {
      if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) {
        out.push(`building ${b.id}: footprint tile (${t.x},${t.y}) out of bounds`);
        continue;
      }
      const tile = map.tiles[t.y * map.width + t.x];
      if (tile.buildingId !== b.id) out.push(`building ${b.id}: tile (${t.x},${t.y}) has buildingId ${tile.buildingId}`);
    }
  }

  const n = map.width * map.height;
  for (const [id, l] of Object.entries(state.layers)) {
    if (l.length !== n) out.push(`layer ${id}: length ${l.length}, expected ${n}`);
  }
  return out;
}
