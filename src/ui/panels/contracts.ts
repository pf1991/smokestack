import type { GameController } from '../../game/controller';
import './panels.css';
import { GOODS } from '../../data/goods';
import { addDays, dateToDays, formatDate } from '../../sim/clock';
import { acceptContract, isComponentContract } from '../../sim/contracts';
import type { Contract, GameState } from '../../sim/types';
import { h } from '../dom';
import { iconEl } from '../icon';
import { formatMoney, formatNumber } from '../format';
import { button, card, dataTable, emptyState, meter, panelHeader, pill, section, type Tone } from '../kit';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './contracts.css';

function daysLeft(state: GameState, c: Contract): number {
  return dateToDays(c.deadline) - dateToDays(state.date);
}

/** "3 open contracts": notices on the board plus contracts being delivered. */
export function contractsHeadline(state: GameState): string {
  const n = state.contracts.filter((c) => c.status === 'offered' || c.status === 'active').length;
  return `${n} open ${n === 1 ? 'contract' : 'contracts'}`;
}

const goodName = (c: Contract) => GOODS[c.goodId]?.name ?? c.goodId;
const townName = (state: GameState, c: Contract) => state.cities[c.cityId]?.name ?? 'Unknown town';

function line(label: string, value: string | HTMLElement, cls = ''): HTMLElement {
  return h('div', { class: `cb-line ${cls}`.trim() }, h('span', { class: 'cb-label' }, label), h('span', { class: 'cb-value' }, value));
}

function contractCard(game: GameController, c: Contract, rerender: () => void): HTMLElement {
  const state = game.state;
  const body: HTMLElement[] = [line('For', townName(state, c)), line('Reward', h('span', { class: 'cb-reward' }, `${formatMoney(c.reward)} + 5% growth`))];
  // a component contract is national: any Trading House sale of the good counts (sim/contracts.ts onTradeSale)
  const component = isComponentContract(c);
  if (component) body.push(h('div', { class: 'cb-line cb-trade' }, iconEl('money', 14), h('span', null, 'Sell through a Trading House')));
  const actions: HTMLElement[] = [];
  let tone: Tone = 'neutral';
  if (c.status === 'offered') {
    body.push(line('Due', formatDate(c.deadline)));
    const accept = button('Accept', {
      variant: 'secondary',
      title: component
        ? `Sell ${formatNumber(c.qty)} ${goodName(c)} through any Trading House by ${formatDate(c.deadline)}`
        : `Deliver ${formatNumber(c.qty)} ${goodName(c)} to ${townName(state, c)} by ${formatDate(c.deadline)}`,
      onClick: () => {
        const r = acceptContract(game.ctx, c.id);
        if (!r.ok) game.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
        rerender();
      },
    });
    accept.classList.add('cb-btn');
    accept.dataset.act = 'accept';
    actions.push(accept);
    tone = 'info';
  } else {
    const d = daysLeft(state, c);
    tone = d < 0 ? 'negative' : d <= 30 ? 'warning' : 'neutral';
    const label = `${formatNumber(c.delivered)} of ${formatNumber(c.qty)} ${component ? 'sold' : 'delivered'}`;
    body.push(h('div', { class: 'cb-progress' }, meter(c.delivered, Math.max(1, c.qty), { label, tone: d < 0 ? 'negative' : 'positive' }), h('span', { class: 'cb-progress-text' }, label)));
    body.push(line('Time', d >= 0 ? `${d} ${d === 1 ? 'day' : 'days'} left` : 'Overdue', d < 0 ? 'cb-overdue' : ''));
  }
  const el = card({ title: `${formatNumber(c.qty)} ${goodName(c)}`, children: body, actions, tone });
  el.classList.add('cb-card', c.status);
  el.dataset.contract = String(c.id);
  el.querySelector('.kit-card-title')?.prepend(iconEl(c.goodId, 16, goodName(c)), ' ');
  return el;
}

