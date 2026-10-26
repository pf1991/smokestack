// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../core/events';
import { DEMAND_PER_1000 } from '../../data/goods';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { buildRoad, demolishBuilding, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import type { Building, SimContext } from '../../sim/types';
import { adjustOpinion } from '../../sim/politics/factions';
import { PANELS } from './index';
import { buyHubTruck } from '../../sim/logistics/hubs';
import { startStrike } from '../../sim/society/strikes';
import { ageLine, staffingText, statusAdvice } from './building';
import { addDays, dateToDays, formatDate } from '../../sim/clock';
import { tradePrice } from '../../sim/trade';
import { buildBoard } from './contracts';
import { formatMoney } from '../format';

function host(ctx: SimContext) {
  const selections: unknown[] = [];
  return {
    ctx,
    renderer: { setSelection: (s: unknown) => selections.push(s) },
    openPanel: () => {},
    selections,
  };
}

function place(ctx: SimContext, typeId: string, x: number, y: number, owner: 'player' | 'rival' = 'player'): Building {
  return must(placeBuilding(ctx, owner, typeId, { x, y }));
}

const text = () => document.body.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('building panel', () => {
  it('recipe change updates building.recipeId and resets progress', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    b.progress = 0.5;
    PANELS.building.open(host(ctx) as never, b.id);
    const sel = document.querySelector<HTMLSelectElement>('select.insp-recipe')!;
    expect(sel).toBeTruthy();
    expect(sel.value).toBe(b.recipeId);
    sel.value = 'r_cotton';
    sel.dispatchEvent(new Event('change'));
    expect(b.recipeId).toBe('r_cotton');
    expect(b.progress).toBe(0);
  });

  it('shows the staffing row', () => {
    const ctx = testCtx(testState({ width: 100, height: 40, cities: [{ x: 10, y: 20, population: 1000, name: 'Ashford' }] }));
    const full = place(ctx, 'sawmill', 30, 20);
    const short = place(ctx, 'sawmill', 34, 20);
    const remote = place(ctx, 'sawmill', 80, 20);
    short.staffing = 0.85;
    remote.staffing = 0.75;
    PANELS.building.open(host(ctx) as never, full.id);
    expect(document.querySelector('.insp-staff')!.textContent).toBe('Staff 100%');
    PANELS.building.open(host(ctx) as never, short.id);
    expect(text()).toContain('Staff 85% — short of hands in Ashford');
    PANELS.building.open(host(ctx) as never, remote.id);
    expect(text()).toContain('Staff 75% — remote works');
  });

  it('shows a strike as "On strike until <date> — <reason>" and a go-slow on the staffing row', () => {
    const ctx = testCtx(testState({ width: 100, height: 40, money: 1e6, cities: [{ x: 10, y: 20, population: 6000, name: 'Ashford' }] }));
    const b = place(ctx, 'sawmill', 30, 20);
    ctx.state.cities[0].opinion.workers = 20;
    startStrike(ctx, b, ctx.state.cities[0]);
    const s = b.strike!;
    s.until = s.since + 45;
    s.reason = 'Pay and hours';
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector('.insp-reason')!.textContent).toBe(`On strike until ${formatDate(addDays(ctx.state.date, 45))} — Pay and hours`);
    expect(text()).toContain('On strike');
    expect(document.querySelector('.insp-staff')!.textContent).toBe('Staff 100% — go-slow in Ashford (×0.9)');
    b.staffing = 0.85;
    expect(staffingText(ctx.state, b)).toBe('Staff 85% — short of hands in Ashford; go-slow (×0.9)');
  });

  it('hides the staffing row for stores and depots', () => {
    const ctx = testCtx(testState({ money: 1e6 }));
    const w = place(ctx, 'warehouse', 5, 5);
    PANELS.building.open(host(ctx) as never, w.id);
    expect(document.querySelector<HTMLElement>('.insp-staff')!.hidden).toBe(true);
  });

  it('status reason text for no_input names missing good', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'sawmill', 5, 5);
    b.status = 'no_input';
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('Waiting for Wood');
  });

  it('panel closes when building demolished', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector('.window')).toBeTruthy();
    must(demolishBuilding(ctx, b.id));
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.window')).toBeNull();
  });

  it('demolish needs two clicks, refunds, and toasts', () => {
    const ctx = testCtx(testState());
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    const btn = document.querySelector<HTMLButtonElement>('button.insp-demolish')!;
    btn.click();
    expect(ctx.state.buildings[b.id]).toBeDefined();
    expect(btn.textContent).toContain('$2,500');
    btn.click();
    expect(ctx.state.buildings[b.id]).toBeUndefined();
    expect(events.some((e) => e.type === 'toast')).toBe(true);
  });

  it('rival buildings have no demolish button and a disabled recipe selector', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5, 'rival');
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector<HTMLElement>('button.insp-demolish')!.hidden).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('select.insp-recipe')!.disabled).toBe(true);
  });

  it('warns about missing road access and lists serving routes', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('No road access');
    expect(text()).toContain('Not on any route');
  });
});

