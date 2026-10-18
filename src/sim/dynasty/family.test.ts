import { describe, expect, it } from 'vitest';
import { CARDS_BY_ID } from '../../data/cards';
import { DYNASTY_TRAITS } from '../../data/dynasty';
import { autoplayNameHeir } from '../../game/autoplay';
import { autoResolve, cardScale, choiceCost, eligibleCards, resolveCard } from '../politics/cards';
import { scandalMonth } from '../politics/elections';
import { companyEdictFactor, maintenanceFactor } from '../politics/edicts';
import { nationalOpinion } from '../politics/factions';
import { checkInvariants } from '../invariants';
import { testCtx, testState } from '../testkit';
import type { GameState, SimContext } from '../types';
import {
  dynastyMonth,
  dynastyYear,
  headDies,
  mortality,
  nameHeir,
  successor,
} from './family';
import { dynastyModifier, marry, newDynasty, type Person } from './types';

function setup(seed = 1, year = 1900): SimContext {
  const ctx = testCtx(testState({ seed, year, cities: [{ x: 10, y: 10, population: 9000 }, { x: 30, y: 20, population: 4000 }] }));
  return ctx;
}

const child = (state: GameState, born: number, traits: Person['traits'] = []): Person => {
  const d = state.dynasty;
  const p: Person = { id: d.nextPersonId++, name: `Kid${born} Test`, born, traits, alive: true };
  d.children.push(p);
  return p;
};

const gameOvers = (ctx: SimContext) => {
  const out: string[] = [];
  ctx.bus.on('gameOver', (e) => out.push(e.reason));
  return out;
};

describe('newDynasty', () => {
  it('starts with Josiah <family>, single, one trait, aged 28 at the start', () => {
    const d = newDynasty({ rngState: 7 }, 'Gilded Gear & Co.', 1900);
    expect(d.head.name).toBe('Josiah Gilded');
    expect(d.head.born).toBe(1872);
    expect(d.head.traits).toHaveLength(1);
    expect(d).toMatchObject({ spouse: null, children: [], heirId: null, generation: 1, prestige: 0 });
  });
});

describe('marry', () => {
  it('never weds a spouse under 18, even to an 18-year-old head', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = setup(seed, 1930).state;
      s.dynasty.head.born = 1912; // 18
      marry(s);
      expect(1930 - s.dynasty.spouse!.born, `seed ${seed}`).toBeGreaterThanOrEqual(18);
    }
    // an older head keeps the age-gap roll: 0-6 years younger
    const s = setup(2, 1930).state;
    s.dynasty.head.born = 1890;
    marry(s);
    expect(s.dynasty.spouse!.born - 1890).toBeGreaterThanOrEqual(0);
    expect(s.dynasty.spouse!.born - 1890).toBeLessThanOrEqual(6);
  });
});

describe('mortality', () => {
  it('is 0 at 54 and 55, (age - 55) x 0.012 after, and 1 at 90 or older', () => {
    expect(mortality(54)).toBe(0);
    expect(mortality(55)).toBe(0);
    expect(mortality(65)).toBeCloseTo(0.12, 12);
    expect(mortality(89)).toBeCloseTo(0.408, 12);
    expect(mortality(90)).toBe(1);
    expect(mortality(97)).toBe(1);
  });
});

describe('births', () => {
  it('a child is only born while married and the head is under 50', () => {
    // single: never, over 20 years
    const single = setup(3, 1905);
    for (let y = 1905; y < 1921; y++) {
      single.state.date = { year: y, month: 12, day: 30, hour: 0 };
      dynastyYear(single);
    }
    expect(single.state.dynasty.children).toHaveLength(0);

    // married at 49: births possible; married at 50 and over: never
    let bornAt49 = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = setup(seed, 1921);
      ctx.state.date = { year: ctx.state.dynasty.head.born + 49, month: 12, day: 30, hour: 0 };
      marry(ctx.state);
      dynastyYear(ctx);
      bornAt49 += ctx.state.dynasty.children.length;
      for (let a = 50; a < 55; a++) {
        ctx.state.date.year = ctx.state.dynasty.head.born + a;
        dynastyYear(ctx);
        // (a childless head of 50 takes in a grown relative instead: born 20 years earlier)
        expect(ctx.state.dynasty.children.filter((k) => k.born === ctx.state.date.year), `seed ${seed} age ${a}`).toEqual([]);
      }
    }
    expect(bornAt49).toBeGreaterThan(5);
  });

  it('caps at 5 children, each with 1-2 distinct traits, eldest first', () => {
    const ctx = setup(11, 1905);
    marry(ctx.state);
    for (let y = 1905; y < 1922; y++) {
      ctx.state.date = { year: y, month: 12, day: 30, hour: 0 };
      dynastyYear(ctx);
    }
    const kids = ctx.state.dynasty.children;
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.length).toBeLessThanOrEqual(5);
    for (const k of kids) {
      expect(k.traits.length).toBeGreaterThanOrEqual(1);
      expect(k.traits.length).toBeLessThanOrEqual(2);
      expect(new Set(k.traits).size).toBe(k.traits.length);
      expect(k.name.endsWith(' Test')).toBe(true);
    }
    expect(kids.map((k) => k.born)).toEqual([...kids.map((k) => k.born)].sort((a, b) => a - b));
    expect(checkInvariants(ctx.state)).toEqual([]);
  });
});

