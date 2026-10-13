import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { currentLedger } from '../finance';
import { LANDMARK_LAYER } from '../landmarkTiles';
import { layer } from '../layers';
import { playerBuildingUpkeep } from '../politics/mayorEdicts';
import { emissionFactor, smogDay } from '../pollution';
import { placeBuilding, plantForest } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { GameEvent } from '../../core/events';
import type { Building, GameState, SimContext } from '../types';
import { nonCompliant } from './lawState';
import { buyUpgrade, SCRUBBER_TIERS, TREE_COST, upgradeCost } from './upgrades';

/** A steel mill at (10, 10), centre tile (11, 11); `light` puts a textile mill there instead (far below the smog cap). */
function world(year = 1990, money = 1e8, light = false): { ctx: SimContext; b: Building } {
  const ctx = testCtx(testState({ width: 40, height: 30, money, year }));
  ctx.state.date = { ...ctx.state.date, year };
  const b = light
    ? must(placeBuilding(ctx, 'player', 'textile_mill', { x: 10, y: 10 }, 'r_fabric'))
    : must(placeBuilding(ctx, 'player', 'steel_mill', { x: 10, y: 10 }, 'r_steel'));
  b.status = 'ok';
  return { ctx, b };
}
const setIndex = (state: GameState, pi: number) => ((state as GameState & { economy?: { priceIndex: number } }).economy = { priceIndex: pi });
const at = (ctx: SimContext, x: number, y: number) => ctx.state.map.tiles[y * ctx.state.map.width + x].pollution;
const total = (ctx: SimContext) => ctx.state.map.tiles.reduce((s, t) => s + t.pollution, 0);

