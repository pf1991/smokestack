import { BUILDINGS } from '../data/buildings';
import { footprint } from './state';
import { publishNews } from './news';
import { LANDMARK_LAYER } from './landmarkTiles';
import { terrainEpoch } from './terrainEpoch';
import { weatherDay } from './weather';
import type { Building, GameMap, GameState, SimContext } from './types';

export const POLLUTION_DECAY = 0.97;
export const POLLUTION_CAP = 100;
export const WARN_THRESHOLD = 0.5;
/** Emission per point of `def.pollution` per day at the source's centre tile (orthogonal neighbours get half). */
const SOURCE_FACTOR = 45;
/** Share of a tile's smog blown one tile downwind each day, split between x and y by |windX| : |windY|. */
export const ADVECT = 0.25;
/** Share of a tile's smog spread equally to its 4 neighbours each day. */
export const DIFFUSE = 0.06;
/** Extra daily decay factors on top of POLLUTION_DECAY. */
export const FOREST_DECAY = 0.94;
export const PARK_DECAY = 0.9;
export const HILL_DECAY = 0.95;
export const RAIN_DECAY = 0.7;
/** Share of the day's loss a valley pocket (all 4 neighbours hills or mountain) keeps. */
export const POCKET_KEEP = 0.5;
/** Below this a tile is clean (and leaves the dirty set). */
const CLEAN = 1e-4;

/**
 * Emission scale of building `b` (1 = unabated). Phase 3 abatement (scrubbers, Task 6) lowers it;
 * smogDay multiplies every source's daily emission by it.
 */
export function emissionFactor(_state: GameState, _b: Building): number {
  return 1;
}

/**
 * Daily decay multiplier by tile code: bits 0–1 terrain class (0 grass/sand/water, 1 forest,
 * 2 hills/mountain), bit 2 valley pocket, bit 3 park landmark, bit 4 rain today.
 */
const DECAY_BY_CODE = new Float64Array(32);
for (let code = 0; code < 32; code++) {
  const cls = code & 3;
  let m = POLLUTION_DECAY;
  if (cls === 1) m *= FOREST_DECAY;
  else if (cls === 2) m *= HILL_DECAY;
  if (code & 8) m *= PARK_DECAY;
  if (code & 16) m *= RAIN_DECAY;
  if (code & 4) m = 1 - (1 - m) * (1 - POCKET_KEEP);
  DECAY_BY_CODE[code] = m;
}

/**
 * Daily smog step (Phase 3), after weatherDay has rolled today's wind and rain:
 *  1. emission: every 'ok' building adds `def.pollution × SOURCE_FACTOR × emissionFactor` to its
 *     centre tile and half that to each orthogonal neighbour;
 *  2. advection: each tile sends ADVECT of its smog one tile downwind (split x/y by |wind|) and
 *     DIFFUSE equally to its 4 neighbours (smog blown off the map is lost);
 *  3. decay: ×0.97, then ×0.94 on forest, ×0.95 on hills and mountain, ×0.90 on park landmark
 *     tiles, and ×0.7 everywhere on a rain day;
 *  4. settling: a valley pocket (all 4 neighbours hills or mountain) keeps half of that loss;
 *  5. clamp to [0, POLLUTION_CAP]; anything under 1e-4 becomes 0.
 * Only tiles in the dirty set (non-zero smog) and their neighbours are touched. Step 2 is a gather:
 * every tile sums what it keeps and what flows in from its neighbours, read from a snapshot of the
 * post-emission values in a fixed order, so the result is bit-identical whatever order the dirty
 * list is in (no sort needed).
 */
