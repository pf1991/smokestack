import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { DEMAND_PER_1000, CLASS_DEMAND, GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { productionDay } from './production';
import { canPlaceBuilding, placeBuilding } from './state';
import { testCtx, testState } from './testkit';
import type { GameMap, Terrain } from './types';

function setTerrain(map: GameMap, x: number, y: number, terrain: Terrain): void {
  map.tiles[y * map.width + x].terrain = terrain;
}

/** Grass map with a vertical water strip at x=10 (shore along x=9 and x=11). */
function shoreState() {
  const state = testState({ width: 24, height: 20, terrain: 'grass' });
  for (let y = 0; y < state.map.height; y++) setTerrain(state.map, 10, y, 'water');
  return state;
}

describe('fishing pier (§3 thin slice)', () => {
  it('catalog: fish is a consumer staple with demand; pier and canned-fish recipe exist', () => {
    expect(GOODS.fish).toEqual({
      id: 'fish', name: 'Fish', tier: 2, kind: 'consumer', basePrice: 10, era: 1900,
      fadeYear: null, color: '#3d6f8f',
    });
    expect(DEMAND_PER_1000.fish).toBe(20);
    expect(CLASS_DEMAND.fish).toEqual({ working: 1.2, middle: 1.0, upper: 0.7 });
    expect(RECIPES.r_fish).toEqual({ id: 'r_fish', inputs: {}, outputs: { fish: 4 }, days: 1 });
    expect(RECIPES.r_canned_fish).toEqual({
      id: 'r_canned_fish', inputs: { fish: 2, steel: 1 }, outputs: { canned_food: 6 }, days: 1,
    });
    expect(BUILDINGS.fishing_pier).toEqual({
      id: 'fishing_pier', name: 'Fishing Pier', category: 'extractor',
      size: { w: 2, h: 2 }, cost: 12000, maintenance: 175,
      allowedTerrain: ['grass', 'sand'], requiresDeposit: false, requiresCity: false,
      recipes: ['r_fish'], storage: 120, era: 1900, pollution: 0, workers: 20,
      color: '#4a7a8c', description: 'Nets over the shallows; the catch comes in before dawn.',
    });
    expect(BUILDINGS.cannery.recipes).toEqual(['r_canned_food', 'r_canned_fish']);
  });

  it('refuses inland grass and accepts a grass tile that touches water', () => {
    const state = shoreState();
    expect(canPlaceBuilding(state, 'player', 'fishing_pier', { x: 2, y: 2 })).toEqual({
      ok: false, error: 'Must touch water',
    });
    expect(canPlaceBuilding(state, 'player', 'fishing_pier', { x: 8, y: 5 }).ok).toBe(true);
  });

  it('produces full fish when the orthogonal shore ring is all water', () => {
    // 2×2 at (5,5); flood every orthogonal neighbour with water (8 tiles)
    const state = testState({ width: 20, height: 20, terrain: 'grass' });
    const ring = [
      [5, 4], [6, 4], [7, 5], [7, 6], [5, 7], [6, 7], [4, 5], [4, 6],
    ];
    for (const [x, y] of ring) setTerrain(state.map, x, y, 'water');
    const ctx = testCtx(state);
    const r = placeBuilding(ctx, 'player', 'fishing_pier', { x: 5, y: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    productionDay(ctx);
    expect(r.value.output.fish).toBe(4);
    expect(r.value.status).toBe('ok');
  });

  it('halves output with four orthogonal water neighbours', () => {
    // 2×2 at (5,5); water only on the north and south edges of the ring (4 of 8)
    const state = testState({ width: 20, height: 20, terrain: 'grass' });
    for (const [x, y] of [[5, 4], [6, 4], [5, 7], [6, 7]] as const) setTerrain(state.map, x, y, 'water');
    const ctx = testCtx(state);
    const r = placeBuilding(ctx, 'player', 'fishing_pier', { x: 5, y: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    productionDay(ctx);
    // 4 water / 8 → 0.5 × 4 fish
    expect(r.value.output.fish).toBe(2);
  });

  it('cannery runs r_canned_fish when fed fish and steel', () => {
    const ctx = testCtx(testState());
    const r = placeBuilding(ctx, 'player', 'cannery', { x: 5, y: 5 }, 'r_canned_fish');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.value;
    expect(b.recipeId).toBe('r_canned_fish');
    productionDay(ctx);
    expect(b.status).toBe('no_input');
    b.input.fish = 2;
    b.input.steel = 1;
    productionDay(ctx);
    expect(b.output.canned_food).toBe(6);
    expect(b.input.fish).toBe(0);
    expect(b.input.steel).toBe(0);
  });
});
