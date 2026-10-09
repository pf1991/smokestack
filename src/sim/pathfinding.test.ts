import { describe, it, expect } from 'vitest';
import { findPath, roadPassable, railPassable, roadBuildable, waterAvoidingCost } from './pathfinding';
import type { GameMap, Tile, Terrain } from './types';

function tile(terrain: Terrain = 'grass', road = false): Tile {
  return { terrain, deposit: null, road, rail: false, buildingId: null, cityId: null, pollution: 0 };
}
function makeMap(w: number, h: number, road = true, terrain: Terrain = 'grass'): GameMap {
  const tiles: Tile[] = [];
  for (let i = 0; i < w * h; i++) tiles.push(tile(terrain, road));
  return { width: w, height: h, tiles };
}

describe('findPath', () => {
  it('straight road path', () => {
    const m = makeMap(6, 1);
    const p = findPath(m, { x: 0, y: 0 }, [{ x: 5, y: 0 }], roadPassable)!;
    expect(p).toHaveLength(6);
    expect(p[0]).toEqual({ x: 0, y: 0 });
    expect(p[5]).toEqual({ x: 5, y: 0 });
  });

  it('detours around gap', () => {
    const m = makeMap(5, 3);
    m.tiles[1 * 5 + 2].road = false;
    const p = findPath(m, { x: 0, y: 1 }, [{ x: 4, y: 1 }], roadPassable)!;
    expect(p).toHaveLength(7);
    expect(p.some((v) => v.x === 2 && v.y === 1)).toBe(false);
  });

  it('null when disconnected', () => {
    const m = makeMap(5, 1);
    m.tiles[2].road = false;
    expect(findPath(m, { x: 0, y: 0 }, [{ x: 4, y: 0 }], roadPassable)).toBeNull();
  });

  it('multi-target picks nearest', () => {
    const m = makeMap(10, 1);
    const p = findPath(m, { x: 4, y: 0 }, [{ x: 9, y: 0 }, { x: 2, y: 0 }], roadPassable)!;
    expect(p[p.length - 1]).toEqual({ x: 2, y: 0 });
    expect(p).toHaveLength(3);
  });

  it('from equals target returns [from]', () => {
    const m = makeMap(3, 3, false);
    expect(findPath(m, { x: 1, y: 1 }, [{ x: 1, y: 1 }], roadPassable)).toEqual([{ x: 1, y: 1 }]);
  });

  it('from need not be passable but targets must be', () => {
    const m = makeMap(3, 1);
    m.tiles[0].road = false;
    expect(findPath(m, { x: 0, y: 0 }, [{ x: 2, y: 0 }], roadPassable)).toHaveLength(3);
    m.tiles[2].road = false;
    expect(findPath(m, { x: 0, y: 0 }, [{ x: 2, y: 0 }], roadPassable)).toBeNull();
  });

  it('out-of-bounds returns null', () => {
    const m = makeMap(3, 3);
    expect(findPath(m, { x: -1, y: 0 }, [{ x: 2, y: 2 }], roadPassable)).toBeNull();
    expect(findPath(m, { x: 0, y: 0 }, [{ x: 9, y: 9 }], roadPassable)).toBeNull();
    expect(findPath(m, { x: 0, y: 0 }, [], roadPassable)).toBeNull();
  });

  it('stepCost avoids water', () => {
    const m = makeMap(5, 3, false);
    for (let x = 1; x < 4; x++) m.tiles[1 * 5 + x].terrain = 'water';
    const p = findPath(m, { x: 0, y: 1 }, [{ x: 4, y: 1 }], () => true, waterAvoidingCost)!;
    expect(p.some((v) => m.tiles[v.y * 5 + v.x].terrain === 'water')).toBe(false);
  });

  it('predicates', () => {
    const t = tile();
    expect(roadPassable(t, 0, 0)).toBe(false);
    expect(railPassable({ ...t, rail: true }, 0, 0)).toBe(true);
    expect(roadBuildable(tile('mountain'), 0, 0)).toBe(false);
    expect(roadBuildable({ ...t, buildingId: 1 }, 0, 0)).toBe(false);
    expect(roadBuildable({ ...t, cityId: 1 }, 0, 0)).toBe(false);
    expect(roadBuildable({ ...t, cityId: 1, road: true }, 0, 0)).toBe(true);
    expect(roadBuildable(tile('water'), 0, 0)).toBe(true);
    expect(waterAvoidingCost(tile('water'))).toBe(8);
    expect(waterAvoidingCost(t)).toBe(1);
  });

  it('128x96 open-field corner-to-corner under 30 ms', () => {
    const m = makeMap(128, 96);
    const a = { x: 0, y: 0 };
    const b = { x: 127, y: 95 };
    findPath(m, a, [b], roadPassable);
    const t0 = performance.now();
    const p = findPath(m, a, [b], roadPassable)!;
    const dt = performance.now() - t0;
    expect(p).toHaveLength(128 + 96 - 1);
    expect(dt).toBeLessThan(30);
  });
});
