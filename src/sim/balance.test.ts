import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../core/events';
import { GOODS } from '../data/goods';
import { chainEconomics } from './chainEconomics';
import { BANKRUPT_MONTHS } from './finance';
import { runDays } from './simulation';
import { createGame } from './state';
import { buildReferenceStrategy } from './testkit';
import type { SimContext } from './types';
import './rail'; // registers the train vehicle kind (production.ts imports it too; explicit for safety)

/**
 * CPU milliseconds used by this process (vitest runs each test file in its own forked process), so the
 * 20 s budget measures the simulation's work rather than how busy the rest of the machine is; falls
 * back to wall time where `process.cpuUsage` is unavailable.
 */
function cpuMs(): number {
  const proc = (globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } }).process;
  const u = proc?.cpuUsage?.();
  return u ? (u.user + u.system) / 1000 : performance.now();
}

describe('chain economics', () => {
  it('every 1900 chain is profitable at full utilisation', () => {
    const goods = Object.values(GOODS).filter((g) => g.tier === 2 && g.era <= 1900);
    expect(goods.map((g) => g.id).sort()).toEqual(['bread', 'cheese', 'clothes', 'furniture', 'juice', 'tools', 'toys']);
    for (const g of goods) {
      const r = chainEconomics(g.id, 1900);
      expect(r, g.id).not.toBeNull();
      expect(r!.profitPerDay, `${g.id} daily profit`).toBeGreaterThan(0);
      // the chain adds value: revenue beats the market value of the raw inputs
      expect(r!.revenuePerDay, `${g.id} value added`).toBeGreaterThan(r!.rawInputCostPerDay);
    }
  });

  it('every later chain is profitable too once invented', () => {
    for (const g of Object.values(GOODS).filter((x) => x.tier === 2 && x.era > 1900)) {
      const r = chainEconomics(g.id, g.era);
      expect(r, g.id).not.toBeNull();
      expect(r!.profitPerDay, `${g.id} daily profit`).toBeGreaterThan(0);
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
    // seeds whose rival has a long, busy wood haul (seeds 7 and 42 have none worth railing)
    for (const seed of [3, 14]) {
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

  it('100-year headless run completes under 20 s with no exceptions and victory emitted', () => {
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
    expect(cpu).toBeLessThan(20_000);
  }, 90_000);
});
