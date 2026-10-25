/**
 * Live national commodity board: bid (sell) and ask (buy) for every material and component, into a
 * chosen Trading House or Warehouse (sim/trade.ts).
 */
import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import type { GameController } from '../../game/controller';
import { BUY_PREMIUM, TRADE_GOODS, buyFromMarket, buyPrice, marketDepots, sellToMarket, tradePrice } from '../../sim/trade';
import type { Building, GameState, GoodId } from '../../sim/types';
import { h } from '../dom';
import { nowCard, progressiveDisclosure, type NowItem } from '../disclosure';
import { formatMoney, formatNumber } from '../format';
import { iconEl } from '../icon';
import { button, dataTable, emptyState, panelHeader, section } from '../kit';
import { createWindow, type GameWindow } from '../window';
import type { PanelDef } from './index';
import './panels.css';
import './market.css';

const REFRESH_MS = 1000;
const LOTS = [1, 10] as const;

interface Row {
  goodId: GoodId;
  bid: number;
  ask: number;
  stock: number;
  factor: number;
}

export function marketHeadline(state: GameState): string {
  const depots = marketDepots(state);
  if (depots.length === 0) return 'Build a Warehouse or Trading House to trade';
  let hottest: { id: GoodId; factor: number } | null = null;
  for (const g of TRADE_GOODS) {
    const f = state.trade.factor[g] ?? 1;
    if (!hottest || Math.abs(f - 1) > Math.abs(hottest.factor - 1)) hottest = { id: g, factor: f };
  }
  if (!hottest || Math.abs(hottest.factor - 1) < 0.05) {
    return `${depots.length} depot${depots.length === 1 ? '' : 's'} · market steady`;
  }
  const dir = hottest.factor > 1 ? 'firm' : 'soft';
  return `${GOODS[hottest.id].name} is ${dir} · ask ${formatMoney(buyPrice(state, hottest.id))}`;
}

export function marketNow(state: GameState): NowItem[] {
  const items: NowItem[] = [{ label: marketHeadline(state), tone: 'info' }];
  const depots = marketDepots(state);
  if (depots.length === 0) {
    items.push({
      label: 'No depot yet',
      detail: 'A Warehouse stores anything; a Trading House also auto-sells overnight',
      tone: 'warning',
    });
  } else {
    items.push({
      label: `Spread ${Math.round((BUY_PREMIUM - 1) * 100)}% ask over bid`,
      detail: 'Buy to feed works; sell stock from the depot below',
      tone: 'neutral',
    });
  }
  return items.slice(0, 3);
}

function depotLabel(b: Building): string {
  return `${BUILDINGS[b.typeId]?.name ?? 'Depot'} #${b.id}`;
}

function rowsFor(state: GameState, depot: Building | null): Row[] {
  return TRADE_GOODS.map((goodId) => ({
    goodId,
    bid: tradePrice(state, goodId),
    ask: buyPrice(state, goodId),
    stock: depot ? Math.floor(depot.input[goodId] ?? 0) : 0,
    factor: state.trade.factor[goodId] ?? 1,
  }));
}

function trend(r: Row): HTMLElement {
  const arrow = r.factor > 1.05 ? '▲' : r.factor < 0.95 ? '▼' : '·';
  const tone = r.factor > 1.05 ? 'mkt-up' : r.factor < 0.95 ? 'mkt-down' : 'mkt-flat';
  return h('span', { class: `mkt-trend ${tone}`, title: 'Drift vs the usual national price' }, arrow);
}

