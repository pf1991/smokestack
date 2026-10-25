// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import type { GameController } from '../../game/controller';
import { createGame, findPlacement, placeBuilding } from '../../sim/state';
import { must } from '../../sim/testkit';
import type { SimContext } from '../../sim/types';
import { buyPrice, tradePrice } from '../../sim/trade';
import { PANELS } from './index';
import { marketHeadline, marketNow } from './market';

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  document.body.replaceChildren();
});

function setup() {
  const state = createGame({ seed: 11, companyName: 'Acme Works', rival: true });
  state.companies.player.money = 1e8;
  const bus = new EventBus();
  const ctx: SimContext = { state, bus };
  const game = { ctx, state, renderer: { setSelection: () => {} }, openPanel: () => {} } as unknown as GameController;
  return { ctx, game, state };
}

describe('commodity market panel', () => {
  it('is registered and prompts for a depot when none exist', () => {
    const { game, state } = setup();
    expect(PANELS.market.id).toBe('market');
    expect(marketHeadline(state)).toMatch(/Warehouse or Trading House/);
    expect(marketNow(state).some((i) => i.tone === 'warning')).toBe(true);
    PANELS.market.open(game);
    expect(document.querySelector('.market-panel')!.textContent).toMatch(/No place to put the goods/);
  });

  it('lists bid/ask and buys steel into a warehouse', () => {
    const { ctx, game, state } = setup();
    const city = Object.values(state.cities)[0]!;
    const pos = findPlacement(state, 'player', 'warehouse', city.center, 40);
    expect(pos).not.toBeNull();
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', pos!));
    PANELS.market.open(game);
    const panel = document.querySelector('.market-panel')!;
    expect(panel.querySelector('.mkt-depot')).toBeTruthy();
    expect(panel.textContent).toContain('Steel');
    const ask = buyPrice(state, 'steel');
    const bid = tradePrice(state, 'steel');
    expect(ask).toBeGreaterThan(bid);
    const buy = document.querySelector<HTMLButtonElement>('[data-act="buy-steel-10"]')!;
    expect(buy.disabled).toBe(false);
    buy.click();
    expect(wh.input.steel).toBe(10);
    const sell = document.querySelector<HTMLButtonElement>('[data-act="sell-steel-10"]')!;
    expect(sell.disabled).toBe(false);
    sell.click();
    expect(wh.input.steel ?? 0).toBe(0);
  });
});
