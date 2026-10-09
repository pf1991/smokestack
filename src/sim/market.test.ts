import { describe, it, expect } from 'vitest';
import {
  lifecycleFactor,
  monthlyDemand,
  salePrice,
  supplyRatio,
  computeDailySales,
  updateMarketDay,
  satisfaction,
  monthlyGrowth,
  urbanRadius,
  type StoreStock,
} from './market';
import type { City } from './types';

function city(population: number): City {
  return {
    id: 0,
    name: 'T',
    center: { x: 0, y: 0 },
    population,
    prevPopulation: population,
    happiness: 0.7,
    pollution: 0,
    market: {},
    urbanRadius: 3,
  };
}

describe('market', () => {
  it('lifecycle', () => {
    expect(lifecycleFactor('radios', 1920)).toBe(0);
    expect(lifecycleFactor('radios', 1930)).toBe(1);
    expect(lifecycleFactor('radios', 1970)).toBeCloseTo(0.6);
    expect(lifecycleFactor('radios', 1980)).toBeCloseTo(0.2);
    expect(lifecycleFactor('radios', 2000)).toBeCloseTo(0.2);
  });

  it('demand', () => {
    expect(monthlyDemand(city(10000), 'bread', 1900)).toBeCloseTo(300);
    expect(monthlyDemand(city(10000), 'bread', 1900, 2)).toBeCloseTo(600);
    expect(monthlyDemand(city(10000), 'wood', 1900)).toBe(0);
  });

  it('price', () => {
    expect(salePrice('furniture', 0)).toBe(72);
    expect(salePrice('furniture', 1)).toBe(36);
    expect(salePrice('furniture', 3)).toBe(24);
  });

  it('supplyRatio', () => {
    expect(supplyRatio(undefined)).toBe(0);
    expect(supplyRatio({ sold30: 5, demand30: 10, pending: 0 })).toBe(0.5);
    expect(supplyRatio({ sold30: 5, demand30: 0, pending: 0 })).toBe(0);
  });

  it('split between two stores', () => {
    const c = city(10000);
    const stores: StoreStock[] = [
      { buildingId: 1, ownerId: 'player', stock: { bread: 1000 } },
      { buildingId: 2, ownerId: 'rival', stock: { bread: 1000 } },
      { buildingId: 3, ownerId: 'player', stock: { bread: 0 } },
    ];
    const sales = computeDailySales(c, stores, 1900, () => 1);
    const bread = sales.filter((s) => s.goodId === 'bread');
    expect(bread.find((s) => s.buildingId === 3)).toBeUndefined();
    expect(bread.find((s) => s.buildingId === 1)!.qty).toBe(5);
    expect(bread.find((s) => s.buildingId === 2)!.qty).toBe(5);
    expect(bread[0].revenue).toBe(5 * salePrice('bread', 0));
  });

  it('cannot sell more than stock', () => {
    const c = city(10000);
    const stores: StoreStock[] = [
      { buildingId: 1, ownerId: 'player', stock: { bread: 3 } },
      { buildingId: 2, ownerId: 'player', stock: { bread: 100 } },
    ];
    const sales = computeDailySales(c, stores, 1900, () => 1);
    expect(sales.find((s) => s.buildingId === 1)!.qty).toBe(3);
    expect(sales.find((s) => s.buildingId === 2)!.qty).toBe(7);
    const one = computeDailySales(city(10000), [{ buildingId: 1, ownerId: 'player', stock: { bread: 2 } }], 1900, () => 1);
    expect(one[0].qty).toBe(2);
  });

  it('low demand accumulates', () => {
    const c = city(10000);
    const stores: StoreStock[] = [{ buildingId: 1, ownerId: 'player', stock: { cars: 50 } }];
    let total = 0;
    const day1 = computeDailySales(c, stores, 1920, () => 1);
    expect(day1.length).toBe(0);
    for (let d = 2; d <= 6; d++) {
      for (const s of computeDailySales(c, stores, 1920, () => 1)) total += s.qty;
    }
    expect(total).toBe(1);
  });

  it('updateMarketDay and satisfaction', () => {
    const c = city(1000);
    c.market.bread = { sold30: 30, demand30: 30, pending: 0 };
    updateMarketDay(c, 'bread', 0, 0);
    expect(c.market.bread.sold30).toBeCloseTo(29);
    expect(satisfaction(c, 'bread')).toBeCloseTo(1);
    expect(satisfaction(c, 'wood')).toBe(0);
  });

  it('growth', () => {
    expect(monthlyGrowth(10000, 0.9, 0)).toBe(10100);
    expect(monthlyGrowth(10000, 0, 1)).toBe(9820);
    expect(monthlyGrowth(500, 0, 1)).toBe(500);
  });

  it('urbanRadius', () => {
    expect(urbanRadius(9000)).toBe(6);
  });

  it('rotates odd units between stores across days', () => {
    const c = city(3000);
    const stores: StoreStock[] = [
      { buildingId: 1, ownerId: 'player', stock: { bread: 1000 } },
      { buildingId: 2, ownerId: 'rival', stock: { bread: 1000 } },
    ];
    const tot: Record<number, number> = { 1: 0, 2: 0 };
    for (const off of [0, 1]) {
      for (const s of computeDailySales(c, stores, 1900, () => 1, off)) {
        if (s.goodId === 'bread') tot[s.buildingId] += s.qty;
      }
    }
    expect(tot[1]).toBe(3);
    expect(tot[2]).toBe(3);
  });

  it('does not create entries for goods without demand', () => {
    const c = city(3000);
    computeDailySales(c, [], 1900, () => 1);
    expect(c.market.cars).toBeUndefined();
    expect(c.market.bread).toBeDefined();
  });

  it('only mutates pending; demandMod scales units', () => {
    const run = (mod: number) => {
      const c = city(10000);
      c.market.bread = { sold30: 7, demand30: 9, pending: 0 };
      const stores: StoreStock[] = [{ buildingId: 1, ownerId: 'player', stock: { bread: 1000 } }];
      const sales = computeDailySales(c, stores, 1900, () => mod);
      expect(stores[0].stock.bread).toBe(1000);
      expect(c.market.bread.sold30).toBe(7);
      expect(c.market.bread.demand30).toBe(9);
      return sales.filter((x) => x.goodId === 'bread').reduce((a, x) => a + x.qty, 0);
    };
    expect(run(2)).toBe(2 * run(1));
  });
});
