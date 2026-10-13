import { describe, expect, it } from 'vitest';
import { unpackState } from '../../game/saves';
import { FACTION_IDS, FACTIONS, type FactionId } from '../../data/factions';
import { err } from '../../core/result';
import { migrateSave } from '../migrations';
import { stateHash } from '../hash';
import { checkInvariants } from '../invariants';
import { runDays } from '../simulation';
import { createGame } from '../state';
import { testCtx, testState } from '../testkit';
import { EventBus, type GameEvent } from '../../core/events';
import { drawWinner, electionsMonth, endorse, firstElection, holdElection, monthIndex, newCityPolitics, voteShares } from './elections';

const fixtures = import.meta.glob('../__fixtures__/phase1.save.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phase1 = Object.values(fixtures)[0];

const town = (seed = 1) => testCtx(testState({ seed, cities: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }));
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('elections', () => {
  it('firstElection staggers four consecutive cities across four years, Mar-Nov', () => {
    const idx = [0, 1, 2, 3].map((i) => firstElection(i, 1900));
    expect(new Set(idx.map((i) => Math.floor(i / 12))).size).toBe(4);
    for (let i = 0; i < 12; i++) {
      const m = firstElection(i, 1900) % 12; // 0-based
      expect(m).toBeGreaterThanOrEqual(2);
      expect(m).toBeLessThanOrEqual(10);
    }
  });

  it('voteShares sum to 1 and are proportional to weight at equal opinions', () => {
    const c = town().state.cities[0];
    for (const f of FACTION_IDS) c.opinion[f] = 50;
    const s = voteShares(c);
    expect(sum(s)).toBeCloseTo(1, 12);
    for (const f of FACTION_IDS) expect(s[f]).toBeCloseTo(FACTIONS[f].weight, 12);
  });

  it('endorsing raises that faction share; slush raises it further, capped at 3 uses', () => {
    const c = town().state.cities[0];
    const base = voteShares(c).church;
    c.politics.endorsed = 'church';
    const e = voteShares(c).church;
    expect(e).toBeGreaterThan(base);
    c.politics.slush = 1;
    const s1 = voteShares(c).church;
    expect(s1).toBeGreaterThan(e);
    c.politics.slush = 3;
    const s3 = voteShares(c).church;
    c.politics.slush = 9;
    expect(voteShares(c).church).toBe(s3);
  });

  it('holdElection is deterministic, advances 48 months, publishes news and emits election', () => {
    const run = () => {
      const ctx = town(5);
      const events: GameEvent[] = [];
      ctx.bus.on('election', (e) => events.push(e));
      ctx.state.cities[0].politics.endorsed = 'baron';
      ctx.state.cities[0].politics.slush = 2;
      const before = ctx.state.cities[0].politics.nextElection;
      const w = holdElection(ctx, ctx.state.cities[0]);
      return { ctx, w, before, events };
    };
    const a = run();
    const b = run();
    expect(a.w).toBe(b.w);
    expect(stateHash(a.ctx.state)).toBe(stateHash(b.ctx.state));
    const p = a.ctx.state.cities[0].politics;
    expect(p.nextElection).toBe(a.before + 48);
    expect(p.endorsed).toBeNull();
    expect(p.slush).toBe(0);
    expect(p.council).toBe(a.w);
    expect(p.mayor.faction).toBe(a.w);
    expect(a.events).toEqual([{ type: 'election', cityId: 0, winner: a.w }]);
    const n = a.ctx.state.news.at(-1)!;
    expect(n.kind).toBe('politics');
    expect(n.headline).toContain('WINS TOWN 0');
    expect(n.headline).toContain(p.mayor.name.toUpperCase());
    expect(n.body).toMatch(/Workers \d+%.*Old Money \d+%.*Reformers \d+%.*Church \d+%/);
  });

  it('always produces a mayor, even with every score equal and at the extreme draws', () => {
    const ctx = town();
    const c = ctx.state.cities[0];
    const saved = FACTION_IDS.map((f) => FACTIONS[f].weight);
    try {
      for (const f of FACTION_IDS) {
        FACTIONS[f].weight = 0.2;
        c.opinion[f] = 50;
      }
      const s = voteShares(c);
      for (const f of FACTION_IDS) expect(s[f]).toBeCloseTo(0.2, 12);
      const winners = new Set<FactionId>();
      for (let seed = 0; seed < 200; seed++) {
        ctx.state.rngState = seed;
        winners.add(holdElection(ctx, c));
        expect(c.politics.mayor.name.length).toBeGreaterThan(3);
        expect(c.politics.mayor.faction).toBe(c.politics.council);
      }
      expect(winners.size).toBe(5);
    } finally {
      FACTION_IDS.forEach((f, i) => (FACTIONS[f].weight = saved[i]));
    }
  });

  it('chooses a winner when the draw lands past float shortfall (all shares equal)', () => {
    const ctx = town();
    const c = ctx.state.cities[0];
    // seeds sweep: every outcome is a valid faction
    const seen = new Set<FactionId>();
    for (let s = 0; s < 300; s++) {
      ctx.state.rngState = s;
      seen.add(holdElection(ctx, c));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const f of seen) expect(FACTION_IDS).toContain(f);
  });

  it('electionsMonth holds due elections in the month and not before', () => {
    const ctx = town();
    const ev: number[] = [];
    ctx.bus.on('election', (e) => ev.push(e.cityId));
    const due = ctx.state.cities[0].politics.nextElection;
    ctx.state.cities[1].politics.nextElection = due + 5;
    ctx.state.date.year = Math.floor(due / 12);
    ctx.state.date.month = (due % 12) + 1;
    electionsMonth(ctx);
    expect(ev).toEqual([0]);
    electionsMonth(ctx);
    expect(ev).toEqual([0]);
  });

  it('an election due on a loaded save is scheduled at least 6 months ahead', () => {
    const r = unpackState(phase1);
    if (!r.ok) throw new Error(r.error);
    const now = monthIndex(r.value.date);
    expect(r.value.cities.length).toBeGreaterThan(0);
    for (const c of r.value.cities) {
      expect(c.politics.nextElection).toBeGreaterThanOrEqual(now + 6);
      expect(c.politics.mayor.faction).toBe('workers');
      expect(c.politics.council).toBe('workers');
      expect(c.politics.edicts).toEqual([]);
    }
    expect(checkInvariants(r.value)).toEqual([]);
  });

  it('a migrated city whose staggered date is already past still gets 6 months', () => {
    expect(newCityPolitics(0, 1900, firstElection(0, 1900) + 20).nextElection).toBe(firstElection(0, 1900) + 26);
  });

  it('createGame cities have staggered politics and a century yields 100+ elections', () => {
    const ctx = { state: createGame({ seed: 7 }), bus: new EventBus() };
    let n = 0;
    ctx.bus.on('election', () => n++);
    expect(ctx.state.cities.length).toBeGreaterThanOrEqual(5);
    runDays(ctx, 360 * 100);
    expect(n).toBeGreaterThanOrEqual(100);
    for (const c of ctx.state.cities) expect(c.politics.mayor.name).toBeTruthy();
  }, 120000);

  it('drawWinner falls back to a valid faction when the draw outruns the cumulative sum', () => {
    const ctx = town();
    // shares summing below the draw: rngState chosen arbitrarily, shares all zero forces the fallback
    const zero = { workers: 0, oldmoney: 0, reformers: 0, church: 0, baron: 0 };
    expect(FACTION_IDS).toContain(drawWinner(ctx.state, zero));
  });

  it('a decades-overdue election holds exactly once and reschedules into the future', () => {
    const ctx = town();
    const ev: number[] = [];
    ctx.bus.on('election', (e) => ev.push(e.cityId));
    const now = monthIndex(ctx.state.date);
    ctx.state.cities[0].politics.nextElection = now - 1200;
    ctx.state.cities[1].politics.nextElection = now + 20;
    electionsMonth(ctx);
    expect(ev).toEqual([0]);
    expect(ctx.state.cities[0].politics.nextElection).toBeGreaterThan(now);
  });

  it('rejects a raw save with no numeric date as corrupted', () => {
    for (const date of [undefined, { year: 'x', month: 1 }]) {
      const o: Record<string, unknown> = { version: 4, cities: [{ id: 0 }], date };
      expect(migrateSave(o)).toEqual(err('Save file is corrupted'));
    }
  });

  describe('endorse', () => {
    const at = (monthsBefore: number) => {
      const ctx = town();
      const due = ctx.state.cities[0].politics.nextElection - monthsBefore;
      ctx.state.date.year = Math.floor(due / 12);
      ctx.state.date.month = (due % 12) + 1;
      return ctx;
    };
    it('is refused 13 months before the election', () => {
      const ctx = at(13);
      expect(endorse(ctx, 0, 'church').ok).toBe(false);
      expect(ctx.state.cities[0].politics.endorsed).toBeNull();
    });
    it('is allowed 12 months before: +5 to the endorsed, -3 to the rest', () => {
      const ctx = at(12);
      const before = { ...ctx.state.cities[0].opinion };
      expect(endorse(ctx, 0, 'church').ok).toBe(true);
      const c = ctx.state.cities[0];
      expect(c.politics.endorsed).toBe('church');
      for (const f of FACTION_IDS) expect(c.opinion[f]).toBe(before[f] + (f === 'church' ? 5 : -3));
      expect(ctx.state.cities[1].opinion).toEqual(before);
      const logs = ctx.state.politics.log.filter((e) => e.reason === 'Election endorsement');
      expect(logs.length).toBe(FACTION_IDS.length);
      expect(logs.find((e) => e.faction === 'church')).toMatchObject({ scope: 0, delta: 5 });
      expect(logs.find((e) => e.faction === 'workers')).toMatchObject({ scope: 0, delta: -3 });
    });
    it('refuses a second endorsement in the same cycle (no switching)', () => {
      const ctx = at(6);
      expect(endorse(ctx, 0, 'church').ok).toBe(true);
      const r = endorse(ctx, 0, 'workers');
      expect(r.ok).toBe(false);
      expect(ctx.state.cities[0].politics.endorsed).toBe('church');
      holdElection(ctx, ctx.state.cities[0]);
      expect(ctx.state.cities[0].politics.endorsed).toBeNull();
    });
    it('refuses an unknown city', () => {
      expect(endorse(at(6), 99, 'church').ok).toBe(false);
    });
  });
});