describe('Trading House inspector', () => {
  it('lists the goods it holds with today\'s national price, and says it sells to the nation', () => {
    const ctx = testCtx(testState({ money: 1e6 }));
    const house = place(ctx, 'trading_house', 5, 5);
    house.input = { steel: 30, wire: 12 };
    ctx.state.trade.factor.wire = 1.2;
    PANELS.building.open(host(ctx) as never, house.id);
    const card = [...document.querySelectorAll<HTMLElement>('.kit-card')].find((c) => c.querySelector('.kit-card-title')?.textContent === 'National prices')!;
    expect(card).toBeTruthy();
    const steel = card.querySelector<HTMLElement>('tr[data-key="steel"]')!;
    expect(steel.textContent).toContain('Steel');
    expect(steel.textContent).toContain('30');
    expect(steel.textContent).toContain(formatMoney(tradePrice(ctx.state, 'steel')));
    const wire = card.querySelector<HTMLElement>('tr[data-key="wire"]')!;
    expect(wire.querySelector('.kit-pill')!.textContent).toMatch(/^▲ \+\d+%$/);
    expect(wire.querySelector('.kit-pill--positive')).toBeTruthy();
    expect(text()).toContain('Selling to the national market');
    expect(statusAdvice(ctx.state, house)).toEqual({ text: 'Selling to the national market', tone: 'positive' });
    // staffing scales the house's daily sales but, like a store's, is not shown
    expect(document.querySelector<HTMLElement>('.insp-staff-row')!.hidden).toBe(true);
  });

  it('an empty house shows the empty state and the route advice', () => {
    const ctx = testCtx(testState({ money: 1e6 }));
    const house = place(ctx, 'trading_house', 5, 5);
    PANELS.building.open(host(ctx) as never, house.id);
    expect(document.querySelector('.kit-empty')!.textContent).toContain('Route materials or components here to sell them');
    expect(text()).toContain('Empty: route goods here, or buy on the Market (U)');
    expect(statusAdvice(ctx.state, house).tone).toBe('warning');
  });
});

describe('contracts board (R4)', () => {
  it('a component contract\'s card says to sell through a Trading House; a town contract\'s does not', () => {
    const ctx = testCtx(testState({ cities: [{ x: 10, y: 10, name: 'Ashford' }] }));
    const deadline = addDays(ctx.state.date, 100);
    ctx.state.contracts.push(
      { id: 90, cityId: 0, goodId: 'wire', qty: 180, delivered: 40, deadline, reward: 8640, status: 'active' },
      { id: 91, cityId: 0, goodId: 'bread', qty: 100, delivered: 0, deadline, reward: 3000, status: 'offered' },
    );
    const board = buildBoard({ state: ctx.state, ctx } as never, () => {});
    const wire = board.querySelector<HTMLElement>('[data-contract="90"]')!;
    const bread = board.querySelector<HTMLElement>('[data-contract="91"]')!;
    expect(wire.textContent).toContain('Sell through a Trading House');
    expect(wire.textContent).toContain('40 of 180 sold');
    expect(bread.textContent).not.toContain('Trading House');
  });
});

describe('building panel upgrades', () => {
  it('offers the next scrubber tier and a tall chimney, buys them, and shows law compliance', () => {
    const ctx = testCtx(testState({ year: 1950, money: 1e7 }));
    ctx.state.date.year = 1950;
    const b = place(ctx, 'steel_mill', 10, 10);
    ctx.state.society.laws.smoke_abatement = { passed: 1925, enforcedFrom: 0, lobbied: false };
    ctx.state.society.laws.clean_air = { passed: 1950, enforcedFrom: 0, lobbied: false };
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('Scrubber: none');
    expect(text()).toContain('Fined $2,400/mo under the Clean Air Act');
    expect(text()).toContain("Below the Smoke Abatement Act's tier 1");
    const scrub = document.querySelector<HTMLButtonElement>('button[data-act="scrubber"]')!;
    expect(scrub.textContent).toContain('Fit tier 1 scrubber $18,000 — smoke ×0.7, upkeep ×1.1');
    scrub.click();
    expect(b.upgrades?.scrubber).toBe(1);
    expect(text()).toContain('Compliant with the Smoke Abatement Act');
    scrub.click();
    expect(b.upgrades?.scrubber).toBe(2);
    expect(text()).toContain('Compliant with the Clean Air Act');
    // tier 3 waits for 1985
    expect(scrub.disabled).toBe(true);
    expect(text()).toContain('Tier 3 scrubbers arrive in 1985');
    const tall = document.querySelector<HTMLButtonElement>('button[data-act="tall-chimney"]')!;
    tall.click();
    expect(b.upgrades?.tallChimney).toBe(true);
    expect(tall.disabled).toBe(true);
    expect(tall.textContent).toBe('Tall chimney built');
  });

  it('hides upgrades for smokeless and rival buildings', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const wh = place(ctx, 'warehouse', 5, 5);
    PANELS.building.open(host(ctx) as never, wh.id);
    expect(document.querySelector<HTMLElement>('.insp-upgrades')!.hidden).toBe(true);
  });
});

