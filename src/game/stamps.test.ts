// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { testCtx } from '../sim/testkit';
import { clearStamps, showStamp } from '../ui/juice';
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

describe('clearStamps', () => {
  it('removes stamps still on screen (game teardown), under #ui or the body fallback', () => {
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.appendChild(ui);
    showStamp('Tycoon', 'good');
    ui.remove();
    showStamp('Bankrupt', 'bad');
    expect(document.querySelectorAll('.stamp').length).toBe(1);
    document.body.appendChild(ui);
    expect(document.querySelectorAll('.stamp').length).toBe(2);
    clearStamps();
    expect(document.querySelectorAll('.stamp').length).toBe(0);
    ui.remove();
  });
});
