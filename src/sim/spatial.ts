import { BUILDINGS } from '../data/buildings';
import type { Building, City, GameState, OwnerId, Vec2 } from './types';

/** Tiles per bucket side. */
export const BUCKET = 8;

interface Index {
  buckets: Map<number, { b: Building; cx: number; cy: number }[]>;
}

// Keyed by the buildings record, so a loaded save (a new object) misses and rebuilds.
const indexes = new WeakMap<GameState['buildings'], Index>();

const key = (bx: number, by: number): number => (by + 1024) * 4096 + (bx + 1024);

/** Drops the cached index; placeBuilding/demolishBuilding call this after mutating state.buildings. */
export function invalidateSpatial(state: GameState): void {
  indexes.delete(state.buildings);
}

function indexFor(state: GameState): Index {
  let idx = indexes.get(state.buildings);
  if (idx) return idx;
  idx = { buckets: new Map() };
  for (const id of Object.keys(state.buildings)) {
    const b = state.buildings[Number(id)];
    const { w, h } = BUILDINGS[b.typeId].size;
    const cx = b.pos.x + w / 2;
    const cy = b.pos.y + h / 2;
    const k = key(Math.floor(cx / BUCKET), Math.floor(cy / BUCKET));
    const list = idx.buckets.get(k);
    if (list) list.push({ b, cx, cy });
    else idx.buckets.set(k, [{ b, cx, cy }]);
  }
  indexes.set(state.buildings, idx);
  return idx;
}

/** Buildings whose footprint centre is within Euclidean `radius` of `center`, sorted by id. */
export function buildingsNear(state: GameState, center: Vec2, radius: number, owner?: OwnerId): Building[] {
  const idx = indexFor(state);
  const out: Building[] = [];
  const r2 = radius * radius;
  const x0 = Math.floor((center.x - radius) / BUCKET);
  const x1 = Math.floor((center.x + radius) / BUCKET);
  const y0 = Math.floor((center.y - radius) / BUCKET);
  const y1 = Math.floor((center.y + radius) / BUCKET);
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      const list = idx.buckets.get(key(bx, by));
      if (!list) continue;
      for (const e of list) {
        if (owner !== undefined && e.b.ownerId !== owner) continue;
        const dx = e.cx - center.x;
        const dy = e.cy - center.y;
        if (dx * dx + dy * dy <= r2) out.push(e.b);
      }
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Cities (there are few, so a plain scan) whose centre is within `radius` of `center`, sorted by id. */
export function citiesNear(state: GameState, center: Vec2, radius: number): City[] {
  const r2 = radius * radius;
  return state.cities
    .filter((c) => (c.center.x - center.x) ** 2 + (c.center.y - center.y) ** 2 <= r2)
    .sort((a, b) => a.id - b.id);
}
