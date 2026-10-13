// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import type { GameController } from '../../game/controller';
import { CARDS_BY_ID } from '../../data/cards';
import { publishNews } from '../../sim/news';
import { stepTick } from '../../sim/simulation';
import { createGame } from '../../sim/state';
import { testCtx, testState } from '../../sim/testkit';
import { closeAllWindows } from '../window';
import { attachNewspaper, mastheadFor, newspaperPanel } from './newspaper';

describe('newspaper panel', () => {
  afterEach(() => closeAllWindows());

  it('reopening an already open paper shows the latest edition', () => {
    const ctx = testCtx(testState());
    const game = { state: ctx.state, ctx } as unknown as GameController;
    ctx.state.date = { year: 1914, month: 8, day: 30, hour: 0 };
    publishNews(ctx, 'historic', 'EUROPE IN ARMS', 'War.');
    newspaperPanel.open(game);
    expect(document.querySelector('.paper-nav span')?.textContent).toBe('Vol. 15 · No. 8');

    ctx.state.date = { year: 1972, month: 1, day: 5, hour: 0 };
    publishNews(ctx, 'random', 'LATER NEWS', 'Much later.');
    newspaperPanel.open(game);
    expect(document.querySelectorAll('.paper')).toHaveLength(1);
    expect(document.querySelector('.paper-nav span')?.textContent).toBe('Vol. 73 · No. 1');
  });
});

