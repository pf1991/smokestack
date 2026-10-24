import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../core/events';
import { GOODS } from '../data/goods';
import { chainEconomics, shallowMedian } from './chainEconomics';
import { BANKRUPT_MONTHS } from './finance';
import { runDays } from './simulation';
import { createGame } from './state';
import { buildReferenceStrategy } from './testkit';
import type { SimContext } from './types';
import './rail'; // registers the train vehicle kind (production.ts imports it too; explicit for safety)

/**
 * CPU milliseconds used by this process (vite.config.ts runs this file in a forked process), so the
 * budget measures the simulation's work rather than time spent waiting for a core; falls
 * back to wall time where `process.cpuUsage` is unavailable.
 */
function cpuMs(): number {
  const proc = (globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } }).process;
  const u = proc?.cpuUsage?.();
  return u ? (u.user + u.system) / 1000 : performance.now();
}

describe('chain economics', () => {
  it('every 1900 chain is profitable at full utilisation', () => {
    const goods = Object.values(GOODS).filter((g) => g.kind === 'consumer' && g.era <= 1900);
    expect(goods.map((g) => g.id).sort()).toEqual(['books', 'bread', 'candy', 'canned_food', 'cheese', 'clothes', 'furniture', 'juice', 'shoes', 'tools', 'toys']);
    for (const g of goods) {
      const r = chainEconomics(g.id, 1900);
      expect(r, g.id).not.toBeNull();
      expect(r!.profitPerDay, `${g.id} daily profit`).toBeGreaterThan(0);
      // the chain adds value: revenue beats the market value of the raw inputs
      expect(r!.revenuePerDay, `${g.id} value added`).toBeGreaterThan(r!.rawInputCostPerDay);
    }
  });

  it('every later chain is profitable too once invented', () => {
    for (const g of Object.values(GOODS).filter((x) => x.kind === 'consumer' && x.era > 1900)) {
      const r = chainEconomics(g.id, g.era);
      expect(r, g.id).not.toBeNull();
      expect(r!.profitPerDay, `${g.id} daily profit`).toBeGreaterThan(0);
    }
  });
});

/**
 * The balance gate (R4): a deep chain (depth >= 4) must pay at least as much per worker-month as the
 * median shallow chain (depth <= 3) the player could already build in the deep good's own era year.
 * Every figure is `chainEconomics(g, y)` with y = the deep good's era, so the shallow median is the
 * one of year y (it uses every consumer good with era <= y).
 */
describe('deep chains pay', () => {
  it('chain reports carry depth, workers and profit per worker-month', () => {
    const bread = chainEconomics('bread', 1900)!;
    expect(bread.depth).toBe(3);
    expect(chainEconomics('cheese', 1900)!.depth).toBe(2);
    expect(bread.workers).toBeGreaterThan(0);
    expect(bread.profitPerWorkerMonth).toBeCloseTo((bread.profitPerDay * 30) / bread.workers, 10);
  });

  it('the 1900 rows match Table E within 10%', () => {
    const table: [string, number, number, number][] = [
      // good, depth, workers, $/worker-month
      ['candy', 3, 116, 14.0],
      ['canned_food', 3, 117, 14.1],
      ['books', 3, 152, 11.4],
      ['shoes', 3, 172, 10.9],
    ];
    for (const [id, depth, workers, perWm] of table) {
      const r = chainEconomics(id, 1900)!;
      expect(r.depth, id).toBe(depth);
      expect(Math.abs(r.workers - workers) / workers, `${id} workers ${r.workers}`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(r.profitPerWorkerMonth - perWm) / perWm, `${id} $/wk-mo ${r.profitPerWorkerMonth}`).toBeLessThanOrEqual(0.1);
    }
  });

  it('the 1905–1915 rows match Table E within 10% (bicycles and motorcycles are deep)', () => {
    const table: [string, number, number, number, number][] = [
      // good, era, depth, workers, $/worker-month
      ['phonographs', 1905, 3, 144, 31.4],
      ['bicycles', 1910, 4, 185, 23.8],
      ['motorcycles', 1915, 4, 334, 27.9],
    ];
    for (const [id, era, depth, workers, perWm] of table) {
      const r = chainEconomics(id, era)!;
      expect(r.depth, id).toBe(depth);
      expect(Math.abs(r.workers - workers) / workers, `${id} workers ${r.workers}`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(r.profitPerWorkerMonth - perWm) / perWm, `${id} $/wk-mo ${r.profitPerWorkerMonth}`).toBeLessThanOrEqual(0.1);
    }
  });

  it('every deep consumer chain beats the shallow median of its era year', () => {
    for (const d of Object.values(GOODS).filter((g) => g.kind === 'consumer')) {
      const r = chainEconomics(d.id, d.era);
      if (!r || r.depth < 4) continue;
      const median = shallowMedian(d.era);
      expect(r.profitPerWorkerMonth, `${d.id} (${d.era}) vs shallow median ${median.toFixed(1)} of ${d.era}`).toBeGreaterThanOrEqual(median);
    }
  });
});