export function smogDay(ctx: SimContext): void {
  const { state } = ctx;
  const { map, buildings, weather } = state;
  const { width, height, tiles } = map;
  const dirty = dirtyTiles(map);
  const { list, member } = dirty;

  // 1. emission
  for (const b of Object.values(buildings)) {
    if (b.status !== 'ok') continue;
    const amount = BUILDINGS[b.typeId].pollution * SOURCE_FACTOR * emissionFactor(state, b);
    if (amount <= 0) continue;
    const fp = footprint(b);
    const c = fp[Math.floor(fp.length / 2)];
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) continue;
    const i = c.y * width + c.x;
    emit(tiles, dirty, i, amount);
    const half = amount * 0.5;
    if (c.x > 0) emit(tiles, dirty, i - 1, half);
    if (c.x < width - 1) emit(tiles, dirty, i + 1, half);
    if (c.y > 0) emit(tiles, dirty, i - width, half);
    if (c.y < height - 1) emit(tiles, dirty, i + width, half);
  }

  // snapshot the smog tiles and enlist their neighbours (the tiles that can receive smog today)
  const { snap, next } = scratch(map);
  const n0 = list.length;
  for (let j = 0; j < n0; j++) {
    const i = list[j];
    snap[i] = tiles[i].pollution;
    const y = (i / width) | 0;
    const x = i - y * width;
    if (x > 0 && !member[i - 1]) (member[i - 1] = 1), list.push(i - 1);
    if (x < width - 1 && !member[i + 1]) (member[i + 1] = 1), list.push(i + 1);
    if (y > 0 && !member[i - width]) (member[i - width] = 1), list.push(i - width);
    if (y < height - 1 && !member[i + width]) (member[i + width] = 1), list.push(i + width);
  }

  // 2–4. gather: kept share plus inflow from each neighbour, then decay and settling
  const wx = weather.windX;
  const wy = weather.windY;
  const wsum = Math.abs(wx) + Math.abs(wy);
  const ax = wsum > 0 ? (ADVECT * Math.abs(wx)) / wsum : 0;
  const ay = wsum > 0 ? (ADVECT * Math.abs(wy)) / wsum : 0;
  const d4 = DIFFUSE / 4;
  const keep = 1 - (wsum > 0 ? ADVECT : 0) - DIFFUSE;
  const fromWest = d4 + (wx > 0 ? ax : 0); // the neighbour at x−1 blows east into us
  const fromEast = d4 + (wx < 0 ? ax : 0);
  const fromNorth = d4 + (wy > 0 ? ay : 0); // y−1 blows south into us
  const fromSouth = d4 + (wy < 0 ? ay : 0);
  const cls = terrainCodes(map);
  const park = parkMask(state);
  const rainBit = weather.rain ? 16 : 0;
  const total = list.length;
  for (let j = 0; j < total; j++) {
    const i = list[j];
    const y = (i / width) | 0;
    const x = i - y * width;
    let v = snap[i] * keep;
    if (x > 0) v += snap[i - 1] * fromWest;
    if (x < width - 1) v += snap[i + 1] * fromEast;
    if (y > 0) v += snap[i - width] * fromNorth;
    if (y < height - 1) v += snap[i + width] * fromSouth;
    next[j] = v * DECAY_BY_CODE[cls[i] | (park[i] << 3) | rainBit];
  }

  // 5. clamp and write back; the snapshot is left all zeros for tomorrow
  let kept = 0;
  for (let j = 0; j < total; j++) {
    const i = list[j];
    snap[i] = 0;
    const p = next[j];
    const t = p > POLLUTION_CAP ? POLLUTION_CAP : p < CLEAN ? 0 : p;
    tiles[i].pollution = t;
    if (t !== 0) list[kept++] = i;
    else member[i] = 0;
  }
  list.length = kept;
}

function emit(tiles: GameMap['tiles'], dirty: DirtySet, i: number, amount: number): void {
  tiles[i].pollution += amount;
  if (!dirty.member[i]) {
    dirty.member[i] = 1;
    dirty.list.push(i);
  }
}

/** The old name of smogDay, kept for existing importers. */
export const pollutionDay = smogDay;

interface Scratch {
  /** post-emission smog by tile; all zeros between days */
  snap: Float64Array;
  /** today's new value by dirty-list position */
  next: Float64Array;
}

/** Reusable per-map buffers for the advection step (not part of GameState). */
const scratchByMap = new WeakMap<GameMap, Scratch>();

function scratch(map: GameMap): Scratch {
  let s = scratchByMap.get(map);
  if (!s || s.snap.length !== map.tiles.length) {
    s = { snap: new Float64Array(map.tiles.length), next: new Float64Array(map.tiles.length) };
    scratchByMap.set(map, s);
  }
  return s;
}

/** Terrain decay class per tile (bits 0–2 of DECAY_BY_CODE), rebuilt when the terrain epoch moves. */
const terrainByMap = new WeakMap<GameMap, { epoch: number; codes: Uint8Array }>();

function terrainCodes(map: GameMap): Uint8Array {
  const epoch = terrainEpoch(map);
  const cached = terrainByMap.get(map);
  if (cached && cached.epoch === epoch && cached.codes.length === map.tiles.length) return cached.codes;
  const { width, height, tiles } = map;
  const codes = new Uint8Array(tiles.length);
  const high = (t: { terrain: string }) => t.terrain === 'hills' || t.terrain === 'mountain';
  for (let i = 0; i < tiles.length; i++) {
    const ter = tiles[i].terrain;
    let c = ter === 'forest' ? 1 : ter === 'hills' || ter === 'mountain' ? 2 : 0;
    const y = (i / width) | 0;
    const x = i - y * width;
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
      if (high(tiles[i - 1]) && high(tiles[i + 1]) && high(tiles[i - width]) && high(tiles[i + width])) c |= 4;
    }
    codes[i] = c;
  }
  terrainByMap.set(map, { epoch, codes });
  return codes;
}

interface ParkCache {
  /** total landmarks over all cities when built; landmarks are never removed, so a change means a new one */
  count: number;
  /** month index (year × 12 + month) when built; rebuilt monthly regardless */
  month: number;
  mask: Uint8Array;
}

/** Park landmark tiles per map, rebuilt when the landmark count changes or the month turns. */
const parksByMap = new WeakMap<GameMap, ParkCache>();

