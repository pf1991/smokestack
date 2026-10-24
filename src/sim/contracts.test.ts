import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods';
import { addDays } from './clock';
import { acceptContract, contractsDay, offerContracts, onSale, onTradeSale } from './contracts';
import { canMake } from './eras';
import { must, testCtx, testState } from './testkit';
import { placeBuilding } from './state';
import { tradeDay } from './trade';
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
    // city 0 is fully satisfied for every consumer good; only city 1 can be targeted
    for (const g of Object.keys(GOODS)) ctx.state.cities[0].market[g] = { sold30: 100, demand30: 100, pending: 0 };
    offerContracts(ctx);
    const offered = ctx.state.contracts.filter((c) => c.status === 'offered');
    expect(offered.length).toBeGreaterThan(0);
    for (const c of offered) {
      expect(c.cityId).toBe(1);
      expect(GOODS[c.goodId].kind).toBe('consumer');
      expect(c.reward).toBe(Math.round(c.qty * GOODS[c.goodId].basePrice * 1.5));
      expect(c.delivered).toBe(0);
    }
    expect(ctx.state.news.some((n) => n.kind === 'contract')).toBe(true);
  });

  it('a 1900 state never offers a good nobody can make yet (canMake)', () => {
    const ctx = setup();
    ctx.state.unlocked = ctx.state.unlocked.filter((id) => id !== 'r_shoes');
    expect(ctx.state.unlocked).toContain('shoes');
    expect(canMake(ctx.state, 'shoes')).toBe(false);
    expect(canMake(ctx.state, 'bread')).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      offerContracts(ctx);
      for (const c of ctx.state.contracts) seen.add(c.goodId);
      for (const c of ctx.state.contracts) expect(canMake(ctx.state, c.goodId), c.goodId).toBe(true);
      // clear the board so every round draws again
      ctx.state.contracts = [];
    }
    expect(seen.size, 'the board drew several goods').toBeGreaterThan(5);
    expect(seen.has('shoes')).toBe(false);
  });

  it('canMake needs both the building and the recipe unlocked', () => {
    const ctx = setup();
    expect(canMake(ctx.state, 'shoes')).toBe(true);
    ctx.state.unlocked = ctx.state.unlocked.filter((id) => id !== 'shoe_factory');
    expect(canMake(ctx.state, 'shoes')).toBe(false);
    expect(canMake(ctx.state, 'cars')).toBe(false); // 1910
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

describe('component contracts (R4, P7)', () => {
  /** Offers `n` times from an empty board; returns every contract offered. */
  function offers(ctx: SimContext, n: number): Contract[] {
    const all: Contract[] = [];
    for (let i = 0; i < n; i++) {
      ctx.state.contracts = [];
      const c = offerContracts(ctx);
      if (c) all.push(c);
    }
    return all;
  }
  const house = (ctx: SimContext) => must(placeBuilding(ctx, 'player', 'trading_house', { x: 1, y: 25 }));

  it('with no Trading House, no component contract is offered over 24 odd months', () => {
    const ctx = setup();
    expect(canMake(ctx.state, 'wire')).toBe(true);
    const all = offers(ctx, 24);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(GOODS[c.goodId].kind).toBe('consumer');
  });

  it('with a Trading House and wire makeable, a wire contract of 180 appears and 180 wire sold through the house completes it', () => {
    const ctx = setup();
    ctx.state.companies.player.money = 1e6;
    const b = house(ctx);
    const news: string[] = [];
    let wire: Contract | undefined;
    for (let i = 0; i < 60 && !wire; i++) {
      ctx.state.contracts = [];
      ctx.state.news = [];
      wire = offerContracts(ctx) ?? undefined;
      if (wire?.goodId !== 'wire') wire = undefined;
      else news.push(...ctx.state.news.map((n) => `${n.headline} ${n.body}`));
    }
    expect(wire).toBeDefined();
    const c = wire!;
    expect(c.qty).toBe(180);
    expect(c.reward).toBe(Math.round(180 * GOODS.wire.basePrice * 1.5));
    expect(news.join(' ')).toContain('pleads for telegraph wire!');
    expect(news.join(' ')).toContain(`for 180 sold through any Trading House within four months.`);
    expect(acceptContract(ctx, c.id).ok).toBe(true);
    // a store sale in the contract's town does not count; the house's national sales do, anywhere
    onSale(ctx.state, { ownerId: 'player', cityId: c.cityId, goodId: 'bread', qty: 50 });
    b.input.wire = 180;
    for (let d = 0; d < 5; d++) tradeDay(ctx);
    expect(c.delivered).toBe(180);
    contractsDay(ctx);
    expect(c.status).toBe('done');
  });

  it('onTradeSale credits only the player, only components', () => {
    const ctx = setup();
    const w = mk(ctx, { goodId: 'wire', status: 'active', cityId: 1 });
    const s = mk(ctx, { goodId: 'steel', status: 'active' });
    onTradeSale(ctx.state, { ownerId: 'rival', goodId: 'wire', qty: 10 });
    onTradeSale(ctx.state, { ownerId: 'player', goodId: 'steel', qty: 10 });
    onTradeSale(ctx.state, { ownerId: 'player', goodId: 'wire', qty: 7 });
    expect(w.delivered).toBe(7);
    expect(s.delivered).toBe(0);
  });

  it('a component that canMake rejects is never offered', () => {
    const ctx = setup();
    ctx.state.companies.player.money = 1e6;
    house(ctx);
    ctx.state.unlocked = ctx.state.unlocked.filter((id) => id !== 'r_wire');
    expect(canMake(ctx.state, 'wire')).toBe(false);
    for (const c of offers(ctx, 60)) expect(c.goodId).not.toBe('wire');
  });
});
