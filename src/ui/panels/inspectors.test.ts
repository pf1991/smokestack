// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../core/events';
import { DEMAND_PER_1000 } from '../../data/goods';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { demolishBuilding, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import type { Building, SimContext } from '../../sim/types';
import { adjustOpinion } from '../../sim/politics/factions';
import { PANELS } from './index';
import { startStrike } from '../../sim/society/strikes';
import { ageLine, staffingText } from './building';
import { addDays, formatDate } from '../../sim/clock';

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
    const fill = rows[4].querySelector<HTMLElement>('.insp-bar-fill')!;
    expect(fill.style.width).toBe('35%');
    expect(rows[4].querySelector('.insp-bar-label')!.textContent).toBe('35');
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
