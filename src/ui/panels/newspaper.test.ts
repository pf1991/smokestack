// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import type { GameController } from '../../game/controller';
import { publishNews } from '../../sim/news';
import { stepTick } from '../../sim/simulation';
import { createGame } from '../../sim/state';
import { testCtx, testState } from '../../sim/testkit';
import { closeAllWindows } from '../window';
import { attachNewspaper, newspaperPanel } from './newspaper';

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