describe('succession', () => {
  it('the heir inherits with generation +1, prestige +10, no spouse and no children', () => {
    const ctx = setup(1, 1940);
    const s = ctx.state;
    marry(s);
    const a = child(s, 1906, ['brute']);
    const b = child(s, 1910, ['charming']);
    expect(nameHeir(s, b.id).ok).toBe(true);
    const prestige = s.dynasty.prestige;
    headDies(ctx);
    expect(s.dynasty.head.id).toBe(b.id);
    expect(s.dynasty.head.traits).toEqual(['charming']);
    expect(s.dynasty.generation).toBe(2);
    expect(s.dynasty.prestige).toBe(prestige + 10);
    expect(s.dynasty.spouse).toBeNull();
    expect(s.dynasty.children).toEqual([]);
    expect(s.dynasty.heirId).toBeNull();
    expect(a.alive).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('the default heir is the eldest living child when none is named', () => {
    const ctx = setup(1, 1940);
    const s = ctx.state;
    const eldest = child(s, 1906);
    child(s, 1908);
    expect(successor(s.dynasty)?.id).toBe(eldest.id);
    headDies(ctx);
    expect(s.dynasty.head.id).toBe(eldest.id);
  });

  it('death with no heir aged 18 or older emits gameOver and stops the clock', () => {
    const ctx = setup(1, 1925);
    const overs = gameOvers(ctx);
    child(ctx.state, 1910); // 15
    headDies(ctx);
    expect(overs).toEqual(['The family line has ended']);
    expect(ctx.state.speed).toBe(0);
    expect(ctx.state.dynasty.head.alive).toBe(false);
    expect(ctx.state.dynasty.head.died).toBe(1925);
    expect(checkInvariants(ctx.state)).toEqual([]);
    // nothing more happens to a dead line
    ctx.state.date = { year: 1926, month: 12, day: 30, hour: 0 };
    dynastyYear(ctx);
    expect(overs).toHaveLength(1);

    const none = setup(2, 1925);
    const o2 = gameOvers(none);
    headDies(none);
    expect(o2).toEqual(['The family line has ended']);
  });

  it('a named heir under 18 does not fall back to an adult sibling', () => {
    const ctx = setup(1, 1925);
    const overs = gameOvers(ctx);
    child(ctx.state, 1900);
    const young = child(ctx.state, 1912);
    expect(nameHeir(ctx.state, young.id).ok).toBe(true);
    headDies(ctx);
    expect(overs).toHaveLength(1);
  });

  it('the head holds on while his successor is under 18, but not past 90', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const ctx = setup(seed, 1940);
      const overs = gameOvers(ctx);
      const s = ctx.state;
      s.dynasty.head.born = 1860;
      child(s, 1925); // 15 in 1940: no death possible until 1943
      for (let y = 1940; y <= 1942; y++) {
        s.date = { year: y, month: 12, day: 30, hour: 0 };
        dynastyYear(ctx);
        expect(s.dynasty.generation, `seed ${seed} ${y}`).toBe(1);
      }
      expect(overs).toEqual([]);
    }
    const ctx = setup(1, 1950);
    const overs = gameOvers(ctx);
    ctx.state.dynasty.head.born = 1860; // 90
    dynastyYear(ctx);
    expect(overs).toEqual(['The family line has ended']);
  });

  it('an heir who inherits at 49 or older takes in a grown nephew or niece', () => {
    const ctx = setup(1, 1960);
    const s = ctx.state;
    s.dynasty.head.born = 1880;
    const old = child(s, 1911); // 49
    headDies(ctx);
    expect(s.dynasty.head.id).toBe(old.id);
    expect(s.dynasty.children).toHaveLength(1);
    expect(s.dynasty.children[0].born).toBe(1940);
    expect(checkInvariants(s)).toEqual([]);

    const young = setup(1, 1960);
    young.state.dynasty.head.born = 1880;
    child(young.state, 1912); // 48: still offered a match next April
    headDies(young);
    expect(young.state.dynasty.children).toHaveLength(0);
  });

  it('a married head at 50 with no child takes in an heir; a single one does not, and the line ends at 90', () => {
    const married = setup(4, 1922);
    married.state.dynasty.head.born = 1872;
    marry(married.state);
    married.state.date = { year: 1922, month: 12, day: 30, hour: 0 }; // Josiah 50
    dynastyYear(married);
    expect(married.state.dynasty.children).toHaveLength(1);
    expect(married.state.dynasty.children[0].born).toBe(1902);

    const single = setup(4, 1922);
    single.state.dynasty.head.born = 1872;
    const overs = gameOvers(single);
    for (let y = 1922; y <= 1962; y++) {
      single.state.date = { year: y, month: 12, day: 30, hour: 0 };
      dynastyYear(single);
    }
    expect(single.state.dynasty.children).toHaveLength(0);
    expect(overs).toEqual(['The family line has ended']);
  });

  it('passed-over adult siblings may open a scandal card (chance 0.3 each)', () => {
    let opened = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = setup(seed, 1945);
      const s = ctx.state;
      for (const born of [1900, 1902, 1904, 1906]) child(s, born);
      headDies(ctx);
      opened += s.politics.cards.pending.filter((p) => CARDS_BY_ID[p.cardId]?.trigger === 'scandal').length;
    }
    // at most one pending per card id, so this counts seeds with at least one scandal
    expect(opened).toBeGreaterThan(10);
  });
});

