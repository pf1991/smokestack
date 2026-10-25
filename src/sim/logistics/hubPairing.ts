/**
 * Spatial pairing of warehouse hubs with train stations (hub trunk). Leaf module: no vehicle or
 * route imports, so autoRoutes / vehicles can use it without circular init.
 */
import { BUILDINGS } from '../../data/buildings';
import { buildingList } from '../spatial';
import type { Building, GameState } from '../types';

/** Chebyshev distance between two footprints, tile to tile (1 for neighbours, 0 when they overlap). */
export function footprintGap(a: Building, b: Building): number {
  const sa = BUILDINGS[a.typeId].size;
  const sb = BUILDINGS[b.typeId].size;
  const dx = Math.max(0, b.pos.x - (a.pos.x + sa.w - 1), a.pos.x - (b.pos.x + sb.w - 1));
  const dy = Math.max(0, b.pos.y - (a.pos.y + sa.h - 1), a.pos.y - (b.pos.y + sb.h - 1));
  return Math.max(dx, dy);
}

/** Max Chebyshev footprint gap between a hub warehouse and its paired train station. */
export const HUB_STATION_GAP = 2;

/** The owner's hub warehouse beside a train station, or null. */
export function shedForStation(state: GameState, station: Building): Building | null {
  if (station.typeId !== 'train_station') return null;
  let best: Building | null = null;
  let bestGap = Infinity;
  for (const b of buildingList(state)) {
    if (b.ownerId !== station.ownerId || b.typeId !== 'warehouse' || !b.hub) continue;
    if (state.buildings[b.id] !== b) continue;
    const g = footprintGap(station, b);
    if (g > HUB_STATION_GAP || g >= bestGap) continue;
    best = b;
    bestGap = g;
  }
  return best;
}

/** The owner's train station beside `hub`, or null (lowest id on a tie). */
export function stationBesideHub(state: GameState, hub: Building): Building | null {
  let best: Building | null = null;
  for (const b of buildingList(state)) {
    if (b.ownerId !== hub.ownerId || b.typeId !== 'train_station' || state.buildings[b.id] !== b) continue;
    if (footprintGap(hub, b) > HUB_STATION_GAP) continue;
    if (!best || b.id < best.id) best = b;
  }
  return best;
}
