import { err, ok, type Result } from '../core/result';
import { LANDMARK_LAYER } from './landmarkTiles';
import { defaultOpinion } from '../data/factions';
import { monthIndex, newCityPolitics } from './politics/elections';
import { chooseMayorEdicts } from './politics/mayorEdicts';
import { defaultPolitics } from './politics/types';
import { defaultWeather } from './weather';
import { newCitySmog } from './society/tiers';
import { layCityStreets, refreshUrbanTiles } from './state';
import type { City, GameState } from './types';
import { MIN_SAVE_VERSION, SAVE_VERSION } from './version';

// versions live in the leaf module version.ts (state.ts needs SAVE_VERSION and must not import this module)
export { MIN_SAVE_VERSION, SAVE_VERSION };

/**
 * Upgrades a save from `from` to `from + 1`. `migrate` runs on the raw parsed object (tiles may still
 * be packed). `afterLoad`, when present, runs on the fully rebuilt GameState (tiles and layers
 * unpacked) before any validation, for steps that need the real simulation helpers.
 */
export interface Migration {
  from: number;
  migrate(o: Record<string, unknown>): void;
  afterLoad?(state: GameState): void;
}

/** Append-only; later phases add one entry per version bump. */
export const MIGRATIONS: Migration[] = [
  {
    // v3: cities spread (urbanRadius grows with sqrt(population), up to 16) and lay streets in the new ring
    from: 2,
    migrate: () => {},
    afterLoad(state) {
      // mark the new discs first, so each city's grid stops where a nearer city's land begins
      refreshUrbanTiles(state);
      for (const c of state.cities) layCityStreets(state.map, c, state.layers[LANDMARK_LAYER]);
    },
  },
  {
    // v4: cities raise landmarks (sim/landmarks.ts); older cities start with none
    from: 3,
    migrate(o) {
      const cities = o.cities;
      if (!Array.isArray(cities)) throw new Error('bad cities');
      for (const c of cities as Record<string, unknown>[]) c.landmarks = [];
    },
  },
  {
    // v5: Phase 2 politics. Every town gets the default faction opinion and the company default
    // politics; every building starts at `staffing: 1`. The drivers' bookkeeping starts unprimed, so
    // existing buildings and finished contracts are snapshotted at the first month rather than
    // counted as new. Frozen at merge; Phase 3 adds from: 5.
    from: 4,
    migrate(o) {
      const cities = o.cities;
      if (!Array.isArray(cities)) throw new Error('bad cities');
      const date = o.date as { year?: unknown; month?: unknown } | undefined;
      if (typeof date?.year !== 'number' || typeof date.month !== 'number') throw new Error('bad date');
      const now = monthIndex({ year: date.year, month: date.month });
      (cities as Record<string, unknown>[]).forEach((c, i) => {
        c.opinion = defaultOpinion();
        c.politics = newCityPolitics(i, date.year as number, now);
        // the default mayor's edicts (chooseMayorEdicts reads only the mayor and the opinion set above)
        (c.politics as { edicts: unknown }).edicts = chooseMayorEdicts(c as unknown as City);
      });
      o.politics = defaultPolitics(false);
      // event cards: the first spring draw is the next 1 April this save reaches (never before 1901)
      const day = (o.date as { day?: unknown }).day;
      const pastSpring = date.month > 4 || (date.month === 4 && typeof day === 'number' && day > 1);
      (o.politics as { nextCardYear: number }).nextCardYear = Math.max(1901, date.year + (pastSpring ? 1 : 0));
      // workforce: every building starts fully staffed until the first monthly recompute
      const buildings = o.buildings;
      if (buildings !== undefined) {
        if (typeof buildings !== 'object' || buildings === null) throw new Error('bad buildings');
        for (const b of Object.values(buildings as Record<string, Record<string, unknown>>)) b.staffing = 1;
      }
    },
  },
  {
    // v6: Phase 3 smog and society. Weather starts calm and dry, blowing the month's prevailing wind.
    // Every town starts clean of escalation (tier 0, no Black Lung) with its smog level at its
    // current pollution. Later Phase 3 tasks extend this entry until the phase merges.
    from: 5,
    migrate(o) {
      const date = o.date as { month?: unknown } | undefined;
      if (typeof date?.month !== 'number') throw new Error('bad date');
      o.weather = defaultWeather(date.month);
      const cities = o.cities;
      if (!Array.isArray(cities)) throw new Error('bad cities');
      for (const c of cities as Record<string, unknown>[]) {
        c.smog = newCitySmog(typeof c.pollution === 'number' && Number.isFinite(c.pollution) ? c.pollution : 0);
      }
      // strikes (Task 4): no building is on strike
      const buildings = o.buildings;
      if (buildings !== undefined) {
        if (typeof buildings !== 'object' || buildings === null) throw new Error('bad buildings');
        for (const b of Object.values(buildings as Record<string, Record<string, unknown>>)) b.strike = null;
      }
    },
  },
];

/**
 * Upgrades a raw save to `current`. Mutates `o` and sets `o.version`. Never throws. Each migration
 * applied is appended to `applied`; the loader (unpackState) runs their `afterLoad` hooks with
 * runAfterLoad once the state is fully rebuilt.
 */
export function migrateSave(
  o: Record<string, unknown>,
  migrations: Migration[] = MIGRATIONS,
  current: number = SAVE_VERSION,
  applied: Migration[] = [],
): Result<Record<string, unknown>> {
  const v = o.version;
  if (typeof v !== 'number' || !Number.isInteger(v)) return err('Save file is corrupted');
  if (v < MIN_SAVE_VERSION) return err('Save from SMOKESTACK I cannot be loaded in this version');
  if (v > current) return err('Save from a newer version of SMOKESTACK');
  for (let from = v; from < current; from++) {
    const m = migrations.find((x) => x.from === from);
    if (!m) return err('Save from an incompatible version');
    try {
      m.migrate(o);
    } catch {
      return err('Save file is corrupted');
    }
    applied.push(m);
  }
  o.version = current;
  return ok(o);
}

/** Runs the `afterLoad` hook of each applied migration, in order. Never throws. */
export function runAfterLoad(state: GameState, applied: Migration[]): Result {
  try {
    for (const m of applied) m.afterLoad?.(state);
  } catch {
    return err('Save file is corrupted');
  }
  return ok();
}
