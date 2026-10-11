import { err, ok, type Result } from '../core/result';

/** Current save format. Lives here (simulation.ts re-exports it) so this module never imports simulation. */
export const SAVE_VERSION = 2;
/** Oldest version that can still be loaded; SMOKESTACK I saves (version 1) are refused. */
export const MIN_SAVE_VERSION = 2;

/** Upgrades a raw save object in place from `from` to `from + 1`. */
export interface Migration {
  from: number;
  migrate(o: Record<string, unknown>): void;
}

/** Append-only; later phases add one entry per version bump. */
export const MIGRATIONS: Migration[] = [];

/** Upgrades a raw save to `current`. Mutates `o` and sets `o.version`. Never throws. */
export function migrateSave(
  o: Record<string, unknown>,
  migrations: Migration[] = MIGRATIONS,
  current: number = SAVE_VERSION,
): Result<Record<string, unknown>> {
  const v = o.version;
  if (typeof v !== 'number' || !Number.isInteger(v)) return err('Save file is corrupted');
  if (v < MIN_SAVE_VERSION) return err('Save from SMOKESTACK I cannot be loaded in this version');
  if (v > current) return err('Save from a newer version of SMOKESTACK');
  for (let from = v; from < current; from++) {
    const m = migrations.find((x) => x.from === from);
    if (!m) return err('Save from an incompatible version');
    m.migrate(o);
  }
  o.version = current;
  return ok(o);
}
