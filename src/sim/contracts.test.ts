import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods';
import { addDays } from './clock';
import { acceptContract, contractsDay, offerContracts, onSale } from './contracts';
import { testCtx, testState } from './testkit';
import type { Contract, SimContext } from './types';

function setup() {
  const ctx = testCtx(testState({ cities: [{ x: 10, y: 10, population: 6000, name: 'Ashby' }, { x: 25, y: 15, population: 8000 }] }));
  return ctx;
}

function mk(ctx: SimContext, over: Partial<Contract> = {}): Contract {
  const c: Contract = {
    id: ctx.state.nextId++,
    cityId: 0,
    goodId: 'bread',
    qty: 100,
    delivered: 0,
    deadline: addDays(ctx.state.date, 100),
    reward: 5000,
    status: 'offered',
    ...over,
  };
  ctx.state.contracts.push(c);
  return c;
}

describe('contracts', () => {
  it('offer targets low-satisfaction goods', () => {
    const ctx = setup();
    // city 0 is fully satisfied for every tier-2 good; only city 1 can be targeted
    for (const g of Object.keys(GOODS)) ctx.state.cities[0].market[g] = { sold30: 100, demand30: 100, pending: 0 };
    offerContracts(ctx);
    const offered = ctx.state.contracts.filter((c) => c.status === 'offered');
    expect(offered.length).toBeGreaterThan(0);
    for (const c of offered) {
      expect(c.cityId).toBe(1);
      expect(GOODS[c.goodId].tier).toBe(2);
      expect(c.reward).toBe(Math.round(c.qty * GOODS[c.goodId].basePrice * 1.5));
      expect(c.delivered).toBe(0);
    }
    expect(ctx.state.news.some((n) => n.kind === 'contract')).toBe(true);
  });

  it('offers never exceed 3 and are deterministic', () => {
    const a = setup();
    const b = setup();
    for (let i = 0; i < 6; i++) {
      offerContracts(a);
      offerContracts(b);
    }
    expect(a.state.contracts.filter((c) => c.status === 'offered').length).toBe(3);
    expect(a.state.contracts).toEqual(b.state.contracts);
  });

  it('sales count only after acceptance and only for player', () => {
    const ctx = setup();
    const c = mk(ctx);
    onSale(ctx.state, { cityId: 0, goodId: 'bread', qty: 10, ownerId: 'player' });
    expect(c.delivered).toBe(0);
    expect(acceptContract(ctx, c.id).ok).toBe(true);
    onSale(ctx.state, { cityId: 0, goodId: 'bread', qty: 10, ownerId: 'rival' });
    onSale(ctx.state, { cityId: 1, goodId: 'bread', qty: 10, ownerId: 'player' });
    onSale(ctx.state, { cityId: 0, goodId: 'tools', qty: 10, ownerId: 'player' });
    expect(c.delivered).toBe(0);
    onSale(ctx.state, { cityId: 0, goodId: 'bread', qty: 7, ownerId: 'player' });
    expect(c.delivered).toBe(7);
  });

  it('completion pays and grows city', () => {
    const ctx = setup();
    const c = mk(ctx, { status: 'active', delivered: 100 });
    const money = ctx.state.companies.player.money;
    const events: string[] = [];
    ctx.bus.on('contract', (e) => events.push(e.status));
    ctx.bus.on('toast', (e) => events.push(e.tone));
    contractsDay(ctx);
    expect(c.status).toBe('done');
    expect(ctx.state.companies.player.money).toBe(money + 5000);
    expect(ctx.state.cities[0].population).toBe(Math.round(6000 * 1.05));
    const led = ctx.state.companies.player.ledger.at(-1)!;
    expect(led.income.contracts).toBe(5000);
    expect(events).toEqual(expect.arrayContaining(['done', 'good']));
  });

  it('failure after deadline', () => {
    const ctx = setup();
    const c = mk(ctx, { status: 'active', delivered: 10, deadline: addDays(ctx.state.date, -1) });
    const events: string[] = [];
    ctx.bus.on('toast', (e) => events.push(e.tone));
    contractsDay(ctx);
    expect(c.status).toBe('failed');
    expect(ctx.state.cities[0].happiness).toBeCloseTo(0.6);
    expect(ctx.state.companies.player.money).toBe(300000);
    expect(events).toContain('bad');
  });

  it('max 3 active', () => {
    const ctx = setup();
    const cs = [mk(ctx), mk(ctx), mk(ctx), mk(ctx)];
    for (let i = 0; i < 3; i++) expect(acceptContract(ctx, cs[i].id).ok).toBe(true);
    const r = acceptContract(ctx, cs[3].id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Too many active contracts');
    expect(cs[3].status).toBe('offered');
    // only offered contracts can be accepted
    expect(acceptContract(ctx, cs[0].id).ok).toBe(false);
  });

  it('unaccepted offers expire after 60 days and finished list is capped', () => {
    const ctx = setup();
    const c = mk(ctx, { deadline: addDays(ctx.state.date, 59) });
    const keep = mk(ctx, { deadline: addDays(ctx.state.date, 61) });
    for (let i = 0; i < 40; i++) mk(ctx, { status: 'done' });
    contractsDay(ctx);
    expect(ctx.state.contracts.includes(c)).toBe(false);
    expect(ctx.state.contracts.includes(keep)).toBe(true);
    expect(ctx.state.contracts.filter((x) => x.status === 'done').length).toBe(30);
  });
});
