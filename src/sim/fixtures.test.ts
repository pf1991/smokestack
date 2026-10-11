import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { unpackState } from '../game/saves';
import { checkInvariants } from './invariants';
import { runDays } from './simulation';

// Vite's glob (no @types/node in this project): every fixture save from each phase.
const fixtures = import.meta.glob('./__fixtures__/*.save.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('fixture saves', () => {
  it('finds at least one fixture', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
  });
  for (const [path, raw] of Object.entries(fixtures)) {
    it(`${path} loads, holds invariants and survives 30 days`, () => {
      const r = unpackState(raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(checkInvariants(r.value)).toEqual([]);
      const ctx = { state: r.value, bus: new EventBus() };
      runDays(ctx, 30);
      expect(checkInvariants(ctx.state)).toEqual([]);
    });
  }
});