describe('city panel', () => {
  it('lists craved goods sorted by unmet demand', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 10000 }] });
    const ctx = testCtx(state);
    const c = state.cities[0];
    // furniture: big unmet value; bread: fully satisfied; tools: some unmet; clothes: some unmet
    for (const g of Object.keys(DEMAND_PER_1000)) c.market[g] = { sold30: 100, demand30: 100, pending: 0 };
    c.market.furniture = { sold30: 0, demand30: 100, pending: 0 };
    c.market.bread = { sold30: 100, demand30: 100, pending: 0 };
    c.market.tools = { sold30: 0, demand30: 100, pending: 0 };
    c.market.clothes = { sold30: 50, demand30: 100, pending: 0 };
    PANELS.city.open(host(ctx) as never, 0);
    const rows = [...document.querySelectorAll<HTMLElement>('tr.insp-good')];
    const crave = rows.filter((r) => r.textContent!.includes('Craves')).map((r) => r.dataset.good);
    expect(crave).toHaveLength(3);
    for (const r of rows.filter((x) => x.textContent!.includes('Craves'))) {
      expect(r.querySelector('.insp-crave img[data-icon="star"]')).not.toBeNull();
    }
    expect(crave[0]).toBe('furniture');
    expect(crave).not.toContain('bread');
    // rows are ordered by unmet demand x price, so craves come first
    expect(rows[0].dataset.good).toBe('furniture');
    expect(text()).toContain('Town 0');
  });

  it('shows population trend', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    state.cities[0].prevPopulation = 5000;
    PANELS.city.open(host(testCtx(state)) as never, 0);
    expect(text()).toContain('▲');
  });

  it('lists the city landmarks with icons', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    const ctx = testCtx(state);
    PANELS.city.open(host(ctx) as never, 0);
    expect(document.querySelector('.insp-landmarks')!.textContent).toContain('None yet');
    state.cities[0].landmarks.push({ id: 'church', pos: { x: 9, y: 9 } }, { id: 'town_hall', pos: { x: 12, y: 9 } });
    vi.advanceTimersByTime(1000);
    const items = [...document.querySelectorAll<HTMLElement>('.insp-landmarks li')];
    expect(items.map((li) => li.textContent)).toEqual(['Church', 'Town Hall']);
    expect(items[0].querySelector('img[data-icon="church"]')).not.toBeNull();
    expect(items[1].querySelector('img[data-icon="town_hall"]')).not.toBeNull();
  });
});

describe('city panel edicts', () => {
  it('lists the edicts in force with icons and effect lines, and the faction levers', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    const c = state.cities[0];
    c.politics.mayor.faction = 'baron';
    c.politics.edicts = ['truck_tolls', 'permits_required'];
    PANELS.city.open(host(testCtx(state)) as never, 0);
    const items = () => [...document.querySelectorAll<HTMLElement>('.insp-edicts li')];
    expect(items().map((li) => li.dataset.edict)).toEqual(['truck_tolls', 'permits_required']);
    expect(items()[0].querySelector('img[data-icon="toll"]')).not.toBeNull();
    expect(items()[1].querySelector('img[data-icon="permit"]')).not.toBeNull();
    expect(items()[0].textContent).toContain('Truck tolls');
    expect(items()[0].textContent).toContain('$40/month');
    expect(items()[1].title).toContain('permit');
    const reach = document.querySelector('.insp-edict-reach')!.textContent!;
    expect(reach).toContain("within the town's zone");
    expect(reach).toContain('staffed from the town');
    c.politics.edicts = [];
    adjustOpinion(state, 'church', c.id, -40, 'test');
    adjustOpinion(state, 'oldmoney', c.id, -20, 'test');
    vi.advanceTimersByTime(1000);
    expect(items().map((li) => li.dataset.edict)).toEqual(['land', 'church']);
    expect(items()[0].textContent).toContain('×1.10');
    expect(items()[1].textContent).toContain('+25%');
  });

  it('says so when no edict is in force', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    PANELS.city.open(host(testCtx(state)) as never, 0);
    expect(document.querySelector('.insp-edicts')!.textContent).toContain('None in force');
  });
});

describe('city panel opinion', () => {
  it('shows five faction bars in faction colours, named for the year', () => {
    const state = testState({ year: 1960, cities: [{ x: 10, y: 10, population: 6000 }] });
    PANELS.city.open(host(testCtx(state)) as never, 0);
    const rows = [...document.querySelectorAll<HTMLElement>('.insp-opinion')];
    expect(text()).toContain('Opinion of your company');
    expect(rows.map((r) => r.dataset.faction)).toEqual(['workers', 'oldmoney', 'reformers', 'church', 'baron']);
    expect(rows.map((r) => r.querySelector('.insp-label')!.textContent)).toEqual(['Workers', 'Old Money', 'Greens', 'Church', "Baron's Circle"]);
    // Task 8: the factions are kit meters (was a labelled .insp-bar)
    const fill = rows[4].querySelector<HTMLElement>('.kit-meter-fill')!;
    expect(fill.style.width).toBe('35%');
    expect(rows[4].querySelector('.insp-opinion-val')!.textContent).toBe('35');
    expect(fill.style.background).not.toBe('');
  });
});

