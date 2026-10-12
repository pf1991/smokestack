import { describe, expect, it } from 'vitest';
import type { Building } from '../../sim/types';
import { BUILDING_HEIGHT } from '../sprites';
import { glowVisibleHeight } from './night';

const bld = (id: number, typeId: string, x: number, y: number): Building => ({ id, typeId, pos: { x, y } }) as unknown as Building;

describe('glowVisibleHeight', () => {
  it('keeps the whole glow when nothing drawn later covers it', () => {
    const list = [bld(1, 'sawmill', 2, 2)];
    expect(glowVisibleHeight(list, 0, 70, 150, 80, 10)).toBe(10);
  });
  it('cuts the glow where the raised roof of a building directly south covers the windows', () => {
    // sawmill footprint rows 2..4 (y 64..160); steel mill right below from row 5 (y 160), its roof raised above y 160
    const list = [bld(1, 'sawmill', 2, 2), bld(2, 'steel_mill', 2, 5)];
    const roofTop = 5 * 32 - BUILDING_HEIGHT.steel_mill;
    expect(glowVisibleHeight(list, 0, 70, 130, 80, 12)).toBe(roofTop - 130);
    expect(glowVisibleHeight(list, 0, 70, roofTop, 80, 12)).toBe(0);
  });
  it('ignores buildings drawn earlier or beside the windows', () => {
    const list = [bld(2, 'steel_mill', 2, 5), bld(1, 'sawmill', 2, 2), bld(3, 'store', 20, 5)];
    expect(glowVisibleHeight(list, 1, 70, 140, 80, 12)).toBe(12);
  });
});
