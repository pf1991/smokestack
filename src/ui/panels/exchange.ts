/**
 * The Exchange window (Phase 4 Task 8, spec §7.3): a row per listed company with its share price, a
 * 12-month sparkline and who holds its shares (the player, the Baron, the public), and Buy/Sell 10/50
 * buttons that show the quote they trade at (sim/exchange/trading.ts). While the Baron's hostile bid
 * is open, a red banner counts down the grace months and offers the buy-back.
 *
 * The rows are rebuilt at each month end, on a bid event and after each trade; in between, a 1 s
 * timer refreshes the prices and quotes in place (so a click never lands on a replaced button).
 */
import type { GameController } from '../../game/controller';
import { companyIds } from '../../sim/companies';
import { buyBack, buyBackNeed, buyBackQuote, buyQuote, buyShares, holding, sellerFor, sellQuote, sellShares, takeoverRefusal } from '../../sim/exchange/trading';
import { CONTROL_SHARES, CONTROL_WEALTH_RATIO, PUBLIC_HOLDER } from '../../sim/exchange/types';
import { bidMonthsLeft, bidOpen } from '../../sim/nemesis/bid';
import type { GameState, OwnerId } from '../../sim/types';
import { sparkline } from '../charts';
import { h } from '../dom';
import './panels.css';
import { formatMoney } from '../format';
import { createWindow, type GameWindow } from '../window';
import type { PanelDef } from './index';

const REFRESH_MS = 1000;
const SPARK_MONTHS = 12;
const LOTS = [10, 50] as const;
const COLORS: Record<string, string> = { player: '#8fb6e6', rival: '#e88a86' };
const FIRM_COLOR = '#d9b45a';

type Action = `${'buy' | 'sell'}-${(typeof LOTS)[number]}`;

