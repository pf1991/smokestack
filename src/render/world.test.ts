import { describe, expect, it } from 'vitest';
import { flatMap } from '../sim/testkit';
import type { GameMap } from '../sim/types';
import { OVERLAYS, setOverlay, type Overlay } from './overlays';
import { roadMask } from './world';
import { isLevelCrossing } from './world/rails';
import { E, N, S, W } from './world/shared';

function withLayer(map: GameMap, tiles: [number, number][], layer: 'road' | 'rail' = 'road'): GameMap {
  for (const [x, y] of tiles) map.tiles[y * map.width + x][layer] = true;
  return map;
}

describe('roadMask', () => {
  it('roadMask crossroads === 15', () => {
    const map = withLayer(flatMap(5, 5), [[2, 2], [2, 1], [3, 2], [2, 3], [1, 2]]);
    expect(roadMask(map, 2, 2, 'road')).toBe(15);
  });

  it('roadMask dead-end east === 2', () => {
    const map = withLayer(flatMap(5, 5), [[2, 2], [3, 2]]);
    expect(roadMask(map, 2, 2, 'road')).toBe(2);
  });

  it('uses N=1 E=2 S=4 W=8, keeps layers separate and handles map edges', () => {
    const map = withLayer(flatMap(3, 3), [[0, 0], [0, 1]]);
    withLayer(map, [[1, 0]], 'rail');
    expect(roadMask(map, 0, 0, 'road')).toBe(4);
    expect(roadMask(map, 0, 1, 'road')).toBe(1);
    expect(roadMask(map, 1, 1, 'road')).toBe(8);
    expect(roadMask(map, 1, 0, 'rail')).toBe(0);
    expect(roadMask(map, 1, 1, 'rail')).toBe(1);
  });
});

describe('overlay registry', () => {
  it('overlay registry toggles', () => {
    const ov: Overlay = { id: 'test-overlay', enabled: false, draw: () => {} };
    OVERLAYS.push(ov);
    try {
      setOverlay('test-overlay', true);
      expect(OVERLAYS.find((o) => o.id === 'test-overlay')?.enabled).toBe(true);
      setOverlay('test-overlay', false);
      expect(ov.enabled).toBe(false);
      expect(() => setOverlay('missing', true)).not.toThrow();
    } finally {
      OVERLAYS.splice(OVERLAYS.indexOf(ov), 1);
    }
  });
});

describe('isLevelCrossing', () => {
  it('a road crossing the track is a crossing; track laid along the street is not', () => {
    // north-south track
    expect(isLevelCrossing(N | S, E | W)).toBe(true); // east-west road over it
    expect(isLevelCrossing(N | S, N | S | E | W)).toBe(true); // street intersection on the line
    expect(isLevelCrossing(N | S, N | S)).toBe(false); // lengthwise in a north-south street
    expect(isLevelCrossing(N | S, N)).toBe(false); // street end
    expect(isLevelCrossing(N, N | S)).toBe(false); // track end in the street (drawn as N|S)
    // east-west track
    expect(isLevelCrossing(E | W, N | S)).toBe(true);
    expect(isLevelCrossing(E | W, E | W)).toBe(false);
    expect(isLevelCrossing(0, E)).toBe(false); // lone track tile is drawn east-west
    // track turning off the street: the street carries on south
    expect(isLevelCrossing(N | E, N | S)).toBe(true);
    expect(isLevelCrossing(N | S, 0)).toBe(false);
  });
});
