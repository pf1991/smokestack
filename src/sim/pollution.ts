import { BUILDINGS } from '../data/buildings';
import { footprint } from './state';
import { publishNews } from './news';
import type { GameState, SimContext } from './types';

export const POLLUTION_RADIUS = 3;
export const POLLUTION_DECAY = 0.97;
export const POLLUTION_CAP = 100;
export const WARN_THRESHOLD = 0.5;
const SOURCE_FACTOR = 2;

/** Precomputed falloff weights for dx,dy in [-R, R]; 0 outside the radius. */
const SIDE = POLLUTION_RADIUS * 2 + 1;
const KERNEL = new Float64Array(SIDE * SIDE);
for (let dy = -POLLUTION_RADIUS; dy <= POLLUTION_RADIUS; dy++) {
  for (let dx = -POLLUTION_RADIUS; dx <= POLLUTION_RADIUS; dx++) {
    const d = Math.hypot(dx, dy);
    KERNEL[(dy + POLLUTION_RADIUS) * SIDE + dx + POLLUTION_RADIUS] = d <= POLLUTION_RADIUS ? 1 - d / 4 : 0;
  }
}

/**
 * Daily pollution step: every 'ok' building adds `def.pollution × 2 × (1 − d/4)` to tiles within
 * radius 3 (Euclidean d) of its centre tile, then every tile decays 3%, capped at 100.
 */
export function pollutionDay(ctx: SimContext): void {
  const { map, buildings } = ctx.state;
  const { width, height, tiles } = map;
  for (const b of Object.values(buildings)) {
    if (b.status !== 'ok') continue;
    const amount = BUILDINGS[b.typeId].pollution * SOURCE_FACTOR;
    if (amount <= 0) continue;
    const fp = footprint(b);
    const c = fp[Math.floor(fp.length / 2)];
    for (let dy = -POLLUTION_RADIUS; dy <= POLLUTION_RADIUS; dy++) {
      const y = c.y + dy;
      if (y < 0 || y >= height) continue;
      for (let dx = -POLLUTION_RADIUS; dx <= POLLUTION_RADIUS; dx++) {
        const x = c.x + dx;
        if (x < 0 || x >= width) continue;
        const k = KERNEL[(dy + POLLUTION_RADIUS) * SIDE + dx + POLLUTION_RADIUS];
        if (k === 0) continue;
        tiles[y * width + x].pollution += amount * k;
      }
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const p = t.pollution * POLLUTION_DECAY;
    t.pollution = p > POLLUTION_CAP ? POLLUTION_CAP : p < 1e-4 ? 0 : p;
  }
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
  for (const c of state.cities) c.pollution = cityPollution(state, c.id);
}

const HEADLINES: ((city: string) => [string, string])[] = [
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
    pollutionDay(ctx);
    // the month's last day: refresh city figures before upkeep's growthMonth runs
    if (ctx.state.date.day >= 30) refreshCityPollution(ctx.state);
  },
  onMonth: pollutionMonth,
};