describe('vehicle panel', () => {
  it('shows route and next stop, and Sell removes the vehicle', () => {
    const ctx = testCtx(testState({ money: 1_000_000 }));
    const a = place(ctx, 'farm', 5, 5);
    const m = place(ctx, 'sawmill', 20, 5);
    for (let x = 4; x < 25; x++) ctx.state.map.tiles[8 * 40 + x].road = true;
    const route = must(
      createRoute(ctx, 'player', 'Wood Run', [
        { buildingId: a.id, load: ['grain'], unload: [] },
        { buildingId: m.id, load: [], unload: ['grain'] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', route.id));
    PANELS.vehicle.open(host(ctx) as never, v.id);
    expect(text()).toContain('Wood Run');
    document.querySelector<HTMLButtonElement>('button.insp-sell')!.click();
    expect(ctx.state.vehicles[v.id]).toBeUndefined();
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.window')).toBeNull();
  });
});

describe('vehicle panel hub truck', () => {
  it('shows its hub, its job and its next stop; picking the hub entry changes nothing', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 13 }, { x: 38, y: 13 })));
    const wh = place(ctx, 'warehouse', 10, 10);
    const mill = place(ctx, 'sawmill', 15, 10);
    const v = must(buyHubTruck(ctx, 'player', wh.id));
    PANELS.vehicle.open(host(ctx) as never, v.id);
    const sel = document.querySelector<HTMLSelectElement>('select.insp-route-sel')!;
    expect(sel.value).toBe('hub');
    expect(sel.selectedOptions[0].textContent).toBe('Hub: Warehouse');
    expect(text()).toContain('Waiting at its hub');
    v.job = { kind: 'collect', from: mill.id, to: wh.id, good: 'lumber', qty: 15 };
    vi.advanceTimersByTime(1000);
    expect(text()).toContain('Collect 15 Lumber');
    expect(text()).toContain(`Sawmill #${mill.id}`);
    const toasts: string[] = [];
    ctx.bus.on('toast', (e: Extract<GameEvent, { type: 'toast' }>) => toasts.push(e.message));
    sel.value = 'hub';
    sel.dispatchEvent(new Event('change'));
    expect(toasts).toEqual([]);
    expect(v.hubId).toBe(wh.id);
    expect(v.job).not.toBeNull();
  });
});

describe('city panel smog tier', () => {
  it('shows the tier name, level, trend and what lowers it; tier-4 edicts say who forced them', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    const c = state.cities[0];
    PANELS.city.open(host(testCtx(state)) as never, 0);
    const row = () => document.querySelector<HTMLElement>('.insp-smog')!;
    expect(row().dataset.tier).toBe('0');
    expect(row().querySelector('.insp-smog-tier')!.textContent).toBe('Clean');
    expect(row().textContent).toContain('Scrubbers, parks or fewer smokestacks lower it');
    c.smog = { tier: 3, months: 0, blackLung: 0, level: 0.12 };
    c.pollution = 0.2;
    vi.advanceTimersByTime(1000);
    expect(row().querySelector('.insp-smog-tier')!.textContent).toBe('Protesting');
    expect(row().querySelector('.insp-smog-level')!.textContent).toBe('12.0%');
    expect(row().querySelector('.insp-trend')!.textContent).toBe('▲');
    expect(row().querySelector('.insp-smog-hint')!.textContent).toContain('80%');
    c.smog.tier = 4;
    c.pollution = 0.05;
    vi.advanceTimersByTime(1000);
    expect(row().querySelector('.insp-smog-tier')!.textContent).toBe('Revolt');
    expect(row().querySelector('.insp-trend')!.textContent).toBe('▼');
    const items = [...document.querySelectorAll<HTMLElement>('.insp-edicts li')];
    const limit = items.find((li) => li.dataset.edict === 'smog_limit')!;
    expect(limit.textContent).toContain('smog revolt');
  });
});

describe('city panel class bar', () => {
  it('shows Working / Middle / Upper segments sized by the class mix', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    const c = state.cities[0];
    PANELS.city.open(host(testCtx(state)) as never, 0);
    const seg = (k: string) => document.querySelector<HTMLElement>(`.insp-classes [data-class="${k}"]`)!;
    expect(document.querySelector('.insp-classes .insp-label')!.textContent).toBe('Classes');
    expect(seg('working').style.width).toBe('75%');
    expect(seg('working').textContent).toBe('Working 75%');
    expect(seg('middle').textContent).toBe('Middle 20%');
    expect(seg('upper').textContent).toBe(''); // too narrow for its label
    expect(document.querySelector<HTMLElement>('.insp-class-bar')!.title).toBe('Working 75% / Middle 20% / Upper 5%');
    c.classes = { working: 0.4, middle: 0.4, upper: 0.2 };
    vi.advanceTimersByTime(1000);
    expect(seg('upper').style.width).toBe('20%');
    expect(seg('upper').textContent).toBe('Upper 20%');
  });
});

