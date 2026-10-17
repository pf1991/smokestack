// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { BARON_TRAITS } from '../../data/nemesis';
import type { GameController } from '../../game/controller';
import { publishNews } from '../../sim/news';
import { createGame } from '../../sim/state';
import { EventBus } from '../../core/events';
import type { SimContext } from '../../sim/types';
import { PANELS } from './index';

function game(ctx: SimContext) {
  return { ctx, state: ctx.state, renderer: { setSelection: () => {} }, openPanel: () => {} } as unknown as GameController;
}

const panel = () => document.querySelector('.rival-panel') as HTMLElement;

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  document.body.replaceChildren();
});

function rivalCtx(): SimContext {
  const state = createGame({ seed: 7, companyName: 'Acme Works', rival: true });
  state.date = { year: 1925, month: 6, day: 1, hour: 9 };
  state.nemesis.traits = ['greedy', 'showman'];
  return { state, bus: new EventBus() };
}

describe('rival panel', () => {
  it('shows the head, his age, his traits with blurbs and his top 5 grudges', () => {
    const ctx = rivalCtx();
    const [a, b] = ctx.state.cities;
    ctx.state.nemesis.grudges = [
      { kind: 'undercut', weight: 2, year: 1923, cityId: a.id },
      { kind: 'contract', weight: 3, year: 1924, cityId: b.id },
      { kind: 'rivalry', weight: 1, year: 1921, cityId: null },
      { kind: 'city', weight: 5, year: 1922, cityId: a.id },
      { kind: 'takeover_bid', weight: 8, year: 1925, cityId: null },
      { kind: 'undercut', weight: 1.5, year: 1920, cityId: b.id },
    ];
    PANELS.rival.open(game(ctx));
    const p = panel();
    expect(p.querySelector('.rival-head-name')!.textContent).toBe('Baron Cornelius Smogsworth');
    expect(p.querySelector('.rival-head-age')!.textContent).toContain('aged 73');
    const chips = [...p.querySelectorAll<HTMLElement>('.rival-trait')];
    expect(chips.map((c) => c.querySelector('.rival-trait-label')!.textContent)).toEqual(['Greedy', 'Showman']);
    expect(chips[0].textContent).toContain(BARON_TRAITS.greedy.blurb);
    const grudges = [...p.querySelectorAll<HTMLElement>('.rival-grudges li')].map((li) => li.textContent);
    expect(grudges).toEqual([
      'Takeover bid, 1925',
      `Stores routed in ${a.name}, 1922`,
      `Contract taken in ${b.name}, 1924`,
      `Undercut in ${a.name}, 1923`,
      `Undercut in ${b.name}, 1920`,
    ]);
    expect(p.querySelector('canvas')!.getAttribute('aria-label')).toContain('furious'); // 20.5 >= 12
  });

  it('lists the last 5 retaliations from the tagged rival news, newest first', () => {
    const ctx = rivalCtx();
    for (let i = 1; i <= 7; i++) {
      publishNews(ctx, 'rival', `Strike ${i}`, 'body', 'nemesis');
      publishNews(ctx, 'rival', `Smogsworth: 'quip ${i}'`, 'body');
    }
    PANELS.rival.open(game(ctx));
    const rows = [...panel().querySelectorAll<HTMLElement>('.rival-strikes li')].map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('Strike 7');
    expect(rows[4]).toContain('Strike 3');
    expect(rows.join()).not.toContain('quip');
  });

  it('says so when the ledger and the history are empty, and keeps the takeover button', () => {
    const ctx = rivalCtx();
    PANELS.rival.open(game(ctx));
    expect(panel().querySelector('.rival-grudges')!.textContent).toContain('No grudges');
    expect(panel().querySelector('.rival-strikes')!.textContent).toContain('not struck');
    expect(panel().querySelector('.rival-takeover')).not.toBeNull();
    expect(panel().querySelector('canvas')!.getAttribute('aria-label')).toContain('smug');
  });
});
