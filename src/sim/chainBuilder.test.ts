import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { biggestCity, runAutoplay } from '../game/autoplay';
import { buildChain, CHAINS } from './chainBuilder';
import { addCompany } from './companies';
import { accessTiles, createGame } from './state';
import { findPath, roadPassable } from './pathfinding';
import type { SimContext } from './types';

const fresh = (seed = 42): SimContext => ({ state: createGame({ seed }), bus: new EventBus() });

/** What autoplay built on seed 42 before it moved onto buildChain (types, positions, recipes, money). */
const SEED_42_FURNITURE = {
  spent: 125000,
  buildings: [
    ['lumber_camp', 85, 25, 'r_wood'],
    ['sawmill', 84, 28, 'r_lumber'],
    ['furniture_factory', 85, 33, 'r_furniture'],
    ['store', 80, 43, null],
  ],
  vehicles: 6,
  routes: 3,
};

describe('buildChain', () => {
  it('builds the same furniture chain for the player as autoplay did (seed 42 snapshot)', () => {
    const ctx = fresh();
    const m0 = ctx.state.companies.player.money;
    const city = biggestCity(ctx.state.cities)!;
    const r = buildChain(ctx, 'player', city, 'furniture');
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    if (!r.ok) return;
    expect({
      spent: m0 - ctx.state.companies.player.money,
      buildings: r.value.map((b) => [b.typeId, b.pos.x, b.pos.y, b.recipeId]),
      vehicles: Object.keys(ctx.state.vehicles).length,
      routes: Object.keys(ctx.state.routes).length,
    }).toEqual(SEED_42_FURNITURE);
  });

  it('autoplay (now on buildChain) still builds the snapshot chain', () => {
    const ctx = fresh();
    const m0 = ctx.state.companies.player.money;
    const r = runAutoplay(ctx);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    if (!r.ok) return;
    expect(m0 - ctx.state.companies.player.money).toBe(SEED_42_FURNITURE.spent);
    expect(r.value.map((b) => [b.typeId, b.pos.x, b.pos.y, b.recipeId])).toEqual(SEED_42_FURNITURE.buildings);
  });

  it.each(['clothes', 'cheese'] as const)('builds the %s chain for another owner, charged to that owner only', (chain) => {
    const ctx = fresh();
    const { state } = ctx;
    addCompany(state, { id: 'regional_1', kind: 'regional', name: 'Test Firm', money: 300_000, loan: 0 });
    const player0 = state.companies.player.money;
    const city = biggestCity(state.cities)!;
    const r = buildChain(ctx, 'regional_1', city, chain);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    if (!r.ok) return;
    const stages = CHAINS[chain];
    expect(r.value.map((b) => b.typeId)).toEqual([...stages.map((s) => s.typeId), 'store']);
    expect(r.value.map((b) => b.recipeId)).toEqual([...stages.map((s) => s.recipeId), null]);
    expect(r.value.every((b) => b.ownerId === 'regional_1')).toBe(true);
    expect(r.value.at(-1)!.cityId).toBe(city.id);
    const routes = Object.values(state.routes);
    expect(routes).toHaveLength(stages.length);
    expect(routes.every((x) => x.ownerId === 'regional_1')).toBe(true);
    const vehicles = Object.values(state.vehicles);
    expect(vehicles).toHaveLength(2 * stages.length);
    expect(vehicles.every((v) => v.ownerId === 'regional_1')).toBe(true);
    expect(state.companies.player.money).toBe(player0);
    expect(state.companies.regional_1.money).toBeLessThan(300_000);
  });

  it('fails cleanly when the owner cannot pay for the first building', () => {
    const ctx = fresh();
    addCompany(ctx.state, { id: 'regional_1', kind: 'regional', name: 'Poor Firm', money: 100, loan: 0 });
    const r = buildChain(ctx, 'regional_1', biggestCity(ctx.state.cities)!, 'cheese');
    expect(r.ok).toBe(false);
    expect(Object.keys(ctx.state.buildings)).toHaveLength(0);
  });

  it('with routes: false links roads but builds no route or truck', () => {
    const ctx = fresh();
    const { state } = ctx;
    const city = biggestCity(state.cities)!;
    const r = buildChain(ctx, 'player', city, 'cheese', 0, { routes: false });
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    if (!r.ok) return;
    expect(r.value.map((b) => b.typeId)).toEqual([...CHAINS.cheese.map((s) => s.typeId), 'store']);
    expect(Object.keys(state.routes)).toEqual([]);
    expect(Object.keys(state.vehicles)).toEqual([]);
    for (let i = 0; i + 1 < r.value.length; i++) {
      expect(findPath(state.map, accessTiles(state, r.value[i])[0], accessTiles(state, r.value[i + 1]), roadPassable), `leg ${i}`).not.toBeNull();
    }
  });

  it('with near, the final factory goes near that spot instead of the town centre', () => {
    const ctx = fresh();
    const city = biggestCity(ctx.state.cities)!;
    const near = { x: city.center.x + 12, y: city.center.y };
    const r = buildChain(ctx, 'player', city, 'cheese', 0, { routes: false, near });
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    if (!r.ok) return;
    const factory = r.value[r.value.length - 2];
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
    expect(d(factory.pos, near)).toBeLessThan(d(factory.pos, city.center));
  });
});
