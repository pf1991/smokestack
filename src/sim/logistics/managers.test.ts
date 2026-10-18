import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../../core/events';
import { CARDS_BY_ID } from '../../data/cards';
import { transferOwnership } from '../companies';
import { currentLedger } from '../finance';
import { forceCard, resolveCard } from '../politics/cards';
import { productionDay } from '../production';
import { random } from '../rng';
import { buildingMaintenance } from '../society/upgrades';
import { atPrices } from '../society/economy';
import { demolishBuilding, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { closeFirm } from '../regional/firms';
import { logisticsYear } from './index';
import {
  assign, fire, hire, managerAt, managerRate, managerSalary, managerUpkeep, refreshMarket, retireYear, salariesMonth,
  SKILL_WEIGHTS,
} from './managers';
import { raiseYear } from './raises';
import type { Manager, Skill } from './types';

function setup() {
  const ctx = testCtx(testState({ money: 1e7, cities: [{ x: 20, y: 20, population: 3000, name: 'Ashford' }] }));
  refreshMarket(ctx.state, 1900);
  return ctx;
}

function hireFirst(ctx: SimContext, owner = 'player'): Manager {
  return must(hire(ctx, owner, ctx.state.logistics.market[0].id));
}

function custom(ctx: SimContext, skills: [Skill, Skill, Skill], born = 1870): Manager {
  const L = ctx.state.logistics;
  const m = hireFirst(ctx);
  m.skills = { logistics: skills[0], production: skills[1], frugality: skills[2] };
  m.salary = managerSalary(m.skills);
  m.born = born;
  L.rev++;
  return m;
}

const events = (ctx: SimContext): GameEvent[] => {
  const seen: GameEvent[] = [];
  const bus = ctx.bus as EventBus;
  bus.on('managerLeft', (e) => seen.push(e));
  bus.on('managerHired', (e) => seen.push(e));
  return seen;
};

describe('salary and market', () => {
  it('salary is 50 + 20 x sum of squares', () => {
    expect(managerSalary({ logistics: 1, production: 1, frugality: 1 })).toBe(110);
    expect(managerSalary({ logistics: 5, production: 1, frugality: 1 })).toBe(590);
    expect(managerSalary({ logistics: 5, production: 5, frugality: 5 })).toBe(1550);
  });

  it('200 seeded markets: size 4-6, first logistics >= 2, weights within 5 points, ages 25-55', () => {
    const counts = [0, 0, 0, 0, 0];
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = testState({ seed });
      s.logistics.rngState = seed * 7919;
      refreshMarket(s, 1900 + (seed % 50));
      const mk = s.logistics.market;
      expect(mk.length).toBeGreaterThanOrEqual(4);
      expect(mk.length).toBeLessThanOrEqual(6);
      expect(mk[0].skills.logistics).toBeGreaterThanOrEqual(2);
      for (const m of mk) {
        const age = s.logistics.marketYear - m.born;
        expect(age).toBeGreaterThanOrEqual(25);
        expect(age).toBeLessThanOrEqual(55);
        expect(m.employer).toBeNull();
        expect(m.salary).toBe(managerSalary(m.skills));
        for (const k of ['logistics', 'production', 'frugality'] as const) (counts[m.skills[k] - 1]++, total++);
      }
    }
    const weightSum = SKILL_WEIGHTS.reduce((a, b) => a + b, 0);
    // the first candidate's logistics floor lifts 2 slightly; still well inside the band
    SKILL_WEIGHTS.forEach((w, i) => expect(Math.abs((counts[i] / total) * 100 - (w / weightSum) * 100)).toBeLessThan(5));
  });

  it('rolling the market never touches state.rngState and unique ids keep rising', () => {
    const s = testState();
    const before = s.rngState;
    refreshMarket(s, 1901);
    refreshMarket(s, 1902);
    expect(s.rngState).toBe(before);
    const ids = s.logistics.market.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThan(s.logistics.market.length - 1);
  });
});

