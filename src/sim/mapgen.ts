import type { City, GameMap, Terrain, Tile } from './types';
import { defaultOpinion } from '../data/factions';
import { START_DATE } from './clock';
import { monthIndex, newCityPolitics } from './politics/elections';
import { CITY_NAMES } from '../data/names';
import { randInt, type RngHolder } from './rng';
import { valueNoise2D } from './noise';
import { urbanRadius } from './market';

export function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function tileAt(map: GameMap, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x];
}

const MIN_LAND = 0.55;
const MAX_ATTEMPTS = 20;
const CITY_COUNT = 5;
const CITY_MIN_DIST = 25;
const CITY_EDGE = 6;
const NOISE_SCALE = 1 / 22;

const stretch = (v: number): number => Math.min(1, Math.max(0, (v - 0.5) * 1.6 + 0.5));

/** Diagnostic: attempts used by the most recent successful generateMap call. */
export let lastGenerationAttempts = 0;

function classify(e: number, m: number): Terrain {
  if (e < 0.3) return 'water';
  if (e < 0.34) return 'sand';
  if (e > 0.78) return 'mountain';
  if (e > 0.66) return 'hills';
  return m > 0.55 ? 'forest' : 'grass';
}

function buildTerrain(seed: number, width: number, height: number): GameMap {
  const tiles: Tile[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = stretch(valueNoise2D(seed, x * NOISE_SCALE, y * NOISE_SCALE, 4));
      const m = stretch(valueNoise2D(seed + 7919, x * NOISE_SCALE, y * NOISE_SCALE, 4));
      tiles[y * width + x] = {
        terrain: classify(e, m),
        deposit: null,
        road: false,
        rail: false,
        buildingId: null,
        cityId: null,
        pollution: 0,
        roadOwner: null,
        railOwner: null,
      };
    }
  }
  return { width, height, tiles };
}

function landRatio(map: GameMap): number {
  let land = 0;
  for (const t of map.tiles) if (t.terrain !== 'water') land++;
  return land / map.tiles.length;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** True when no deposit lies within one tile (8-neighbourhood) of (x,y). */
function isolated(map: GameMap, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(map, x + dx, y + dy)?.deposit) return false;
    }
  }
  return true;
}

/** Place one 3-6 tile cluster; optionally seeded within `radius` of `anchor`. */
function placeCluster(
  map: GameMap,
  rng: RngHolder,
  good: string,
  legal: Terrain[],
  anchor?: { x: number; y: number; radius: number },
): boolean {
  const { width, height } = map;
  for (let attempt = 0; attempt < 400; attempt++) {
    let sx: number;
    let sy: number;
    if (anchor) {
      sx = anchor.x + randInt(rng, -anchor.radius, anchor.radius);
      sy = anchor.y + randInt(rng, -anchor.radius, anchor.radius);
      if (sx < 2 || sy < 2 || sx > width - 3 || sy > height - 3) continue;
      if (Math.hypot(sx - anchor.x, sy - anchor.y) > anchor.radius) continue;
    } else {
      sx = randInt(rng, 2, width - 3);
      sy = randInt(rng, 2, height - 3);
    }
    const st = map.tiles[sy * width + sx];
    if (!legal.includes(st.terrain) || st.deposit || !isolated(map, sx, sy)) continue;
    const target = randInt(rng, 3, 6);
    const cells: number[] = [sy * width + sx];
    st.deposit = good;
    let guard = 0;
    while (cells.length < target && guard++ < 40) {
      const from = cells[randInt(rng, 0, cells.length - 1)];
      const [dx, dy] = DIRS[randInt(rng, 0, 3)];
      const nx = (from % width) + dx;
      const ny = Math.floor(from / width) + dy;
      const t = tileAt(map, nx, ny);
      if (!t || t.deposit || !legal.includes(t.terrain)) continue;
      // must not touch any other cluster (other cells of this cluster are fine)
      let touches = false;
      for (let oy = -1; oy <= 1 && !touches; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const o = tileAt(map, nx + ox, ny + oy);
          if (o?.deposit && !cells.includes((ny + oy) * width + nx + ox)) {
            touches = true;
            break;
          }
        }
      }
      if (touches) continue;
      t.deposit = good;
      cells.push(ny * width + nx);
    }
    if (cells.length >= 3) return true;
    for (const c of cells) map.tiles[c].deposit = null;
  }
  return false;
}