describe('dynasty invariants', () => {
  it('flag a dead or foreign heir, duplicate ids and a dead head with an adult successor', () => {
    const s = setup(1, 1930).state;
    const kid = child(s, 1905);
    expect(checkInvariants(s)).toEqual([]);
    s.dynasty.heirId = 77;
    expect(checkInvariants(s).join()).toContain('not a living child');
    s.dynasty.heirId = kid.id;
    kid.id = s.dynasty.head.id;
    expect(checkInvariants(s).join()).toContain('used twice');
    kid.id = s.dynasty.nextPersonId - 1;
    s.dynasty.heirId = null;
    s.dynasty.head.alive = false;
    expect(checkInvariants(s).join()).toContain('never took the chair');
    s.dynasty.head.alive = true;
    s.dynasty.prestige = NaN;
    expect(checkInvariants(s).join()).toContain('prestige');
  });
});

describe('nameHeir', () => {
  it('refuses a dead person, a non-child and an unknown id', () => {
    const s = setup(1, 1930).state;
    const kid = child(s, 1910);
    const dead = child(s, 1912);
    dead.alive = false;
    expect(nameHeir(s, dead.id).ok).toBe(false);
    expect(nameHeir(s, s.dynasty.head.id).ok).toBe(false);
    marry(s);
    expect(nameHeir(s, s.dynasty.spouse!.id).ok).toBe(false);
    expect(nameHeir(s, 999).ok).toBe(false);
    expect(s.dynasty.heirId).toBeNull();
    expect(nameHeir(s, kid.id).ok).toBe(true);
    expect(s.dynasty.heirId).toBe(kid.id);
  });
});

