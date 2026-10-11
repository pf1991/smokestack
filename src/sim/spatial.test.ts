import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { buildingsNear, citiesNear } from './spatial';
import { createGame, demolishBuilding, findPlacement, placeBuilding } from './state';
import { testCtx } from './testkit';
import type { Building, GameState, Vec2 } from './types';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function brute(state: GameState, c: Vec2, r: number, owner?: string): Building[] {
  return Object.values(state.buildings)
    .filter((b) => {
      const { w, h } = BUILDINGS[b.typeId].size;
      return (owner === undefined || b.ownerId === owner) && Math.hypot(b.pos.x + w / 2 - c.x, b.pos.y + h / 2 - c.y) <= r;
    })
    .sort((a, b) => a.id - b.id);
}

function setup() {
  const state = createGame({ seed: 7 });
  state.companies.player.money = 1e12;
  state.companies.rival.money = 1e12;
  const ctx = testCtx(state);
  const rnd = lcg(12345);
  const placed: Building[] = [];
  for (let i = 0; i < 400 && placed.length < 40; i++) {
    const near = { x: Math.floor(rnd() * state.map.width), y: Math.floor(rnd() * state.map.height) };
    const owner = i % 3 === 0 ? 'rival' : 'player';
    const typeId = i % 2 ? 'lumber_camp' : 'sawmill';
    const pos = findPlacement(state, owner, typeId, near, 6);
    if (!pos) continue;
    const r = placeBuilding(ctx, owner, typeId, pos);
    if (r.ok) placed.push(r.value);
  }
  return { state, ctx, placed, rnd };
}

describe('spatial index', () => {
  it('matches brute force on 200 random queries', () => {
    const { state, placed, rnd } = setup();
    expect(placed.length).toBe(40);
    for (let i = 0; i < 200; i++) {
      const c = { x: rnd() * state.map.width, y: rnd() * state.map.height };
      const r = 1 + rnd() * 29;
      expect(buildingsNear(state, c, r).map((b) => b.id)).toEqual(brute(state, c, r).map((b) => b.id));
    }
  });

  it('sees buildings placed after the first query', () => {
    const { state, ctx, placed } = setup();
    const c = { x: 5, y: 5 };
    buildingsNear(state, c, 200);
    const pos = findPlacement(state, 'player', 'lumber_camp', c, 30)!;
    const b = placeBuilding(ctx, 'player', 'lumber_camp', pos);
    expect(b.ok).toBe(true);
    const ids = buildingsNear(state, c, 200).map((x) => x.id);
    expect(ids).toContain((b as { value: Building }).value.id);
    expect(ids.length).toBe(placed.length + 1);
  });

  it('drops demolished buildings', () => {
    const { state, ctx, placed } = setup();
    buildingsNear(state, { x: 0, y: 0 }, 500);
    expect(demolishBuilding(ctx, placed[3].id).ok).toBe(true);
    expect(buildingsNear(state, { x: 0, y: 0 }, 500).map((b) => b.id)).not.toContain(placed[3].id);
  });

  it('filters by owner', () => {
    const { state } = setup();
    const all = buildingsNear(state, { x: 64, y: 48 }, 500);
    const mine = buildingsNear(state, { x: 64, y: 48 }, 500, 'rival');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.every((b) => b.ownerId === 'rival')).toBe(true);
  });

  it('radius 0 on an empty tile returns nothing', () => {
    const { state } = setup();
    expect(buildingsNear(state, { x: 0.5, y: 0.5 }, 0)).toEqual([]);
  });

  it('citiesNear sorts by id and respects radius', () => {
    const { state } = setup();
    const c0 = state.cities[0];
    expect(citiesNear(state, c0.center, 0).map((c) => c.id)).toContain(c0.id);
    const ids = citiesNear(state, c0.center, 1000).map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.length).toBe(state.cities.length);
  });
});
