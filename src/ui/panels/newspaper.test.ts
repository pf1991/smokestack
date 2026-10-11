// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { GameController } from '../../game/controller';
import { publishNews } from '../../sim/news';
import { testCtx, testState } from '../../sim/testkit';
import { closeAllWindows } from '../window';
import { newspaperPanel } from './newspaper';

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