describe('building age (Task 8)', () => {
  it('reads "Built 1912 (age 41): 74% efficiency"', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 4, y: 4 }));
    b.builtYear = 1912;
    ctx.state.date = { ...ctx.state.date, year: 1953 };
    expect(ageLine(ctx.state, b)).toBe('Built 1912 (age 41): 74% efficiency');
  });

  it('a store makes nothing, so it shows its upkeep surcharge instead', () => {
    const ctx = testCtx(testState({ money: 1e7, cities: [{ x: 30, y: 20 }] }));
    const b = must(placeBuilding(ctx, 'player', 'store', { x: 30, y: 21 }));
    b.builtYear = 1912;
    ctx.state.date = { ...ctx.state.date, year: 1953 };
    expect(ageLine(ctx.state, b)).toBe('Built 1912 (age 41): upkeep +52%');
  });
});

describe('building level card', () => {
  it('shows both columns, the price and the refusal', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = place(ctx, 'sawmill', 10, 10);
    PANELS.building.open(host(ctx) as never, b.id);
    const card = document.querySelector<HTMLElement>('.insp-level')!;
    expect(card.querySelector('.p-head')!.textContent).toBe('Level');
    const cols = card.querySelectorAll('.lv-col');
    expect(cols).toHaveLength(2);
    expect(cols[0].textContent).toContain('Level 1');
    expect(cols[1].textContent).toContain('Level 2');
    expect(cols[1].textContent).toContain('Workers 78');
    expect(cols[1].textContent).toContain('Smoke ×1.3');
    const btn = card.querySelector<HTMLButtonElement>('button[data-act="upgrade-level"]')!;
    expect(btn.textContent).toBe('Upgrade $10,000: 30 days, output paused');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(b.works?.toLevel).toBe(2);
    expect(text()).toContain('Upgrading to level 2: 30 days left');
  });

  it('says why a level 2 works cannot climb yet, and counts the days during works', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = place(ctx, 'sawmill', 10, 10);
    b.level = 2;
    PANELS.building.open(host(ctx) as never, b.id);
    const btn = document.querySelector<HTMLButtonElement>('button[data-act="upgrade-level"]')!;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Level 3 arrives in 1920');
    expect(text()).toContain('Level 3 arrives in 1920');
    ctx.state.date.year = 1920;
    b.works = { toLevel: 3, startDay: dateToDays(ctx.state.date), untilDay: dateToDays(ctx.state.date) + 45 };
    b.status = 'upgrading';
    vi.advanceTimersByTime(2000);
    document.querySelector<HTMLButtonElement>('.window-close')?.click();
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('Upgrading to level 3: 45 days left');
    b.works.untilDay = dateToDays(ctx.state.date) + 1;
    document.querySelector<HTMLButtonElement>('.window-close')?.click();
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('Upgrading to level 3: 1 day left');
  });
});

describe('warehouse hub section', () => {
  it('shows range, trucks and the buy button, and warns when no manager runs the hub', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 13 }, { x: 38, y: 13 })));
    const wh = place(ctx, 'warehouse', 10, 10);
    place(ctx, 'sawmill', 15, 10);
    PANELS.building.open(host(ctx) as never, wh.id);
    const sec = document.querySelector<HTMLElement>('.insp-hub')!;
    expect(sec.querySelector('.p-head')!.textContent).toContain('Hub');
    expect(sec.textContent).toContain('Range 12 tiles: 1 building attached');
    expect(sec.textContent).toContain('Trucks 0 / 4');
    // a plain warehouse is no hub yet: nothing to run
    expect(sec.querySelector<HTMLElement>('.insp-hub-warn')!.hidden).toBe(true);
    const buy = sec.querySelector<HTMLButtonElement>('button[data-act="hub-truck"]')!;
    expect(buy.textContent).toBe('Buy hub truck $8,000');
    buy.click();
    expect(wh.hub).toBeDefined();
    expect(sec.querySelector<HTMLElement>('.insp-hub-warn')!.hidden).toBe(false);
    expect(sec.querySelector<HTMLElement>('.insp-hub-warn')!.textContent).toContain('Hire a manager');
    expect(sec.textContent).toContain('Trucks 1 / 4');
    expect(sec.textContent).toContain('Yesterday: 0 jobs, 0 trucks idle');
    const auto = sec.querySelector<HTMLInputElement>('input[data-act="hub-autosize"]')!;
    expect(auto.checked).toBe(true);
    auto.checked = false;
    auto.dispatchEvent(new Event('change'));
    expect(wh.hub!.autoSize).toBe(false);
    const cap = sec.querySelector<HTMLInputElement>('input[data-act="hub-cap"]')!;
    expect(cap.value).toBe('4');
    cap.value = '2';
    cap.dispatchEvent(new Event('change'));
    expect(wh.hub!.maxTrucks).toBe(2);
    cap.value = '9';
    cap.dispatchEvent(new Event('change'));
    expect(wh.hub!.maxTrucks).toBe(4);
    const balancing = sec.querySelector<HTMLElement>('.insp-hub-balance')!;
    expect(balancing.hidden).toBe(true);
    const other = place(ctx, 'warehouse', 20, 10);
    const truck = Object.values(ctx.state.vehicles)[0];
    truck.job = { kind: 'balance', from: wh.id, to: other.id, good: 'bread', qty: 20 };
    vi.advanceTimersByTime(600);
    expect(balancing.textContent).toBe('Balancing with Warehouse at 20,10');
  });

  it('is absent for anything but a warehouse', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = place(ctx, 'sawmill', 10, 10);
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector<HTMLElement>('.insp-hub')!.hidden).toBe(true);
  });
});

