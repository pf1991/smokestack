import { describe, expect, it } from 'vitest';
import { err } from '../core/result';
import { migrateSave, type Migration } from './migrations';

describe('migrateSave', () => {
  it('rejects a SMOKESTACK I save', () => {
    expect(migrateSave({ version: 1 })).toEqual(err('Save from SMOKESTACK I cannot be loaded in this version'));
  });
  it('rejects a save from a newer version', () => {
    expect(migrateSave({ version: 99 })).toEqual(err('Save from a newer version of SMOKESTACK'));
  });
  it('rejects a non-numeric version', () => {
    expect(migrateSave({ version: 'x' })).toEqual(err('Save file is corrupted'));
  });
  it('applies migrations in order up to current', () => {
    const seen: number[] = [];
    const ms: Migration[] = [3, 2].map((from) => ({ from, migrate: (o) => { seen.push(from); o[`m${from}`] = true; } }));
    const r = migrateSave({ version: 2 }, ms, 4);
    expect(seen).toEqual([2, 3]);
    expect(r.ok && r.value).toMatchObject({ version: 4, m2: true, m3: true });
  });
  it('fails when a migration step is missing', () => {
    expect(migrateSave({ version: 2 }, [], 3)).toEqual(err('Save from an incompatible version'));
  });
});