describe('trait modifiers', () => {
  it('combine multiplicatively, opinion additively', () => {
    const s = setup().state;
    s.dynasty.head.traits = ['shrewd', 'reckless'];
    const m = dynastyModifier(s);
    expect(m.cardCost).toBeCloseTo(0.85 * 0.9, 12);
    expect(m.scandal).toBe(1.5);
    expect(m.edictCost).toBe(1);
    expect(m.opinion.oldmoney).toBe(0.5);
    s.dynasty.head.traits = ['idealist', 'charming'];
    expect(dynastyModifier(s).opinion).toMatchObject({ reformers: 0.75, church: 0.75, oldmoney: -0.25, workers: 0.25 });
  });

  it('discount what the player pays for a card, never what he receives', () => {
    const s = setup().state;
    const paid = { label: 'Pay', cost: 10_000, effects: [] };
    const dowry = CARDS_BY_ID.marriage.choices[0];
    s.dynasty.head.traits = [];
    const scale = cardScale(s);
    expect(choiceCost(s, paid)).toBe(Math.round((10_000 * scale) / 100) * 100);
    const dowryBase = choiceCost(s, dowry);
    expect(dowryBase).toBeLessThan(0);
    s.dynasty.head.traits = ['shrewd'];
    expect(cardScale(s)).toBe(scale);
    expect(choiceCost(s, paid)).toBe(Math.round((10_000 * scale * 0.85) / 100) * 100);
    expect(choiceCost(s, dowry)).toBe(dowryBase);
  });

  it('reach the edict maintenance multiplier', () => {
    const s = setup().state;
    s.politics.edicts = { wage: 'generous', safety: 'standard', union: 'tolerate' };
    s.dynasty.head.traits = ['brute'];
    expect(companyEdictFactor(s)).toBeCloseTo(maintenanceFactor(s.politics.edicts) * 0.8, 12);
  });

  it('reach scandal risk', () => {
    // same rng, same risk: a reckless head turns some clean months into scandals
    const count = (traits: Person['traits']) => {
      let n = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const ctx = setup(seed);
        ctx.state.dynasty.head.traits = traits;
        ctx.state.cities[0].politics.scandalRisk = 0.5;
        scandalMonth(ctx);
        if (ctx.state.cities[0].politics.scandalRisk === 0) n++;
      }
      return n;
    };
    const calm = count([]);
    const reckless = count(['reckless']);
    expect(reckless).toBeGreaterThan(calm);
  });

  it('reach opinion drift through dynastyMonth', () => {
    const ctx = setup(1, 1902);
    const s = ctx.state;
    s.dynasty.head.traits = ['idealist'];
    const before = { r: nationalOpinion(s, 'reformers'), o: nationalOpinion(s, 'oldmoney'), w: nationalOpinion(s, 'workers') };
    s.date = { year: 1902, month: 6, day: 30, hour: 0 };
    dynastyMonth(ctx);
    expect(nationalOpinion(s, 'reformers')).toBeCloseTo(before.r + 0.5, 9);
    expect(nationalOpinion(s, 'oldmoney')).toBeCloseTo(before.o - 0.5, 9);
    expect(nationalOpinion(s, 'workers')).toBeCloseTo(before.w, 9);
  });

  it('a year of drift adds nothing to the politics log', () => {
    const ctx = setup(1, 1902);
    const s = ctx.state;
    s.dynasty.head.traits = ['idealist', 'charming'];
    const before = s.politics.log.length;
    for (let m = 1; m <= 12; m++) {
      s.date = { year: 1902, month: m, day: 30, hour: 0 };
      dynastyMonth(ctx);
    }
    expect(s.politics.log.length).toBe(before);
    expect(s.politics.log.some((l) => l.reason === 'The family name')).toBe(false);
  });

  it('every trait has a label, a blurb and modifiers', () => {
    for (const def of Object.values(DYNASTY_TRAITS)) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.blurb.length).toBeGreaterThan(0);
      expect(def.modifiers).toBeDefined();
    }
  });
});

