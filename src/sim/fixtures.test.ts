import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { unpackState } from '../game/saves';
import { checkInvariants } from './invariants';
import { SAVE_VERSION } from './migrations';
import { runDays } from './simulation';
import { BASELINE_GOODS } from '../data/goods';
import { averageSatisfaction, demandModifier, monthlyDemand, satisfaction } from './market';

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
    it(`${path} loads (migrated to the current version), holds invariants and survives 30 days`, () => {
      const r = unpackState(raw);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.version).toBe(SAVE_VERSION);
      expect(checkInvariants(r.value)).toEqual([]);
      const ctx = { state: r.value, bus: new EventBus() };
      runDays(ctx, 30);
      expect(checkInvariants(ctx.state)).toEqual([]);
    });
  }

  it('the baseline rule keeps an old save\'s town satisfaction exactly as before R4 (phase4b, before any day runs)', () => {
    const raw = fixtures['./__fixtures__/phase4b.save.json'];
    expect(raw).toBeDefined();
    const r = unpackState(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = r.value;
    expect(state.cities.length).toBeGreaterThan(0);
    for (const city of state.cities) {
      // the pre-R4 formula: the mean over the wanted v1 goods, 0.4 when none is wanted
      const sats = [...BASELINE_GOODS]
        .filter((g) => monthlyDemand(city, g, state.date.year, demandModifier(state, city.id, g)) > 0)
        .map((g) => satisfaction(city, g));
      const before = sats.length > 0 ? sats.reduce((a, b) => a + b, 0) / sats.length : 0.4;
      expect(averageSatisfaction(state, city), city.name).toBeCloseTo(before, 12);
    }
  });
});
