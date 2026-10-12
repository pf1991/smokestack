import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../core/events';
import { runAutoplay } from '../game/autoplay';
import { LANDMARKS } from '../data/landmarks';
import { findLandmarkSite, landmarksMonth } from './landmarks';
import { layer, layerAt } from './layers';
import { buildRail, ensureRailLink } from './rail';
import { buildRoad, canPlaceBuilding, createGame, layCityStreets, placeBuilding, refreshUrbanTiles } from './state';
import { must, testCtx, testState } from './testkit';
import type { City, GameState, SimContext, Vec2 } from './types';

const tile = (s: GameState, x: number, y: number) => s.map.tiles[y * s.map.width + x];
const block = (p: Vec2): Vec2[] => [p, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x + 1, y: p.y + 1 }];

function townCtx(population = 6000, year = 1900): SimContext {
  return testCtx(testState({ cities: [{ x: 20, y: 15, population }], streets: true, year, money: 10_000_000 }));
}

describe('LANDMARKS', () => {
  it('has the unlock table in build order', () => {
    expect(Object.values(LANDMARKS).map((l) => [l.id, l.minPop, l.minYear, l.size])).toEqual([
      ['church', 1500, 1900, 2],
      ['town_hall', 5000, 1900, 2],
      ['grand_station', 9000, 1900, 2],
      ['library', 14000, 1905, 2],
      ['stadium', 25000, 1920, 2],
      ['skyscraper', 45000, 1930, 2],
    ]);
    for (const l of Object.values(LANDMARKS)) expect(l.news).toContain('{city}');
  });
});

describe('landmarksMonth', () => {
  it('a 6,000 town in 1900 gets a church, then a town hall, then nothing until it grows', () => {
    const ctx = townCtx();
    const city = ctx.state.cities[0];
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));

    landmarksMonth(ctx);
    expect(city.landmarks.map((l) => l.id)).toEqual(['church']);
    landmarksMonth(ctx);
    expect(city.landmarks.map((l) => l.id)).toEqual(['church', 'town_hall']);
    landmarksMonth(ctx);
    landmarksMonth(ctx);
    expect(city.landmarks.map((l) => l.id)).toEqual(['church', 'town_hall']);

    const built = events.filter((e) => e.type === 'landmarkBuilt');
    expect(built).toEqual([
      { type: 'landmarkBuilt', cityId: 0, id: 'church' },
      { type: 'landmarkBuilt', cityId: 0, id: 'town_hall' },
    ]);
    expect(ctx.state.news.map((n) => n.kind)).toEqual(['historic', 'historic']);
    expect(ctx.state.news[0].headline).toContain('TOWN 0');

    // layer value = index + 1 on all 4 tiles
    city.landmarks.forEach((l, i) => {
      for (const p of block(l.pos)) expect(layerAt(ctx.state, 'landmark', p.x, p.y)).toBe(i + 1);
    });

    city.population = 9500;
    landmarksMonth(ctx);
    expect(city.landmarks.map((l) => l.id)).toEqual(['church', 'town_hall', 'grand_station']);
  });

  it('waits for the era: a 30,000 city in 1900 never builds a library or stadium', () => {
    const ctx = townCtx(30000, 1900);
    for (let i = 0; i < 6; i++) landmarksMonth(ctx);
    expect(ctx.state.cities[0].landmarks.map((l) => l.id)).toEqual(['church', 'town_hall', 'grand_station']);
  });

  it('processes cities in id order, one landmark per city per month', () => {
    const ctx = testCtx(testState({ width: 60, cities: [{ x: 12, y: 15, population: 6000 }, { x: 45, y: 15, population: 6000 }], streets: true }));
    const order: number[] = [];
    ctx.bus.on('landmarkBuilt', (e) => order.push(e.cityId));
    landmarksMonth(ctx);
    expect(order).toEqual([0, 1]);
    expect(ctx.state.cities.map((c) => c.landmarks.length)).toEqual([1, 1]);
  });

  it('a city whose disc is fully built gets no site and no landmark', () => {
    const ctx = townCtx();
    const city = ctx.state.cities[0];
    for (const t of ctx.state.map.tiles) if (t.cityId === city.id) t.road = true;
    expect(findLandmarkSite(ctx.state, city)).toBeNull();
    landmarksMonth(ctx);
    expect(city.landmarks).toEqual([]);
    expect(ctx.state.news).toEqual([]);
    expect(ctx.state.layers.landmark?.some((v) => v > 0) ?? false).toBe(false);
  });
});