describe('statusAdvice (Task 8)', () => {
  const setup = (typeId = 'sawmill') => {
    const ctx = testCtx(testState({ year: 1950, money: 1e7 }));
    ctx.state.date.year = 1950;
    return { ctx, b: place(ctx, typeId, 10, 10) };
  };

  it('ok: Producing', () => {
    const { ctx, b } = setup();
    b.status = 'ok';
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Producing', tone: 'positive' });
  });

  it('no_input names the first missing input and the fix', () => {
    const { ctx, b } = setup('steel_mill');
    b.status = 'no_input';
    b.input = { iron_ore: 20, coal: 0 };
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Starved of Coal: connect a route that delivers it', tone: 'warning' });
    b.input = {};
    expect(statusAdvice(ctx.state, b).text).toBe('Starved of Iron Ore: connect a route that delivers it');
  });

  it('output_full names the output and the fix', () => {
    const { ctx, b } = setup();
    b.status = 'output_full';
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Storage full: add a route to carry Lumber away', tone: 'warning' });
  });

  it('halted on strike gives the strike reason; otherwise plain Halted', () => {
    const { ctx, b } = setup();
    b.status = 'halted';
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Halted', tone: 'negative' });
    const today = dateToDays(ctx.state.date);
    b.strike = { since: today, until: today + 30, reason: 'Pay and hours', cityId: 0, cardUid: null } as never;
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'On strike: Pay and hours', tone: 'negative' });
  });

  it('idle asks for a recipe', () => {
    const { ctx, b } = setup();
    b.status = 'idle';
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Idle: choose a recipe', tone: 'neutral' });
  });

  it('upgrading counts the days left', () => {
    const { ctx, b } = setup();
    const today = dateToDays(ctx.state.date);
    b.works = { toLevel: 2, startDay: today, untilDay: today + 30 };
    b.status = 'upgrading';
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Upgrading: 30 days left', tone: 'info' });
  });

  it('is pure: leaves the building untouched', () => {
    const { ctx, b } = setup();
    b.status = 'no_input';
    const before = JSON.stringify(b);
    statusAdvice(ctx.state, b);
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('building panel layout (Task 8)', () => {
  it('heads the panel with the building name and the status advice', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = place(ctx, 'sawmill', 10, 10);
    b.status = 'no_input';
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector('.insp .kit-ph-title')!.textContent).toBe('Sawmill');
    const sum = document.querySelector<HTMLElement>('.insp .kit-ph-summary')!;
    expect(sum.textContent).toBe('Starved of Wood: connect a route that delivers it');
    expect(sum.dataset.tone).toBe('warning');
    b.status = 'ok';
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.insp .kit-ph-summary')!.textContent).toBe('Producing');
  });

  it('has a danger Demolish button in the footer actions', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    const btn = document.querySelector<HTMLButtonElement>('.p-actions button.danger')!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Demolish');
    expect(btn.classList.contains('insp-demolish')).toBe(true);
    expect(document.querySelector('.insp')!.lastElementChild!.classList.contains('p-actions')).toBe(true);
  });

  it('shows a production card: input meters, an arrow, output meters and the month total', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = place(ctx, 'sawmill', 10, 10);
    b.input = { wood: 30 };
    b.output = { lumber: 120 };
    b.producedThisMonth = { lumber: 42 };
    PANELS.building.open(host(ctx) as never, b.id);
    const flow = document.querySelector<HTMLElement>('.insp-production .insp-flow')!;
    const parts = [...flow.children].map((c) => c.className);
    expect(parts).toEqual(['insp-flow-side insp-flow-in', 'insp-flow-arrow', 'insp-flow-side insp-flow-out']);
    const inRow = flow.querySelector<HTMLElement>('.insp-flow-in [data-good="wood"]')!;
    expect(inRow.querySelector('img[data-icon="wood"]')).not.toBeNull();
    expect(inRow.querySelector('.kit-meter')!.getAttribute('aria-valuenow')).toBe('30');
    const outRow = flow.querySelector<HTMLElement>('.insp-flow-out [data-good="lumber"]')!;
    expect(outRow.querySelector<HTMLElement>('.kit-meter')!.dataset.tone).toBe('warning'); // full
    expect(document.querySelector('.insp-produced')!.textContent).toBe('Produced this month: 42');
    // the meters update in place
    const meterEl = inRow.querySelector('.kit-meter');
    b.input.wood = 60;
    vi.advanceTimersByTime(600);
    expect(flow.querySelector('.insp-flow-in [data-good="wood"] .kit-meter')).toBe(meterEl);
    expect(meterEl!.getAttribute('aria-valuenow')).toBe('60');
  });

  it('an extractor has no input side; a fresh store shows an empty stock', () => {
    const ctx = testCtx(testState({ money: 1e7, cities: [{ x: 30, y: 20 }] }));
    const farm = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, farm.id);
    expect(document.querySelector<HTMLElement>('.insp-flow-in')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.insp-flow-arrow')!.hidden).toBe(true);
    expect(document.querySelector('.insp-produced')!.textContent).toBe('Produced this month: 0');
    const store = must(placeBuilding(ctx, 'player', 'store', { x: 30, y: 21 }));
    PANELS.building.open(host(ctx) as never, store.id);
    const win = [...document.querySelectorAll<HTMLElement>('.insp')].at(-1)!;
    expect(win.querySelector('.insp-production')!.textContent).toContain('Nothing in stock');
  });

  it('shows staffing as a meter', () => {
    const ctx = testCtx(testState({ width: 100, height: 40, cities: [{ x: 10, y: 20, population: 1000, name: 'Ashford' }] }));
    const b = place(ctx, 'sawmill', 34, 20);
    b.staffing = 0.85;
    PANELS.building.open(host(ctx) as never, b.id);
    const m = document.querySelector<HTMLElement>('.insp-staff-row .kit-meter')!;
    expect(m.getAttribute('aria-valuenow')).toBe('0.85');
    expect(m.dataset.tone).toBe('warning');
  });

  it('level, manager, upgrades and age read as cards', () => {
    const ctx = testCtx(testState({ year: 1950, money: 1e7 }));
    ctx.state.date.year = 1950;
    const b = place(ctx, 'steel_mill', 10, 10);
    PANELS.building.open(host(ctx) as never, b.id);
    for (const sel of ['.insp-level', '.insp-manager', '.insp-upgrades', '.insp-age']) {
      expect(document.querySelector(sel)!.classList.contains('kit-card'), sel).toBe(true);
    }
  });
});