function resultsTable(state: GameState, list: Contract[]): HTMLElement {
  const t = dataTable<Contract>({
    columns: [
      { key: 'good', label: 'Contract', render: (c) => h('span', { class: 'cb-good' }, iconEl(c.goodId, 16), ` ${formatNumber(c.qty)} ${goodName(c)}`), title: (c) => `${formatNumber(c.qty)} ${goodName(c)}` },
      { key: 'town', label: 'Town', render: (c) => townName(state, c), title: (c) => townName(state, c) },
      { key: 'result', label: 'Result', render: (c) => (c.status === 'done' ? pill('Delivered', 'positive') : pill('Failed', 'negative')) },
      { key: 'reward', label: 'Reward', align: 'right', render: (c) => formatMoney(c.reward) },
    ],
    rows: list,
    rowKey: (c) => String(c.id),
    emptyText: '',
  });
  t.classList.add('cb-results');
  return t;
}

function none(title: string, body: string): HTMLElement {
  const el = emptyState({ title, body });
  el.classList.add('cb-empty', 'p-empty-sm');
  return el;
}

export function buildBoard(game: GameController, rerender: () => void): HTMLElement {
  const state = game.state;
  const cs = state.contracts;
  const offered = cs.filter((c) => c.status === 'offered');
  const active = cs.filter((c) => c.status === 'active');
  const results = cs.filter((c) => c.status === 'done' || c.status === 'failed').slice(-6).reverse();
  const cards = (list: Contract[]) => h('div', { class: 'cb-grid' }, list.map((c) => contractCard(game, c, rerender)));
  return h(
    'div',
    { class: 'contracts-panel' },
    h('div', { class: 'contracts-header' }, panelHeader({ title: 'Contracts', summary: contractsHeadline(state), tone: offered.length > 0 ? 'info' : 'neutral' })),
    section('Wanted', [offered.length ? cards(offered) : none('No notices pinned', 'Mayors post every other month.')]),
    section('In progress', [active.length ? cards(active) : none('Nothing in progress', 'Accept a notice to start delivering.')]),
    section('Recent results', [results.length ? resultsTable(state, results) : none('No results yet', 'Delivered and failed contracts are listed here.')]),
  );
}

export const contractsPanel: PanelDef = {
  id: 'contracts',
  open(game) {
    const offs: (() => void)[] = [];
    let win: ReturnType<typeof createWindow> | null = null;
    const rerender = () => win?.setContent(buildBoard(game, rerender));
    win = createWindow({
      id: 'contracts',
      title: "Mayor's Contracts",
      tabTitle: 'Contracts',
      content: buildBoard(game, rerender),
      onClose: () => offs.forEach((f) => f()),
    });
    offs.push(game.ctx.bus.on('contract', rerender), game.ctx.bus.on('dayStart', rerender));
  },
};

// Dev screenshot hook: ?contracts=1 seeds a few notices and opens the panel.
if (import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('contracts') === '1') {
  const t = setInterval(() => {
    const game = (window as unknown as { game?: GameController }).game;
    if (!game?.ctx) return;
    clearInterval(t);
    const s = game.state;
    const mk = (cityId: number, goodId: string, qty: number, status: Contract['status'], delivered: number, days: number): Contract => ({
      id: s.nextId++, cityId, goodId, qty, delivered, status, deadline: addDays(s.date, days),
      reward: Math.round(qty * GOODS[goodId].basePrice * 1.5),
    });
    s.contracts.push(
      mk(0, 'bread', 90, 'offered', 0, 110), mk(1, 'tools', 20, 'offered', 0, 95), mk(2, 'clothes', 30, 'offered', 0, 80),
      mk(0, 'cheese', 60, 'active', 41, 64), mk(1, 'furniture', 25, 'active', 6, 22),
      mk(2, 'toys', 40, 'done', 40, 0), mk(3, 'juice', 50, 'failed', 12, -3),
    );
    game.openPanel('contracts');
  }, 200);
}
