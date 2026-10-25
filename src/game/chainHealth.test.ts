import { describe, expect, it } from 'vitest';
import { storeStocked } from '../sim/inventory';
import { testState } from '../sim/testkit';
import type { Building, BuildingStatus, GameState } from '../sim/types';
import { chainHealth, segmentTone } from './chainHealth';

function mk(
  state: GameState,
  id: number,
  status: BuildingStatus,
  typeId: string,
  ownerId: 'player' | 'rival' = 'player',
): Building {
  const b = {
    id, typeId, ownerId, pos: { x: 1, y: 1 }, recipeId: null, input: {}, output: {}, progress: 0, status,
    cityId: null, haltedUntil: null, producedThisMonth: {}, staffing: 1, builtYear: 1900, level: 1,
  } as unknown as Building;
  state.buildings[id] = b;
  return b;
}

describe('chainHealth', () => {
  it('scores empty when the player has no chain buildings', () => {
    const s = testState();
    expect(chainHealth(s)).toEqual({
      inputs: { total: 0, broken: 0, jumpId: null },
      works: { total: 0, broken: 0, jumpId: null },
      shelves: { total: 0, broken: 0, jumpId: null },
    });
  });

  it('counts starved works under Inputs and idle under Works', () => {
    const s = testState();
    mk(s, 1, 'no_input', 'sawmill');
    mk(s, 2, 'idle', 'furniture_factory');
    mk(s, 3, 'ok', 'steel_mill');
    const h = chainHealth(s);
    expect(h.inputs).toEqual({ total: 3, broken: 1, jumpId: 1 });
    expect(h.works).toEqual({ total: 3, broken: 1, jumpId: 2 });
    expect(h.shelves.total).toBe(0);
  });

  it('counts empty player stores under Shelves and ignores stocked ones', () => {
    const s = testState();
    const empty = mk(s, 1, 'idle', 'store');
    const stocked = mk(s, 2, 'idle', 'store');
    stocked.input = { furniture: 2 };
    stocked.output = { furniture: 2 };
    expect(storeStocked(stocked)).toBe(true);
    expect(storeStocked(empty)).toBe(false);
    const h = chainHealth(s);
    expect(h.shelves).toEqual({ total: 2, broken: 1, jumpId: 1 });
  });

  it('ignores rival buildings and non-works logistics', () => {
    const s = testState();
    mk(s, 1, 'no_input', 'sawmill', 'rival');
    mk(s, 2, 'idle', 'warehouse');
    expect(chainHealth(s)).toEqual({
      inputs: { total: 0, broken: 0, jumpId: null },
      works: { total: 0, broken: 0, jumpId: null },
      shelves: { total: 0, broken: 0, jumpId: null },
    });
  });

  it('skips upgrading/halted stores for empty shelves (same as alerts)', () => {
    const s = testState();
    mk(s, 1, 'upgrading', 'store');
    mk(s, 2, 'halted', 'store');
    expect(chainHealth(s).shelves).toEqual({ total: 2, broken: 0, jumpId: null });
  });

  it('picks the lowest building id as jump target when several are broken', () => {
    const s = testState();
    mk(s, 5, 'no_input', 'sawmill');
    mk(s, 2, 'no_input', 'mine');
    expect(chainHealth(s).inputs.jumpId).toBe(2);
  });
});

describe('segmentTone', () => {
  it('is positive when nothing is broken, warning when some are, negative when all are', () => {
    expect(segmentTone({ total: 0, broken: 0, jumpId: null })).toBe('neutral');
    expect(segmentTone({ total: 3, broken: 0, jumpId: null })).toBe('positive');
    expect(segmentTone({ total: 3, broken: 1, jumpId: 1 })).toBe('warning');
    expect(segmentTone({ total: 3, broken: 3, jumpId: 1 })).toBe('negative');
  });
});
