import { describe, it, expect } from 'vitest';
import { generateMap, tileAt, tileIndex } from './mapgen';
import type { GameMap, Tile } from './types';

const W = 128;
const H = 96;

function clusters(map: GameMap, good: string): number {
  const seen = new Set<number>();
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i].deposit !== good || seen.has(i)) continue;
    n++;
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % map.width;
      const y = Math.floor(j / map.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = tileAt(map, x + dx, y + dy);
        if (t && t.deposit === good) {
          const k = tileIndex(map, x + dx, y + dy);
          if (!seen.has(k)) {
            seen.add(k);
            stack.push(k);
          }
        }
      }
    }
  }
  return n;
}

describe('generateMap', () => {
  it('is deterministic', () => {
    expect(generateMap(7)).toEqual(generateMap(7));
    expect(generateMap(8)).not.toEqual(generateMap(7));
  });

  it('has the right dimensions', () => {
    const { map } = generateMap(7);
    expect(map.width).toBe(W);
    expect(map.height).toBe(H);
    expect(map.tiles.length).toBe(W * H);
  });

  it('is at least 55% land', () => {
    for (const seed of [1, 7, 42, 99]) {
      const { map } = generateMap(seed);
      const land = map.tiles.filter((t) => t.terrain !== 'water').length;
      expect(land / map.tiles.length).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('places five well-spread cities on grass', () => {
    for (const seed of [1, 7, 42, 99]) {
      const { map, cities } = generateMap(seed);
      expect(cities).toHaveLength(5);
      expect(new Set(cities.map((c) => c.name)).size).toBe(5);
      cities.forEach((c, i) => {
        expect(c.id).toBe(i);
        expect(tileAt(map, c.center.x, c.center.y)!.terrain).toBe('grass');
        expect(c.center.x).toBeGreaterThanOrEqual(6);
        expect(c.center.y).toBeGreaterThanOrEqual(6);
        expect(c.center.x).toBeLessThanOrEqual(W - 1 - 6);
        expect(c.center.y).toBeLessThanOrEqual(H - 1 - 6);
        expect(c.population).toBeGreaterThanOrEqual(2000);
        expect(c.population).toBeLessThanOrEqual(12000);
        expect(c.prevPopulation).toBe(c.population);
        expect(c.happiness).toBe(0.7);
        expect(c.pollution).toBe(0);
        expect(c.market).toEqual({});
        expect(c.urbanRadius).toBe(3 + Math.floor(c.population / 3000));
        for (let j = i + 1; j < cities.length; j++) {
          const d = Math.hypot(c.center.x - cities[j].center.x, c.center.y - cities[j].center.y);
          expect(d).toBeGreaterThanOrEqual(25);
        }
      });
    }
  });

  it('puts deposits on legal terrain with enough clusters', () => {
    for (const seed of [1, 7, 42, 99]) {
      const { map } = generateMap(seed);
      for (const t of map.tiles) {
        if (t.deposit === 'iron_ore' || t.deposit === 'coal') {
          expect(['hills', 'mountain']).toContain(t.terrain);
        } else if (t.deposit === 'oil') {
          expect(['grass', 'sand']).toContain(t.terrain);
        } else {
          expect(t.deposit).toBeNull();
        }
      }
      for (const g of ['iron_ore', 'coal', 'oil']) {
        expect(clusters(map, g)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('has no roads or buildings yet', () => {
    const { map } = generateMap(7);
    for (const t of map.tiles) {
      expect(t.road).toBe(false);
      expect(t.rail).toBe(false);
      expect(t.buildingId).toBeNull();
      expect(t.cityId).toBeNull();
      expect(t.pollution).toBe(0);
    }
  });

  it('is fast', () => {
    generateMap(5);
    const t0 = performance.now();
    generateMap(5);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it('every city has iron, coal, forest and sand nearby', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { map, cities } = generateMap(seed);
      const near = (c: { x: number; y: number }, r: number, pred: (t: Tile) => boolean) =>
        map.tiles.some(
          (t, i) => pred(t) && Math.hypot((i % map.width) - c.x, Math.floor(i / map.width) - c.y) <= r,
        );
      for (const city of cities) {
        const c = city.center;
        expect(near(c, 20, (t) => t.deposit === 'iron_ore')).toBe(true);
        expect(near(c, 20, (t) => t.deposit === 'coal')).toBe(true);
        expect(near(c, 25, (t) => t.terrain === 'forest')).toBe(true);
        expect(near(c, 25, (t) => t.terrain === 'sand')).toBe(true);
      }
    }
  });

  it('has terrain variety', () => {
    let water = 0;
    let mountain = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { map } = generateMap(seed);
      total += map.tiles.length;
      for (const t of map.tiles) {
        if (t.terrain === 'water') water++;
        if (t.terrain === 'mountain') mountain++;
      }
    }
    expect(water / total).toBeGreaterThanOrEqual(0.1);
    expect(mountain / total).toBeGreaterThanOrEqual(0.02);
  });

  it('small map throws a clear error (cities cannot fit 25 tiles apart)', () => {
    expect(() => generateMap(1, 64, 48)).toThrow(/mapgen: no valid map found/);
  });
});