describe('auto-open', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    closeAllWindows();
  });

  it('landmark news is civic and never auto-opens the paper in the first 3 months', () => {
    const state = createGame({ seed: 7 });
    const ctx = { state, bus: new EventBus() };
    const game = { state, ctx } as unknown as GameController;
    const open = vi.spyOn(newspaperPanel, 'open').mockImplementation(() => {});
    attachNewspaper(game);
    const start = state.date.year * 12 + state.date.month;
    while (state.date.year * 12 + state.date.month < start + 3) stepTick(ctx);
    expect(open).not.toHaveBeenCalled();
    const civic = state.news.filter((n) => n.kind === 'civic');
    expect(civic.length).toBeGreaterThan(0);
    expect(state.news.some((n) => n.kind === 'historic')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('civic stories still print with their own byline', () => {
    const ctx = testCtx(testState());
    const game = { state: ctx.state, ctx } as unknown as GameController;
    publishNews(ctx, 'civic', 'TOWN HALL OPENS', 'Bunting.');
    publishNews(ctx, 'civic', 'CHURCH CONSECRATED', 'Bells.');
    newspaperPanel.open(game);
    expect(document.querySelector('.paper .lead .kicker')?.textContent).toBe('Civic Affairs');
    expect(document.querySelector('.paper .story.civic .byline')?.textContent).toContain('Civic Affairs');
  });

  it('historic news still auto-opens at month end', () => {
    const ctx = testCtx(testState());
    const game = { state: ctx.state, ctx } as unknown as GameController;
    const open = vi.spyOn(newspaperPanel, 'open').mockImplementation(() => {});
    attachNewspaper(game);
    publishNews(ctx, 'historic', 'EUROPE IN ARMS', 'War.');
    ctx.bus.emit({ type: 'monthEnd', date: { ...ctx.state.date } });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('political front page', () => {
  afterEach(() => closeAllWindows());
  const shares = { workers: 0.5, oldmoney: 0.2, reformers: 0.1, church: 0.15, baron: 0.05 };
  const setup = () => {
    const ctx = testCtx(testState());
    const game = { state: ctx.state, ctx } as unknown as GameController;
    ctx.state.date = { year: 1912, month: 5, day: 10, hour: 0 };
    return { ctx, game };
  };

  it('mastheadFor changes name and class by era', () => {
    const m = [1900, 1925, 1950, 1975, 1999].map((y) => mastheadFor(y));
    expect(m[0].title).toBe('The Daily Smokestack');
    expect(new Set(m.slice(0, 4).map((x) => x.className)).size).toBe(4);
    expect(m[4]).toEqual(m[3]);
    expect(mastheadFor(1924)).toEqual(m[0]);
    expect(mastheadFor(1949)).toEqual(m[1]);
  });

  it('lead story is the latest politics item', () => {
    const { ctx, game } = setup();
    publishNews(ctx, 'historic', 'OLD HISTORY', 'x');
    publishNews(ctx, 'politics', 'MAYOR WINS', 'y');
    publishNews(ctx, 'random', 'LATER LOCAL', 'z');
    newspaperPanel.open(game);
    expect(document.querySelector('.paper .lead h2')?.textContent).toBe('MAYOR WINS');
  });

  it('lead goes to whichever of politics and historic is newer', () => {
    const { ctx, game } = setup();
    publishNews(ctx, 'politics', 'EARLIER POLITICS', 'y');
    publishNews(ctx, 'historic', 'LATER HISTORY', 'x');
    newspaperPanel.open(game);
    expect(document.querySelector('.paper .lead h2')?.textContent).toBe('LATER HISTORY');
    closeAllWindows();
    publishNews(ctx, 'politics', 'LATEST POLITICS', 'y');
    newspaperPanel.open(game);
    expect(document.querySelector('.paper .lead h2')?.textContent).toBe('LATEST POLITICS');
  });

  it('prints a Ballot Box with the last 3 elections and next 3 dates', () => {
    const state = createGame({ seed: 7 });
    const ctx = { state, bus: new EventBus() };
    const game = { state, ctx } as unknown as GameController;
    const c = state.cities[0];
    state.date = { year: 1912, month: 5, day: 10, hour: 0 };
    for (let i = 0; i < 4; i++) ctx.state.politics.elections.push({ cityId: c.id, year: 1900 + i, month: 3, winner: 'workers', shares });
    newspaperPanel.open(game);
    const box = document.querySelector('.paper .ballot-box')!;
    expect(box).toBeTruthy();
    expect(box.querySelectorAll('.ballot-past')).toHaveLength(3);
    expect(box.querySelector('.ballot-past')?.textContent).toContain('1903');
    expect(box.querySelectorAll('.ballot-next').length).toBeGreaterThan(0);
    expect(box.querySelectorAll('.ballot-next').length).toBeLessThanOrEqual(3);
  });

  it('ballot box on an old edition hides later elections and the upcoming list', () => {
    const state = createGame({ seed: 7 });
    const ctx = { state, bus: new EventBus() };
    const game = { state, ctx } as unknown as GameController;
    const id = state.cities[0].id;
    state.politics.elections.push({ cityId: id, year: 1901, month: 3, winner: 'workers', shares });
    state.politics.elections.push({ cityId: id, year: 1905, month: 3, winner: 'church', shares });
    state.date = { year: 1906, month: 2, day: 1, hour: 0 };
    publishNews(ctx, 'random', 'EARLY', 'x');
    state.date = { year: 1902, month: 6, day: 1, hour: 0 };
    publishNews(ctx, 'random', 'OLDER', 'x');
    state.date = { year: 1906, month: 2, day: 1, hour: 0 };
    newspaperPanel.open(game);
    document.querySelector<HTMLButtonElement>('.paper-nav button')!.click();
    const box = document.querySelector('.paper .ballot-box')!;
    expect(box.querySelectorAll('.ballot-past')).toHaveLength(1);
    expect(box.textContent).toContain('1901');
    expect(box.querySelector('.ballot-next')).toBeNull();
  });

  it('lists the Smogsworth Desk and Decisions of the Year', () => {
    const { ctx, game } = setup();
    publishNews(ctx, 'rival', 'SMOGSWORTH SNEERS', 'Ha.');
    const card = Object.values(CARDS_BY_ID)[0];
    ctx.state.politics.cards.history.push({ id: card.id, year: 1912, choice: 0 });
    ctx.state.politics.cards.history.push({ id: card.id, year: 1905, choice: 1 });
    newspaperPanel.open(game);
    expect(document.querySelector('.paper .smogsworth-desk')?.textContent).toContain('SMOGSWORTH SNEERS');
    const rows = document.querySelectorAll('.paper .decisions li');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain(card.title);
    expect(rows[0].textContent).toContain(card.choices[0].label);
  });
});
