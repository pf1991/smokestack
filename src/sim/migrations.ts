import { err, ok, type Result } from '../core/result';
// state.ts imports SAVE_VERSION from here; the cycle is safe because neither module uses the
// other's bindings at load time (only inside functions).
import { layCityStreets, refreshUrbanTiles } from './state';
import type { GameState } from './types';

/** Current save format. Lives here (simulation.ts re-exports it) so this module never imports simulation. */
export const SAVE_VERSION = 3;
/** Oldest version that can still be loaded; SMOKESTACK I saves (version 1) are refused. */
export const MIN_SAVE_VERSION = 2;

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
      for (const c of state.cities) layCityStreets(state.map, c);
      refreshUrbanTiles(state);
    },
  },
];

/**
 * Upgrades a raw save to `current`. Mutates `o` and sets `o.version`. Never throws. Each migration
 * applied is appended to `applied`, so the loader can run its `afterLoad` hook (see runAfterLoad).
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
