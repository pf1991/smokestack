import { describe, expect, it } from 'vitest';
import { acceptsGood, loadSource, storageLeft } from './inventory';
import type { Building } from './types';

function b(typeId: string, recipeId: string | null = null, input = {}, output = {}): Building {
  return {
    id: 1, typeId, ownerId: 'player', pos: { x: 0, y: 0 }, recipeId, input, output,
    progress: 0, status: 'idle', cityId: null, haltedUntil: null, producedThisMonth: {},
  };
}

describe('inventory rules', () => {
  it('factory accepts only its current recipe inputs', () => {
    const mill = b('steel_mill', 'r_steel');
    expect(acceptsGood(mill, 'iron_ore')).toBe(true);
    expect(acceptsGood(mill, 'coal')).toBe(true);
    expect(acceptsGood(mill, 'wood')).toBe(false);
    expect(acceptsGood(mill, 'steel')).toBe(false);
    expect(acceptsGood(b('steel_mill', null), 'iron_ore')).toBe(false);
  });

  it('store accepts consumer goods only', () => {
    expect(acceptsGood(b('store'), 'furniture')).toBe(true);
    expect(acceptsGood(b('store'), 'lumber')).toBe(false);
    expect(acceptsGood(b('store'), 'wood')).toBe(false);
  });

  it('warehouse and station accept anything, extractors nothing', () => {
    expect(acceptsGood(b('warehouse'), 'wood')).toBe(true);
    expect(acceptsGood(b('train_station'), 'cars')).toBe(true);
    expect(acceptsGood(b('lumber_camp', 'r_wood'), 'wood')).toBe(false);
  });

  it('unknown goods are never accepted', () => {
    expect(acceptsGood(b('warehouse'), 'unobtainium')).toBe(false);
  });

  it('loadSource: output for producers, input for storage buildings', () => {
    const camp = b('lumber_camp', 'r_wood', {}, { wood: 5 });
    expect(loadSource(camp)).toBe(camp.output);
    const wh = b('warehouse', null, { wood: 5 });
    expect(loadSource(wh)).toBe(wh.input);
    const st = b('store', null, { bread: 5 });
    expect(loadSource(st)).toBe(st.input);
  });

  it('storageLeft is per good for factories', () => {
    // sawmill storage 60
    expect(storageLeft(b('sawmill', 'r_lumber', { wood: 50 }), 'wood')).toBe(10);
    expect(storageLeft(b('sawmill', 'r_lumber', { wood: 70 }), 'wood')).toBe(0);
    expect(storageLeft(b('sawmill', 'r_lumber'), 'grain')).toBe(0);
  });

  it('storageLeft is shared across goods for store, warehouse and station', () => {
    // store storage 200
    expect(storageLeft(b('store', null, { bread: 120, furniture: 30 }), 'clothes')).toBe(50);
    // warehouse storage 600
    expect(storageLeft(b('warehouse', null, { wood: 590 }), 'coal')).toBe(10);
    expect(storageLeft(b('store', null, {}), 'lumber')).toBe(0);
  });
});
