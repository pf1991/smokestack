import { describe, expect, it } from 'vitest';
import type { LedgerMonth, Route, SimContext } from '../types';
import { placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import { block, chooseProject } from './market';
import { rivalMonth } from './index';
import { closeLosingLines, LINE_REVIEW_MONTHS, linesUpkeep, productLines, trailingSales } from './lines';

let nextId = 900;

/** A two-stop route (and one truck on it) by hand: these works have no road access. */
function leg(ctx: SimContext, from: number, to: number, good: string): Route {
  const id = nextId++;
  const route: Route = {
    id, ownerId: 'rival', name: good, color: '#fff', kind: 'truck', mode: 'manual',
    stops: [{ buildingId: from, load: [good], unload: [] }, { buildingId: to, load: [], unload: [good] }],
  };
  ctx.state.routes[id] = route;
  const vid = nextId++;
  ctx.state.vehicles[vid] = {
    id: vid, kind: 'truck', ownerId: 'rival', routeId: id, pos: { x: 0, y: 0 }, prevPos: { x: 0, y: 0 }, path: [],
    pathIndex: 0, stopIndex: 0, cargo: {}, capacity: 20, state: 'idle', waitTicks: 0, stuckNotified: false, builtYear: 1900, model: 'steam_lorry', speed: 0.5,
  };
  return route;
}

/** Twelve closed ledger months (1900) in which `good` sold `perMonth` a month. */
function sales(ctx: SimContext, good: string, perMonth: number, months = LINE_REVIEW_MONTHS): void {
  const ledger: LedgerMonth[] = ctx.state.companies.rival.ledger;
  for (let m = 13 - months; m <= 12; m++) {
    let entry = ledger.find((e) => e.year === 1900 && e.month === m);
    if (!entry) ledger.push((entry = { year: 1900, month: m, income: {}, expense: {}, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 }));
    entry.salesByGood[good] = perMonth;
    entry.income.sales = (entry.income.sales ?? 0) + perMonth;
  }
  ledger.sort((a, b) => a.month - b.month);
}

/** The Baron in January 1901: a furniture line (mill -> factory -> store) a year old. */
function baron() {
  const ctx = testCtx(testState({ year: 1901, rivalMoney: 1e7, cities: [{ x: 30, y: 20 }] }));
  const store = must(placeBuilding(ctx, 'rival', 'store', { x: 30, y: 21 }));
  const mill = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 8, y: 2 }));
  const shop = must(placeBuilding(ctx, 'rival', 'furniture_factory', { x: 14, y: 2 }));
  for (const b of [store, mill, shop]) b.earnings12 = new Array(LINE_REVIEW_MONTHS).fill(0);
  const lumber = leg(ctx, mill.id, shop.id, 'lumber');
  const furniture = leg(ctx, shop.id, store.id, 'furniture');
  const upkeep = linesUpkeep(ctx.state, productLines(ctx.state, 'furniture'));
  return { ctx, store, mill, shop, lumber, furniture, upkeep };
}

