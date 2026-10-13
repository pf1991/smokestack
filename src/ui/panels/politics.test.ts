// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { adjustOpinion, opinionHistoryYear } from '../../sim/politics/factions';
import { buildRoad, demolishBuilding, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { sendTargets, stopPickSet, stopProblem } from './routeActions';
import type { SimContext } from '../../sim/types';
import { PANELS } from './index';

// spy on setEdict while keeping its real behaviour
const calls: unknown[][] = [];
vi.mock('../../sim/politics/edicts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../sim/politics/edicts')>();
  return {
    ...real,
    setEdict: (...args: Parameters<typeof real.setEdict>) => {
      calls.push(args.slice(1));
      return real.setEdict(...args);
    },
  };
});

function game(ctx: SimContext) {
  return { ctx, state: ctx.state, renderer: { setSelection: () => {} }, openPanel: () => {} } as unknown as GameController;
}

const win = () => document.querySelector('.window') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
});

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('politics window', () => {
  it('upkeep estimates count mayors\' minimum wage', () => {
    const ctx = testCtx(testState({ width: 80, height: 60, money: 1e6, cities: [{ x: 20, y: 20, population: 6000 }] }));
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 29, y: 19 })); // $300/mo, staffed from Town 0
    ctx.state.cities[0].politics.edicts = ['minimum_wage'];
    PANELS.politics.open(game(ctx));
    const wage = () => win().querySelectorAll<HTMLElement>('.pol-edict')[0];
    // fair: no change from wages, but the town's minimum wage adds 10%
    expect(wage().querySelector('.pol-cost')!.textContent).toBe('Upkeep unchanged · minimum wage +$30/mo');
    // low counts as fair in a minimum-wage town: no saving there
    expect(wage().querySelector<HTMLElement>('[data-value="low"]')!.title).toContain('Upkeep ×0.85 (+$0/mo)');
    // generous clears the minimum-wage floor, so nothing stacks: 300 × 1.25 − 300 × 1.1
    expect(wage().querySelector<HTMLElement>('[data-value="generous"]')!.title).toContain('(+$45/mo)');
  });

  it('renders three segmented controls; clicking one calls setEdict and updates the selection', () => {
    const ctx = testCtx(testState({ cities: [{ x: 10, y: 10, population: 6000 }] }));
    PANELS.politics.open(game(ctx));
    const segs = [...win().querySelectorAll<HTMLElement>('.pol-seg')];
    expect(segs.map((s) => s.dataset.edict)).toEqual(['wage', 'safety', 'union']);
    expect(segs.map((s) => [...s.querySelectorAll('button')].map((b) => b.textContent))).toEqual([
      ['Low', 'Fair', 'Generous'],
      ['Minimal', 'Standard', 'High'],
      ['Crush', 'Tolerate', 'Recognise'],
    ]);
    const pressed = () => segs.map((s) => s.querySelector<HTMLElement>('button[aria-pressed="true"]')!.dataset.value);
    expect(pressed()).toEqual(['fair', 'standard', 'tolerate']);
    segs[0].querySelector<HTMLElement>('[data-value="generous"]')!.click();
    expect(calls).toEqual([['wage', 'generous']]);
    expect(ctx.state.politics.edicts.wage).toBe('generous');
    expect(pressed()).toEqual(['generous', 'standard', 'tolerate']);
    // the control shows its cost and opinion effect
    const wage = win().querySelectorAll<HTMLElement>('.pol-edict')[0];
    expect(wage.querySelector('.pol-cost')!.textContent).toContain('×1.25');
    expect(wage.querySelector('.pol-effects')!.textContent).toBe('Workers +0.2/mo, Old Money −0.1/mo');
    expect(segs[0].querySelector<HTMLElement>('[data-value="low"]')!.title).toContain('Workers −0.2/mo, Old Money +0.1/mo');
    expect(win().querySelector('.pol-edicts .pol-note')!.textContent).toBe('Together, edicts move a faction at most ±0.8 a month; opinion drifts back toward 50.');
    segs[2].querySelector<HTMLElement>('[data-value="crush"]')!.click();
    expect(calls).toEqual([['wage', 'generous'], ['union', 'crush']]);
  });

  it('shows five national opinion bars with trends against the yearly sample, and the latest log', () => {
    const ctx = testCtx(testState({ cities: [{ x: 10, y: 10, population: 6000 }] }));
    // one sample of 1900, and no other: the trend shows "–" until it is 12 months old
    opinionHistoryYear(ctx);
    ctx.state.date = { ...ctx.state.date, year: 1902 };
    adjustOpinion(ctx.state, 'workers', 0, 10, 'Contract delivered');
    adjustOpinion(ctx.state, 'church', 0, -5, 'Contract failed');
    for (let i = 0; i < 10; i++) adjustOpinion(ctx.state, 'reformers', 0, 1, `Gift ${i}`);
    PANELS.politics.open(game(ctx));
    const rows = [...win().querySelectorAll<HTMLElement>('.pol-opinion')];
    expect(rows.map((r) => r.dataset.faction)).toEqual(['workers', 'oldmoney', 'reformers', 'church', 'baron']);
    const trend = (f: string) => win().querySelector<HTMLElement>(`.pol-opinion[data-faction="${f}"] .pol-trend`)!;
    expect(trend('workers').className).toBe('pol-trend up');
    expect(trend('workers').textContent).toBe('▲ +10');
    expect(trend('church').className).toBe('pol-trend down');
    expect(trend('oldmoney').textContent).toBe('–');
    expect(trend('workers').title).toBe('Change since 1900');
    const log = [...win().querySelectorAll<HTMLElement>('.pol-log li')];
    expect(log).toHaveLength(8);
    expect(log[0].textContent).toContain('Gift 9');
    expect(win().textContent).toContain('Recent political news');
  });
});

