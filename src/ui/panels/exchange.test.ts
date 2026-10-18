// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import type { GameController } from '../../game/controller';
import { buyShares, CONTROL_SHARES, holding, quote, sellQuote } from '../../sim/exchange/trading';
import { delist } from '../../sim/exchange/shares';
import { createGame } from '../../sim/state';
import { must } from '../../sim/testkit';
import type { SimContext } from '../../sim/types';
import { formatMoney } from '../format';
import { PANELS } from './index';

function game(ctx: SimContext) {
  const opened: string[] = [];
  return { ctx, state: ctx.state, renderer: { setSelection: () => {} }, openPanel: (id: string) => opened.push(id), opened } as unknown as GameController;
}

const panel = () => document.querySelector('.exchange-panel') as HTMLElement;
const row = (id: string) => panel().querySelector(`.exchange-row[data-company="${id}"]`) as HTMLElement;
const button = (id: string, action: string) => row(id).querySelector(`button[data-action="${action}"]`) as HTMLButtonElement;

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  document.body.replaceChildren();
});

function ctx(): SimContext {
  const state = createGame({ seed: 7, companyName: 'Acme Works', rival: true });
  state.companies.player.money = 1e8;
  state.companies.rival.money = 1e9;
  return { state, bus: new EventBus() };
}

describe('exchange panel', () => {
  it('is registered as PANELS.exchange', () => {
    expect(PANELS.exchange.id).toBe('exchange');
  });

  it('shows a row per listed company with its price, a sparkline and the holdings', () => {
    const c = ctx();
    const { state } = c;
    must(buyShares(c, 'player', 'rival', 30));
    state.exchange.listings.rival.history = [1, 2, 3];
    PANELS.exchange.open(game(c));
    const rows = [...panel().querySelectorAll<HTMLElement>('.exchange-row')].map((r) => r.dataset.company);
    expect(rows).toEqual(['player', 'rival']);
    const r = row('rival');
    expect(r.textContent).toContain(state.companies.rival.name);
    expect(r.querySelector('.exchange-price')!.textContent).toBe(formatMoney(state.exchange.listings.rival.price));
    expect(r.querySelector('canvas.exchange-spark')).not.toBeNull();
    const held = r.querySelector('.exchange-holdings')!.textContent!;
    expect(held).toContain('You 30');
    expect(held).toContain('Baron 400');
    expect(held).toContain('Public 570');
    // a delisted company has no row
    state.companies.rival.active = false;
    delist(state, 'rival');
    PANELS.exchange.open(game(c));
    expect([...panel().querySelectorAll<HTMLElement>('.exchange-row')].map((x) => x.dataset.company)).toEqual(['player']);
  });

  it('Buy and Sell 10/50 trade at the quote shown on the button', () => {
    const c = ctx();
    const { state } = c;
    PANELS.exchange.open(game(c));
    const q = quote(state, 'player', 'rival', 50).total;
    const b = button('rival', 'buy-50');
    expect(b.textContent).toContain(formatMoney(q));
    expect(button('rival', 'sell-10').disabled).toBe(true);
    const money = state.companies.player.money;
    b.click();
    expect(state.companies.player.money).toBe(money - q);
    expect(holding(state, 'player', 'rival')).toBe(50);
    expect(row('rival').querySelector('.exchange-holdings')!.textContent).toContain('You 50');
    const s = sellQuote(state, 'player', 'rival', 10).total;
    expect(button('rival', 'sell-10').disabled).toBe(false);
    expect(button('rival', 'sell-10').textContent).toContain(formatMoney(s));
    button('rival', 'sell-10').click();
    expect(holding(state, 'player', 'rival')).toBe(40);
    for (const a of ['buy-10', 'buy-50', 'sell-10', 'sell-50']) expect(button('player', a), a).not.toBeNull();
  });

  it('shows a red banner with a countdown while a bid is open, and buys back from it', () => {
    const c = ctx();
    const { state } = c;
    PANELS.exchange.open(game(c));
    expect(panel().querySelector('.exchange-bid')).toBeNull();
    must(buyShares(c, 'rival', 'player', CONTROL_SHARES + 10));
    // the panel follows the bid event
    const banner = panel().querySelector('.exchange-bid') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('6 months');
    expect(banner.textContent).toContain(`${CONTROL_SHARES + 10}`);
    state.date.month += 2;
    PANELS.exchange.open(game(c));
    expect(panel().querySelector('.exchange-bid')!.textContent).toContain('4 months');
    (panel().querySelector('.exchange-bid button') as HTMLButtonElement).click();
    expect(state.nemesis.bid).toBeNull();
    expect(panel().querySelector('.exchange-bid')).toBeNull();
  });
});