const ORE: Terrain[] = ['hills', 'mountain'];
const OIL: Terrain[] = ['grass', 'sand'];

function hasTerrainNear(map: GameMap, c: { x: number; y: number }, r: number, terrains: Terrain[]): boolean {
  for (let y = Math.max(0, c.y - r); y <= Math.min(map.height - 1, c.y + r); y++) {
    for (let x = Math.max(0, c.x - r); x <= Math.min(map.width - 1, c.x + r); x++) {
      if (Math.hypot(x - c.x, y - c.y) <= r && terrains.includes(map.tiles[y * map.width + x].terrain)) {
        return true;
      }
    }
  }
  return false;
}

/** Cities first: one iron, coal and oil cluster near each, then random extras up to the totals. */
function placeDeposits(map: GameMap, rng: RngHolder, cities: City[]): boolean {
  for (const city of cities) {
    const c = city.center;
    if (!hasTerrainNear(map, c, 20, ORE)) return false;
    if (!hasTerrainNear(map, c, 25, ['forest']) || !hasTerrainNear(map, c, 25, ['sand'])) return false;
    if (!placeCluster(map, rng, 'iron_ore', ORE, { ...c, radius: 20 })) return false;
    if (!placeCluster(map, rng, 'coal', ORE, { ...c, radius: 20 })) return false;
    if (!placeCluster(map, rng, 'oil', OIL, { ...c, radius: 25 })) return false;
  }
  const totals: [string, number, Terrain[]][] = [
    ['iron_ore', 8, ORE],
    ['coal', 8, ORE],
    ['oil', 7, OIL],
  ];
  for (const [good, total, legal] of totals) {
    for (let n = cities.length; n < total; n++) {
      if (!placeCluster(map, rng, good, legal)) return false;
    }
  }
  return true;
}

function placeCities(map: GameMap, rng: RngHolder): City[] | null {
  const { width, height } = map;
  const centers: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 3000 && centers.length < CITY_COUNT; attempt++) {
    const x = randInt(rng, CITY_EDGE, width - 1 - CITY_EDGE);
    const y = randInt(rng, CITY_EDGE, height - 1 - CITY_EDGE);
    if (map.tiles[y * width + x].terrain !== 'grass') continue;
    if (centers.some((c) => Math.hypot(c.x - x, c.y - y) < CITY_MIN_DIST)) continue;
    centers.push({ x, y });
  }
  if (centers.length < CITY_COUNT) return null;

  const names = [...CITY_NAMES];
  return centers.map((center, id) => {
    const population = randInt(rng, 2000, 12000);
    const name = names.splice(randInt(rng, 0, names.length - 1), 1)[0];
    return {
      id,
      name,
      center,
      population,
      prevPopulation: population,
      happiness: 0.7,
      pollution: 0,
      market: {},
      urbanRadius: urbanRadius(population),
      landmarks: [],
      opinion: defaultOpinion(),
      politics: newCityPolitics(id, START_DATE.year, monthIndex(START_DATE)),
    };
  });
}

export function generateMap(
  seed: number,
  width = 128,
  height = 96,
): { map: GameMap; cities: City[] } {
  let s = seed;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++, s += 1000) {
    const map = buildTerrain(s, width, height);
    if (landRatio(map) < MIN_LAND) continue;
    const rng: RngHolder = { rngState: s ^ 0x5bd1e995 };
    const cities = placeCities(map, rng);
    if (!cities) continue;
    if (!placeDeposits(map, rng, cities)) continue;
    lastGenerationAttempts = attempt + 1;
    return { map, cities };
  }
  throw new Error(`mapgen: no valid map found for seed ${seed}`);
}