describe('the Baron closes a product that loses money (spec §9)', () => {
  it('traces a good’s lines back from his stores and prices a year of their upkeep', () => {
    const { ctx, mill, shop, lumber, furniture, upkeep } = baron();
    const lines = productLines(ctx.state, 'furniture');
    expect([...lines.members].sort()).toEqual([mill.id, shop.id].sort());
    expect([...lines.routes].sort()).toEqual([lumber.id, furniture.id].sort());
    expect(upkeep).toBeGreaterThan(0);
  });

  it('when a year of sales falls short of that upkeep he closes the line, back up the chain, and never plans the good again', () => {
    const { ctx, store, mill, shop, lumber, furniture, upkeep } = baron();
    sales(ctx, 'furniture', (upkeep - 12) / 12);
    expect(closeLosingLines(ctx)).toEqual(['furniture']);
    expect(ctx.state.routes[furniture.id]).toBeUndefined();
    expect(ctx.state.routes[lumber.id]).toBeUndefined();
    expect(Object.values(ctx.state.vehicles).filter((v) => v.ownerId === 'rival')).toHaveLength(0);
    expect(ctx.state.buildings[shop.id]).toBeUndefined();
    expect(ctx.state.buildings[mill.id]).toBeUndefined();
    // the store sells other goods: it stays
    expect(ctx.state.buildings[store.id]).toBeDefined();
    expect(String(ctx.state.flags.rivalBlocked)).toContain('*:furniture');
    expect(ctx.state.news.some((n) => n.headline === 'Smogsworth quits furniture')).toBe(true);
  });

  it('runs in his monthly turn', () => {
    const { ctx, shop, upkeep } = baron();
    sales(ctx, 'furniture', (upkeep - 12) / 12);
    rivalMonth(ctx);
    expect(ctx.state.buildings[shop.id]).toBeUndefined();
  });

  it('keeps a line whose sales cover its upkeep', () => {
    const { ctx, shop, furniture, upkeep } = baron();
    sales(ctx, 'furniture', upkeep / 12);
    expect(trailingSales(ctx.state, 'furniture')).toBeCloseTo(upkeep, 6);
    expect(closeLosingLines(ctx)).toEqual([]);
    expect(ctx.state.routes[furniture.id]).toBeDefined();
    expect(ctx.state.buildings[shop.id]).toBeDefined();
  });

  it('judges only a full year: a month without sales of the good, or under 12 closed months, spares it', () => {
    const a = baron();
    sales(a.ctx, 'furniture', 1, LINE_REVIEW_MONTHS - 1);
    sales(a.ctx, 'cheese', 1, 1); // January exists, without furniture sales
    expect(trailingSales(a.ctx.state, 'furniture')).toBeNull();
    expect(closeLosingLines(a.ctx)).toEqual([]);
    const b = baron();
    b.ctx.state.date.year = 1900;
    b.ctx.state.date.month = 12;
    sales(b.ctx, 'furniture', 1);
    // December 1900 is the month under way, so only 11 months are closed
    expect(trailingSales(b.ctx.state, 'furniture')).toBeNull();
    expect(closeLosingLines(b.ctx)).toEqual([]);
  });

  it('gives a works, station or railway under a year old its year to earn', () => {
    const { ctx, mill, shop } = baron();
    sales(ctx, 'furniture', 1);
    mill.earnings12 = new Array(LINE_REVIEW_MONTHS - 1).fill(0);
    expect(closeLosingLines(ctx)).toEqual([]);
    expect(ctx.state.buildings[shop.id]).toBeDefined();
  });

  it('spares the good of his project under way', () => {
    const { ctx, shop } = baron();
    sales(ctx, 'furniture', 1);
    ctx.state.rivalProject = { cityId: 0, goodId: 'furniture', stage: 1 };
    expect(closeLosingLines(ctx)).toEqual([]);
    expect(ctx.state.buildings[shop.id]).toBeDefined();
  });

  it('keeps an upstream works another route still hauls from', () => {
    const { ctx, mill, shop } = baron();
    const depot = must(placeBuilding(ctx, 'rival', 'warehouse', { x: 2, y: 12 }));
    depot.earnings12 = new Array(LINE_REVIEW_MONTHS).fill(0);
    leg(ctx, mill.id, depot.id, 'lumber');
    sales(ctx, 'furniture', 1);
    expect(closeLosingLines(ctx)).toEqual(['furniture']);
    expect(ctx.state.buildings[shop.id]).toBeUndefined();
    expect(ctx.state.buildings[mill.id]).toBeDefined();
  });

  it('chooseProject never picks a good blocked everywhere (`*:good`)', () => {
    const ctx = testCtx(testState({ cities: [{ x: 25, y: 15, population: 20000 }], rivalMoney: 1e7 }));
    const first = chooseProject(ctx.state);
    expect(first).not.toBeNull();
    block(ctx.state, `*:${first!.goodId}`);
    expect(chooseProject(ctx.state)?.goodId).not.toBe(first!.goodId);
  });
});
