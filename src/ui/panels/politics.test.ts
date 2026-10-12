// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { adjustOpinion, opinionHistoryYear } from '../../sim/politics/factions';
import { testCtx, testState } from '../../sim/testkit';
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
    expect(wage.querySelector('.pol-effects')!.textContent).toBe('Workers +2/mo, Old Money −1/mo');
    segs[2].querySelector<HTMLElement>('[data-value="crush"]')!.click();
    expect(calls).toEqual([['wage', 'generous'], ['union', 'crush']]);
  });

  it('shows five national opinion bars with trends against the yearly sample, and the latest log', () => {
    const ctx = testCtx(testState({ cities: [{ x: 10, y: 10, population: 6000 }] }));
    opinionHistoryYear(ctx);
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