describe('economy balance', () => {
  it('reference strategy grows money', () => {
    // the Task 17 furniture chain plus a bread chain, 2 trucks per leg, rival off (measures the economy)
    const { ctx, city } = buildReferenceStrategy(42);
    const start = 300_000;
    const afterBuild = ctx.state.companies.player.money;
    runDays(ctx, 5 * 360);
    const p = ctx.state.companies.player;
    console.log(
      `[balance] reference strategy seed 42 city=${city.name} afterBuild=$${afterBuild} ` +
        `after 5y money=$${p.money} (${(p.money / start).toFixed(2)}x start) loan=$${p.loan}`,
    );
    expect(p.loan).toBe(0);
    expect(p.money).toBeGreaterThanOrEqual(1.5 * start);
    expect(p.money).toBeLessThanOrEqual(5 * start);
  });

  it('rival does not bankrupt itself in 20 years', () => {
    for (const seed of [7, 42]) {
      const ctx: SimContext = { state: createGame({ seed, companyName: 'Acme Works', rival: true }), bus: new EventBus() };
      let worstRed = 0;
      ctx.bus.on('monthEnd', () => {
        worstRed = Math.max(worstRed, ctx.state.companies.rival.monthsInRed);
      });
      runDays(ctx, 20 * 360);
      const r = ctx.state.companies.rival;
      const buildings = Object.values(ctx.state.buildings).filter((b) => b.ownerId === 'rival').length;
      const lines = Object.values(ctx.state.routes).filter((x) => x.ownerId === 'rival' && x.kind === 'train').length;
      console.log(
        `[balance] rival seed ${seed} after 20y money=$${r.money} loan=$${r.loan} buildings=${buildings} worstRed=${worstRed} ` +
          `railLines=${lines} railTiles=${r.railTiles}`,
      );
      expect(worstRed, `seed ${seed}`).toBeLessThan(BANKRUPT_MONTHS);
      expect(r.money - r.loan, `seed ${seed}`).toBeGreaterThan(0);
      expect(r.active).toBe(true);
      expect(buildings, `seed ${seed}: he actually played`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('the rival lays railways in real games and they run', () => {
    // seeds whose rival has a long, busy wood haul (seeds 7 and 42 have none worth railing);
    // re-picked for save v3, where larger towns moved seed 3's rival chain off rail; seed 19 swapped for
    // 20 in Phase 4b: his seed-19 railway serves a cheese line it does not grow (sales stay ~32k a year,
    // upkeep 16k -> 46k), so he closes that losing line in 1906 (spec §9 losing lines, rival/lines.ts)
    for (const seed of [16, 20]) {
      const ctx: SimContext = { state: createGame({ seed, companyName: 'Acme Works', rival: true }), bus: new EventBus() };
      const headlines: string[] = [];
      ctx.bus.on('news', (e) => headlines.push(e.item.headline));
      let worstRed = 0;
      ctx.bus.on('monthEnd', () => {
        worstRed = Math.max(worstRed, ctx.state.companies.rival.monthsInRed);
      });
      runDays(ctx, 6 * 360);
      const { state } = ctx;
      const line = Object.values(state.routes).find((r) => r.ownerId === 'rival' && r.kind === 'train');
      console.log(`[balance] rival seed ${seed} after 6y railTiles=${state.companies.rival.railTiles} ${headlines.filter((h) => h.includes('IRON')).join('; ')}`);
      expect(line, `seed ${seed}`).toBeDefined();
      expect(state.companies.rival.railTiles).toBeGreaterThanOrEqual(10);
      expect(headlines.some((h) => /^SMOGSWORTH LAYS IRON TO .+!$/.test(h))).toBe(true);
      const trains = Object.values(state.vehicles).filter((v) => v.routeId === line!.id);
      expect(trains).toHaveLength(1);
      expect(trains[0].state).not.toBe('stuck');
      expect((trains[0].trips30 ?? []).length, `seed ${seed}: the train delivers`).toBeGreaterThan(0);
      expect(worstRed).toBeLessThan(BANKRUPT_MONTHS);
    }
  }, 60_000);

  it('100-year headless run completes within its CPU budget with no exceptions and victory emitted', () => {
    // The reference strategy plays the whole century (eras, events, contracts, pollution, growth and
    // goals all run). The rival is off here: his long-run play is covered by the 20-year test above,
    // and his fleet would multiply the vehicle work of this run.
    const { ctx } = buildReferenceStrategy(42);
    const events: GameEvent[] = [];
    ctx.bus.on('victory', (e) => events.push(e));
    ctx.bus.on('gameOver', (e) => events.push(e));
    const wall0 = performance.now();
    const cpu0 = cpuMs();
    expect(() => runDays(ctx, 101 * 360)).not.toThrow();
    const cpu = cpuMs() - cpu0;
    const wall = performance.now() - wall0;
    console.log(
      `[balance] 100-year run cpu=${Math.round(cpu)} ms wall=${Math.round(wall)} ms ` +
        `events=${JSON.stringify(events)} money=$${ctx.state.companies.player.money}`,
    );
    expect(events).toEqual([{ type: 'victory', reason: 'The century is over' }]);
    expect(ctx.state.date.year).toBe(2001);
    // The run takes about 19 s of CPU alone, and up to about 25 s while the rest of the suite loads
    // every core (CPU time inflates with core contention, not just wall time). The 30 s budget still
    // catches a 1.5x regression without flaking. Shared CI runners are slower and noisier: the budget
    // doubles there (CI is set by GitHub Actions).
    const ci = Boolean((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI);
    expect(cpu).toBeLessThan(ci ? 60_000 : 30_000);
  }, 120_000);
});
