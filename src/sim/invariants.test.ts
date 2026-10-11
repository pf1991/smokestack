import { describe, expect, it } from 'vitest';
import { checkInvariants } from './invariants';
import { createGame } from './state';
import type { Vehicle } from './types';

describe('checkInvariants', () => {
  it('a fresh game is healthy', () => {
    expect(checkInvariants(createGame({ seed: 7 }))).toEqual([]);
  });

  it('flags a non-finite company balance', () => {
    const state = createGame({ seed: 7 });
    state.companies.player.money = NaN;
    const msgs = checkInvariants(state);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('player');
  });

  it('flags a vehicle on a missing route', () => {
    const state = createGame({ seed: 7 });
    const v: Vehicle = {
      id: 500,
      kind: 'truck',
      ownerId: 'player',
      routeId: 999,
      pos: { x: 0, y: 0 },
      prevPos: { x: 0, y: 0 },
      path: [],
      pathIndex: 0,
      stopIndex: 0,
      cargo: {},
      capacity: 10,
      state: 'idle',
      waitTicks: 0,
      stuckNotified: false,
    };
    state.vehicles[v.id] = v;
    const msgs = checkInvariants(state);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('999');
  });
});