describe('city panel layout (Task 8)', () => {
  it('has a header with population and mayor, four stat tiles and a demand table', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    state.cities[0].politics.mayor.name = 'Mabel Clogg';
    PANELS.city.open(host(testCtx(state)) as never, 0);
    expect(document.querySelector('.insp .kit-ph-title')!.textContent).toBe('Town 0');
    const sum = document.querySelector('.insp .kit-ph-summary')!.textContent!;
    expect(sum).toContain('6,000');
    expect(sum).toContain('Mabel Clogg');
    const tiles = [...document.querySelectorAll('.insp .kit-stat-row .kit-stat')];
    expect(tiles).toHaveLength(4);
    expect(tiles.map((t) => t.querySelector('.kit-stat-label')!.textContent)).toEqual(['Population', 'Workers', 'Smog tier', 'Happiness']);
    expect(document.querySelector('.insp table.kit-table tr.insp-good')).not.toBeNull();
    expect(document.querySelectorAll('.insp-opinion .kit-meter')).toHaveLength(5);
  });

  it('park endow tip promises townsfolk stay', () => {
    const state = testState({ money: 1e7, cities: [{ x: 10, y: 10, population: 6000 }] });
    PANELS.city.open(host(testCtx(state)) as never, 0);
    expect(document.querySelector<HTMLButtonElement>('.insp-endow[data-endow="park"]')!.title).toContain('Park: townsfolk stay');
  });

  it('population tile notes a park retains townsfolk', () => {
    const state = testState({ money: 1e7, cities: [{ x: 10, y: 10, population: 6000 }] });
    state.cities[0].landmarks = [{ id: 'park', pos: { x: 10, y: 10 } }];
    PANELS.city.open(host(testCtx(state)) as never, 0);
    expect((document.querySelector('.insp .kit-stat-row .kit-stat') as HTMLElement).title).toContain('Park: townsfolk stay');
  });
});

