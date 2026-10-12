import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { runAutoplay } from '../game/autoplay';
import { packState, unpackState } from '../game/saves';
import { stateHash } from './hash';
import { runDays } from './simulation';
import { createGame } from './state';
import type { SimContext } from './types';

function start(seed: number): SimContext {
  const ctx = { state: createGame({ seed }), bus: new EventBus() };
  const r = runAutoplay(ctx);
  expect(r.ok ? 'ok' : r.error).toBe('ok');
  return ctx;
}

function run(seed: number, days: number): string {
  const ctx = start(seed);
  runDays(ctx, days);
  return stateHash(ctx.state);
}

describe('determinism', () => {
  it('stateHash is 8 hex digits and ignores speed', () => {
    const state = createGame({ seed: 7 });
    const h = stateHash(state);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(stateHash({ ...state, speed: 8 })).toBe(h);
  });

  it('two runs of the same seed hash equal; another seed differs', () => {
    const a = run(7, 720);
    expect(run(7, 720)).toBe(a);
    expect(run(8, 720)).not.toBe(a);
  });

  it('save → load → continue matches an uninterrupted run', () => {
    const a = start(7);
    runDays(a, 720);

    const b = start(7);
    runDays(b, 360);
    // the save carries a populated layer: towns have raised landmarks by now
    expect(b.state.cities.some((c) => c.landmarks.length > 0)).toBe(true);
    expect(b.state.layers.landmark?.some((v) => v > 0)).toBe(true);
    const loaded = unpackState(packState(b.state));
    expect(loaded.ok ? 'ok' : loaded.error).toBe('ok');
    if (!loaded.ok) return;
    const c: SimContext = { state: loaded.value, bus: new EventBus() };
    runDays(c, 360);

    expect(stateHash(c.state)).toBe(stateHash(a.state));
  });
});
