import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { biggestCity, runAutoplay } from '../game/autoplay';
import { buildChain, CHAINS } from './chainBuilder';
import { addCompany } from './companies';
import { createGame } from './state';
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
});
