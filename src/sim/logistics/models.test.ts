import { describe, expect, it } from 'vitest';
import { assetValue, buildRoad, lPath, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import { atPrices } from '../society/economy';
import { NO_WEAR } from '../society/aging';
import type { GameState, SimContext } from '../types';
import { buyTruck, createRoute, replaceVehicle, upgradeRouteTrucks, vehiclesTick } from '../vehicles';
import { fitKit, kitCost, kitRefusal, newestModel } from './models';

function world(year: number) {
  const s = testState();
  s.date.year = year;
  const ctx = testCtx(s);
  for (let y = 8; y < 10; y++) for (let x = 2; x < 4; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
  const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 21, y: 10 })));
  const route = must(
    createRoute(ctx, 'player', 'Wood', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]),
  );
  s.companies.player.money = 1e7;
  return { s, ctx, route };
}

const at = (s: GameState, year: number) => { s.date.year = year; };
const run = (ctx: SimContext, n: number) => { for (let i = 0; i < n; i++) { ctx.state.tick++; vehiclesTick(ctx); } };

describe('truck models', () => {
  it('newestModel follows the calendar', () => {
    const s = testState();
    const m = (y: number) => { s.date.year = y; return newestModel(s); };
    expect([m(1900), m(1919), m(1920), m(1950), m(1975)]).toEqual(['steam_lorry', 'steam_lorry', 'motor_truck', 'diesel_truck', 'articulated']);
  });

  it('a truck bought in 1925 is a motor truck: capacity 28, speed 0.6, price 11000', () => {
    const { s, ctx, route } = world(1925);
    const m0 = s.companies.player.money;
    const v = must(buyTruck(ctx, 'player', route.id));
    expect(v.model).toBe('motor_truck');
    expect(v.capacity).toBe(28);
    expect(v.speed).toBe(0.6);
    expect(m0 - s.companies.player.money).toBe(Math.round(atPrices(s, 11000)));
  });

  it('a motor truck covers 20% more tiles than a steam lorry in the same ticks', () => {
    const dist = (year: number) => {
      const { ctx, route } = world(year);
      const v = must(buyTruck(ctx, 'player', route.id));
      const x0 = v.pos.x;
      run(ctx, 10);
      return Math.abs(v.pos.x - x0);
    };
    expect(dist(1925) / dist(1910)).toBeCloseTo(1.2, 5);
  });

  it('kits: body 35 capacity, engine 0.69 speed, once each', () => {
    const { s, ctx, route } = world(1925);
    const v = must(buyTruck(ctx, 'player', route.id));
    const m0 = s.companies.player.money;
    expect(kitCost(s, v, 'body')).toBe(Math.round(atPrices(s, 11000 * 0.3)));
    must(fitKit(ctx, v.id, 'body', 'player'));
    expect(v.capacity).toBe(35);
    expect(m0 - s.companies.player.money).toBe(Math.round(atPrices(s, 3300)));
    must(fitKit(ctx, v.id, 'engine', 'player'));
    expect(v.speed).toBeCloseTo(0.69, 9);
    expect(v.kits).toEqual({ body: true, engine: true });
    expect(fitKit(ctx, v.id, 'body', 'player')).toEqual({ ok: false, error: 'Already fitted' });
    expect(kitRefusal(s, v, 'engine')).toBe('Already fitted');
  });

  it('kit refusals', () => {
    const { s, ctx, route } = world(1925);
    const v = must(buyTruck(ctx, 'player', route.id));
    expect(kitRefusal(s, v, 'body', 'rival')).toBe('Not your vehicle');
    s.companies.player.money = 0;
    expect(kitRefusal(s, v, 'body', 'player')).toBe('Not enough money');
    expect(kitRefusal(s, { ...v, kind: 'train' }, 'body')).toBe('Trucks only');
    expect(fitKit(ctx, 9999, 'body')).toEqual({ ok: false, error: 'No such vehicle' });
  });

  it('replace in 1921 of a 1915 steam lorry gives a motor truck without kits; in 1919 it is refused', () => {
    const { s, ctx, route } = world(1915);
    const old = must(buyTruck(ctx, 'player', route.id));
    must(fitKit(ctx, old.id, 'body', 'player'));
    at(s, 1919);
    expect(replaceVehicle(ctx, old.id, 'player')).toEqual({ ok: false, error: NO_WEAR });
    at(s, 1921);
    const fresh = must(replaceVehicle(ctx, old.id, 'player'));
    expect(fresh.model).toBe('motor_truck');
    expect(fresh.capacity).toBe(28);
    expect(fresh.kits).toBeUndefined();
  });

  it('upgradeRouteTrucks replaces 2 of 3 when cash covers only 2', () => {
    const { s, ctx, route } = world(1910);
    const ids = [1, 2, 3].map(() => must(buyTruck(ctx, 'player', route.id)).id);
    at(s, 1925);
    const net = Math.round(atPrices(s, 11000)) - Math.round(Math.round(atPrices(s, 8000)) * 0.5);
    s.companies.player.money = net * 2 + 10;
    const r = must(upgradeRouteTrucks(ctx, route.id, 'player'));
    expect(r.replaced).toBe(2);
    const left = Object.values(s.vehicles).map((v) => v.model).sort();
    expect(left).toEqual(['motor_truck', 'motor_truck', 'steam_lorry']);
    expect(s.vehicles[ids[2]]).toBeDefined();
  });

  it('net worth counts a motor truck at half its model price', () => {
    const { s, ctx, route } = world(1925);
    const before = assetValue(s, 'player');
    must(buyTruck(ctx, 'player', route.id));
    expect(Math.abs(assetValue(s, "player") - before - atPrices(s, 5500))).toBeLessThanOrEqual(1);
  });
});
