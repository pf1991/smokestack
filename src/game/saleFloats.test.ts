import { describe, expect, it } from 'vitest';
import {
  SaleFloatAggregator,
  dominantGood,
  saleFloatLabel,
  shouldShowSaleFloats,
} from './saleFloats';

describe('dominantGood', () => {
  it('returns the sole good', () => {
    expect(dominantGood(new Map([['furniture', 40]]))).toBe('furniture');
  });

  it('returns the highest-revenue good when mixed', () => {
    expect(dominantGood(new Map([['furniture', 40], ['tools', 60]]))).toBe('tools');
  });

  it('returns null when empty', () => {
    expect(dominantGood(new Map())).toBeNull();
  });
});

describe('saleFloatLabel', () => {
  it('formats revenue as +$n', () => {
    expect(saleFloatLabel(48)).toBe('+$48');
    expect(saleFloatLabel(1234.6)).toBe('+$1,235');
  });
});

describe('shouldShowSaleFloats', () => {
  it('hides in photo mode and when zoomed out below 1', () => {
    expect(shouldShowSaleFloats({ photo: false, zoom: 1 })).toBe(true);
    expect(shouldShowSaleFloats({ photo: false, zoom: 1.5 })).toBe(true);
    expect(shouldShowSaleFloats({ photo: true, zoom: 1.5 })).toBe(false);
    expect(shouldShowSaleFloats({ photo: false, zoom: 0.99 })).toBe(false);
  });
});

describe('SaleFloatAggregator', () => {
  it('ignores non-player sales', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 10, goodId: 'furniture', ownerId: 'rival' }, 100);
    expect(a.take(100)).toEqual([]);
  });

  it('aggregates multiple sales at one building into one float', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 40, goodId: 'furniture', ownerId: 'player' }, 100);
    a.record({ buildingId: 1, revenue: 60, goodId: 'furniture', ownerId: 'player' }, 100);
    expect(a.take(100)).toEqual([{ buildingId: 1, revenue: 100, goodId: 'furniture', ownerId: 'player' }]);
    expect(a.take(100)).toEqual([]);
  });

  it('emits at most one float per building per game-day', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 40, goodId: 'furniture', ownerId: 'player' }, 100);
    expect(a.take(100)).toHaveLength(1);
    a.record({ buildingId: 1, revenue: 80, goodId: 'tools', ownerId: 'player' }, 100);
    expect(a.take(100)).toEqual([]);
  });

  it('allows another float the next game-day', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 40, goodId: 'furniture', ownerId: 'player' }, 100);
    a.take(100);
    a.record({ buildingId: 1, revenue: 25, goodId: 'furniture', ownerId: 'player' }, 101);
    expect(a.take(101)).toEqual([{ buildingId: 1, revenue: 25, goodId: 'furniture', ownerId: 'player' }]);
  });

  it('carries unflushed revenue into the next day without double-counting the emit mark', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 40, goodId: 'furniture', ownerId: 'player' }, 100);
    // never took on day 100 — pending survives; take on 101 emits once
    expect(a.take(101)).toEqual([{ buildingId: 1, revenue: 40, goodId: 'furniture', ownerId: 'player' }]);
  });

  it('emits separate floats for separate buildings the same day', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 10, goodId: 'furniture', ownerId: 'player' }, 5);
    a.record({ buildingId: 2, revenue: 20, goodId: 'tools', ownerId: 'player' }, 5);
    const out = a.take(5).sort((x, y) => x.buildingId - y.buildingId);
    expect(out).toEqual([
      { buildingId: 1, revenue: 10, goodId: 'furniture', ownerId: 'player' },
      { buildingId: 2, revenue: 20, goodId: 'tools', ownerId: 'player' },
    ]);
  });

  it('picks the dominant good when a building sells mixed goods', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 30, goodId: 'furniture', ownerId: 'player' }, 1);
    a.record({ buildingId: 1, revenue: 70, goodId: 'tools', ownerId: 'player' }, 1);
    expect(a.take(1)[0].goodId).toBe('tools');
  });

  it('clear drops pending and emit marks', () => {
    const a = new SaleFloatAggregator();
    a.record({ buildingId: 1, revenue: 10, goodId: 'furniture', ownerId: 'player' }, 1);
    a.take(1);
    a.record({ buildingId: 1, revenue: 5, goodId: 'furniture', ownerId: 'player' }, 1);
    a.clear();
    expect(a.take(1)).toEqual([]);
    a.record({ buildingId: 1, revenue: 5, goodId: 'furniture', ownerId: 'player' }, 1);
    expect(a.take(1)).toHaveLength(1);
  });
});