interface Live {
  update(): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The player's trade `action` on `id`: its label (with the quote), whether it can go through now and,
 * when the takeover gate blocks it, why (shown as the button's tooltip).
 */
function actionState(state: GameState, id: OwnerId, action: Action): { label: string; enabled: boolean; reason?: string } {
  const [side, lot] = action.split('-') as ['buy' | 'sell', string];
  const n = Number(lot);
  if (side === 'buy') {
    // during a bid the player's own shares come from the Baron, at the buy-back price
    const q = buyQuote(state, 'player', id, n);
    const offer = holding(state, sellerFor(state, 'player', id), id);
    const gate = takeoverRefusal(state, 'player', id, n);
    // the lot that takes control of the Baron shows its control premium in the price
    const label = q.premium > 0 ? `Buy ${n} · ${formatMoney(q.total)} incl. ${formatMoney(q.premium)} control premium` : `Buy ${n} · ${formatMoney(q.total)}`;
    const premiumNote = q.premium > 0 ? `Taking control costs a premium of ${formatMoney(q.premium)} on top of the shares' ${formatMoney(q.total - q.premium)}` : undefined;
    if (gate) return { label, enabled: false, reason: premiumNote ? `${gate}. ${premiumNote}` : gate };
    return { label, enabled: offer >= n && state.companies.player.money >= q.total, reason: premiumNote };
  }
  const q = sellQuote(state, 'player', id, n);
  return { label: `Sell ${n} · ${formatMoney(q.total)}`, enabled: holding(state, 'player', id) >= n };
}

function holdingsText(state: GameState, id: OwnerId): string {
  const you = holding(state, 'player', id);
  const baron = holding(state, 'rival', id);
  const own = id === 'player' || id === 'rival' ? 0 : holding(state, id, id);
  const pub = holding(state, PUBLIC_HOLDER, id);
  const parts = [`You ${you}`, `Baron ${baron}`];
  if (own > 0) parts.push(`Firm ${own}`);
  parts.push(`Public ${pub}`);
  return parts.join(' · ');
}

function bidBanner(game: GameController, rerender: () => void): HTMLElement | null {
  const { state } = game.ctx;
  if (!bidOpen(state)) return null;
  const months = bidMonthsLeft(state);
  const need = buyBackNeed(state);
  const q = buyBackQuote(state, need);
  const his = holding(state, 'rival', 'player');
  const btn = h('button', {
    class: 'btn',
    type: 'button',
    onClick: () => {
      const r = buyBack(game.ctx);
      game.ctx.bus.emit(r.ok
        ? { type: 'toast', message: 'Bid repelled: your shares are your own again', tone: 'good' }
        : { type: 'toast', message: r.error, tone: 'bad' });
      rerender();
    },
  }, `Buy back ${need} · ${formatMoney(q.total)}`);
  return h('div', { class: 'p-section exchange-bid', role: 'alert' },
  h('div', { class: 'exchange-bid-title' }, `Hostile bid: ${plural(months, 'month')} left`),
  h('div', { class: 'exchange-bid-text' },
    `Smogsworth holds ${his} of your shares (${CONTROL_SHARES} is control). Buy back ${need} from him at the fair price of ${formatMoney(q.price)} a share before the deadline, or lose the company. A loan covers any shortfall.`),
  btn);
}

function render(game: GameController, rerender: () => void): { el: HTMLElement; live: Live } {
  const { state } = game.ctx;
  const updates: (() => void)[] = [];
  const rows: HTMLElement[] = [];
  for (const id of companyIds(state)) {
    const l = state.exchange.listings[id];
    const c = state.companies[id];
    if (!l?.listed || !c?.active) continue;
    const color = COLORS[id] ?? FIRM_COLOR;
    const price = h('span', { class: 'exchange-price' }, formatMoney(l.price));
    const canvas = h('canvas', { class: 'exchange-spark', width: 120, height: 28, style: { width: '120px', height: '28px' }, 'aria-label': `${c.name} share price, last ${SPARK_MONTHS} months` }) as HTMLCanvasElement;
    const held = h('div', { class: 'exchange-holdings' }, holdingsText(state, id));
    const buttons = h('div', { class: 'exchange-buttons' });
    // the Baron's row says why a Buy that would take control is greyed (the takeover gate)
    const gateText = (): string => {
      for (const lot of LOTS) {
        const why = takeoverRefusal(game.ctx.state, 'player', id, lot);
        if (why) return why;
      }
      return '';
    };
    const gateNote = h('div', { class: 'exchange-gate', style: { display: gateText() ? '' : 'none' } }, gateText());
    updates.push(() => {
      const text = gateText();
      if (gateNote.textContent !== text) gateNote.textContent = text;
      gateNote.style.display = text ? '' : 'none';
    });
    const trade = (action: Action) => {
      const [side, lot] = action.split('-');
      const n = Number(lot);
      const r = side === 'buy' ? buyShares(game.ctx, 'player', id, n) : sellShares(game.ctx, 'player', id, n);
      if (!r.ok) game.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      else if (!game.ctx.state.companies[id].active) game.ctx.bus.emit({ type: 'toast', message: `${c.name} is yours`, tone: 'good' });
      rerender();
    };
    for (const side of ['buy', 'sell'] as const) {
      for (const lot of LOTS) {
        const action: Action = `${side}-${lot}`;
        const s = actionState(state, id, action);
        const b = h('button', { class: 'btn', type: 'button', 'data-action': action, disabled: !s.enabled, title: s.reason ?? undefined, onClick: () => trade(action) }, s.label) as HTMLButtonElement;
        buttons.appendChild(b);
        updates.push(() => {
          const now = actionState(game.ctx.state, id, action);
          if (b.textContent !== now.label) b.textContent = now.label;
          b.disabled = !now.enabled;
          if (now.reason) b.title = now.reason;
          else b.removeAttribute('title');
        });
      }
    }
    updates.push(() => {
      const text = formatMoney(game.ctx.state.exchange.listings[id].price);
      if (price.textContent !== text) price.textContent = text;
    });
    rows.push(h('div', { class: 'exchange-row', 'data-company': id },
    h('div', { class: 'p-row' },
      h('span', { class: 'exchange-name', style: { color } }, c.name),
      h('span', { class: 'exchange-quote' }, canvas, price)),
    held,
    buttons,
    gateNote));
    // the month-end prices, then today's
    const spark = [...l.history.slice(-SPARK_MONTHS), l.price];
    // drawn once the canvas is laid out (jsdom has no 2D context: sparkline then draws nothing)
    queueMicrotask(() => {
      try {
        sparkline(canvas, spark, color);
      } catch {
        // no canvas support: the figure is enough
      }
    });
  }
  const el = h('div', { class: 'exchange-panel' },
    bidBanner(game, rerender),
    h('div', { class: 'p-section' },
      h('div', { class: 'p-head' }, 'Listed companies'),
      ...rows),
    h('div', { class: 'p-section exchange-note' },
      `Shares trade in lots of 10; each 50 bought moves the price 2%, and the broker takes 1%. ${CONTROL_SHARES} of a company's 1,000 shares takes it over; to take control of Smogsworth you need ${CONTROL_WEALTH_RATIO}× his wealth, and the lot that takes it costs a control premium as large again as 510 of its shares.`));
  return { el, live: { update: () => updates.forEach((u) => u()) } };
}

let win: GameWindow | null = null;
let live: Live | null = null;

export const exchangePanel: PanelDef = {
  id: 'exchange',
  open(game) {
    const rerender = (): void => {
      if (!win) return;
      const r = render(game, rerender);
      live = r.live;
      win.setContent(r.el);
    };
    if (win) {
      rerender();
      return;
    }
    const first = render(game, rerender);
    live = first.live;
    const offs: (() => void)[] = [];
    const timer = window.setInterval(() => live?.update(), REFRESH_MS);
    win = createWindow({
      id: 'exchange',
      title: 'The Exchange',
      width: 420,
      content: first.el,
      onClose: () => {
        window.clearInterval(timer);
        for (const off of offs) off();
        win = null;
        live = null;
      },
    });
    offs.push(game.ctx.bus.on('monthEnd', rerender), game.ctx.bus.on('hostileBid', rerender));
  },
};
