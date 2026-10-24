import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { stateHash } from '../sim/hash';
import { runDays } from '../sim/simulation';
import { createGame } from '../sim/state';
import type { SimContext } from '../sim/types';
import { autoplayLogistics, autoplayUnrest, biggestCity, runAutoplay, UNREST } from './autoplay';
import { canAbate } from '../sim/society/upgrades';
import { workCity } from '../sim/politics/workforce';
import { siteCity } from '../sim/politics/mayorEdicts';

describe('autoplay', () => {
  it.each([1, 42, 7777])('scripted furniture chain sells within 20 days (seed %i)', (seed) => {
    const ctx = { state: createGame({ seed }), bus: new EventBus() };
    let sales = 0;
    ctx.bus.on('sale', (e) => {
      if (e.ownerId === 'player') sales += e.revenue;
    });
    const r = runAutoplay(ctx);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    expect(Object.keys(ctx.state.vehicles)).toHaveLength(6);
    runDays(ctx, 20);
    expect(Object.values(ctx.state.vehicles).filter((v) => v.state === 'stuck')).toHaveLength(0);
    expect(sales).toBeGreaterThan(0);
  });
});

describe('autoplayLogistics', () => {
  /** The furniture chain, then `months` soak months (30 days, then autoplayLogistics). */
  function run(seed: number, months: number, each?: (ctx: SimContext) => void, setup?: (ctx: SimContext) => void): SimContext {
    const ctx = { state: createGame({ seed }), bus: new EventBus() };
    setup?.(ctx);
    const r = runAutoplay(ctx);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    for (let m = 0; m < months; m++) {
      runDays(ctx, 30);
      each?.(ctx);
      autoplayLogistics(ctx);
    }
    return ctx;
  }

  it('in 10 years on seed 42 hires, builds the auto line, opens a manned hub and upgrades', () => {
    let upgraded = 0;
    let hired = 0;
    const ctx = run(42, 120, undefined, (c) => {
      c.bus.on('buildingUpgraded', (e) => {
        if (e.ownerId === 'player') upgraded++;
      });
      c.bus.on('managerHired', (e) => {
        if (e.ownerId === 'player') hired++;
      });
    });
    const { state } = ctx;
    expect(hired).toBeGreaterThan(0);
    expect(state.logistics.stats.hires.player ?? 0).toBeGreaterThanOrEqual(1);
    const auto = Object.values(state.routes).filter((r) => r.ownerId === 'player' && r.mode === 'auto');
    expect(auto).toHaveLength(1);
    expect(auto[0].stops).toHaveLength(4);
    expect(auto[0].autoSize).toEqual({ on: true, maxTrucks: 6 });
    // the legs are gone and every leg truck now runs the auto line
    expect(Object.values(state.routes).filter((r) => r.ownerId === 'player' && r.mode === 'manual')).toHaveLength(0);
    expect(Object.values(state.vehicles).filter((v) => v.ownerId === 'player' && v.routeId === auto[0].id).length).toBeGreaterThanOrEqual(3);
    expect(state.logistics.stats.autoLoaded.player ?? 0).toBeGreaterThan(0);
    const hub = Object.values(state.buildings).find((b) => b.ownerId === 'player' && b.hub);
    expect(hub?.typeId).toBe('warehouse');
    const posted = state.logistics.managers.find((m) => m.employer === 'player' && m.post === hub!.id);
    expect(posted).toBeDefined();
    expect(Object.values(state.vehicles).filter((v) => v.hubId === hub!.id).length).toBeGreaterThanOrEqual(1);
    expect(state.logistics.stats.upgrades.player ?? 0).toBeGreaterThanOrEqual(1);
    expect(upgraded).toBeGreaterThanOrEqual(1);
  });

  it('skips every step while it cannot be afforded', () => {
    // no cash: no hub, no upgrade, no new truck model (the auto line costs nothing and is still built)
    const ctx = run(42, 300, (c) => {
      c.state.companies.player.money = 0;
      // and no candidate within 5% of last month's sales
      for (const m of c.state.logistics.market) m.salary = 1e9;
    });
    const { state } = ctx;
    expect(state.date.year).toBeGreaterThanOrEqual(1925); // motor trucks are on sale
    expect(state.logistics.stats.hires.player ?? 0).toBe(0);
    expect(Object.values(state.vehicles).filter((v) => v.ownerId === 'player').every((v) => v.model === 'steam_lorry')).toBe(true);
    expect(state.logistics.stats.upgrades.player ?? 0).toBe(0);
    expect(Object.values(state.buildings).some((b) => b.ownerId === 'player' && (b.hub || b.typeId === 'warehouse' || b.typeId === 'creamery'))).toBe(false);
  });

  it('two runs of the same seed hash equal', () => {
    expect(stateHash(run(42, 84).state)).toBe(stateHash(run(42, 84).state));
  });
});

describe('autoplayUnrest (a town whose workers stay pinned)', () => {
  /** The furniture chain on seed 42 in 1906 with cash to spare, its town's workers held at `workers` for `months` monthly calls. */
  function pinned(workers: number, months: number) {
    const ctx = { state: createGame({ seed: 42 }), bus: new EventBus() };
    expect(runAutoplay(ctx).ok).toBe(true);
    const { state } = ctx;
    state.date.year = 1906;
    state.companies.player.money = 1e8;
    const town = biggestCity(state.cities)!;
    for (let m = 0; m < months; m++) {
      town.opinion.workers = workers;
      autoplayUnrest(ctx);
    }
    const smoky = Object.values(state.buildings).filter(
      (b) => b.ownerId === 'player' && canAbate(b) && (workCity(state, b)?.id === town.id || siteCity(state, b.typeId, b.pos)?.id === town.id),
    );
    return { state, town, smoky };
  }

  it(`after ${UNREST.pinMonths} months at or below ${UNREST.pinLevel}: scrubbers on the town's smoky works, the union recognised, a hospital endowed`, () => {
    const { state, town, smoky } = pinned(UNREST.pinLevel, UNREST.pinMonths);
    expect(smoky.length).toBeGreaterThan(0);
    expect(smoky.every((b) => (b.upgrades?.scrubber ?? 0) >= 1)).toBe(true);
    expect(state.politics.edicts.union).toBe('recognise');
    expect(town.landmarks.some((l) => l.id === 'hospital')).toBe(true);
  });

  it('does nothing for a town one month short of pinned, or one whose workers sit above the line', () => {
    for (const [workers, months] of [[UNREST.pinLevel, UNREST.pinMonths - 1], [UNREST.pinLevel + 1, 36]]) {
      const { state, town, smoky } = pinned(workers, months);
      expect(smoky.some((b) => (b.upgrades?.scrubber ?? 0) > 0)).toBe(false);
      expect(state.politics.edicts.union).not.toBe('recognise');
      expect(town.landmarks.some((l) => l.id === 'hospital')).toBe(false);
    }
  });
});