describe('vehicle panel layout (Task 8)', () => {
  it('has a header, a cargo meter and the route as a pill', () => {
    const ctx = testCtx(testState({ money: 1_000_000 }));
    const a = place(ctx, 'farm', 5, 5);
    const m = place(ctx, 'sawmill', 20, 5);
    for (let x = 4; x < 25; x++) ctx.state.map.tiles[8 * 40 + x].road = true;
    const route = must(
      createRoute(ctx, 'player', 'Wood Run', [
        { buildingId: a.id, load: ['grain'], unload: [] },
        { buildingId: m.id, load: [], unload: ['grain'] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', route.id));
    v.cargo = { grain: 10 };
    PANELS.vehicle.open(host(ctx) as never, v.id);
    expect(document.querySelector('.insp .kit-ph-title')).not.toBeNull();
    const cargo = document.querySelector<HTMLElement>('.insp-cargo .kit-meter')!;
    expect(cargo.getAttribute('aria-valuenow')).toBe('10');
    expect(cargo.getAttribute('aria-valuemax')).toBe(String(v.capacity));
    expect(document.querySelector('.insp-route-pill')!.textContent).toBe('Wood Run');
    expect(document.querySelector('.insp-route-pill')!.classList.contains('kit-pill')).toBe(true);
  });
});

describe('inspectors in an empty game (Task 8)', () => {
  it('a fresh works, a town with nothing unlocked and an empty truck read as designed empty states', () => {
    const ctx = testCtx(testState({ money: 1_000_000, cities: [{ x: 30, y: 30, population: 2000 }] }));
    const farm = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, farm.id);
    expect(document.querySelector('.insp-produced')!.textContent).toBe('Produced this month: 0');
    expect(document.querySelector('.insp-routes')!.textContent).toBe('Not on any route');
    const unlocked = ctx.state.unlocked;
    ctx.state.unlocked = [];
    PANELS.city.open(host(ctx) as never, 0);
    expect(document.querySelector('.insp-demand')!.textContent).toContain('No demand for manufactured goods yet');
    ctx.state.unlocked = unlocked;
    const m = place(ctx, 'sawmill', 20, 5);
    for (let x = 4; x < 25; x++) ctx.state.map.tiles[8 * 40 + x].road = true;
    const route = must(createRoute(ctx, 'player', 'Run', [
      { buildingId: farm.id, load: ['grain'], unload: [] },
      { buildingId: m.id, load: [], unload: ['grain'] },
    ]));
    const v = must(buyTruck(ctx, 'player', route.id));
    PANELS.vehicle.open(host(ctx) as never, v.id);
    expect(document.querySelector('.insp-cargo')!.textContent).toContain(`Empty (0 / ${v.capacity})`);
    expect(document.querySelector('.insp-cargo .kit-meter')!.getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('statusAdvice for stores, depots and the last day (Task 8 fix)', () => {
  it('a store reads its shelves, not its status', () => {
    const ctx = testCtx(testState({ money: 1e7, cities: [{ x: 30, y: 20 }] }));
    const store = must(placeBuilding(ctx, 'player', 'store', { x: 30, y: 21 }));
    store.status = 'idle';
    expect(statusAdvice(ctx.state, store)).toEqual({ text: 'Shelves empty: route goods here', tone: 'warning' });
    store.input = { bread: 12 };
    expect(statusAdvice(ctx.state, store)).toEqual({ text: 'Open for business', tone: 'positive' });
    store.status = 'ok';
    expect(statusAdvice(ctx.state, store).text).toBe('Open for business');
    PANELS.building.open(host(ctx) as never, store.id);
    expect(document.querySelector('.insp-reason')!.textContent).toBe('Open for business');
  });

  it('a depot is handling cargo whether ok or idle', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const wh = place(ctx, 'warehouse', 5, 5);
    for (const st of ['ok', 'idle'] as const) {
      wh.status = st;
      expect(statusAdvice(ctx.state, wh)).toEqual({ text: 'Handling cargo', tone: 'neutral' });
    }
  });

  it('says "1 day left" on the last day of works', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = place(ctx, 'sawmill', 10, 10);
    const today = dateToDays(ctx.state.date);
    b.works = { toLevel: 2, startDay: today - 29, untilDay: today + 1 };
    b.status = 'upgrading';
    expect(statusAdvice(ctx.state, b)).toEqual({ text: 'Upgrading: 1 day left', tone: 'info' });
  });
});

describe('inspect swap', () => {
  it('rebuilds only on a new key and keeps the box scroll and an inner scroller', async () => {
    const { swap } = await import('./inspect');
    const box = document.createElement('div');
    const build = (n: number) => () => {
      const el = document.createElement('div');
      el.className = 'inner';
      el.textContent = String(n);
      return el;
    };
    swap(box, 'a', build(1), '.inner');
    const first = box.firstElementChild;
    swap(box, 'a', build(2), '.inner');
    expect(box.firstElementChild).toBe(first);
    box.scrollTop = 40;
    (box.querySelector('.inner') as HTMLElement).scrollLeft = 30;
    swap(box, 'b', build(3), '.inner');
    expect(box.textContent).toBe('3');
    expect(box.scrollTop).toBe(40);
    expect((box.querySelector('.inner') as HTMLElement).scrollLeft).toBe(30);
  });
});