describe('hire, assign, fire', () => {
  it('hire moves a candidate to the payroll; refusals', () => {
    const ctx = setup();
    const L = ctx.state.logistics;
    const id = L.market[1].id;
    const seen = events(ctx);
    const m = must(hire(ctx, 'player', id));
    expect(m.employer).toBe('player');
    expect(m.hiredYear).toBe(1900);
    expect(L.market.some((x) => x.id === id)).toBe(false);
    expect(L.managers.map((x) => x.id)).toEqual([id]);
    expect(seen).toEqual([{ type: 'managerHired', managerId: id, ownerId: 'player' }]);
    expect(hire(ctx, 'player', id)).toEqual({ ok: false, error: 'Not on the market' });
    expect(hire(ctx, 'player', 9999)).toEqual({ ok: false, error: 'No such manager' });
  });

  it('managers stay in ascending id order', () => {
    const ctx = setup();
    const ids = ctx.state.logistics.market.map((m) => m.id);
    hire(ctx, 'player', ids[2]);
    hire(ctx, 'player', ids[0]);
    hire(ctx, 'rival', ids[1]);
    expect(ctx.state.logistics.managers.map((m) => m.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  it('assign refusals and posting', () => {
    const ctx = setup();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 12, y: 5 }));
    const store = must(placeBuilding(ctx, 'player', 'store', { x: 22, y: 20 }));
    const foreign = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 30, y: 5 }));
    const a = hireFirst(ctx);
    const b = must(hire(ctx, 'player', ctx.state.logistics.market[0].id));
    expect(assign(ctx, 'player', 999, mill.id)).toEqual({ ok: false, error: 'No such manager' });
    expect(assign(ctx, 'rival', a.id, mill.id)).toEqual({ ok: false, error: 'Not your manager' });
    expect(assign(ctx, 'player', a.id, foreign.id)).toEqual({ ok: false, error: 'Not your building' });
    expect(assign(ctx, 'player', a.id, store.id)).toEqual({ ok: false, error: 'This building takes no manager' });
    must(assign(ctx, 'player', a.id, mill.id));
    expect(assign(ctx, 'player', b.id, mill.id)).toEqual({ ok: false, error: 'Post already filled' });
    must(assign(ctx, 'player', b.id, wh.id));
    expect(managerAt(ctx.state, mill.id)?.id).toBe(a.id);
    expect(managerAt(ctx.state, wh.id)?.id).toBe(b.id);
    must(assign(ctx, 'player', a.id, null));
    expect(managerAt(ctx.state, mill.id)).toBeNull();
  });

  it('fire charges three months of severance once, then salary stops', () => {
    const ctx = setup();
    ctx.state.economy.priceIndex = 2;
    const m = custom(ctx, [1, 1, 1]);
    const ledger = () => currentLedger(ctx.state.companies.player, ctx.state.date).expense.salaries ?? 0;
    salariesMonth(ctx);
    expect(ledger()).toBe(Math.round(atPrices(ctx.state, 110)));
    const before = ledger();
    must(fire(ctx, 'player', m.id));
    expect(ledger() - before).toBe(3 * Math.round(atPrices(ctx.state, 110)));
    const after = ledger();
    salariesMonth(ctx);
    expect(ledger()).toBe(after);
    expect(fire(ctx, 'player', m.id)).toEqual({ ok: false, error: 'No such manager' });
  });

  it('cannot fire another company\'s manager', () => {
    const ctx = setup();
    const m = hireFirst(ctx, 'rival');
    expect(fire(ctx, 'player', m.id)).toEqual({ ok: false, error: 'Not your manager' });
  });
});

describe('effects', () => {
  it('production 5 gives x1.20 output at a sawmill; frugality 5 gives x0.80 upkeep', () => {
    const ctx = setup();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    expect(managerRate(ctx.state, mill)).toBe(1);
    expect(managerUpkeep(ctx.state, mill)).toBe(1);
    const base = buildingMaintenance(ctx.state, mill);
    const m = custom(ctx, [1, 5, 5]);
    must(assign(ctx, 'player', m.id, mill.id));
    expect(managerRate(ctx.state, mill)).toBeCloseTo(1.2, 10);
    expect(managerUpkeep(ctx.state, mill)).toBeCloseTo(0.8, 10);
    expect(buildingMaintenance(ctx.state, mill)).toBeCloseTo(base * 0.8, 6);
  });

  it('a production-5 manager gives a lumber camp x1.20 over a twin', () => {
    const ctx = testCtx(testState({ money: 1e7, terrain: 'forest' }));
    refreshMarket(ctx.state, 1900);
    const a = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 5, y: 5 }));
    const b = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 15, y: 15 }));
    a.staffing = b.staffing = 1;
    must(assign(ctx, 'player', custom(ctx, [1, 5, 1]).id, b.id));
    let made1 = 0;
    let made2 = 0;
    for (let d = 0; d < 30; d++) {
      a.output = {};
      b.output = {};
      productionDay(ctx);
      made1 += a.output.wood ?? 0;
      made2 += b.output.wood ?? 0;
    }
    expect(made1).toBeGreaterThan(0);
    expect(made2 / made1).toBeCloseTo(1.2, 6);
  });

  it('a warehouse manager gives no output factor but cuts upkeep', () => {
    const ctx = setup();
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 5, y: 5 }));
    must(assign(ctx, 'player', custom(ctx, [1, 5, 2]).id, wh.id));
    expect(managerRate(ctx.state, wh)).toBe(1);
    expect(managerUpkeep(ctx.state, wh)).toBeCloseTo(0.92, 10);
  });

  it('the post index follows hires, posts and removals', () => {
    const ctx = setup();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    const m = hireFirst(ctx);
    expect(managerAt(ctx.state, mill.id)).toBeNull();
    must(assign(ctx, 'player', m.id, mill.id));
    expect(managerAt(ctx.state, mill.id)).toBe(m);
    must(fire(ctx, 'player', m.id));
    expect(managerAt(ctx.state, mill.id)).toBeNull();
  });
});

