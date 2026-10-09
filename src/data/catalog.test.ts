import { describe, it, expect } from 'vitest';
import { GOODS, DEMAND_PER_1000 } from './goods';
import { RECIPES, recipeEra } from './recipes';
import { BUILDINGS } from './buildings';

describe('content catalog', () => {
  it('every recipe good exists', () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const id of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]) {
        expect(GOODS[id], `recipe ${recipe.id} uses unknown good ${id}`).toBeDefined();
      }
    }
  });

  it('every building recipe exists', () => {
    for (const building of Object.values(BUILDINGS)) {
      for (const recipeId of building.recipes) {
        expect(RECIPES[recipeId], `building ${building.id} uses unknown recipe ${recipeId}`).toBeDefined();
      }
    }
  });

  it('every consumer good is producible from raw goods', () => {
    const reachable = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const recipe of Object.values(RECIPES)) {
        if (!Object.keys(recipe.inputs).every((g) => reachable.has(g))) continue;
        for (const out of Object.keys(recipe.outputs)) {
          if (!reachable.has(out)) {
            reachable.add(out);
            changed = true;
          }
        }
      }
    }
    const consumer = Object.values(GOODS).filter((g) => g.tier === 2);
    expect(consumer).toHaveLength(11);
    for (const good of consumer) {
      expect(reachable.has(good.id), `${good.id} not producible`).toBe(true);
    }
  });

  it('recipe era', () => {
    expect(recipeEra('r_toys_plastic')).toBe(1935);
    expect(recipeEra('r_cars')).toBe(1910);
    expect(recipeEra('r_fuel')).toBe(1910);
  });

  it('exact values', () => {
    expect(GOODS.cars.basePrice).toBe(420);
    expect(GOODS.radios.fadeYear).toBe(1965);
    expect(BUILDINGS.car_plant.size).toEqual({ w: 4, h: 4 });
    expect(BUILDINGS.store.requiresCity).toBe(true);
    expect(DEMAND_PER_1000.bread).toBe(30);
  });

  it('every manufacturing recipe is profitable at base price', () => {
    const value = (inv: Record<string, number>) =>
      Object.entries(inv).reduce((sum, [id, qty]) => sum + qty * GOODS[id].basePrice, 0);
    const manufacturing = Object.values(RECIPES).filter((r) =>
      Object.keys(r.inputs).some((g) => GOODS[g].tier > 0),
    );
    expect(manufacturing.length).toBeGreaterThan(0);
    for (const recipe of manufacturing) {
      expect(value(recipe.outputs), `${recipe.id} not profitable`).toBeGreaterThan(value(recipe.inputs));
    }
  });

  it('requiresDeposit and requiresCity flags', () => {
    for (const b of Object.values(BUILDINGS)) {
      expect(b.requiresDeposit, b.id).toBe(b.id === 'mine' || b.id === 'oil_well');
      expect(b.requiresCity, b.id).toBe(b.id === 'store');
    }
  });

  it('every good and building has a distinct colour and a description', () => {
    const goodColors = Object.values(GOODS).map((g) => g.color);
    expect(new Set(goodColors).size).toBe(goodColors.length);
    for (const b of Object.values(BUILDINGS)) {
      expect(b.description.length).toBeGreaterThan(0);
    }
  });
});
