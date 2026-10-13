import { describe, expect, it } from 'vitest';
import { CARDS, CARDS_BY_ID, type CardDef } from '../../data/cards';
import { EventBus } from '../../core/events';
import { PLAYER_ID } from '../companies';
import { dateToDays } from '../clock';
import { migrateSave } from '../migrations';
import { runDays } from '../simulation';
import { createGame } from '../state';
import { testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { AUTO_RESOLVE_DAYS, autoResolve, canAffordChoice, cardCity, cardScale, cardsDay, cardText, choiceCost, drawSpringCard, eligibleCards, forceCard, HISTORY_CAP, resolveCard, triggerCard } from './cards';
import { netWorth } from '../rival/takeover';
import { holdElection, playerHiresFrom } from './elections';
import { placeBuilding } from '../state';
import { must } from '../testkit';
import { runAutoplay } from '../../game/autoplay';
import { checkInvariants } from '../invariants';
import { stateHash } from '../hash';

const town = (year = 1905, seed = 3) => testCtx(testState({ seed, year, cities: [{ x: 10, y: 10, name: 'Ashford' }, { x: 28, y: 20, name: 'Brill' }] }));
const at = (ctx: SimContext, year: number, month: number, day = 1) => {
  ctx.state.date = { ...ctx.state.date, year, month, day };
};
const pending = (ctx: SimContext) => ctx.state.politics.cards.pending;
const money = (ctx: SimContext) => ctx.state.companies[PLAYER_ID].money;

function card(over: Partial<CardDef>): CardDef {
  return {
    id: 'x', title: 'X', body: '', trigger: 'spring', years: [1901, 2000], weight: 1, cooldownYears: 0, needsCity: false,
    choices: [{ label: 'ok', cost: 0, effects: [] }], defaultChoice: 0, ...over,
  };
}

describe('spring draw', () => {
  it('draws once a year on 1 April from 1901, never in 1900', () => {
    const ctx = testCtx(createGame({ seed: 7 }));
    ctx.state.speed = 1;
    // 1 Apr 1900 to 1 Mar 1901: no card
    runDays(ctx, 330);
    expect(ctx.state.politics.cards.history.length + pending(ctx).length).toBe(0);
    expect(ctx.state.politics.nextCardYear).toBe(1901);
    runDays(ctx, 40); // past 1 April 1901
    expect(pending(ctx).length).toBe(1);
    expect(ctx.state.politics.nextCardYear).toBe(1902);
    // calling again the same year does nothing
    at(ctx, 1901, 4, 1);
    drawSpringCard(ctx);
    expect(pending(ctx).length).toBe(1);
  });

  it('records the opened day and the city for city cards', () => {
    const ctx = town();
    at(ctx, 1905, 4, 1);
    for (let i = 0; i < 20 && pending(ctx).length === 0; i++) {
      ctx.state.politics.nextCardYear = 1905;
      drawSpringCard(ctx);
    }
    const inst = pending(ctx)[0];
    expect(inst.openedDay).toBe(dateToDays(ctx.state.date));
    expect(inst.cityId === null).toBe(!CARDS_BY_ID[inst.cardId].needsCity);
  });
});

describe('eligibility filters', () => {
  it('filters by era: the war card only 1915-1918', () => {
    const ctx = town();
    const ids = (y: number) => {
      at(ctx, y, 4);
      return eligibleCards(ctx.state, 'spring', null).map((e) => e.card.id);
    };
    expect(ids(1914)).not.toContain('war_office');
    expect(ids(1915)).toContain('war_office');
    expect(ids(1918)).toContain('war_office');
    expect(ids(1919)).not.toContain('war_office');
  });

  it('filters by cooldown and by pending', () => {
    const ctx = town();
    at(ctx, 1910, 4);
    const ids = () => eligibleCards(ctx.state, 'spring', null).map((e) => e.card.id);
    expect(ids()).toContain('letter_to_editor');
    ctx.state.politics.cards.history.push({ id: 'letter_to_editor', year: 1905 });
    expect(ids()).not.toContain('letter_to_editor'); // cooldown 6: back in 1911
    at(ctx, 1911, 4);
    expect(ids()).toContain('letter_to_editor');
    pending(ctx).push({ uid: 99, cardId: 'letter_to_editor', cityId: null, openedDay: 0 });
    expect(ids()).not.toContain('letter_to_editor');
  });

  it('filters by condition, evaluated for the chosen city', () => {
    const ctx = town();
    at(ctx, 1910, 4);
    const ids = () => eligibleCards(ctx.state, 'spring', null).map((e) => e.card.id);
    expect(ids()).not.toContain('shop_floor_grumbling');
    ctx.state.cities[1].opinion.workers = 30;
    const e = eligibleCards(ctx.state, 'spring', null).find((x) => x.card.id === 'shop_floor_grumbling');
    expect(e?.cityId).toBe(1);
  });

  it('picks the city with the most extreme opinion among the card factions, ties to the lowest id', () => {
    const ctx = town();
    const c = card({ needsCity: true, choices: [{ label: 'a', cost: 0, effects: [{ faction: 'church', scope: 'city', delta: 1 }] }] });
    expect(cardCity(ctx.state, c)).toBe(0);
    ctx.state.cities[1].opinion.church = 80;
    expect(cardCity(ctx.state, c)).toBe(1);
    ctx.state.cities[0].opinion.church = 20;
    expect(cardCity(ctx.state, c)).toBe(0);
    ctx.state.cities[0].opinion.workers = 0; // not one of the card's factions
    ctx.state.cities[0].opinion.church = 50;
    expect(cardCity(ctx.state, c)).toBe(1);
  });

  it('a city card has no city to go to without towns', () => {
    const ctx = testCtx(testState({ year: 1905 }));
    at(ctx, 1905, 4);
    expect(eligibleCards(ctx.state, 'spring', null).every((e) => !e.card.needsCity)).toBe(true);
  });

  it('a triggered card uses the given city and needs one when needsCity', () => {
    const ctx = town();
    triggerCard(ctx, 'election', null);
    expect(pending(ctx)).toEqual([]);
    triggerCard(ctx, 'election', 1);
    expect(pending(ctx)).toMatchObject([{ cityId: 1 }]);
    expect(CARDS_BY_ID[pending(ctx)[0].cardId].trigger).toBe('election');
  });
});

describe('triggers from the sim', () => {
  it('an election opens the new mayor card for that town', () => {
    const ctx = town();
    holdElection(ctx, ctx.state.cities[1]);
    expect(pending(ctx)).toMatchObject([{ cityId: 1 }]);
    expect(CARDS_BY_ID[pending(ctx)[0].cardId].trigger).toBe('election');
    const text = cardText(ctx.state, pending(ctx)[0]);
    expect(text.body).toContain('Brill');
    expect(text.title + text.body).not.toContain('{');
  });

  it('a scandal opens the reporters card for that town', async () => {
    const { scandalMonth } = await import('./elections');
    const ctx = town();
    ctx.state.cities[0].politics.scandalRisk = 100; // chance clamps to certain
    scandalMonth(ctx);
    expect(pending(ctx)).toMatchObject([{ cardId: 'reporters_at_gates', cityId: 0 }]);
  });
});

describe('resolveCard', () => {
  const open = (ctx: SimContext, cardId: string, cityId: number | null) => {
    pending(ctx).push({ uid: 500, cardId, cityId, openedDay: dateToDays(ctx.state.date) });
  };

  it('spends the cost, applies the effects, records history and news', () => {
    const ctx = town();
    at(ctx, 1906, 4);
    open(ctx, 'founders_parade', 1);
    const m = money(ctx);
    const w = ctx.state.cities[1].opinion.workers;
    const cost = choiceCost(ctx.state, CARDS_BY_ID.founders_parade.choices[0]);
    expect(cost).toBe(3700); // 3000 x 1.24 (1906), rounded to $100
    const r = resolveCard(ctx, 500, 0);
    expect(r.ok).toBe(true);
    expect(money(ctx)).toBe(m - 3700);
    expect(ctx.state.cities[1].opinion.workers).toBe(w + 4);
    expect(ctx.state.cities[0].opinion.workers).toBe(50);
    expect(pending(ctx)).toEqual([]);
    expect(ctx.state.politics.cards.history).toEqual([{ id: 'founders_parade', year: 1906 }]);
    const news = ctx.state.news[ctx.state.news.length - 1];
    expect(news.kind).toBe('politics');
    expect(news.body).toContain('Sponsor a float');
    const ledger = ctx.state.companies[PLAYER_ID].ledger.at(-1)!;
    expect(ledger.expense.events).toBe(3700);
  });

  it('earns a negative cost under events', () => {
    const ctx = town();
    open(ctx, 'founders_parade', 0);
    const m = money(ctx);
    expect(resolveCard(ctx, 500, 1).ok).toBe(true);
    expect(money(ctx)).toBe(m + 2400); // -2000 x 1.2 (1905)
    expect(ctx.state.companies[PLAYER_ID].ledger.at(-1)!.income.events).toBe(2400);
  });

  it('applies national effects to every town and runs apply', () => {
    const ctx = town();
    open(ctx, 'letter_to_editor', null);
    resolveCard(ctx, 500, 0);
    expect(ctx.state.cities.map((c) => c.opinion.reformers)).toEqual([54, 54]);
    ctx.state.cities[1].politics.mayor.faction = 'church';
    open(ctx, 'new_mayor', 1);
    resolveCard(ctx, 500, 0);
    expect(ctx.state.cities[1].opinion.church).toBe(55);
  });

  it('refuses an unaffordable choice and leaves the card pending', () => {
    const ctx = town();
    ctx.state.companies[PLAYER_ID].money = 1000;
    open(ctx, 'letter_to_editor', null);
    const r = resolveCard(ctx, 500, 0);
    expect(r).toEqual({ ok: false, error: 'Not enough money' });
    expect(pending(ctx).length).toBe(1);
    expect(money(ctx)).toBe(1000);
    expect(resolveCard(ctx, 500, 1).ok).toBe(true);
  });

  it('refuses unknown uids and choices', () => {
    const ctx = town();
    expect(resolveCard(ctx, 1, 0).ok).toBe(false);
    open(ctx, 'letter_to_editor', null);
    expect(resolveCard(ctx, 500, 5).ok).toBe(false);
  });
});

describe('cardsDay', () => {
  it('auto-resolves after 60 days with the default choice', () => {
    const ctx = town();
    at(ctx, 1906, 5, 1);
    pending(ctx).push({ uid: 7, cardId: 'war_office', cityId: null, openedDay: dateToDays(ctx.state.date) });
    const m = money(ctx);
    ctx.state.date = { ...ctx.state.date, month: 6, day: 30 }; // 59 days later
    cardsDay(ctx);
    expect(pending(ctx).length).toBe(1);
    ctx.state.date = { ...ctx.state.date, month: 7, day: 1 }; // AUTO_RESOLVE_DAYS later
    expect(AUTO_RESOLVE_DAYS).toBe(60);
    cardsDay(ctx);
    expect(pending(ctx)).toEqual([]);
    expect(money(ctx)).toBe(m + 9900); // default 0: sell steel, 8000 x 1.24
  });

  it('falls back to the first affordable choice when the default is unaffordable', () => {
    const ctx = town();
    const dear = card({
      id: 'dear',
      choices: [
        { label: 'pay', cost: 5000, effects: [{ faction: 'church', scope: 'national', delta: 5 }] },
        { label: 'refuse', cost: 0, effects: [{ faction: 'reformers', scope: 'national', delta: -2 }] },
      ],
      defaultChoice: 0,
    });
    ctx.state.companies[PLAYER_ID].money = 100;
    pending(ctx).push({ uid: 7, cardId: 'dear', cityId: null, openedDay: dateToDays(ctx.state.date) - 60 });
    cardsDay(ctx, { dear });
    expect(pending(ctx)).toEqual([]);
    expect(money(ctx)).toBe(100);
    expect(ctx.state.cities[0].opinion.reformers).toBe(48);
    expect(ctx.state.cities[0].opinion.church).toBe(50);
  });

  it('drops pending cards whose definition no longer exists', () => {
    const ctx = town();
    pending(ctx).push({ uid: 7, cardId: 'no_such_card', cityId: null, openedDay: dateToDays(ctx.state.date) });
    cardsDay(ctx);
    expect(pending(ctx)).toEqual([]);
  });
});

describe('forceCard and autoResolve', () => {
  it('opens any card now and answers it with its default', () => {
    const ctx = town(1950);
    expect(forceCard(ctx, 'war_office')).toBe(true);
    expect(forceCard(ctx, 'no_such_card')).toBe(false);
    expect(forceCard(testCtx(testState()), 'founders_parade')).toBe(false); // no towns
    const inst = pending(ctx)[0];
    const m = money(ctx);
    expect(autoResolve(ctx, inst.uid).ok).toBe(true);
    expect(money(ctx)).toBe(m + 8000 * 3); // 1950: era scale 3
    expect(autoResolve(ctx, inst.uid).ok).toBe(false);
  });
});

describe('card money scaling (R-Q8)', () => {
  const steel = CARDS_BY_ID.war_office.choices[0]; // -8000
  const bonds = CARDS_BY_ID.war_office.choices[1]; // 5000

  it('is 1 in 1900 for a starting $300k company', () => {
    const ctx = town(1900);
    expect(netWorth(ctx.state, PLAYER_ID)).toBe(300_000);
    expect(cardScale(ctx.state)).toBe(1);
    expect(choiceCost(ctx.state, bonds)).toBe(5000);
    expect(choiceCost(ctx.state, steel)).toBe(-8000);
  });

  it('follows the era: 3 in 1950', () => {
    const ctx = town(1950);
    expect(cardScale(ctx.state)).toBe(3);
    expect(choiceCost(ctx.state, bonds)).toBe(15000);
  });

  it('follows wealth: 10 at $3M net worth', () => {
    const ctx = town(1900);
    ctx.state.companies[PLAYER_ID].money = 3_000_000;
    expect(cardScale(ctx.state)).toBe(10);
    expect(choiceCost(ctx.state, bonds)).toBe(50000);
  });

  it('is capped at 40', () => {
    const ctx = town(1900);
    ctx.state.companies[PLAYER_ID].money = 1e9;
    expect(cardScale(ctx.state)).toBe(40);
    at(ctx, 2000, 4);
    ctx.state.companies[PLAYER_ID].money = 0;
    expect(cardScale(ctx.state)).toBe(5);
  });

  it('affordability uses the scaled cost', () => {
    const ctx = town(1950);
    ctx.state.companies[PLAYER_ID].money = 10_000; // affords 5000 but not 15000
    expect(canAffordChoice(ctx.state, bonds)).toBe(false);
    pending(ctx).push({ uid: 3, cardId: 'war_office', cityId: null, openedDay: 0 });
    expect(resolveCard(ctx, 3, 1)).toEqual({ ok: false, error: 'Not enough money' });
  });
});

describe('history cap', () => {
  it(`keeps the newest ${HISTORY_CAP} entries`, () => {
    const ctx = town();
    const h = ctx.state.politics.cards.history;
    for (let i = 0; i < HISTORY_CAP; i++) h.push({ id: `old${i}`, year: 1901 });
    pending(ctx).push({ uid: 4, cardId: 'letter_to_editor', cityId: null, openedDay: 0 });
    expect(resolveCard(ctx, 4, 1).ok).toBe(true);
    expect(h.length).toBe(HISTORY_CAP);
    expect(h[0].id).toBe('old1');
    expect(h.at(-1)).toEqual({ id: 'letter_to_editor', year: 1905 });
  });
});

describe('determinism', () => {
  it('two runs with the same seed draw the same cards over 20 years', () => {
    const run = () => {
      const ctx = { state: createGame({ seed: 42 }), bus: new EventBus() };
      for (let y = 0; y < 20; y++) runDays(ctx, 360);
      return ctx.state.politics.cards.history.map((h) => `${h.year}:${h.id}`).concat(pending(ctx).map((p) => `p:${p.cardId}:${p.cityId}`));
    };
    const a = run();
    expect(a.length).toBeGreaterThanOrEqual(19);
    expect(run()).toEqual(a);
  });
});

describe('migration', () => {
  it('a migrated save draws its first card the next April it reaches', () => {
    const s = createGame({ seed: 5 }) as unknown as Record<string, unknown>;
    s.version = 4;
    s.date = { year: 1920, month: 6, day: 3, hour: 8 };
    const r = migrateSave(s);
    expect(r.ok).toBe(true);
    expect((s.politics as { nextCardYear: number }).nextCardYear).toBe(1921);
    s.version = 4;
    s.date = { year: 1920, month: 2, day: 3, hour: 8 };
    migrateSave(s);
    expect((s.politics as { nextCardYear: number }).nextCardYear).toBe(1920);
    s.version = 4;
    s.date = { year: 1900, month: 6, day: 3, hour: 8 };
    migrateSave(s);
    expect((s.politics as { nextCardYear: number }).nextCardYear).toBe(1901);
  });
});

it('the seed table exercises every engine feature', () => {
  const choices = CARDS.flatMap((c) => c.choices);
  expect(CARDS.some((c) => c.needsCity && c.trigger === 'spring')).toBe(true);
  expect(CARDS.some((c) => !c.needsCity)).toBe(true);
  expect(CARDS.some((c) => c.condition)).toBe(true);
  expect(CARDS.some((c) => c.trigger === 'election')).toBe(true);
  expect(CARDS.some((c) => c.trigger === 'scandal')).toBe(true);
  expect(choices.some((c) => c.apply)).toBe(true);
  expect(choices.some((c) => c.cost < 0)).toBe(true);
});

describe('card content (Task 8)', () => {
  // `new_mayor` (Task 7 seed) is the one card whose apply moves opinion: it targets the mayor's faction
  const applied = CARDS.flatMap((c) => c.choices.filter((ch) => ch.apply).map((ch) => ({ c, ch }))).filter(({ c }) => c.id !== 'new_mayor');

  it('apply hooks exist, move no opinion, keep invariants and are deterministic', () => {
    expect(applied.length).toBeGreaterThanOrEqual(10);
    for (const { c, ch } of applied) {
      const run = () => {
        const ctx = testCtx(createGame({ seed: 11 }));
        expect(runAutoplay(ctx).ok).toBe(true);
        at(ctx, Math.max(c.years[0], 1901), 4, 1);
        const cityId = c.needsCity ? cardCity(ctx.state, c) : null;
        const before = JSON.stringify(ctx.state.cities.map((x) => x.opinion));
        ch.apply!(ctx, cityId);
        expect(JSON.stringify(ctx.state.cities.map((x) => x.opinion)), `${c.id}: ${ch.label} moved opinion`).toBe(before);
        expect(checkInvariants(ctx.state), `${c.id}: ${ch.label}`).toEqual([]);
        return stateHash(ctx.state);
      };
      expect(run(), `${c.id}: ${ch.label} not deterministic`).toBe(run());
    }
  });

  it('every card text fills its placeholders', () => {
    const ctx = town(1950);
    for (const c of CARDS) {
      const cityId = c.needsCity ? ctx.state.cities[0].id : null;
      const { title, body } = cardText(ctx.state, { uid: 1, cardId: c.id, cityId, openedDay: 0 });
      expect(title + body, c.id).not.toMatch(/[{}]/);
    }
  });
});

describe('election cards only when it matters (R-Q10)', () => {
  // the draw ignores the outgoing mayor, so clones of one state elect the same winner
  const winnerOf = (ctx: SimContext) => holdElection(testCtx(structuredClone(ctx.state)), structuredClone(ctx.state).cities[1]);
  const elect = (ctx: SimContext) => {
    holdElection(ctx, ctx.state.cities[1]);
    return pending(ctx).filter((p) => CARDS_BY_ID[p.cardId].trigger === 'election').length;
  };

  it('opens a card when the winning faction differs from the outgoing mayor', () => {
    const ctx = town();
    const w = winnerOf(ctx);
    ctx.state.cities[1].politics.mayor.faction = w === 'workers' ? 'church' : 'workers';
    expect(elect(ctx)).toBe(1);
  });

  it('no card when the same faction is returned and no player works hire from the town', () => {
    const ctx = town();
    const w = winnerOf(ctx);
    ctx.state.cities[1].politics.mayor.faction = w;
    expect(playerHiresFrom(ctx.state, 1)).toBe(false);
    expect(elect(ctx)).toBe(0);
  });

  it('a card when the same faction is returned in a town the player hires from', () => {
    const ctx = town();
    ctx.state.companies[PLAYER_ID].money = 1e7;
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 35, y: 26 }));
    expect(playerHiresFrom(ctx.state, 1)).toBe(true);
    const w = winnerOf(ctx);
    ctx.state.cities[1].politics.mayor.faction = w;
    expect(elect(ctx)).toBe(1);
  });

  it('the cardResolved event fires for every answered card', () => {
    const ctx = town();
    const seen: string[] = [];
    ctx.bus.on('cardResolved', (e) => seen.push(e.cardId));
    forceCard(ctx, 'letter_to_editor');
    expect(resolveCard(ctx, pending(ctx)[0].uid, 1).ok).toBe(true);
    expect(seen).toEqual(['letter_to_editor']);
  });
});
