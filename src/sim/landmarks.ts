/**
 * Landmarks (Phase 1 Task 8): once a town is big enough, and the era allows, it raises a civic
 * building on a free 2×2 block near its centre. One landmark per city per month, in table order.
 *
 * The block's tiles carry `index + 1` in the 'landmark' layer (index = the landmark's position in
 * the city's `landmarks` list). Builders refuse those tiles (state.ts, rail.ts), and street laying
 * skips them, so a landmark stands for good.
 */
import { LANDMARK_IDS, LANDMARKS, landmarkHeadline, type LandmarkId } from '../data/landmarks';
import { LANDMARK_LAYER } from './landmarkTiles';
import { layer, layerAt } from './layers';
import { publishNews } from './news';
import type { City, GameState, SimContext, Vec2 } from './types';

export { LANDMARK_BLOCKED, LANDMARK_LAYER } from './landmarkTiles';

/** True when tile (x, y) can hold part of a landmark of `city`. */
function freeFor(state: GameState, city: City, x: number, y: number): boolean {
  const { map } = state;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y * map.width + x];
  if (t.cityId !== city.id) return false;
  if (t.terrain === 'water' || t.terrain === 'mountain') return false;
  if (t.road || t.rail || t.buildingId !== null || t.deposit !== null) return false;
  return layerAt(state, LANDMARK_LAYER, x, y) === 0;
}

/**
 * The free 2×2 block (top-left tile) whose centre is nearest the city centre, within the urban
 * radius; ties go to the lowest y, then the lowest x. All 4 tiles must be the city's own land (not
 * water or mountain) and carry no road, rail, building, deposit or landmark. Null when none is free.
 */
export function findLandmarkSite(state: GameState, city: City): Vec2 | null {
  const r = city.urbanRadius;
  const { x: cx, y: cy } = city.center;
  let best: Vec2 | null = null;
  let bestD = Infinity;
  // row-major scan with a strict `<`: equal distances keep the lowest y, then x
  for (let y = cy - r; y <= cy + r - 1; y++) {
    for (let x = cx - r; x <= cx + r - 1; x++) {
      // doubled block-centre offsets keep the distance an exact integer
      const d = (2 * (x - cx) + 1) ** 2 + (2 * (y - cy) + 1) ** 2;
      if (d >= bestD) continue;
      if (!freeFor(state, city, x, y) || !freeFor(state, city, x + 1, y)) continue;
      if (!freeFor(state, city, x, y + 1) || !freeFor(state, city, x + 1, y + 1)) continue;
      best = { x, y };
      bestD = d;
    }
  }
  return best;
}

/** The first landmark (table order) `city` qualifies for in `year` and does not have yet. */
function nextLandmark(city: City, year: number): LandmarkId | null {
  for (const id of LANDMARK_IDS) {
    const def = LANDMARKS[id];
    if (city.population < def.minPop || year < def.minYear) continue;
    if (city.landmarks.some((l) => l.id === id)) continue;
    return id;
  }
  return null;
}

/** Monthly: each city (in id order) raises at most one landmark it qualifies for. */
export function landmarksMonth(ctx: SimContext): void {
  const { state } = ctx;
  const cities = [...state.cities].sort((a, b) => a.id - b.id);
  for (const city of cities) {
    const id = nextLandmark(city, state.date.year);
    if (!id) continue;
    const pos = findLandmarkSite(state, city);
    if (!pos) continue;
    city.landmarks.push({ id, pos });
    const value = city.landmarks.length; // index + 1
    const l = layer(state, LANDMARK_LAYER);
    const w = state.map.width;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) l[(pos.y + dy) * w + pos.x + dx] = value;
    publishNews(ctx, 'civic', landmarkHeadline(id, city.name), `${city.name} unveils its new ${LANDMARKS[id].name.toLowerCase()}. Citizens turn out in their Sunday best.`);
    ctx.bus.emit({ type: 'landmarkBuilt', cityId: city.id, id });
  }
}