describe('salaries', () => {
  it('are booked under salaries at today\'s prices, in id order, for unposted managers too', () => {
    const ctx = setup();
    ctx.state.economy.priceIndex = 1.5;
    const a = custom(ctx, [2, 2, 2]);
    salariesMonth(ctx);
    expect(currentLedger(ctx.state.companies.player, ctx.state.date).expense.salaries).toBe(Math.round(atPrices(ctx.state, a.salary)));
  });
});

describe('retirement', () => {
  it('is never at 59 and always at 70, and clears the post that day', () => {
    const ctx = setup();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    const young = custom(ctx, [1, 1, 1], 1900 - 59);
    const old = hireFirst(ctx);
    old.born = 1900 - 70;
    must(assign(ctx, 'player', old.id, mill.id));
    const seen = events(ctx);
    ctx.state.date.year = 1900;
    const before = ctx.state.rngState;
    retireYear(ctx);
    expect(ctx.state.logistics.managers.map((m) => m.id)).toEqual([young.id]);
    expect(managerAt(ctx.state, mill.id)).toBeNull();
    expect(seen).toEqual([{ type: 'managerLeft', managerId: old.id, name: old.name, ownerId: 'player', reason: 'retired' }]);
    expect(ctx.state.logistics.stats.retirements).toBe(1);
    expect(ctx.state.rngState).toBe(before); // 59 is below the roll band and 70 is certain
  });

  it('at 65 the chance is 0.6 (state rng, id order)', () => {
    let retired = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const ctx = setup();
      ctx.state.rngState = seed * 104729;
      custom(ctx, [1, 1, 1], 1900 - 65);
      retireYear(ctx);
      if (ctx.state.logistics.managers.length === 0) retired++;
    }
    expect(retired / 300).toBeGreaterThan(0.5);
    expect(retired / 300).toBeLessThan(0.7);
  });

  it('with no managers it draws nothing from the state rng', () => {
    const ctx = setup();
    const before = ctx.state.rngState;
    logisticsYear(ctx);
    expect(ctx.state.rngState).toBe(before);
    expect(ctx.state.logistics.marketYear).toBe(ctx.state.date.year + 1);
  });
});

