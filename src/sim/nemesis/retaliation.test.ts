import { describe, expect, it } from 'vitest';
import { FACTION_IDS } from '../../data/factions';
import { addDays, dateToDays } from '../clock';
import { checkInvariants } from '../invariants';
import { loadSource } from '../inventory';
import { computeDailySales, salePrice, type StoreStock } from '../market';
import { holdElection, monthIndex, voteShares } from '../politics/elections';
import { adjustOpinion, nationalOpinion } from '../politics/factions';
import { productionDay, retailDay } from '../production';
import { rivalReserve } from '../rival/shared';
import { placeBuilding } from '../state';
import { must, testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { addGrudge, grudgesYear, grudgeTotal } from './grudges';
import {
  BARON_BACK_BONUS,
  eligibleKinds,
  priceWars,
  PRICE_WAR_DAYS,
  PRICE_WAR_FACTOR,
  RESERVE_MULTIPLE,
  POACH_COOLDOWN_MONTHS,
  POACH_DELTA,
  POACH_MIN_WORKERS,
  RETALIATE_AT,
  RETALIATION_COST,
  retaliate,
  retaliateMonth,
  SABOTAGE_BAN_YEARS,
} from './retaliation';
import type { RetaliationKind } from './types';

function setup(): SimContext {
  const ctx = testCtx(
    testState({ width: 60, height: 30, money: 1e7, rivalMoney: 1e7, cities: [{ x: 10, y: 10, population: 10000 }, { x: 45, y: 15, population: 2000 }] }),
  );
  ctx.state.date = { year: 1900, month: 6, day: 30, hour: 0 };
  return ctx;
}

/** Tops the ledger up with `city` grudges (weight 5) until it weighs at least `total`. */
function feud(ctx: SimContext, total: number): void {
  while (grudgeTotal(ctx.state) < total) addGrudge(ctx.state, 'city', 0);
}

/** Runs the month's retaliation, then steps to the next month's last day (the year hook at December). */
function month(ctx: SimContext): void {
  retaliateMonth(ctx);
  const d = ctx.state.date;
  if (d.month === 12) {
    grudgesYear(ctx);
    d.year++;
    d.month = 1;
  } else d.month++;
}

const factory = (ctx: SimContext) => must(placeBuilding(ctx, 'player', 'sawmill', { x: 10, y: 21 }));

function strikes(ctx: SimContext): { kind: RetaliationKind; at: number }[] {
  const out: { kind: RetaliationKind; at: number }[] = [];
  ctx.bus.on('baronStrike', (e) => out.push({ kind: e.kind, at: monthIndex(ctx.state.date) }));
  return out;
}

describe('retaliateMonth gates', () => {
  it(`never acts below RETALIATE_AT (${RETALIATE_AT})`, () => {
    const ctx = setup();
    // a Baron far richer than the player collects no December rivalry grudge
    ctx.state.companies.rival.money = 1e12;
    const seen = strikes(ctx);
    addGrudge(ctx.state, 'city', 0); // 5
    expect(grudgeTotal(ctx.state)).toBeLessThan(RETALIATE_AT);
    for (let i = 0; i < 300; i++) month(ctx);
    expect(seen).toEqual([]);
    expect(ctx.state.news.filter((n) => n.kind === 'rival')).toEqual([]);
    expect(ctx.state.nemesis.lastAction).toBeNull();
  });

  it('acts at most 6 times a year, never in consecutive months, and every action prints news (1,000 months)', () => {
    const ctx = setup();
    factory(ctx);
    const seen = strikes(ctx);
    const newsMonths = new Set<number>();
    ctx.bus.on('news', (e) => {
      if (e.item.kind === 'rival') newsMonths.add(monthIndex(ctx.state.date));
    });
    for (let i = 0; i < 1000; i++) {
      feud(ctx, 40);
      month(ctx);
    }
    expect(seen.length).toBeGreaterThan(200);
    const perYear = new Map<number, number>();
    for (const s of seen) perYear.set(Math.floor(s.at / 12), (perYear.get(Math.floor(s.at / 12)) ?? 0) + 1);
    expect(Math.max(...perYear.values())).toBeLessThanOrEqual(6);
    for (let i = 1; i < seen.length; i++) expect(seen[i].at - seen[i - 1].at).toBeGreaterThanOrEqual(2);
    for (const s of seen) expect(newsMonths.has(s.at)).toBe(true);
    // more than one kind is chosen
    expect(new Set(seen.map((s) => s.kind)).size).toBeGreaterThan(1);
    expect(seen.some((s) => s.kind === 'hostile_bid')).toBe(false);
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it('spends the heaviest grudge (its weight halves) and names its cause', () => {
    const ctx = setup();
    addGrudge(ctx.state, 'undercut', 0);
    addGrudge(ctx.state, 'takeover_bid', null);
    expect(retaliate(ctx, 'smear')).toBe(true);
    expect(ctx.state.nemesis.grudges.map((g) => g.weight)).toEqual([2, 4]);
    const news = ctx.state.news.filter((n) => n.kind === 'rival');
    expect(news).toHaveLength(1);
    expect(news[0].body).toMatch(/bid for his company/);
    expect(ctx.state.nemesis.lastAction).toEqual({ kind: 'smear', year: 1900, month: 6 });
    expect(ctx.state.nemesis.actionsThisYear).toBe(1);
    grudgesYear(ctx);
    expect(ctx.state.nemesis.actionsThisYear).toBe(0);
  });
});

describe('the Baron pays', () => {
  it(`each kind is charged at today's prices, and he never spends below ${RESERVE_MULTIPLE} × his reserve`, () => {
    const ctx = setup();
    const rival = ctx.state.companies.rival;
    const keep = () => RESERVE_MULTIPLE * rivalReserve(ctx.state);
    rival.money = keep() + RETALIATION_COST.smear + 10;
    factory(ctx);
    expect(eligibleKinds(ctx)).toEqual(['smear']);
    expect(retaliate(ctx, 'smear')).toBe(true);
    expect(rival.money).toBe(keep() + 10);
    expect(eligibleKinds(ctx)).toEqual([]);
    expect(retaliate(ctx, 'smear')).toBe(false);
    const seen = strikes(ctx);
    for (let i = 0; i < 200; i++) {
      feud(ctx, 40);
      month(ctx);
      expect(rival.money).toBeGreaterThanOrEqual(keep());
    }
    expect(seen).toEqual([]);
  });

  it('charges more as prices rise', () => {
    const ctx = setup();
    ctx.state.economy.priceIndex = 2;
    const before = ctx.state.companies.rival.money;
    retaliate(ctx, 'smear');
    expect(before - ctx.state.companies.rival.money).toBe(2 * RETALIATION_COST.smear);
  });
});

describe('price war', () => {
  it('computeDailySales: the favoured owner gets 2 units for each 1 of a rival store, at 85% of the price', () => {
    const ctx = setup();
    const city = ctx.state.cities[0];
    const stores: StoreStock[] = [
      { buildingId: 1, ownerId: 'player', stock: { bread: 1e6 } },
      { buildingId: 2, ownerId: 'rival', stock: { bread: 1e6 } },
    ];
    const wars = { bread: { favoured: 'rival', priceFactor: PRICE_WAR_FACTOR } };
    let p = 0;
    let r = 0;
    for (let day = 0; day < 30; day++) {
      for (const s of computeDailySales(city, stores, 1900, () => 1, day, 1, wars)) {
        if (s.goodId !== 'bread') continue;
        if (s.ownerId === 'player') p += s.qty;
        else r += s.qty;
        expect(s.revenue / s.qty).toBe(Math.max(1, Math.round(salePrice('bread', 0) * PRICE_WAR_FACTOR)));
      }
    }
    expect(r / p).toBeGreaterThan(1.9);
    expect(r / p).toBeLessThan(2.1);
    // no war: an even split at full price
    const even = computeDailySales(ctx.state.cities[1], stores, 1900, () => 1, 0, 1, null).filter((s) => s.goodId === 'bread');
    expect(even[0].qty).toBe(even[1].qty);
    expect(even[0].revenue / even[0].qty).toBe(salePrice('bread', 0));
  });

  it('starts in a contested city and good, shifts retail 2:1, and lifts after PRICE_WAR_DAYS', () => {
    const ctx = setup();
    expect(eligibleKinds(ctx)).not.toContain('price_war');
    ctx.state.nemesis.track.contested = ['0:bread'];
    expect(eligibleKinds(ctx)).toContain('price_war');
    expect(retaliate(ctx, 'price_war')).toBe(true);
    const today = dateToDays(ctx.state.date);
    expect(ctx.state.nemesis.effects).toEqual([{ kind: 'price_war', cityId: 0, goodId: 'bread', untilDay: today + PRICE_WAR_DAYS + 1 }]);
    const mine = must(placeBuilding(ctx, 'player', 'store', { x: 8, y: 12 }));
    const his = must(placeBuilding(ctx, 'rival', 'store', { x: 12, y: 12 }));
    expect([mine.cityId, his.cityId]).toEqual([0, 0]);
    loadSource(mine).bread = 1e5;
    loadSource(his).bread = 1e5;
    ctx.state.date = addDays(ctx.state.date, 1);
    for (let d = 0; d < 30; d++) {
      expect(priceWars(ctx.state, 0)).not.toBeNull();
      retailDay(ctx);
      ctx.state.date = addDays(ctx.state.date, 1);
    }
    const soldMine = 1e5 - loadSource(mine).bread;
    const soldHis = 1e5 - loadSource(his).bread;
    expect(soldHis / soldMine).toBeGreaterThan(1.9);
    expect(soldHis / soldMine).toBeLessThan(2.1);
    expect(priceWars(ctx.state, 1)).toBeNull();
    // day PRICE_WAR_DAYS is the last; the day after it, the war is over and the effect is dropped
    ctx.state.date = addDays(ctx.state.date, today + PRICE_WAR_DAYS - dateToDays(ctx.state.date));
    expect(priceWars(ctx.state, 0)).not.toBeNull();
    ctx.state.date = addDays(ctx.state.date, 1);
    expect(priceWars(ctx.state, 0)).toBeNull();
    retaliateMonth(ctx);
    expect(ctx.state.nemesis.effects).toEqual([]);
  });
});

describe('fund_opponent', () => {
  it('backs the faction that likes the player least, ×1.3 in voteShares, until the election clears it', () => {
    const ctx = setup();
    const city = ctx.state.cities[1];
    expect(eligibleKinds(ctx)).not.toContain('fund_opponent');
    city.politics.nextElection = monthIndex(ctx.state.date) + 5;
    expect(eligibleKinds(ctx)).toContain('fund_opponent');
    adjustOpinion(ctx.state, 'church', 1, -40, 'test');
    const before = voteShares(city);
    expect(retaliate(ctx, 'fund_opponent')).toBe(true);
    expect(city.politics.baronBacks).toBe('church');
    expect(eligibleKinds(ctx)).not.toContain('fund_opponent');
    const after = voteShares(city);
    const ratio = (f: (typeof FACTION_IDS)[number]) => after[f] / before[f];
    expect(ratio('church') / ratio('workers')).toBeCloseTo(BARON_BACK_BONUS, 9);
    expect(ratio('oldmoney') / ratio('workers')).toBeCloseTo(1, 9);
    expect(ctx.state.nemesis.effects).toHaveLength(1);
    // the effect holds until the election month's last day
    for (let i = 0; i < 5; i++) month(ctx);
    expect(ctx.state.nemesis.effects).toHaveLength(1);
    expect(city.politics.baronBacks).toBe('church');
    expect(monthIndex(ctx.state.date)).toBe(city.politics.nextElection);
    holdElection(ctx, city);
    expect(city.politics.baronBacks).toBeNull();
    retaliateMonth(ctx);
    expect(ctx.state.nemesis.effects).toEqual([]);
  });

  it("never backs the Baron's own circle, even when it likes the player least", () => {
    const ctx = setup();
    const city = ctx.state.cities[1];
    city.politics.nextElection = monthIndex(ctx.state.date) + 5;
    const lowest = FACTION_IDS.reduce((a, b) => (city.opinion[b] < city.opinion[a] ? b : a));
    expect(lowest).toBe('baron');
    expect(retaliate(ctx, 'fund_opponent')).toBe(true);
    expect(city.politics.baronBacks).toBe('workers');
  });

  it('a lapsed backing is cleared even without an election', () => {
    const ctx = setup();
    const city = ctx.state.cities[1];
    city.politics.nextElection = monthIndex(ctx.state.date) + 2;
    retaliate(ctx, 'fund_opponent');
    expect(city.politics.baronBacks).not.toBeNull();
    city.politics.nextElection += 48; // postponed: the Baron's money runs out on the old date
    for (let i = 0; i < 3; i++) month(ctx);
    expect(city.politics.baronBacks).toBeNull();
    expect(ctx.state.nemesis.effects).toEqual([]);
  });
});

describe('poach and smear', () => {
  it('poach: the workers of a town the player hires from lose 4', () => {
    const ctx = setup();
    expect(eligibleKinds(ctx)).not.toContain('poach');
    factory(ctx);
    expect(eligibleKinds(ctx)).toContain('poach');
    const w = ctx.state.cities[0].opinion.workers;
    expect(retaliate(ctx, 'poach')).toBe(true);
    expect(POACH_DELTA).toBe(-4);
    expect(ctx.state.cities[0].opinion.workers).toBe(w - 4);
    expect(ctx.state.politics.log.at(-1)).toMatchObject({ faction: 'workers', scope: 0, delta: -4, reason: 'Smogsworth poaches your men' });
  });

  it(`poach: only in towns whose workers' opinion is at least ${POACH_MIN_WORKERS}`, () => {
    const ctx = setup();
    factory(ctx);
    const city = ctx.state.cities[0];
    adjustOpinion(ctx.state, 'workers', 0, POACH_MIN_WORKERS - 1 - city.opinion.workers, 'test');
    expect(city.opinion.workers).toBe(34);
    expect(eligibleKinds(ctx)).not.toContain('poach');
    expect(retaliate(ctx, 'poach')).toBe(false);
    adjustOpinion(ctx.state, 'workers', 0, 1, 'test');
    expect(city.opinion.workers).toBe(35);
    expect(eligibleKinds(ctx)).toContain('poach');
    expect(retaliate(ctx, 'poach')).toBe(true);
    expect(city.opinion.workers).toBe(31);
  });

  it(`poach: not again in the same town within ${POACH_COOLDOWN_MONTHS} months`, () => {
    const ctx = setup();
    // no December rivalry grudges, so no moves of his own while the months pass
    ctx.state.companies.rival.money = 1e12;
    factory(ctx);
    expect(POACH_COOLDOWN_MONTHS).toBe(48);
    expect(retaliate(ctx, 'poach')).toBe(true);
    expect(ctx.state.nemesis.track.poached).toEqual({ 0: monthIndex(ctx.state.date) });
    for (let i = 0; i < POACH_COOLDOWN_MONTHS - 1; i++) {
      month(ctx);
      expect(eligibleKinds(ctx)).not.toContain('poach');
    }
    const money = ctx.state.companies.rival.money;
    expect(retaliate(ctx, 'poach')).toBe(false);
    expect(ctx.state.companies.rival.money).toBe(money);
    month(ctx);
    expect(eligibleKinds(ctx)).toContain('poach');
  });

  it('smear: never the workers (nor the Baron\'s circle), even when they like the player best', () => {
    const ctx = setup();
    adjustOpinion(ctx.state, 'workers', 'national', 30, 'test');
    adjustOpinion(ctx.state, 'baron', 'national', 40, 'test');
    adjustOpinion(ctx.state, 'church', 'national', 10, 'test');
    const before = { workers: nationalOpinion(ctx.state, 'workers'), baron: nationalOpinion(ctx.state, 'baron'), church: nationalOpinion(ctx.state, 'church') };
    expect(retaliate(ctx, 'smear')).toBe(true);
    expect(nationalOpinion(ctx.state, 'workers')).toBe(before.workers);
    expect(nationalOpinion(ctx.state, 'baron')).toBe(before.baron);
    expect(nationalOpinion(ctx.state, 'church')).toBeCloseTo(before.church - 4, 9);
  });

  it('smear: ties go to FACTION_IDS order (oldmoney before reformers and church)', () => {
    const ctx = setup();
    retaliate(ctx, 'smear');
    expect(ctx.state.politics.log.at(-1)).toMatchObject({ faction: 'oldmoney', scope: 'national', delta: -4 });
  });

  it('smear: the faction that likes the player best loses 4 nationally', () => {
    const ctx = setup();
    adjustOpinion(ctx.state, 'reformers', 'national', 20, 'test');
    const r = nationalOpinion(ctx.state, 'reformers');
    expect(retaliate(ctx, 'smear')).toBe(true);
    expect(nationalOpinion(ctx.state, 'reformers')).toBeCloseTo(r - 4, 9);
  });
});

describe('sabotage', () => {
  it('halts a working factory for 10-20 days, after which it runs again', () => {
    const ctx = setup();
    expect(eligibleKinds(ctx)).not.toContain('sabotage');
    const b = factory(ctx);
    expect(eligibleKinds(ctx)).toContain('sabotage');
    expect(retaliate(ctx, 'sabotage')).toBe(true);
    const today = dateToDays(ctx.state.date);
    const days = dateToDays(b.haltedUntil!) - today;
    expect(days).toBeGreaterThanOrEqual(10);
    expect(days).toBeLessThanOrEqual(20);
    // a halted works is not working: no second sabotage on it
    expect(eligibleKinds(ctx)).not.toContain('sabotage');
    ctx.state.date = addDays(ctx.state.date, days - 1);
    productionDay(ctx);
    expect(b.status).toBe('halted');
    ctx.state.date = addDays(ctx.state.date, 1);
    productionDay(ctx);
    expect(b.status).not.toBe('halted');
    expect(b.haltedUntil).toBeNull();
  });

  it(`exposed sabotage helps the player, adds a grudge, and blocks sabotage for ${SABOTAGE_BAN_YEARS} years`, () => {
    let exposed: SimContext | null = null;
    for (let seed = 1; seed < 200 && !exposed; seed++) {
      const ctx = setup();
      ctx.state.rngState = seed;
      factory(ctx);
      retaliate(ctx, 'sabotage');
      if (ctx.state.nemesis.grudges.some((g) => g.kind === 'sabotage_exposed')) exposed = ctx;
    }
    expect(exposed).not.toBeNull();
    const ctx = exposed!;
    expect(ctx.state.news.filter((n) => n.kind === 'rival')).toHaveLength(2);
    expect(ctx.state.politics.log.map((l) => [l.faction, l.scope, l.delta])).toEqual([
      ['reformers', 'national', 4],
      ['oldmoney', 'national', 2],
    ]);
    const b = Object.values(ctx.state.buildings).find((x) => x.ownerId === 'player')!;
    b.haltedUntil = null;
    const today = dateToDays(ctx.state.date);
    ctx.state.date = addDays(ctx.state.date, SABOTAGE_BAN_YEARS * 360 - 1);
    expect(eligibleKinds(ctx)).not.toContain('sabotage');
    expect(retaliate(ctx, 'sabotage')).toBe(false);
    ctx.state.date = addDays(ctx.state.date, 1);
    expect(dateToDays(ctx.state.date) - today).toBe(SABOTAGE_BAN_YEARS * 360);
    expect(eligibleKinds(ctx)).toContain('sabotage');
  });
});

describe('every kind', () => {
  it('prints a rival news item and emits baronStrike', () => {
    const kinds: RetaliationKind[] = ['price_war', 'poach', 'fund_opponent', 'smear', 'sabotage'];
    for (const kind of kinds) {
      const ctx = setup();
      factory(ctx);
      ctx.state.nemesis.track.contested = ['0:bread'];
      ctx.state.cities[0].politics.nextElection = monthIndex(ctx.state.date) + 3;
      addGrudge(ctx.state, 'contract', 0);
      const seen = strikes(ctx);
      expect(retaliate(ctx, kind), kind).toBe(true);
      expect(seen.map((s) => s.kind)).toEqual([kind]);
      expect(ctx.state.news.filter((n) => n.kind === 'rival').length, kind).toBeGreaterThanOrEqual(1);
      // exactly the retaliation's own item carries the nemesis tag (the rival panel's history)
      const tagged = ctx.state.news.filter((n) => n.tag === 'nemesis');
      expect(tagged, kind).toHaveLength(1);
      expect(tagged[0].kind, kind).toBe('rival');
      expect(tagged[0].body, kind).not.toMatch(/\{\w+\}/);
      expect(checkInvariants(ctx.state), kind).toEqual([]);
    }
  });

  it('hostile_bid is never chosen yet (Task 8)', () => {
    const ctx = setup();
    expect(eligibleKinds(ctx)).not.toContain('hostile_bid');
    feud(ctx, 40);
    const before = JSON.stringify(ctx.state);
    expect(retaliate(ctx, 'hostile_bid')).toBe(false);
    expect(JSON.stringify(ctx.state)).toBe(before);
  });

  it('an inactive Baron does nothing', () => {
    const ctx = setup();
    feud(ctx, 40);
    ctx.state.companies.rival.active = false;
    const seen = strikes(ctx);
    for (let i = 0; i < 50; i++) month(ctx);
    expect(seen).toEqual([]);
  });
});