function board(
  game: GameController,
  depotId: number | null,
  setDepot: (id: number) => void,
  refresh: () => void,
): HTMLElement {
  const { state } = game.ctx;
  const depots = marketDepots(state);
  if (depots.length === 0) {
    return emptyState({
      icon: 'crate',
      title: 'No place to put the goods',
      body: 'Build a Warehouse (stores anything, feeds works by hub truck) or a Trading House (also sells overnight).',
    });
  }
  const depot = depots.find((b) => b.id === depotId) ?? depots[0]!;

  const sel = h(
    'select',
    {
      class: 'mkt-depot',
      'aria-label': 'Depot',
      onChange: () => setDepot(Number((sel as HTMLSelectElement).value)),
    },
    ...depots.map((b) => h('option', { value: String(b.id), selected: b.id === depot.id }, depotLabel(b))),
  ) as HTMLSelectElement;

  const money = state.companies.player.money;
  const table = dataTable<Row>({
    rowKey: (r) => r.goodId,
    emptyText: 'No goods on the board',
    rows: rowsFor(state, depot),
    columns: [
      {
        key: 'good',
        label: 'Good',
        render: (r) => h('span', { class: 'mkt-good' }, iconEl(r.goodId, 16), h('span', null, GOODS[r.goodId].name)),
      },
      { key: 'stock', label: 'Stock', align: 'right', render: (r) => formatNumber(r.stock) },
      {
        key: 'bid',
        label: 'Bid',
        align: 'right',
        title: () => 'What the nation pays when you sell',
        render: (r) => formatMoney(r.bid),
      },
      {
        key: 'ask',
        label: 'Ask',
        align: 'right',
        title: () => 'What you pay to import',
        render: (r) => formatMoney(r.ask),
      },
      { key: 'trend', label: '', align: 'right', render: trend },
      {
        key: 'acts',
        label: '',
        align: 'right',
        render: (r) => {
          const acts = h('span', { class: 'mkt-acts' });
          for (const n of LOTS) {
            const buyBtn = button(`Buy ${n}`, {
              variant: 'secondary',
              title: `Import ${n} into ${depotLabel(depot)} for ${formatMoney(r.ask * n)}`,
              disabled: money < r.ask || r.ask <= 0,
              onClick: () => {
                const res = buyFromMarket(game.ctx, depot.id, r.goodId, n);
                if (!res.ok) game.ctx.bus.emit({ type: 'toast', message: res.error, tone: 'bad' });
                refresh();
              },
            });
            buyBtn.dataset.act = `buy-${r.goodId}-${n}`;
            acts.appendChild(buyBtn);
            const sellBtn = button(`Sell ${n}`, {
              variant: 'quiet',
              title: `Sell ${n} from ${depotLabel(depot)} for ${formatMoney(r.bid * n)}`,
              disabled: r.stock < n || r.bid <= 0,
              onClick: () => {
                const res = sellToMarket(game.ctx, depot.id, r.goodId, n);
                if (!res.ok) game.ctx.bus.emit({ type: 'toast', message: res.error, tone: 'bad' });
                refresh();
              },
            });
            sellBtn.dataset.act = `sell-${r.goodId}-${n}`;
            acts.appendChild(sellBtn);
          }
          return acts;
        },
      },
    ],
  });
  table.classList.add('mkt-table');

  return h(
    'div',
    { class: 'mkt-board' },
    h(
      'div',
      { class: 'mkt-toolbar' },
      h('label', { class: 'mkt-depot-label' }, 'Depot', sel),
      h('span', { class: 'mkt-hint' }, 'Bid = sell · Ask = buy · warehouses store any good'),
    ),
    table,
  );
}

function render(game: GameController, depotId: number | null, setDepot: (id: number) => void, refresh: () => void): HTMLElement {
  const state = game.ctx.state;
  const full = h(
    'div',
    { class: 'mkt-full' },
    section('Board', [board(game, depotId, setDepot, refresh)]),
    section('How the market works', [
      h(
        'p',
        { class: 'mkt-note' },
        `Materials and components trade on a national board. Bid is what you get when you sell; ask is bid × ${BUY_PREMIUM} when you buy. Route goods to a Trading House to auto-sell each day, or trade live here into any Warehouse or Trading House.`,
      ),
    ]),
  );
  const disc = progressiveDisclosure({
    panelId: 'market',
    expandLabel: 'Show full Market',
    coachText: 'Buy materials you lack, sell surplus from a depot. The Exchange is for company shares; this board is for goods.',
    now: nowCard(marketNow(state)),
    full,
  });
  return h(
    'div',
    { class: 'market-panel' },
    h('div', { class: 'mkt-header' }, panelHeader({ title: 'Commodity Market', summary: marketHeadline(state), icon: 'crate' })),
    disc.el,
  );
}

let win: GameWindow | null = null;
let depotId: number | null = null;

export const marketPanel: PanelDef = {
  id: 'market',
  open(game) {
    const refresh = (): void => {
      if (!win) return;
      win.setContent(render(game, depotId, (id) => {
        depotId = id;
        refresh();
      }, refresh));
    };
    if (win) {
      refresh();
      return;
    }
    const timer = window.setInterval(refresh, REFRESH_MS);
    win = createWindow({
      id: 'market',
      title: 'Commodity Market',
      tabTitle: 'Market',
      width: 780,
      content: render(game, depotId, (id) => {
        depotId = id;
        refresh();
      }, refresh),
      onClose: () => {
        window.clearInterval(timer);
        win = null;
      },
    });
  },
};
