import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../../core/events';
import { STRIKE_CARDS } from '../../data/cards/triggered';
import { addDays, dateToDays } from '../clock';
import { checkInvariants } from '../invariants';
import { migrateSave } from '../migrations';
import { resolveCard } from '../politics/cards';
import { productionDay } from '../production';
import { demolishBuilding, nextId, placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { Building, SimContext } from '../types';
import type { UnionStance, WageLevel } from '../politics/types';
import {
  SLOWDOWN_FACTOR,
  SLOWDOWN_OPINION,
  STRIKE_MAX_DAYS,
  STRIKE_OPINION,
  slowedBuildings,
  strikeActive,
  strikeTarget,
} from './strikeState';
import { startStrike, strikeChance, strikesMonth } from './strikes';

/** A town at (20,20), pop 6000, with a second town far east at (80,20), in 1905 (cards run from 1901). */
function towns(): SimContext {
  const ctx = testCtx(testState({ width: 100, height: 60, money: 1e7, cities: [{ x: 20, y: 20 }, { x: 80, y: 20 }] }));
  ctx.state.date = { ...ctx.state.date, year: 1905 };
  return ctx;
}
const NEAR = { x: 29, y: 19 };

function mill(ctx: SimContext, pos = NEAR): Building {
  const b = must(placeBuilding(ctx, 'player', 'sawmill', pos));
  b.input = { wood: 1000 };
  return b;
}

const today = (ctx: SimContext) => dateToDays(ctx.state.date);

function nextDay(ctx: SimContext): void {
  ctx.state.date = { ...addDays(ctx.state.date, 1), hour: ctx.state.date.hour };
}

describe('slowdown', () => {
  it('runs player works staffed from a town below 30 workers opinion at ×0.9', () => {
    expect(SLOWDOWN_OPINION).toBe(30);
    expect(SLOWDOWN_FACTOR).toBe(0.9);
    const ctx = towns();
    const b = mill(ctx);
    const baron = must(placeBuilding(ctx, 'rival', 'sawmill', { x: 29, y: 24 }));
    baron.input = { wood: 1000 };
    ctx.state.cities[0].opinion.workers = 29;
    expect([...slowedBuildings(ctx.state)]).toEqual([b.id]);
    productionDay(ctx);
    expect(b.progress).toBeCloseTo(0.9, 12);
    expect(b.output.lumber ?? 0).toBe(0);
    expect(baron.output.lumber).toBe(5);
  });

  it('is off at 30', () => {
    const ctx = towns();
    const b = mill(ctx);
    ctx.state.cities[0].opinion.workers = 30;
    expect(slowedBuildings(ctx.state).size).toBe(0);
    productionDay(ctx);
    expect(b.output.lumber).toBe(5);
  });

  it('only towns below 30 slow the works they staff', () => {
    const ctx = towns();
    const b = mill(ctx);
    ctx.state.cities[1].opinion.workers = 5;
    expect(slowedBuildings(ctx.state).has(b.id)).toBe(false);
  });
});

describe('strike chance', () => {
  function rate(union: UnionStance, wage: WageLevel): number {
    const ctx = towns();
    const b = mill(ctx);
    ctx.state.cities[0].opinion.workers = 20;
    ctx.state.politics.edicts.union = union;
    ctx.state.politics.edicts.wage = wage;
    let n = 0;
    for (let i = 0; i < 1000; i++) {
      b.strike = null;
      strikesMonth(ctx);
      if (b.strike) n++;
    }
    return n;
  }

  it('base 0.04, crush ×1.5, recognise ×0.4, low wage ×1.5, generous ×0.5', () => {
    const s = towns().state;
    expect(STRIKE_OPINION).toBe(25);
    expect(strikeChance(s)).toBeCloseTo(0.04, 12);
    s.politics.edicts.union = 'crush';
    s.politics.edicts.wage = 'low';
    expect(strikeChance(s)).toBeCloseTo(0.09, 12);
    s.politics.edicts.union = 'recognise';
    s.politics.edicts.wage = 'generous';
    expect(strikeChance(s)).toBeCloseTo(0.008, 12);
  });

  it.each([
    ['tolerate', 'fair', 0.04],
    ['crush', 'fair', 0.06],
    ['crush', 'low', 0.09],
    ['tolerate', 'generous', 0.02],
    ['recognise', 'fair', 0.016],
    ['recognise', 'generous', 0.008],
  ] as const)('%s / %s strikes about %s of 1,000 months', (union, wage, p) => {
    const n = rate(union, wage);
    const mean = 1000 * p;
    const tol = 3 * Math.sqrt(mean * (1 - p)) + 2;
    expect(Math.abs(n - mean)).toBeLessThanOrEqual(tol);
  });

  it('no strikes at workers 25 or more', () => {
    const ctx = towns();
    const b = mill(ctx);
    ctx.state.cities[0].opinion.workers = 25;
    ctx.state.politics.edicts.union = 'crush';
    for (let i = 0; i < 300; i++) strikesMonth(ctx);
    expect(b.strike ?? null).toBeNull();
  });

  it('only player factories and extractors strike', () => {
    const ctx = towns();
    const baron = must(placeBuilding(ctx, 'rival', 'sawmill', NEAR));
    const store = must(placeBuilding(ctx, 'player', 'store', { x: 23, y: 23 }));
    ctx.state.cities[0].opinion.workers = 0;
    for (let i = 0; i < 300; i++) strikesMonth(ctx);
    expect(baron.strike ?? null).toBeNull();
    expect(store.strike ?? null).toBeNull();
  });
});

describe('one strike per town per month', () => {
  it('starts at most one new strike in a town each month, however many works', () => {
    const ctx = towns();
    const mills = [mill(ctx, { x: 29, y: 10 }), mill(ctx, { x: 29, y: 14 }), mill(ctx, { x: 29, y: 19 }), mill(ctx, { x: 29, y: 24 })];
    ctx.state.cities[0].opinion.workers = 0;
    ctx.state.politics.edicts.union = 'crush';
    ctx.state.politics.edicts.wage = 'low';
    let striking = 0;
    for (let m = 0; m < 30; m++) {
      strikesMonth(ctx);
      const now = mills.filter((b) => b.strike).length;
      expect(now - striking).toBeLessThanOrEqual(1);
      striking = now;
    }
    expect(striking).toBeGreaterThan(0);
  });

  it('towns roll in id order, buildings in id order (deterministic)', () => {
    const run = () => {
      const ctx = towns();
      const a = mill(ctx, { x: 29, y: 14 });
      const b = mill(ctx, { x: 29, y: 19 });
      const c = mill(ctx, { x: 70, y: 19 });
      for (const city of ctx.state.cities) city.opinion.workers = 0;
      const out: string[] = [];
      for (let m = 0; m < 40; m++) {
        strikesMonth(ctx);
        out.push([a, b, c].map((x) => x.strike?.until ?? '-').join(','));
      }
      return out.join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('a strike', () => {
  it('halts production for 30–90 days, then the works runs again', () => {
    const ctx = towns();
    const b = mill(ctx);
    const durations = new Set<number>();
    for (let i = 0; i < 200; i++) {
      b.strike = null;
      startStrike(ctx, b, ctx.state.cities[0]);
      const s = b.strike!;
      durations.add(s.until - s.since);
    }
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...durations)).toBeLessThanOrEqual(90);
    expect(durations.size).toBeGreaterThan(20);
  });

  it('a striking works produces nothing and shows halted; it ends by 120 days at the latest', () => {
    const ctx = towns();
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    // a corrupted or extended strike is still capped at STRIKE_MAX_DAYS
    b.strike!.until = b.strike!.since + 500;
    expect(STRIKE_MAX_DAYS).toBe(120);
    let days = 0;
    while (b.strike && days < 400) {
      productionDay(ctx);
      if (b.strike) {
        expect(b.status).toBe('halted');
        expect(b.output.lumber ?? 0).toBe(0);
      }
      nextDay(ctx);
      days++;
    }
    expect(days).toBeLessThanOrEqual(STRIKE_MAX_DAYS + 1);
    productionDay(ctx);
    expect(b.status).toBe('ok');
    expect(b.output.lumber).toBeGreaterThan(0);
  });

  it('in 1900, before the first card year, a strike still starts but opens no card', () => {
    const ctx = towns();
    ctx.state.date = { ...ctx.state.date, year: 1900 };
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    expect(ctx.state.politics.cards.pending).toHaveLength(0);
    expect(b.strike!.cardUid).toBeNull();
  });

  it('opens a strike card for the town, emits a strike event and prints the news', () => {
    const ctx = towns();
    const b = mill(ctx);
    const events: GameEvent[] = [];
    ctx.bus.on('strike', (e) => events.push(e));
    startStrike(ctx, b, ctx.state.cities[0]);
    const pending = ctx.state.politics.cards.pending;
    expect(pending.length).toBe(1);
    expect(STRIKE_CARDS.map((c) => c.id)).toContain(pending[0].cardId);
    expect(pending[0].cityId).toBe(0);
    expect(b.strike!.cardUid).toBe(pending[0].uid);
    expect(b.strike!.reason.length).toBeGreaterThan(0);
    expect(events).toEqual([{ type: 'strike', buildingId: b.id, cityId: 0 }]);
    expect(ctx.state.news.at(-1)!.kind).toBe('protest');
    expect(strikeTarget(ctx.state, pending[0].uid)?.id).toBe(b.id);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('the reason follows the company edicts', () => {
    const ctx = towns();
    const b = mill(ctx);
    ctx.state.politics.edicts.union = 'crush';
    startStrike(ctx, b, ctx.state.cities[0]);
    const crush = b.strike!.reason;
    b.strike = null;
    ctx.state.politics.edicts.union = 'tolerate';
    ctx.state.politics.edicts.wage = 'low';
    startStrike(ctx, b, ctx.state.cities[0]);
    expect(b.strike!.reason).not.toBe(crush);
  });
});

describe('strike cards', () => {
  /** A strike at a mill with `card` open for its town. */
  function struck(cardId: string) {
    const ctx = towns();
    const b = mill(ctx);
    const city = ctx.state.cities[0];
    city.opinion.workers = 20;
    city.opinion.oldmoney = 50;
    startStrike(ctx, b, city);
    ctx.state.politics.cards.pending.length = 0;
    const uid = nextId(ctx.state);
    ctx.state.politics.cards.pending.push({ uid, cardId, cityId: 0, openedDay: today(ctx) });
    b.strike!.until = today(ctx) + 60;
    b.strike!.cardUid = uid;
    return { ctx, b, city, uid };
  }

  for (const card of STRIKE_CARDS) {
    describe(card.id, () => {
      const idx = (label: string) => card.choices.findIndex((c) => c.label.startsWith(label));

      it('has Concede, a free "Wait it out" (the default) and Break it', () => {
        expect(idx('Concede')).toBeGreaterThanOrEqual(0);
        expect(idx('Break it')).toBeGreaterThanOrEqual(0);
        const wait = idx('Wait it out');
        expect(wait).toBeGreaterThanOrEqual(0);
        expect(card.choices[wait].cost).toBe(0);
        expect(card.defaultChoice).toBe(wait);
        expect(card.choices[idx('Concede')].cost).toBeGreaterThan(0);
        expect(card.choices[idx('Break it')].cost).toBeGreaterThan(0);
        expect(card.choices).toHaveLength(3);
      });

      it('Concede: workers +8 and the strike ends now', () => {
        const { ctx, b, city, uid } = struck(card.id);
        expect(resolveCard(ctx, uid, idx('Concede')).ok).toBe(true);
        expect(city.opinion.workers).toBe(28);
        expect(b.strike).toBeNull();
        productionDay(ctx);
        expect(b.status).not.toBe('halted');
      });

      it('Wait it out: free, the strike goes on unchanged', () => {
        const { ctx, b, city, uid } = struck(card.id);
        const until = b.strike!.until;
        const money = ctx.state.companies.player.money;
        expect(resolveCard(ctx, uid, idx('Wait it out')).ok).toBe(true);
        expect(ctx.state.companies.player.money).toBe(money);
        expect(city.opinion.workers).toBe(20);
        expect(b.strike!.until).toBe(until);
        expect(b.strike!.cardUid).toBeNull();
      });

      it('Break it: workers −12, oldmoney +4, ends in 7 days, scandal risk +0.1', () => {
        const { ctx, b, city, uid } = struck(card.id);
        const risk = city.politics.scandalRisk;
        expect(resolveCard(ctx, uid, idx('Break it')).ok).toBe(true);
        expect(city.opinion.workers).toBe(8);
        expect(city.opinion.oldmoney).toBe(54);
        expect(b.strike!.until).toBe(today(ctx) + 7);
        expect(b.strike!.cardUid).toBeNull();
        expect(city.politics.scandalRisk).toBeCloseTo(risk + 0.1, 12);
      });
    });
  }

  it('Break it never lengthens a strike that ends sooner', () => {
    const { ctx, b, uid } = struck('walkout');
    b.strike!.until = today(ctx) + 3;
    const card = STRIKE_CARDS.find((c) => c.id === 'walkout')!;
    resolveCard(ctx, uid, card.choices.findIndex((c) => c.label.startsWith('Break it')));
    expect(b.strike!.until).toBe(today(ctx) + 3);
  });

  it('each card acts only on its own strike: Concede on the newer card ends only the newer strike', () => {
    const ctx = towns();
    const a = mill(ctx, { x: 29, y: 14 });
    const b = mill(ctx, { x: 29, y: 19 });
    startStrike(ctx, a, ctx.state.cities[0]);
    nextDay(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    const pending = ctx.state.politics.cards.pending;
    expect(pending).toHaveLength(2);
    const [older, newer] = pending;
    expect(a.strike!.cardUid).toBe(older.uid);
    expect(b.strike!.cardUid).toBe(newer.uid);
    expect(strikeTarget(ctx.state, older.uid)?.id).toBe(a.id);
    expect(strikeTarget(ctx.state, newer.uid)?.id).toBe(b.id);
    expect(checkInvariants(ctx.state)).toEqual([]);
    const card = STRIKE_CARDS.find((c) => c.id === newer.cardId)!;
    expect(resolveCard(ctx, newer.uid, card.choices.findIndex((c) => c.label.startsWith('Concede'))).ok).toBe(true);
    expect(b.strike).toBeNull();
    expect(a.strike).not.toBeNull();
    expect(a.strike!.cardUid).toBe(older.uid);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('a strike that ends on its own withdraws its unanswered card, with a news line', () => {
    const ctx = towns();
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    const uid = b.strike!.cardUid!;
    b.strike!.until = today(ctx) + 2;
    for (let i = 0; i < 3; i++) {
      productionDay(ctx);
      nextDay(ctx);
    }
    expect(b.strike).toBeNull();
    expect(ctx.state.politics.cards.pending.some((p) => p.uid === uid)).toBe(false);
    expect(ctx.state.news.at(-1)!.body).toBe('The strike at the Town 0 Sawmill ended on its own.');
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('a strike ends on its day, card withdrawn, even while an upgrade’s works is under way', () => {
    const ctx = towns();
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    const uid = b.strike!.cardUid!;
    b.strike!.until = today(ctx) + 2;
    b.works = { toLevel: 2, startDay: today(ctx), untilDay: today(ctx) + 30 };
    b.status = 'upgrading';
    for (let i = 0; i < 3; i++) {
      productionDay(ctx);
      nextDay(ctx);
    }
    expect(b.strike).toBeNull();
    expect(b.status).toBe('upgrading');
    expect(ctx.state.politics.cards.pending.some((p) => p.uid === uid)).toBe(false);
  });

  it('a strike whose card was answered ends quietly, leaving other pending cards alone', () => {
    const ctx = towns();
    const a = mill(ctx, { x: 29, y: 14 });
    const b = mill(ctx, { x: 29, y: 19 });
    startStrike(ctx, a, ctx.state.cities[0]);
    startStrike(ctx, b, ctx.state.cities[0]);
    const [first] = ctx.state.politics.cards.pending;
    const card = STRIKE_CARDS.find((c) => c.id === first.cardId)!;
    resolveCard(ctx, first.uid, card.defaultChoice);
    a.strike!.until = today(ctx) + 1;
    const news = ctx.state.news.length;
    productionDay(ctx);
    nextDay(ctx);
    productionDay(ctx);
    expect(a.strike).toBeNull();
    expect(ctx.state.news.length).toBe(news);
    expect(ctx.state.politics.cards.pending.map((p) => p.uid)).toEqual([b.strike!.cardUid]);
  });

  it('a card instance with no bound strike does nothing', () => {
    expect(strikeTarget(towns().state, 12345)).toBeNull();
    expect(strikeTarget(towns().state, null)).toBeNull();
  });
});

describe('demolition mid-strike', () => {
  it('leaves no dangling state and withdraws the strike card (nothing left to concede)', () => {
    const ctx = towns();
    const a = mill(ctx, { x: 29, y: 14 });
    const b = mill(ctx, { x: 29, y: 19 });
    startStrike(ctx, a, ctx.state.cities[0]);
    startStrike(ctx, b, ctx.state.cities[0]);
    const [ofA, ofB] = ctx.state.politics.cards.pending;
    expect(demolishBuilding(ctx, a.id, 'player').ok).toBe(true);
    expect(strikeTarget(ctx.state, ofA.uid)).toBeNull();
    expect(ctx.state.politics.cards.pending.map((p) => p.uid)).toEqual([ofB.uid]); // the other strike's card stays
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
});

describe('invariants', () => {
  it('flag a strike bound to a card that is not pending', () => {
    const ctx = towns();
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    b.strike!.cardUid = 9999;
    expect(checkInvariants(ctx.state).some((m) => m.includes('not pending'))).toBe(true);
  });

  it('flag a strike longer than 120 days or with no reason', () => {
    const ctx = towns();
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    expect(checkInvariants(ctx.state)).toEqual([]);
    b.strike!.until = b.strike!.since + 121;
    expect(checkInvariants(ctx.state).some((m) => m.includes('strike'))).toBe(true);
    b.strike!.until = b.strike!.since + 30;
    b.strike!.reason = '';
    expect(checkInvariants(ctx.state).some((m) => m.includes('strike'))).toBe(true);
  });
});

describe('v6 migration', () => {
  it('gives every building strike: null', () => {
    const o: Record<string, unknown> = {
      version: 5,
      date: { year: 1950, month: 3, day: 1, hour: 0 },
      cities: [],
      buildings: { 1: { id: 1 }, 2: { id: 2 } },
    };
    expect(migrateSave(o, undefined, 6).ok).toBe(true);
    expect(Object.values(o.buildings as Record<string, { strike: unknown }>).map((b) => b.strike)).toEqual([null, null]);
  });
});

describe('strikeActive', () => {
  it('is true until the day the strike ends', () => {
    const ctx = towns();
    const b = mill(ctx);
    startStrike(ctx, b, ctx.state.cities[0]);
    const s = b.strike!;
    expect(strikeActive(s, s.until - 1)).toBe(true);
    expect(strikeActive(s, s.until)).toBe(false);
    expect(strikeActive(null, 0)).toBe(false);
  });

  it('the bus type exists', () => {
    const bus = new EventBus();
    let n = 0;
    bus.on('strike', () => n++);
    bus.emit({ type: 'strike', buildingId: 1, cityId: 0 });
    expect(n).toBe(1);
  });
});