describe('city panel philanthropy', () => {
  it('offers the three gifts, disabled with a reason when unaffordable or already built', () => {
    const ctx = testCtx(testState({ money: 50000, cities: [{ x: 10, y: 10, population: 6000 }] }));
    PANELS.city.open(game(ctx) as never, 0);
    const btn = (id: string) => document.querySelector<HTMLButtonElement>(`[data-endow="${id}"]`)!;
    expect(btn('park').textContent).toContain('Endow a park — $25,000');
    expect(btn('park').disabled).toBe(false);
    expect(btn('hospital').disabled).toBe(true);
    expect(btn('hospital').title).toBe('Not enough money');
    btn('park').click();
    expect(ctx.state.cities[0].landmarks.map((l) => l.id)).toEqual(['park']);
    expect(btn('park').disabled).toBe(true);
    expect(btn('park').title).toBe('Town 0 already has a park');
  });
});

describe('company housing in the routes UI and its inspector', () => {
  function site() {
    const ctx = testCtx(testState({ width: 80, height: 60, money: 1e7, cities: [{ x: 20, y: 20, population: 6000 }] }));
    const s = ctx.state;
    // a wood source next to a sawmill, the housing between, and a road along the south of them all
    for (let y = 30; y < 32; y++) for (let x = 30; x < 32; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
    const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 30, y: 30 }));
    const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 36, y: 30 }));
    const home = must(placeBuilding(ctx, 'player', 'company_housing', { x: 40, y: 30 }));
    must(buildRoad(ctx, 'player', lPath({ x: 29, y: 33 }, { x: 44, y: 33 })));
    return { ctx, camp, mill, home };
  }

  it('is refused as a stop and absent from send targets and the stop picker', () => {
    const { ctx, camp, mill, home } = site();
    expect(stopProblem(ctx.state, home, 'truck')).toBe('Company Housing takes no cargo');
    const targets = sendTargets(ctx.state, camp);
    expect(targets.valid).toContain(mill.id);
    expect([...targets.valid, ...targets.blocked]).not.toContain(home.id);
    const pick = stopPickSet(ctx.state, 'truck', null);
    expect([...pick.valid, ...pick.blocked]).not.toContain(home.id);
  });

  it('the inspector says whom it houses, or warns when its factory is gone; no cargo rows', () => {
    const { ctx, mill, home } = site();
    PANELS.building.open(game(ctx) as never, home.id);
    const line = () => document.querySelector<HTMLElement>('.insp-housing')!;
    expect(line().textContent).toBe('Houses 150 hands for Sawmill (Town 0)');
    expect(line().hidden).toBe(false);
    const visible = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => !e.hidden && !e.closest('[hidden]'));
    expect(visible('[data-act="send-goods"]')).toEqual([]);
    const shown = visible('.insp > :not(.insp-head), .insp-head > *').map((e) => e.textContent).join('|');
    for (const word of ['Nothing in stock', 'Inputs', 'Routes', 'Handling cargo', 'Not on any route', 'Idle']) expect(shown).not.toContain(word);
    must(demolishBuilding(ctx, mill.id, 'player'));
    vi.advanceTimersByTime(1000);
    expect(line().textContent).toBe('No factory within 3 tiles — housing stands empty');
    expect(line().className).toContain('insp-warn');
  });
});
