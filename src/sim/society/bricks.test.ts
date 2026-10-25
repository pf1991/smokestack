import { describe, expect, it } from 'vitest';
import { createGame, placeBuilding, buildRoad, lPath, roadTileCost, findPlacement } from '../state';
import { EventBus } from '../../core/events';
import type { SimContext } from '../types';
import { BRICK_DISCOUNT, BRICKS_PER_JOB, brickCostFactor, brickStock, consumeBricksForJob } from './bricks';
import { upgradeCost as levelUpgradeCost, startUpgrade } from '../logistics/levels';
import { upgradeCost as abateCost, buyUpgrade } from './upgrades';
import { placementQuote } from '../politics/mayorEdicts';
import { atPrices } from './economy';

function ctx(): SimContext {
  const c: SimContext = { state: createGame({ seed: 7, companyName: 'Acme', rival: false }), bus: new EventBus() };
  c.state.companies.player.money = 1e9;
  return c;
}

function place(c: SimContext, typeId: 'warehouse' | 'trading_house' | 'sawmill' | 'steel_mill') {
  const pos = findPlacement(c.state, 'player', typeId, { x: 20, y: 20 }, 40);
  expect(pos, typeId).not.toBeNull();
  const r = placeBuilding(c, 'player', typeId, pos!);
  expect(r.ok, typeId).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function stockBricks(c: SimContext, n: number): void {
  const wh = Object.values(c.state.buildings).find((b) => b.typeId === 'warehouse' && b.ownerId === 'player')
    ?? place(c, 'warehouse');
  wh.input.bricks = n;
}

describe('brick construction discount', () => {
  it(`pins ${BRICK_DISCOUNT * 100}% off when ≥${BRICKS_PER_JOB} bricks are stocked`, () => {
    expect(BRICK_DISCOUNT).toBe(0.08);
    expect(BRICKS_PER_JOB).toBe(20);
    const c = ctx();
    expect(brickCostFactor(c.state, 'player')).toBe(1);
    stockBricks(c, BRICKS_PER_JOB - 1);
    expect(brickCostFactor(c.state, 'player')).toBe(1);
    stockBricks(c, BRICKS_PER_JOB);
    expect(brickCostFactor(c.state, 'player')).toBeCloseTo(1 - BRICK_DISCOUNT, 12);
  });

  it('rivals never get the discount', () => {
    const c = ctx();
    stockBricks(c, 100);
    expect(brickCostFactor(c.state, 'rival')).toBe(1);
  });

  it('placeBuilding charges 8% less and consumes 20 bricks from a warehouse', () => {
    const c = ctx();
    const pos = findPlacement(c.state, 'player', 'sawmill', { x: 40, y: 40 }, 40)!;
    const full = placementQuote(c.state, 'player', 'sawmill', pos).cost;
    stockBricks(c, BRICKS_PER_JOB);
    const cut = placementQuote(c.state, 'player', 'sawmill', pos).cost;
    expect(cut).toBeLessThan(full);
    expect(cut / full).toBeCloseTo(1 - BRICK_DISCOUNT, 2);
    const before = c.state.companies.player.money;
    expect(placeBuilding(c, 'player', 'sawmill', pos).ok).toBe(true);
    expect(before - c.state.companies.player.money).toBe(cut);
    expect(brickStock(c.state)).toBe(0);
  });

  it('buildRoad applies the same discount once per stretch', () => {
    const c = ctx();
    stockBricks(c, BRICKS_PER_JOB);
    const tile = roadTileCost(c.state, false, 'player');
    expect(tile).toBe(Math.round(atPrices(c.state, 500) * (1 - BRICK_DISCOUNT)));
    const before = c.state.companies.player.money;
    const r = buildRoad(c, 'player', lPath({ x: 0, y: 0 }, { x: 3, y: 0 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cost).toBe(tile * r.value.built);
    expect(before - c.state.companies.player.money).toBe(r.value.cost);
    expect(brickStock(c.state)).toBe(0);
  });

  it('consumeBricksForJob drains trading houses before later warehouses by id', () => {
    const c = ctx();
    const th = place(c, 'trading_house');
    const wh = place(c, 'warehouse');
    th.input.bricks = 12;
    wh.input.bricks = 15;
    expect(th.id).toBeLessThan(wh.id);
    expect(consumeBricksForJob(c.state)).toBe(true);
    expect(th.input.bricks ?? 0).toBe(0);
    expect(wh.input.bricks ?? 0).toBe(7);
  });

  it('level upgrades use the brick factor and consume stock', () => {
    const c = ctx();
    const mill = place(c, 'sawmill');
    const full = levelUpgradeCost(c.state, mill);
    stockBricks(c, BRICKS_PER_JOB);
    const cut = levelUpgradeCost(c.state, mill);
    expect(cut / full).toBeCloseTo(1 - BRICK_DISCOUNT, 2);
    expect(startUpgrade(c, mill.id, 'player').ok).toBe(true);
    expect(brickStock(c.state)).toBe(0);
  });

  it('scrubber upgrades use the brick factor and consume stock', () => {
    const c = ctx();
    c.state.date.year = 1905; // tier-1 scrubbers
    const mill = place(c, 'steel_mill');
    const full = abateCost(c.state, mill, 'scrubber');
    stockBricks(c, BRICKS_PER_JOB);
    expect(abateCost(c.state, mill, 'scrubber') / full).toBeCloseTo(1 - BRICK_DISCOUNT, 2);
    expect(buyUpgrade(c, mill.id, 'scrubber').ok).toBe(true);
    expect(brickStock(c.state)).toBe(0);
  });
});