describe('findLandmarkSite', () => {
  it('picks the free block nearest the centre, ties by lowest y then x', () => {
    const s = testState({ cities: [{ x: 20, y: 15, population: 6000 }] });
    // no streets: the four blocks around the centre tie; (19,14) has the lowest y, then x
    expect(findLandmarkSite(s, s.cities[0])).toEqual({ x: 19, y: 14 });
    tile(s, 19, 14).road = true;
    expect(findLandmarkSite(s, s.cities[0])).toEqual({ x: 20, y: 14 });
  });

  it('never picks water, mountain or another city’s land', () => {
    const s = testState({ cities: [{ x: 20, y: 15, population: 6000 }] });
    for (const [x, y] of [[19, 14], [20, 16]]) tile(s, x, y).terrain = 'water';
    tile(s, 21, 14).terrain = 'mountain';
    const p = findLandmarkSite(s, s.cities[0])!;
    for (const q of block(p)) {
      const t = tile(s, q.x, q.y);
      expect(t.terrain).not.toBe('water');
      expect(t.terrain).not.toBe('mountain');
      expect(t.cityId).toBe(0);
    }
  });

  it('never lands on road, rail, building, deposit or another landmark (seeds 1-20 at 30k)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createGame({ seed, rival: false });
      state.date.year = 1925;
      const ctx: SimContext = { state, bus: new EventBus() };
      runAutoplay(ctx); // buildings and their roads; a failed autoplay still leaves a valid map
      for (const c of state.cities) c.population = 30000;
      refreshUrbanTiles(state);
      for (const c of state.cities) {
        layCityStreets(state.map, c);
        // a rail line through each town, just off the centre row
        for (let x = c.center.x - 8; x <= c.center.x + 8; x++) {
          const t = state.map.tiles[(c.center.y + 1) * state.map.width + x];
          if (t && x >= 0 && x < state.map.width && t.terrain !== 'water' && t.buildingId === null) t.rail = true;
        }
      }
      const taken = new Set<number>();
      for (let m = 0; m < 6; m++) {
        const before = new Map(state.cities.map((c): [City, number] => [c, c.landmarks.length]));
        // remember what each block looked like before the landmark took it
        const snap = state.map.tiles.map((t) => ({ ...t }));
        landmarksMonth(ctx);
        for (const c of state.cities) {
          for (const l of c.landmarks.slice(before.get(c))) {
            for (const p of block(l.pos)) {
              const i = p.y * state.map.width + p.x;
              const t = snap[i];
              const where = `seed ${seed} city ${c.id} ${l.id} at (${p.x},${p.y})`;
              expect(t.road, where).toBe(false);
              expect(t.rail, where).toBe(false);
              expect(t.buildingId, where).toBeNull();
              expect(t.deposit, where).toBeNull();
              expect(t.terrain, where).not.toBe('water');
              expect(t.cityId, where).toBe(c.id);
              expect(taken.has(i), where).toBe(false);
              taken.add(i);
            }
          }
        }
      }
      expect(state.cities.some((c) => c.landmarks.length === 5), `seed ${seed}`).toBe(true);
    }
  });
});

describe('landmark tiles are never built over', () => {
  function withChurch(): { ctx: SimContext; at: Vec2 } {
    const ctx = townCtx();
    landmarksMonth(ctx);
    return { ctx, at: ctx.state.cities[0].landmarks[0].pos };
  }

  it('canPlaceBuilding refuses a landmark tile', () => {
    const { ctx, at } = withChurch();
    const r = canPlaceBuilding(ctx.state, 'player', 'store', at);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('landmark');
      expect(r.error).toBe('A landmark stands here');
    }
  });

  it('buildRoad and buildRail refuse a landmark tile', () => {
    const { ctx, at } = withChurch();
    expect(buildRoad(ctx, 'player', [at])).toEqual({ ok: false, error: 'A landmark stands here' });
    expect(buildRail(ctx, 'player', [at])).toEqual({ ok: false, error: 'A landmark stands here' });
    expect(tile(ctx.state, at.x, at.y).road).toBe(false);
    expect(tile(ctx.state, at.x, at.y).rail).toBe(false);
  });

  it('layCityStreets leaves landmark tiles alone', () => {
    const s = testState({ cities: [{ x: 20, y: 15, population: 6000 }] });
    const ctx = testCtx(s);
    landmarksMonth(ctx); // no streets yet: the church sits on the centre, across the street grid
    const at = s.cities[0].landmarks[0].pos;
    layCityStreets(s.map, s.cities[0], s.layers.landmark);
    for (const p of block(at)) expect(tile(s, p.x, p.y).road).toBe(false);
    expect(tile(s, 20, 20).road).toBe(true);
  });

  it('the rival rail planner routes around landmark tiles', () => {
    const s = testState({ width: 50 });
    const ctx = testCtx(s);
    // a wall of landmark tiles between the stations, open only at the bottom rows
    const l = layer(s, 'landmark');
    for (let y = 0; y < 27; y++) for (const x of [20, 21]) l[y * 50 + x] = 1;
    const a = must(placeBuilding(ctx, 'rival', 'train_station', { x: 4, y: 10 }));
    const b = must(placeBuilding(ctx, 'rival', 'train_station', { x: 36, y: 12 }));
    const r = must(ensureRailLink(ctx, 'rival', a, b, 0));
    expect(r.built).toBeGreaterThan(0);
    for (const p of r.tiles) expect(layerAt(s, 'landmark', p.x, p.y), `(${p.x},${p.y})`).toBe(0);
    expect(r.tiles.some((p) => p.x === 20 && p.y >= 27)).toBe(true);
  });
});
