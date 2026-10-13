/**
 * Heavy-industry regression (ruling R-S6): the revolt tier must be reachable on the real smog scale.
 * Steel mills ring a small town (pop 3000, urbanRadius 6) on a flat 80×60 map, their inputs refilled
 * daily so they never starve, for 5 years; the town's tier is sampled at every month end.
 */
import { describe, expect, it } from 'vitest';
import { placeBuilding } from '../state';
import { runDays } from '../simulation';
import { testCtx, testState } from '../testkit';
import type { Building } from '../types';

function heavyTown(mills: number): { placed: number; maxTier: number; monthsAt: number[] } {
  const ctx = testCtx(testState({ width: 80, height: 60, money: 1e9, cities: [{ x: 40, y: 30, population: 3000 }] }));
  const { state } = ctx;
  if (!state.unlocked.includes('r_steel')) state.unlocked.push('r_steel');
  const city = state.cities[0];
  const placed: Building[] = [];
  // rings just outside the town's land, 24 angles each, until `mills` are placed
  for (let r = city.urbanRadius + 1; r < city.urbanRadius + 12 && placed.length < mills; r++) {
    for (let a = 0; a < 24 && placed.length < mills; a++) {
      const x = Math.round(city.center.x + r * Math.cos((a / 24) * 2 * Math.PI));
      const y = Math.round(city.center.y + r * Math.sin((a / 24) * 2 * Math.PI));
      const res = placeBuilding(ctx, 'player', 'steel_mill', { x, y }, 'r_steel');
      if (res.ok) placed.push(res.value);
    }
  }
  const monthsAt = [0, 0, 0, 0, 0];
  let maxTier = 0;
  for (let m = 0; m < 60; m++) {
    for (let d = 0; d < 30; d++) {
      for (const b of placed) {
        b.input = { iron_ore: 100, coal: 100 };
        b.output = {};
      }
      runDays(ctx, 1);
    }
    monthsAt[city.smog.tier]++;
    maxTier = Math.max(maxTier, city.smog.tier);
  }
  return { placed: placed.length, maxTier, monthsAt };
}

describe('heavy industry escalates (R-S6)', () => {
  it('12 steel mills around a small town reach tier 3 or worse within 5 years', () => {
    const r = heavyTown(12);
    expect(r.placed).toBe(12);
    expect(r.maxTier).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('20 steel mills reach the revolt tier (4)', () => {
    const r = heavyTown(20);
    expect(r.placed).toBe(20);
    expect(r.maxTier).toBe(4);
  }, 30_000);
});
