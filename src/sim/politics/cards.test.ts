import { describe, expect, it } from 'vitest';
import { CARDS, CARDS_BY_ID, type CardDef } from '../../data/cards';
import { EventBus } from '../../core/events';
import { PLAYER_ID } from '../companies';
import { dateToDays } from '../clock';
import { migrateSave } from '../migrations';
import { runDays } from '../simulation';
import { answerDecision } from '../ai/mailbox';
import { createGame } from '../state';
import { testCtx, testState } from '../testkit';
import type { SimContext } from '../types';
import { AUTO_RESOLVE_DAYS, autoResolve, canAffordChoice, cardCity, cardScale, cardsDay, cardText, choiceCost, cardsDayHook, drawSpringCard, eligibleCards, forceCard, HISTORY_CAP, resolveCard, triggerCard } from './cards';
import { netWorth } from '../rival/takeover';
import { holdElection, playerHiresFrom } from './elections';
import { placeBuilding } from '../state';
import { must } from '../testkit';
import { runAutoplay } from '../../game/autoplay';
import { checkInvariants } from '../invariants';
import { stateHash } from '../hash';
import { random } from '../rng';

const town = (year = 1905, seed = 3) => testCtx(testState({ seed, year, cities: [{ x: 10, y: 10, name: 'Ashford' }, { x: 28, y: 20, name: 'Brill' }] }));
/** Sets the price index (society/economy.ts), which drives card money since Task 8. */
const prices = (ctx: SimContext, index: number) => (ctx.state.economy.priceIndex = index);
const at = (ctx: SimContext, year: number, month: number, day = 1) => {
  ctx.state.date = { ...ctx.state.date, year, month, day };
};
const pending = (ctx: SimContext) => ctx.state.politics.cards.pending;
const money = (ctx: SimContext) => ctx.state.companies[PLAYER_ID].money;
/** the winner Brill would elect now: the draw ignores the outgoing mayor, so a clone elects the same one */
const winnerOf = (ctx: SimContext) => {
  const copy = structuredClone(ctx.state);
  return holdElection(testCtx(copy), copy.cities[1]);
};
/** make Brill's coming election a turnover */
const turnover = (ctx: SimContext) => {
  ctx.state.cities[1].politics.mayor.faction = winnerOf(ctx) === 'workers' ? 'church' : 'workers';
};
/** a player sawmill that hires from Brill */
const hireFromBrill = (ctx: SimContext) => {
  ctx.state.companies[PLAYER_ID].money = 1e7;
  must(placeBuilding(ctx, 'player', 'sawmill', { x: 35, y: 26 }));
  expect(playerHiresFrom(ctx.state, 1)).toBe(true);
};

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

  it('ranks only the towns where the card condition passes (M2)', () => {
    const ctx = town();
    // only Ashford (id 0) qualifies, though Brill holds the more extreme opinion
    const c = card({
      needsCity: true,
      condition: (_s, cityId) => cityId === 0,
      choices: [{ label: 'a', cost: 0, effects: [{ faction: 'church', scope: 'city', delta: 1 }] }],
    });
    ctx.state.cities[1].opinion.church = 95;
    ctx.state.cities[0].opinion.church = 55;
    expect(cardCity(ctx.state, c)).toBe(0);
    // so the card is eligible there, rather than dropped because the most extreme town fails
    at(ctx, 1910, 4);
    const e = eligibleCards(ctx.state, 'spring', null, [c]);
    expect(e).toEqual([{ card: c, cityId: 0 }]);
    // no town qualifies: no city
    const never = { ...c, condition: () => false };
    expect(cardCity(ctx.state, never)).toBeNull();
    expect(eligibleCards(ctx.state, 'spring', null, [never])).toEqual([]);
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
  it('an election opens an election card for that town', () => {
    const ctx = town();
    hireFromBrill(ctx);
    turnover(ctx);
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
    prices(ctx, 1.24);
    open(ctx, 'founders_parade', 1);
    const m = money(ctx);
    const w = ctx.state.cities[1].opinion.workers;
    const cost = choiceCost(ctx.state, CARDS_BY_ID.founders_parade.choices[0]);
    expect(cost).toBe(3700); // 3000 x 1.24 (price index), rounded to $100
    const r = resolveCard(ctx, 500, 0);
    expect(r.ok).toBe(true);
    expect(money(ctx)).toBe(m - 3700);
    expect(ctx.state.cities[1].opinion.workers).toBe(w + 4);
    expect(ctx.state.cities[0].opinion.workers).toBe(50);
    expect(pending(ctx)).toEqual([]);
    expect(ctx.state.politics.cards.history).toEqual([{ id: 'founders_parade', year: 1906, choice: 0, title: 'Brill Founders\' Day' }]);
    const news = ctx.state.news[ctx.state.news.length - 1];
    expect(news.kind).toBe('politics');
    expect(news.body).toContain('Sponsor a float');
    const ledger = ctx.state.companies[PLAYER_ID].ledger.at(-1)!;
    expect(ledger.expense.events).toBe(3700);
  });

  it('earns a negative cost under events', () => {
    const ctx = town();
    prices(ctx, 1.2);
    open(ctx, 'founders_parade', 0);
    const m = money(ctx);
    expect(resolveCard(ctx, 500, 1).ok).toBe(true);
    expect(money(ctx)).toBe(m + 2400); // -2000 x 1.2 (price index)
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
    prices(ctx, 1.24);
    pending(ctx).push({ uid: 7, cardId: 'war_office', cityId: null, openedDay: dateToDays(ctx.state.date) });
    const m = money(ctx);
    ctx.state.date = { ...ctx.state.date, month: 6, day: 30 }; // 59 days later
    cardsDay(ctx);
    expect(pending(ctx).length).toBe(1);
    ctx.state.date = { ...ctx.state.date, month: 7, day: 1 }; // AUTO_RESOLVE_DAYS later
    expect(AUTO_RESOLVE_DAYS).toBe(60);
    cardsDay(ctx);
    expect(pending(ctx)).toEqual([]);
    expect(money(ctx)).toBe(m + 9900); // default 0: sell steel, 8000 x 1.24 (price index)
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
    prices(ctx, 3);
    expect(forceCard(ctx, 'war_office')).toBe(true);
    expect(forceCard(ctx, 'no_such_card')).toBe(false);
    expect(forceCard(testCtx(testState()), 'founders_parade')).toBe(false); // no towns
    const inst = pending(ctx)[0];
    const m = money(ctx);
    expect(autoResolve(ctx, inst.uid).ok).toBe(true);
    expect(money(ctx)).toBe(m + 8000 * 3); // price index 3
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

  it('follows the price index (Task 8, replacing the era term): 3 at index 3', () => {
    const ctx = town(1950);
    expect(cardScale(ctx.state)).toBe(1); // the year alone no longer scales it
    prices(ctx, 3);
    expect(cardScale(ctx.state)).toBe(3);
    expect(choiceCost(ctx.state, bonds)).toBe(15000);
  });

  it('follows wealth: 10 at $3M net worth', () => {
    const ctx = town(1900);
    ctx.state.companies[PLAYER_ID].money = 3_000_000;
    expect(cardScale(ctx.state)).toBe(10);
    expect(choiceCost(ctx.state, bonds)).toBe(50000);
  });

  it('caps the wealth term at 40, in real terms', () => {
    const ctx = town(1900);
    ctx.state.companies[PLAYER_ID].money = 1e9;
    expect(cardScale(ctx.state)).toBe(40);
    prices(ctx, 5);
    ctx.state.companies[PLAYER_ID].money = 0;
    expect(cardScale(ctx.state)).toBe(5);
    ctx.state.companies[PLAYER_ID].money = 1e10;
    expect(cardScale(ctx.state)).toBe(200); // 40x real wealth at index 5
  });

  it('the wealth term counts real net worth (nominal / price index)', () => {
    const ctx = town(1900);
    ctx.state.companies[PLAYER_ID].money = 3_000_000;
    prices(ctx, 4);
    expect(cardScale(ctx.state)).toBe(10); // $3M is $750k in 1900 dollars: wealth 2.5 x index 4
    ctx.state.companies[PLAYER_ID].money = 60_000_000;
    expect(cardScale(ctx.state)).toBe(160); // $15M real: wealth 50, capped at 40, x index 4
  });

  it('affordability uses the scaled cost', () => {
    const ctx = town(1950);
    prices(ctx, 3);
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
    expect(h.at(-1)).toEqual({ id: 'letter_to_editor', year: 1905, choice: 1, title: 'A Letter to the Editor' });
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

  /**
   * Choices whose opinion effect applies only if their action succeeds (final review Minor 5): the
   * effect cannot sit in `effects`, which the engine applies before `apply` runs.
   */
  const OPINION_ON_SUCCESS: Record<string, string> = { exchange_panic: 'Buy back your shares' };
  it('apply hooks exist, move no opinion (bar OPINION_ON_SUCCESS), keep invariants and are deterministic', () => {
    expect(applied.length).toBeGreaterThanOrEqual(10);
    for (const { c, ch } of applied) {
      const run = () => {
        const ctx = testCtx(createGame({ seed: 11 }));
        expect(runAutoplay(ctx).ok).toBe(true);
        at(ctx, Math.max(c.years[0], 1901), 4, 1);
        const cityId = c.needsCity ? cardCity(ctx.state, c) : null;
        const before = JSON.stringify(ctx.state.cities.map((x) => x.opinion));
        const conditional = OPINION_ON_SUCCESS[c.id] === ch.label;
        // the success case: the purse for the action, so its opinion effect must land
        if (conditional) ctx.state.companies.player.money += 1e9;
        const logged = ctx.state.politics.log.length;
        ch.apply!(ctx, cityId);
        if (conditional) {
          // its opinion effect hangs on its action succeeding, so apply moves it, through adjustOpinion only
          const added = ctx.state.politics.log.slice(logged);
          expect(added.length, `${c.id}: ${ch.label} logged nothing`).toBeGreaterThan(0);
          expect(added.every((e) => e.reason === c.title), `${c.id}: ${ch.label}`).toBe(true);
        } else expect(JSON.stringify(ctx.state.cities.map((x) => x.opinion)), `${c.id}: ${ch.label} moved opinion`).toBe(before);
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

describe('election cards only when it matters (R-Q10b)', () => {
  const elect = (ctx: SimContext) => {
    holdElection(ctx, ctx.state.cities[1]);
    return pending(ctx).filter((p) => CARDS_BY_ID[p.cardId].trigger === 'election').length;
  };

  it('turnover in a town the player hires from: a card', () => {
    const ctx = town();
    hireFromBrill(ctx);
    turnover(ctx);
    expect(elect(ctx)).toBe(1);
  });

  it('turnover in a town the player does not hire from: no card', () => {
    const ctx = town();
    turnover(ctx);
    expect(playerHiresFrom(ctx.state, 1)).toBe(false);
    expect(elect(ctx)).toBe(0);
  });

  it('same faction returned in a town the player hires from: no card', () => {
    const ctx = town();
    hireFromBrill(ctx);
    ctx.state.cities[1].politics.mayor.faction = winnerOf(ctx);
    expect(elect(ctx)).toBe(0);
  });

  it('at most one election card per calendar year, pending or answered', () => {
    const ctx = town();
    hireFromBrill(ctx);
    turnover(ctx);
    expect(elect(ctx)).toBe(1);
    // a second turnover the same year: skipped while the first is pending...
    turnover(ctx);
    expect(elect(ctx)).toBe(1);
    // ...and after it was answered
    expect(autoResolve(ctx, pending(ctx)[0].uid).ok).toBe(true);
    turnover(ctx);
    expect(elect(ctx)).toBe(0);
    // next year a turnover opens one again
    at(ctx, ctx.state.date.year + 1, 2);
    turnover(ctx);
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

describe('spring card dealer asks JEV', () => {
  // what the reference pick below gives for seeds 1-20 on 1 April 1935 (re-derived when Phase 4 added
  // market_rumour and bull_market to the spring deck); pinned so a change to the deck shows up here
  const SNAPSHOT = ['dust_bowl', 'baron_envelope', 'baron_smear', 'prize_marrow', 'baron_smear', 'company_hour', 'letter_to_editor', 'founders_parade', 'works_dance', 'company_hour', 'company_hour', 'hard_times', 'dust_bowl', 'soup_kitchen', 'works_dance', 'dust_bowl', 'baron_smear', 'soup_kitchen', 'letter_to_editor', 'baron_envelope'];
  const spring = (seed: number, year = 1935) => testCtx(testState({ seed, year, cities: [{ x: 10, y: 10, name: 'Ashford' }, { x: 28, y: 20, name: 'Brill' }] }));
  /** The pre-JEV spring pick, on a copy: one random draw × total weight walked over the eligible cards in table order. */
  const referencePick = (ctx: SimContext): string => {
    const copy = structuredClone(ctx.state);
    const list = eligibleCards(copy, 'spring', null);
    const total = list.reduce((s, e) => s + Math.max(0, e.card.weight), 0);
    let r = random(copy) * total;
    for (const e of list) {
      r -= Math.max(0, e.card.weight);
      if (r < 0) return e.card.id;
    }
    return list[list.length - 1].card.id;
  };

  it('without an answer draws exactly as the pre-JEV weighted pick (seeds 1-20)', () => {
    const picked: string[] = [];
    const reference: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = spring(seed);
      reference.push(referencePick(ctx));
      drawSpringCard(ctx);
      picked.push(pending(ctx)[0].cardId);
    }
    expect(picked).toEqual(reference);
    expect(reference).toEqual(SNAPSHOT);
  });

  it('posts card:<year> on 1 March with the eligible card ids, once', () => {
    const ctx = spring(3);
    at(ctx, 1935, 3, 1);
    cardsDayHook(ctx);
    cardsDayHook(ctx);
    const box = ctx.state.ai!;
    expect(box.pending.length).toBe(1);
    const r = box.pending[0];
    expect(r.id).toBe('card:1935');
    expect(r.options.map((o) => o.key)).toEqual(eligibleCards(ctx.state, 'spring', null).slice(0, 32).map((e) => e.card.id));
    expect(r.options[0].label.startsWith(CARDS_BY_ID[r.options[0].key].title)).toBe(true);
    expect(r.dueDay).toBe(dateToDays({ ...ctx.state.date, month: 4, day: 1 }));
    // an answered request is not posted again before the draw
    answerDecision(ctx.state, 'card:1935', { probabilities: { hard_times: 1 } });
    cardsDayHook(ctx);
    expect(ctx.state.ai!.pending.length).toBe(0);
  });

  it('fills a card\'s vars and towns in the labels it sends JEV (marriage, 1906)', () => {
    const ctx = spring(3, 1906);
    at(ctx, 1906, 3, 1);
    cardsDayHook(ctx);
    const opts = ctx.state.ai!.pending[0].options;
    expect(opts.map((o) => o.key)).toContain('marriage');
    for (const o of opts) expect(o.label).not.toMatch(/\{\w+\}/);
  });

  it('a one-hot answer lifts the pick rate to 0.55-0.6 over 2000 draws, never past the cap', () => {
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const ctx = spring(1);
      ctx.state.rngState = i * 2654435761;
      at(ctx, 1935, 3, 1);
      cardsDayHook(ctx);
      answerDecision(ctx.state, 'card:1935', { probabilities: { hard_times: 1 } });
      at(ctx, 1935, 4, 1);
      drawSpringCard(ctx);
      if (pending(ctx)[0].cardId === 'hard_times') hits++;
      expect(ctx.state.ai!.answers['card:1935']).toBeUndefined();
    }
    expect(hits / 2000).toBeGreaterThanOrEqual(0.55);
    expect(hits / 2000).toBeLessThanOrEqual(0.6);
  });

  it('ignores an answer for a card that is not eligible', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = spring(seed);
      at(ctx, 1935, 3, 1);
      cardsDayHook(ctx);
      answerDecision(ctx.state, 'card:1935', { probabilities: { not_a_card: 1, hard_times_gone: 1 } });
      at(ctx, 1935, 4, 1);
      // neither answered id is a card, so neither can be eligible
      const eligible = eligibleCards(ctx.state, 'spring', null).map((e) => e.card.id);
      for (const id of ['not_a_card', 'hard_times_gone']) {
        expect(CARDS_BY_ID[id]).toBeUndefined();
        expect(eligible).not.toContain(id);
      }
      const expected = referencePick(ctx);
      drawSpringCard(ctx);
      expect(pending(ctx)[0].cardId).toBe(expected);
      expect(expected).toBe(SNAPSHOT[seed - 1]);
    }
  });
});
