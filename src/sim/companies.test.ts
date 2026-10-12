import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/events';
import { addCompany, companyIds, transferOwnership } from './companies';
import type { Building, Route, Vehicle } from './types';
import { runDays } from './simulation';
import { testCtx, testState } from './testkit';

const reg = (id: string) => ({ id, name: id, money: 1000, loan: 0, kind: 'regional' as const });

describe('companies', () => {
  it('companyIds orders player, baron, then sorted rest', () => {
    const s = testState();
    addCompany(s, reg('r_b'));
    addCompany(s, reg('r_a'));
    expect(companyIds(s)).toEqual(['player', 'rival', 'r_a', 'r_b']);
  });

  it('addCompany throws on duplicate id', () => {
    const s = testState();
    addCompany(s, reg('r_a'));
    expect(() => addCompany(s, reg('r_a'))).toThrow();
  });

  it('finance closes the month for a regional company without gameOver', () => {
    const ctx = testCtx(testState());
    const c = addCompany(ctx.state, { ...reg('r_a'), money: -5_000_000 });
    c.monthsInRed = 50;
    const over: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    runDays(ctx, 35);
    for (const id of companyIds(ctx.state)) expect(ctx.state.companies[id].ledger.length).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });

  it('transferOwnership moves every asset and tile count and emits once', () => {
    const ctx = testCtx(testState());
    const { state } = ctx;
    for (const id of [1, 2]) state.buildings[id] = { id, ownerId: 'rival' } as Building;
    state.buildings[3] = { id: 3, ownerId: 'player' } as Building;
    state.routes[4] = { id: 4, ownerId: 'rival' } as Route;
    for (const id of [5, 6]) state.vehicles[id] = { id, ownerId: 'rival' } as Vehicle;
    for (let i = 0; i < 5; i++) state.map.tiles[i].roadOwner = 'rival';
    for (let i = 5; i < 8; i++) state.map.tiles[i].railOwner = 'rival';
    state.companies.rival.roadTiles = 5;
    state.companies.rival.railTiles = 3;
    const events: GameEvent[] = [];
    ctx.bus.on('ownershipChanged', (e) => events.push(e));
    const r = transferOwnership(ctx, 'rival', 'player');
    expect(r).toEqual({ buildings: 2, routes: 1, vehicles: 2, roadTiles: 5, railTiles: 3 });
    const all = [...Object.values(state.buildings), ...Object.values(state.routes), ...Object.values(state.vehicles)];
    expect(all.some((a) => a.ownerId === 'rival')).toBe(false);
    expect(state.map.tiles.some((t) => t.roadOwner === 'rival' || t.railOwner === 'rival')).toBe(false);
    expect(state.companies.rival.roadTiles).toBe(0);
    expect(state.companies.rival.railTiles).toBe(0);
    expect(state.companies.player.roadTiles).toBe(5);
    expect(state.companies.player.railTiles).toBe(3);
    expect(events).toEqual([{ type: 'ownershipChanged', from: 'rival', to: 'player' }]);
  });

  it('transferOwnership to the same company is a no-op without an event', () => {
    const ctx = testCtx(testState());
    const { state } = ctx;
    state.buildings[1] = { id: 1, ownerId: 'rival' } as Building;
    state.map.tiles[0].roadOwner = 'rival';
    state.companies.rival.roadTiles = 4;
    const events: GameEvent[] = [];
    ctx.bus.on('ownershipChanged', (e) => events.push(e));
    expect(transferOwnership(ctx, 'rival', 'rival')).toEqual({ buildings: 0, routes: 0, vehicles: 0, roadTiles: 0, railTiles: 0 });
    expect(state.companies.rival.roadTiles).toBe(4);
    expect(state.buildings[1].ownerId).toBe('rival');
    expect(events).toEqual([]);
  });

  it('transferOwnership with an unknown company throws before mutating anything', () => {
    const ctx = testCtx(testState());
    const { state } = ctx;
    state.buildings[1] = { id: 1, ownerId: 'rival' } as Building;
    state.map.tiles[0].roadOwner = 'rival';
    state.companies.rival.roadTiles = 4;
    expect(() => transferOwnership(ctx, 'rival', 'ghost')).toThrow();
    expect(() => transferOwnership(ctx, 'ghost', 'player')).toThrow();
    expect(state.buildings[1].ownerId).toBe('rival');
    expect(state.map.tiles[0].roadOwner).toBe('rival');
    expect(state.companies.rival.roadTiles).toBe(4);
  });
});
