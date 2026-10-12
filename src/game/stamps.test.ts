// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { testCtx } from '../sim/testkit';
import { attachMilestoneStamps } from './feedback';

describe('milestone stamps', () => {
  it('stamps once per upward crossing and on achievements', () => {
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.appendChild(ui);
    const ctx = testCtx();
    ctx.state.companies.player.money = 90_000;
    attachMilestoneStamps(ctx);
    const day = () => ctx.bus.emit({ type: 'dayStart', date: { ...ctx.state.date } });
    day();
    expect(ui.querySelectorAll('.stamp').length).toBe(0);
    ctx.state.companies.player.money = 120_000;
    day();
    day();
    expect(ui.querySelectorAll('.stamp').length).toBe(1);
    ctx.bus.emit({ type: 'achievement', id: 'first_sale' });
    expect(ui.querySelectorAll('.stamp').length).toBe(2);
    expect(ui.lastElementChild?.textContent).toBe('First Sale');
    ui.remove();
  });
});