function parkMask(state: GameState): Uint8Array {
  const { map } = state;
  let count = 0;
  for (const c of state.cities) count += c.landmarks.length;
  const month = state.date.year * 12 + state.date.month;
  let cache = parksByMap.get(map);
  if (cache && cache.count === count && cache.month === month && cache.mask.length === map.tiles.length) return cache.mask;
  const mask = cache && cache.mask.length === map.tiles.length ? cache.mask.fill(0) : new Uint8Array(map.tiles.length);
  const l = state.layers[LANDMARK_LAYER];
  const { width, height } = map;
  if (l) {
    for (const c of state.cities) {
      c.landmarks.forEach((lm, idx) => {
        if (lm.id !== 'park') return;
        // the 2×2 block at pos, where the LANDMARK layer still names this landmark
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const x = lm.pos.x + dx;
            const y = lm.pos.y + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = y * width + x;
            if (l[i] === idx + 1) mask[i] = 1;
          }
        }
      });
    }
  }
  cache = { count, month, mask };
  parksByMap.set(map, cache);
  return mask;
}

interface DirtySet {
  list: number[];
  member: Uint8Array;
}

/**
 * Indices of tiles with non-zero pollution, per map (not part of GameState). Built by a full scan the
 * first time a map is seen (new game, loaded save, test fixture), then kept up to date by smogDay,
 * the only sim code that writes tile pollution.
 */
const dirtyByMap = new WeakMap<GameMap, DirtySet>();

function dirtyTiles(map: GameMap): DirtySet {
  let d = dirtyByMap.get(map);
  if (!d) {
    d = { list: [], member: new Uint8Array(map.tiles.length) };
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i].pollution !== 0) {
        d.member[i] = 1;
        d.list.push(i);
      }
    }
    dirtyByMap.set(map, d);
  }
  return d;
}

/** Mean tile pollution over the city's urban tiles, 0..1. */
export function cityPollution(state: GameState, cityId: number): number {
  let sum = 0;
  let n = 0;
  for (const t of state.map.tiles) {
    if (t.cityId !== cityId) continue;
    sum += t.pollution;
    n++;
  }
  return n === 0 ? 0 : Math.min(1, sum / n / POLLUTION_CAP);
}

/** Writes `city.pollution` for every city. */
export function refreshCityPollution(state: GameState): void {
  // one pass over the map for all cities; sums run in tile order, so results equal cityPollution()
  let maxId = -1;
  for (const c of state.cities) maxId = Math.max(maxId, c.id);
  if (maxId < 0) return;
  const sum = new Float64Array(maxId + 1);
  const n = new Float64Array(maxId + 1);
  const { tiles } = state.map;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const id = t.cityId;
    if (id === null || id < 0 || id > maxId) continue;
    sum[id] += t.pollution;
    n[id]++;
  }
  for (const c of state.cities) c.pollution = n[c.id] === 0 ? 0 : Math.min(1, sum[c.id] / n[c.id] / POLLUTION_CAP);
}

/** Smog headlines (the pollution warning here, and the tier-1 smog editorial in society/escalation.ts). */
export const HEADLINES: ((city: string) => [string, string])[] = [
  (c) => [`Citizens of ${c} cough in protest`, `Smoke hangs over ${c} and the townsfolk are not amused.`],
  (c) => [`${c} chokes under a pall of smoke`, `Washing hung out in ${c} comes back dirtier than it went out.`],
  (c) => [`Soot rains on ${c}`, `Doctors in ${c} report a rise in coughs and complaints.`],
  (c) => [`${c} mayor demands cleaner air`, `The chimneys around ${c} are drawing angry letters.`],
];

/**
 * Monthly: warns about smoggy cities (at most once per game year per city) and sets
 * `happiness = 0.6 × avg satisfaction + 0.4 × (1 − pollution)`.
 * Ordering: this system is registered after `upkeep`, whose growthMonth has just written the average
 * satisfaction into `city.happiness`; we own the final value. `city.pollution` was refreshed on the
 * month's last day (see `pollutionSystem.onDay`), so growthMonth already grew with the current figure.
 */
export function pollutionMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const city of state.cities) {
    city.happiness = 0.6 * city.happiness + 0.4 * (1 - city.pollution);
    const key = `smogWarn${city.id}`;
    if (city.pollution > WARN_THRESHOLD && state.flags[key] !== state.date.year) {
      state.flags[key] = state.date.year;
      const [headline, body] = HEADLINES[(city.id + state.date.year) % HEADLINES.length](city.name);
      publishNews(ctx, 'warning', headline, body);
    }
  }
}

export const pollutionSystem = {
  id: 'pollution',
  onDay(ctx: SimContext): void {
    // SYSTEMS is append-only, so today's weather is rolled here, just before the smog moves
    weatherDay(ctx);
    smogDay(ctx);
    // the month's last day: refresh city figures before upkeep's growthMonth runs
    if (ctx.state.date.day >= 30) refreshCityPollution(ctx.state);
  },
  onMonth: pollutionMonth,
};