describe('scrubbers', () => {
  it('each tier applies its emission multiplier', () => {
    const { ctx, b } = world(1990, 1e8, true);
    expect(emissionFactor(ctx.state, b)).toBe(1);
    ctx.state.weather = { windX: 0, windY: 0, rain: false, rainDays: 0 };
    smogDay(ctx);
    const plain = at(ctx, 11, 11);
    for (const t of SCRUBBER_TIERS) {
      must(buyUpgrade(ctx, b.id, 'scrubber'));
      expect(b.upgrades?.scrubber).toBe(t.tier);
      expect(emissionFactor(ctx.state, b)).toBe(t.emission);
      const fresh = world(1990, 1e8, true);
      fresh.b.upgrades = { scrubber: t.tier, tallChimney: false };
      fresh.ctx.state.weather = { windX: 0, windY: 0, rain: false, rainDays: 0 };
      smogDay(fresh.ctx);
      expect(at(fresh.ctx, 11, 11)).toBeCloseTo(plain * t.emission, 9);
    }
  });

  it('tiers only go up, one at a time, and stop at 3', () => {
    const { ctx, b } = world();
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    const r = buyUpgrade(ctx, b.id, 'scrubber');
    expect(r.ok).toBe(false);
    expect(b.upgrades?.scrubber).toBe(3);
  });

  it('is gated by era: tier 1 from 1905, tier 2 from 1948, tier 3 from 1985', () => {
    const { ctx, b } = world(1904);
    expect(buyUpgrade(ctx, b.id, 'scrubber')).toEqual({ ok: false, error: 'Tier 1 scrubbers arrive in 1905' });
    ctx.state.date.year = 1905;
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    ctx.state.date.year = 1947;
    expect(buyUpgrade(ctx, b.id, 'scrubber').ok).toBe(false);
    ctx.state.date.year = 1948;
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    ctx.state.date.year = 1984;
    expect(buyUpgrade(ctx, b.id, 'scrubber').ok).toBe(false);
    ctx.state.date.year = 1985;
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    // each tier arrives before the law that demands it
    expect(SCRUBBER_TIERS.map((t) => t.year)).toEqual([1905, 1948, 1985]);
  });

  it('cost and upkeep scale with the price index; cost is booked as construction', () => {
    const { ctx, b } = world();
    const def = BUILDINGS.steel_mill;
    expect(upgradeCost(ctx.state, b, 'scrubber')).toBe(Math.round(def.cost * 0.3));
    setIndex(ctx.state, 2);
    expect(upgradeCost(ctx.state, b, 'scrubber')).toBe(Math.round(def.cost * 0.3 * 2));
    expect(upgradeCost(ctx.state, b, 'tallChimney')).toBe(Math.round(def.cost * 0.2 * 2));
    const before = currentLedger(ctx.state.companies.player, ctx.state.date).expense.construction ?? 0;
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).expense.construction).toBe(before + Math.round(def.cost * 0.6));
    // upkeep: the scrubber's ×1.1 surcharge follows prices (×1.2 at index 2)
    setIndex(ctx.state, 1);
    expect(playerBuildingUpkeep(ctx.state)).toBeCloseTo(def.maintenance * 1.1, 6);
    setIndex(ctx.state, 2);
    expect(playerBuildingUpkeep(ctx.state)).toBeCloseTo(def.maintenance * 1.2, 6);
  });

  it('refuses another company’s works, a smokeless building, and an empty purse', () => {
    const { ctx, b } = world();
    const rival = must(placeBuilding(ctx, 'rival', 'steel_mill', { x: 20, y: 10 }, 'r_steel'));
    expect(buyUpgrade(ctx, rival.id, 'scrubber').ok).toBe(false);
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 20, y: 20 }));
    expect(buyUpgrade(ctx, wh.id, 'tallChimney').ok).toBe(false);
    ctx.state.companies.player.money = 0;
    ctx.state.companies.player.loan = 1e12;
    expect(buyUpgrade(ctx, b.id, 'scrubber')).toEqual({ ok: false, error: 'Not enough money' });
  });

  it('is never blocked by town permits (an upgrade is not a placement)', () => {
    const ctx = testCtx(testState({ width: 60, height: 40, money: 1e8, year: 1990, cities: [{ x: 15, y: 15 }] }));
    ctx.state.date = { ...ctx.state.date, year: 1990 };
    const b = must(placeBuilding(ctx, 'player', 'steel_mill', { x: 24, y: 14 }, 'r_steel'));
    const city = ctx.state.cities[0];
    city.politics.edicts = ['permits_required'];
    for (const f of Object.keys(city.opinion) as (keyof typeof city.opinion)[]) city.opinion[f] = 0;
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    must(buyUpgrade(ctx, b.id, 'tallChimney'));
  });

  it('a fitted tier makes the works compliant with the law demanding it', () => {
    const { ctx, b } = world();
    expect(nonCompliant(ctx.state, 'smoke_abatement').map((x) => x.id)).toEqual([b.id]);
    must(buyUpgrade(ctx, b.id, 'scrubber'));
    expect(nonCompliant(ctx.state, 'smoke_abatement')).toEqual([]);
    expect(nonCompliant(ctx.state, 'clean_air').map((x) => x.id)).toEqual([b.id]);
  });
});

