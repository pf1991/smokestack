/**
 * Point picking that matches what the diorama draws: buildings are raised BUILDING_HEIGHT px above
 * their footprint and drawn over vehicles, sorted by footprint bottom (render/world/index.ts), so a
 * click on a raised roof belongs to that building, and the frontmost (last drawn) building wins.
 * Landmarks rise LANDMARK_HEIGHT px above their 2×2 block. In the survey regime everything is flat.
 */
import { BUILDINGS } from '../data/buildings';
import { LANDMARK_HEIGHT, LANDMARK_PX } from '../render/landmarks';
import { BUILDING_HEIGHT } from '../render/sprites';
import { TILE } from '../render/constants';
import type { City, GameState, Vec2 } from '../sim/types';

/** Building whose drawn body (footprint plus `raised` × BUILDING_HEIGHT above it) contains world point `p`. */
export function buildingAtPoint(state: GameState, p: Vec2, raised: boolean): number | null {
  let best: number | null = null;
  let bestBottom = -Infinity;
  let bestX = -Infinity;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    const def = BUILDINGS[b.typeId];
    if (!def) continue;
    const x0 = b.pos.x * TILE;
    const bottom = (b.pos.y + def.size.h) * TILE;
    const top = b.pos.y * TILE - (raised ? (BUILDING_HEIGHT[b.typeId] ?? 0) : 0);
    if (p.x < x0 || p.x >= x0 + def.size.w * TILE || p.y < top || p.y >= bottom) continue;
    // draw order: footprint bottom, then x; the last one drawn is on top
    if (bottom > bestBottom || (bottom === bestBottom && b.pos.x > bestX)) {
      best = b.id;
      bestBottom = bottom;
      bestX = b.pos.x;
    }
  }
  return best;
}

/** Landmark whose raised body (2×2 block plus LANDMARK_HEIGHT above) contains world point `p`. */
export function landmarkAtPoint(state: GameState, p: Vec2): { city: City; id: string } | null {
  let best: { city: City; id: string } | null = null;
  let bestBottom = -Infinity;
  for (const city of state.cities) {
    for (const l of city.landmarks) {
      const x0 = l.pos.x * TILE;
      const bottom = l.pos.y * TILE + LANDMARK_PX;
      const top = l.pos.y * TILE - LANDMARK_HEIGHT[l.id];
      if (p.x < x0 || p.x >= x0 + LANDMARK_PX || p.y < top || p.y >= bottom) continue;
      if (bottom > bestBottom) {
        best = { city, id: l.id };
        bestBottom = bottom;
      }
    }
  }
  return best;
}
