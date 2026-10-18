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

  it('flags tile pollution that is non-finite or outside [0, cap]', () => {
    for (const bad of [NaN, Infinity, -0.5, 100.5]) {
      const state = createGame({ seed: 7 });
      state.map.tiles[123].pollution = bad;
      const msgs = checkInvariants(state);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain('pollution');
    }
  });

  it('flags wind components outside [-1, 1]', () => {
    for (const [windX, windY] of [[1.2, 0], [0, -1.01], [NaN, 0]]) {
      const state = createGame({ seed: 7 });
      state.weather = { ...state.weather, windX, windY };
      const msgs = checkInvariants(state);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain('wind');
    }
  });

  it('flags a non-boolean rain flag and a bad rainDays count', () => {
    for (const patch of [{ rain: 1 }, { rain: undefined }, { rainDays: -1 }, { rainDays: NaN }, { rainDays: '2' }]) {
      const state = createGame({ seed: 7 });
      state.weather = { ...state.weather, ...(patch as object) };
      const msgs = checkInvariants(state);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatch(/rain/);
    }
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
      stuckNotified: false, builtYear: 1900, model: 'steam_lorry', speed: 0.5,
    };
    state.vehicles[v.id] = v;
    const msgs = checkInvariants(state);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('999');
  });
});