describe('the marriage card', () => {
  it('is a spring card of 1905-1910 whose default choice marries', () => {
    const card = CARDS_BY_ID.marriage;
    expect(card.trigger).toBe('spring');
    expect(card.years).toEqual([1905, 1910]);
    expect(card.choices[card.defaultChoice].label.toLowerCase()).toBe('marry for money');
    const ctx = setup(1, 1906);
    const s = ctx.state;
    s.date = { year: 1906, month: 4, day: 30, hour: 0 };
    expect(eligibleCards(s, 'spring', null).some((e) => e.card.id === 'marriage')).toBe(true);
    dynastyMonth(ctx); // end of April: the card opens if the spring draw did not bring it
    const inst = s.politics.cards.pending.find((p) => p.cardId === 'marriage');
    expect(inst).toBeDefined();
    const money = s.companies.player.money;
    const prestige = s.dynasty.prestige;
    expect(autoResolve(ctx, inst!.uid).ok).toBe(true);
    expect(s.dynasty.spouse).not.toBeNull();
    expect(s.dynasty.prestige).toBe(prestige + 5);
    expect(s.companies.player.money).toBeGreaterThan(money);
    // married: never offered again
    expect(eligibleCards(s, 'spring', null).some((e) => e.card.id === 'marriage')).toBe(false);
    s.date.year = 1907;
    dynastyMonth(ctx);
    expect(s.politics.cards.pending.some((p) => p.cardId === 'marriage')).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('is not offered before 1905, and is offered to a later single head under 50 each April', () => {
    const ctx = setup(1, 1904);
    ctx.state.date = { year: 1904, month: 4, day: 30, hour: 0 };
    dynastyMonth(ctx);
    expect(ctx.state.politics.cards.pending).toHaveLength(0);

    const later = setup(1, 1950);
    const s = later.state;
    s.dynasty.head = { id: 9, name: 'Ezra Test', born: 1915, traits: ['shrewd'], alive: true };
    s.dynasty.nextPersonId = 10;
    s.dynasty.generation = 2;
    s.date = { year: 1950, month: 3, day: 30, hour: 0 };
    dynastyMonth(later);
    expect(s.politics.cards.pending).toHaveLength(0);
    s.date.month = 4;
    dynastyMonth(later);
    expect(s.politics.cards.pending.map((p) => p.cardId)).toEqual(['marriage']);
    s.dynasty.head.born = 1900; // 50: too old
    s.politics.cards.pending = [];
    dynastyMonth(later);
    expect(s.politics.cards.pending).toHaveLength(0);
  });

  it('staying single leaves the head single, to be asked again next April', () => {
    const ctx = setup(1, 1906);
    const s = ctx.state;
    s.date = { year: 1906, month: 4, day: 30, hour: 0 };
    dynastyMonth(ctx);
    const inst = s.politics.cards.pending.find((p) => p.cardId === 'marriage')!;
    const single = CARDS_BY_ID.marriage.choices.findIndex((c) => /single/i.test(c.label));
    expect(single).toBeGreaterThanOrEqual(0);
    expect(CARDS_BY_ID.marriage.choices[single].cost).toBeLessThanOrEqual(0);
    expect(resolveCard(ctx, inst.uid, single).ok).toBe(true);
    expect(s.dynasty.spouse).toBeNull();
    s.date.year = 1907;
    dynastyMonth(ctx);
    expect(s.politics.cards.pending.some((p) => p.cardId === 'marriage')).toBe(true);
  });

  it('marry for standing marries and pleases Old Money', () => {
    const ctx = setup(1, 1906);
    const s = ctx.state;
    s.date = { year: 1906, month: 4, day: 30, hour: 0 };
    dynastyMonth(ctx);
    const inst = s.politics.cards.pending.find((p) => p.cardId === 'marriage')!;
    const standing = CARDS_BY_ID.marriage.choices.findIndex((c) => /standing/i.test(c.label));
    const before = nationalOpinion(s, 'oldmoney');
    expect(resolveCard(ctx, inst.uid, standing).ok).toBe(true);
    expect(s.dynasty.spouse).not.toBeNull();
    expect(nationalOpinion(s, 'oldmoney')).toBeCloseTo(before + 8, 9);
  });
});

describe('the line over a century', () => {
  it('never ends over 50 seeds x 101 years with autoplayNameHeir and default card answers', () => {
    const generations: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const ctx = setup(seed, 1900);
      const overs = gameOvers(ctx);
      const s = ctx.state;
      for (let year = 1900; year <= 2000; year++) {
        for (let month = 1; month <= 12; month++) {
          s.date = { year, month, day: 30, hour: 0 };
          dynastyMonth(ctx);
          // headless: every card left open takes its default choice
          for (const p of [...s.politics.cards.pending]) autoResolve(ctx, p.uid);
        }
        autoplayNameHeir(ctx);
        dynastyYear(ctx);
        expect(overs, `seed ${seed} ${year}`).toEqual([]);
      }
      expect(s.dynasty.head.alive).toBe(true);
      expect(checkInvariants(s)).toEqual([]);
      generations.push(s.dynasty.generation);
    }
    expect(Math.min(...generations)).toBeGreaterThanOrEqual(2);
  });
});

describe('autoplayNameHeir', () => {
  it('names the eldest child with the most shrewd/charming traits, else the eldest', () => {
    const ctx = setup(1, 1930);
    const s = ctx.state;
    const a = child(s, 1906, ['brute']);
    const b = child(s, 1908, ['shrewd']);
    const c = child(s, 1910, ['shrewd', 'charming']);
    autoplayNameHeir(ctx);
    expect(s.dynasty.heirId).toBe(c.id);
    c.traits = ['shrewd'];
    autoplayNameHeir(ctx);
    expect(s.dynasty.heirId).toBe(b.id);
    b.traits = ['reckless'];
    c.traits = ['idealist'];
    autoplayNameHeir(ctx);
    expect(s.dynasty.heirId).toBe(a.id);
  });
});