describe('the raise card', () => {
  function ask(ctx: SimContext, m: Manager): number {
    ctx.state.logistics.raiseAsk = m.id;
    expect(forceCard(ctx, 'manager_raise')).toBe(true);
    return ctx.state.politics.cards.pending[0].uid;
  }

  it('is a manager-triggered card with a free choice and the manager\'s name', () => {
    const c = CARDS_BY_ID.manager_raise;
    expect(c.trigger).toBe('manager');
    expect(c.choices.map((x) => x.cost)).toEqual([0, 1500, 0]);
    expect(c.defaultChoice).toBe(0);
  });

  it('grant: salary x1.2 and the clock restarts', () => {
    const ctx = setup();
    const m = custom(ctx, [2, 2, 2]);
    const was = m.salary;
    ctx.state.date.year = 1905;
    must(resolveCard(ctx, ask(ctx, m), 0));
    expect(m.salary).toBeCloseTo(was * 1.2, 2);
    expect(m.lastRaiseYear).toBe(1905);
    expect(ctx.state.logistics.raiseAsk).toBeNull();
  });

  it('bonus: no raise, clock restarts; cost goes through choiceCost', () => {
    const ctx = setup();
    const m = custom(ctx, [2, 2, 2]);
    const was = m.salary;
    ctx.state.date.year = 1905;
    const money = ctx.state.companies.player.money;
    must(resolveCard(ctx, ask(ctx, m), 1));
    expect(m.salary).toBe(was);
    expect(m.lastRaiseYear).toBe(1905);
    expect(ctx.state.companies.player.money).toBeLessThan(money);
  });

  it('refuse with a forced rng quits without severance; with the other roll he stays', () => {
    const outcome = (quit: boolean): { stays: boolean; salaries: number; seen: GameEvent[] } => {
      const ctx = setup();
      const m = custom(ctx, [2, 2, 2]);
      const seen = events(ctx);
      for (let s = 1; ; s++) {
        const probe = { rngState: s };
        if (random(probe) < 0.5 === quit) {
          ctx.state.rngState = s;
          break;
        }
      }
      must(resolveCard(ctx, ask(ctx, m), 2));
      return { stays: ctx.state.logistics.managers.length === 1, salaries: currentLedger(ctx.state.companies.player, ctx.state.date).expense.salaries ?? 0, seen };
    };
    const q = outcome(true);
    expect(q.stays).toBe(false);
    expect(q.salaries).toBe(0);
    expect(q.seen.map((e) => (e.type === 'managerLeft' ? e.reason : e.type))).toEqual(['quit']);
    expect(outcome(false).stays).toBe(true);
  });

  it('answered after the manager retired it does nothing', () => {
    const ctx = setup();
    const m = custom(ctx, [2, 2, 2]);
    const uid = ask(ctx, m);
    m.born = 1900 - 70;
    ctx.state.date.year = 1900;
    retireYear(ctx);
    const rng = ctx.state.rngState;
    must(resolveCard(ctx, uid, 2));
    expect(ctx.state.logistics.raiseAsk).toBeNull();
    expect(ctx.state.logistics.managers).toEqual([]);
    expect(ctx.state.rngState).toBe(rng);
  });

  it('raiseYear asks only after four years, only for the player, and opens the card', () => {
    const find = (years: number): number => {
      let asked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const ctx = setup();
        ctx.state.rngState = seed * 7607;
        const m = custom(ctx, [2, 2, 2]);
        m.hiredYear = 1900;
        ctx.state.date.year = 1900 + years;
        raiseYear(ctx);
        if (ctx.state.logistics.raiseAsk === m.id) {
          asked++;
          expect(ctx.state.politics.cards.pending.some((p) => p.cardId === 'manager_raise')).toBe(true);
        }
      }
      return asked;
    };
    expect(find(3)).toBe(0);
    expect(find(4)).toBeGreaterThan(5);
  });

  it('raiseYear never asks for an AI manager', () => {
    const ctx = setup();
    const m = hireFirst(ctx, 'rival');
    m.hiredYear = 1890;
    for (let i = 0; i < 40; i++) raiseYear(ctx);
    expect(ctx.state.logistics.raiseAsk).toBeNull();
  });
});

describe('leaving cleanly', () => {
  it('demolishing a posted building unposts the manager', () => {
    const ctx = setup();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    const m = hireFirst(ctx);
    must(assign(ctx, 'player', m.id, mill.id));
    must(demolishBuilding(ctx, mill.id, 'player'));
    expect(m.post).toBeNull();
    expect(ctx.state.logistics.managers).toEqual([m]);
  });

  it('transferOwnership moves managers and their posts', () => {
    const ctx = setup();
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    const m = hireFirst(ctx);
    must(assign(ctx, 'player', m.id, mill.id));
    transferOwnership(ctx, 'player', 'rival');
    expect(m.employer).toBe('rival');
    expect(m.post).toBe(mill.id);
    expect(mill.ownerId).toBe('rival');
    expect(managerAt(ctx.state, mill.id)).toBe(m);
    expect(fire(ctx, 'player', m.id).ok).toBe(false);
  });

  it('closeFirm releases the firm\'s managers', () => {
    const ctx = setup();
    hireFirst(ctx, 'rival');
    const keep = hireFirst(ctx, 'player');
    closeFirm(ctx, 'rival', false);
    expect(ctx.state.logistics.managers).toEqual([keep]);
  });
});