describe('tall chimney', () => {
  it('moves deposition downwind: 2 tiles away, 0.4 of it 3 tiles away, none on the works', () => {
    const { ctx, b } = world(1990, 1e8, true);
    must(buyUpgrade(ctx, b.id, 'tallChimney'));
    expect(b.upgrades).toEqual({ scrubber: 0, tallChimney: true });
    const plain = world(1990, 1e8, true);
    for (const c of [ctx, plain.ctx]) c.state.weather = { windX: 1, windY: 0, rain: false, rainDays: 0 };
    smogDay(ctx);
    smogDay(plain.ctx);
    // the mill's centre tile is (11, 11); the plume lands at (13, 11) and (14, 11)
    expect(at(ctx, 11, 11)).toBeLessThan(at(plain.ctx, 11, 11) * 0.1);
    expect(at(ctx, 13, 11)).toBeGreaterThan(at(plain.ctx, 13, 11));
    expect(at(ctx, 13, 11)).toBeGreaterThan(at(ctx, 11, 11) * 10);
    expect(at(ctx, 14, 11)).toBeGreaterThan(at(plain.ctx, 14, 11));
    // the same smog in total (nothing reaches the map edge)
    expect(total(ctx)).toBeCloseTo(total(plain.ctx), 6);
  });

  it('follows the wind direction, and falls on the works in a calm', () => {
    const { ctx, b } = world();
    b.upgrades = { scrubber: 0, tallChimney: true };
    ctx.state.weather = { windX: 0, windY: -1, rain: false, rainDays: 0 };
    smogDay(ctx);
    expect(at(ctx, 11, 9)).toBeGreaterThan(at(ctx, 11, 13));
    const calm = world();
    calm.b.upgrades = { scrubber: 0, tallChimney: true };
    const plain = world();
    for (const c of [calm.ctx, plain.ctx]) c.state.weather = { windX: 0, windY: 0, rain: false, rainDays: 0 };
    smogDay(calm.ctx);
    smogDay(plain.ctx);
    expect(at(calm.ctx, 11, 11)).toBe(at(plain.ctx, 11, 11));
  });

  it('is a one-off purchase', () => {
    const { ctx, b } = world(1900);
    must(buyUpgrade(ctx, b.id, 'tallChimney'));
    expect(buyUpgrade(ctx, b.id, 'tallChimney').ok).toBe(false);
  });
});

describe('plantForest', () => {
  it('plants grass, charges TREE_COST × price index as construction, and reports the change', () => {
    const { ctx } = world();
    setIndex(ctx.state, 1.5);
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    const money = ctx.state.companies.player.money;
    const r = must(plantForest(ctx, 'player', [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 2 }]));
    expect(r).toEqual({ planted: 2, cost: 2 * TREE_COST * 1.5 });
    expect(ctx.state.map.tiles[2 * 40 + 2].terrain).toBe('forest');
    expect(ctx.state.companies.player.money).toBe(money - 900);
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).expense.construction).toBeGreaterThanOrEqual(900);
    expect(events.some((e) => e.type === 'terrainChanged')).toBe(true);
    // standing forest is skipped for free
    expect(must(plantForest(ctx, 'player', [{ x: 2, y: 2 }]))).toEqual({ planted: 0, cost: 0 });
  });

  it('refuses roads, rail, buildings, deposits, landmarks, water and town land, changing nothing', () => {
    const { ctx, b } = world();
    const { map } = ctx.state;
    const t = (x: number, y: number) => map.tiles[y * map.width + x];
    t(1, 1).road = true;
    t(2, 1).rail = true;
    t(3, 1).deposit = 'coal';
    t(4, 1).terrain = 'water';
    t(5, 1).cityId = 0;
    t(6, 1).terrain = 'sand';
    layer(ctx.state, LANDMARK_LAYER)[1 * map.width + 7] = 1;
    const money = ctx.state.companies.player.money;
    for (const p of [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }, b.pos]) {
      expect(plantForest(ctx, 'player', [{ x: 0, y: 5 }, p]).ok, `${p.x},${p.y}`).toBe(false);
    }
    expect(t(0, 5).terrain).toBe('grass');
    expect(ctx.state.companies.player.money).toBe(money);
  });

  it('raises absorption: smog over planted tiles decays faster', () => {
    const run = (plant: boolean) => {
      const { ctx, b } = world(1990, 1e8, true);
      ctx.state.weather = { windX: 0, windY: 0, rain: false, rainDays: 0 };
      for (let i = 0; i < 10; i++) smogDay(ctx);
      b.status = 'idle';
      if (plant) {
        const tiles = [];
        for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) if (ctx.state.map.tiles[y * 40 + x].buildingId === null) tiles.push({ x, y });
        must(plantForest(ctx, 'player', tiles));
      }
      for (let i = 0; i < 10; i++) smogDay(ctx);
      // smog off the works' own (unplanted) tiles
      return ctx.state.map.tiles.reduce((s, t) => s + (t.buildingId === null ? t.pollution : 0), 0);
    };
    expect(run(true)).toBeLessThan(run(false) * 0.75);
  });
});
