import type { Result } from '../../core/result';
import './panels.css';
import type { GameController } from '../../game/controller';
import { GOODS } from '../../data/goods';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, loanStep, maxLoan, monthProfit, repayLoan, repayStep, takeLoan } from '../../sim/finance';
import { inflationRate, priceIndex } from '../../sim/society/economy';
import { loanRate } from '../../sim/politics/mayorEdicts';
import { companyIds } from '../../sim/companies';
import { wealth } from '../../sim/state';
import type { Company, GameState, LedgerCategory, LedgerMonth } from '../../sim/types';
import { barChart, cssColor, lineChart } from '../charts';
import { h } from '../dom';
import { formatMoney } from '../format';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './finance.css';

const REFRESH_MS = 1000;
const STATEMENT_MONTHS = 12;
const LABELS: Record<LedgerCategory, string> = {
  sales: 'Sales',
  contracts: 'Mayor’s contracts',
  events: 'Events',
  demolition: 'Demolition refunds',
  construction: 'Construction',
  maintenance: 'Maintenance',
  vehicles: 'Vehicles',
  interest: 'Interest',
  fines: 'Smoke fines',
  dividends: 'Dividends',
  shares: 'Share trades',
};
// rows come from the sim's category lists, so the statement and monthProfit cannot drift apart
const INCOME_CATS = INCOME_CATEGORIES.map((cat) => ({ cat, label: LABELS[cat] }));
// spending under 'events' is philanthropy and takeover deals, not windfalls: its own label on the expense side
const EXPENSE_LABELS: Partial<Record<LedgerCategory, string>> = { events: 'Gifts & deals' };
const EXPENSE_CATS = EXPENSE_CATEGORIES.map((cat) => ({ cat, label: EXPENSE_LABELS[cat] ?? LABELS[cat] }));
/** Capital flows shown under the profit line (net of both sides), only in months that had any. */
const CAPITAL_CATS: LedgerCategory[] = ['shares', 'dividends'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthKey = (m: { year: number; month: number }) => m.year * 12 + m.month;
const monthLabel = (m: { year: number; month: number }) => `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`;

/** Income statement table: one column per month, a row per category and a bold profit row. */
function statement(ledger: LedgerMonth[]): HTMLElement {
  const months = ledger.slice(-STATEMENT_MONTHS);
  if (months.length === 0) return h('p', { class: 'finance-empty' }, 'No history yet');
  const cell = (v: number) => h('td', { class: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }, v === 0 ? '–' : formatMoney(v));
  const row = (label: string, values: number[]) =>
    h('tr', null, h('th', { scope: 'row' }, label), values.map(cell));
  const profit = months.map(monthProfit);
  return h(
    'div',
    { class: 'finance-scroll' },
    h(
      'table',
      { class: 'finance-table' },
      h(
        'thead',
        null,
        h('tr', null, h('th', { scope: 'col' }, 'Ledger'), months.map((m) => h('th', { scope: 'col' }, monthLabel(m)))),
      ),
      h(
        'tbody',
        null,
        INCOME_CATS.map((c) => row(c.label, months.map((m) => m.income[c.cat] ?? 0))),
        EXPENSE_CATS.map((c) => row(c.label, months.map((m) => -(m.expense[c.cat] ?? 0)))),
        h(
          'tr',
          { class: 'finance-profit' },
          h('th', { scope: 'row' }, 'Profit'),
          profit.map((v) => h('td', { class: v < 0 ? 'neg' : 'pos' }, formatMoney(v))),
        ),
        // capital flows below the line: share trades and dividends never count as profit
        CAPITAL_CATS.filter((cat) => months.some((m) => (m.income[cat] ?? 0) !== 0 || (m.expense[cat] ?? 0) !== 0)).map((cat) =>
          row(LABELS[cat], months.map((m) => (m.income[cat] ?? 0) - (m.expense[cat] ?? 0)))),
      ),
    ),
  );
}

/**
 * Cash and net worth for one company in one ledger month. The month the game is currently in is
 * still open, so its stored values are zero until it closes; use the live figures for it instead.
 */
function monthValues(state: GameState, c: Company | undefined, key: number, m: LedgerMonth | undefined) {
  if (key === monthKey(state.date) && c) {
    return { cash: c.money, net: wealth(state, c.id) };
  }
  return { cash: m?.cashEnd ?? Number.NaN, net: m?.netWorthEnd ?? Number.NaN };
}

/** Every company (player, Baron, regional firms in companyIds order): name, cash and net worth today. */
export function companiesTable(state: GameState): HTMLElement {
  const money = (v: number) => h('td', { class: v < 0 ? 'neg' : '' }, formatMoney(v));
  return h(
    'div',
    { class: 'finance-scroll' },
    h(
      'table',
      { class: 'finance-table finance-companies' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Company'), h('th', { scope: 'col' }, 'Cash'), h('th', { scope: 'col', title: 'Cash minus loans, plus works, vehicles and shares held' }, 'Net worth'))),
      h(
        'tbody',
        null,
        companyIds(state).map((id) => {
          const c = state.companies[id];
          return h(
            'tr',
            null,
            h('th', { scope: 'row' }, c.active ? c.name : `${c.name} (closed)`),
            money(c.money),
            money(wealth(state, id)),
          );
        }),
      ),
    ),
  );
}

/** Windows that already have a refresh timer running (so a second open just re-raises them). */
const timed = new WeakSet<HTMLElement>();

/** One titled block of the ledger. */
function section(title: string, ...children: HTMLElement[]): HTMLElement {
  return h('section', { class: 'p-section' }, h('h3', { class: 'p-head' }, title), ...children);
}

export const financePanel: PanelDef = {
  id: 'finance',
  open(game: GameController) {
    const statementBox = h('div');
    const companiesBox = h('div');
    const emptyCharts = h('p', { class: 'finance-empty' }, 'No history yet');
    const cashCanvas = h('canvas', { class: 'finance-chart' }) as HTMLCanvasElement;
    const legend = h('div', { class: 'finance-legend' });
    const chartsBox = h('div', { class: 'finance-charts' }, cashCanvas, legend);
    const goodsCanvas = h('canvas', { class: 'finance-chart' }) as HTMLCanvasElement;
    const goodsEmpty = h('p', { class: 'finance-empty' }, 'No sales this year');
    const loanInfo = h('div', { class: 'finance-loan-info' });

    const act = (fn: (c: Company) => Result) => {
      const res = fn(game.state.companies.player);
      if (!res.ok) game.ctx.bus.emit({ type: 'toast', message: res.error, tone: 'bad' });
      update();
    };
    // loans are scaled by the price index when taken; the balance owed stays nominal
    const borrow = () => act((c) => takeLoan(c, loanStep(priceIndex(game.state)), priceIndex(game.state)));
    const repay = () => act((c) => repayLoan(c, repayStep(c, priceIndex(game.state)) || loanStep(priceIndex(game.state)), priceIndex(game.state)));
    const borrowBtn = h('button', { type: 'button', class: 'btn', onClick: borrow });
    const repayBtn = h('button', { type: 'button', class: 'btn', onClick: repay });
    const indexInfo = h('div', { class: 'finance-index-info' });
    const indexCanvas = h('canvas', { class: 'finance-chart finance-index-chart' }) as HTMLCanvasElement;

    const body = h(
      'div',
      { class: 'finance' },
      section('Income statement (last 12 months)', statementBox),
      section('Companies', companiesBox),
      section('Cash and net worth', emptyCharts, chartsBox),
      section('Sales this year', goodsEmpty, goodsCanvas),
      section('Prices', indexInfo, indexCanvas),
      section('Loans', h('div', { class: 'finance-loan' }, loanInfo)),
      // pinned to the foot of the panel so Borrow and Repay stay in reach while the charts scroll
      h('div', { class: 'p-actions finance-loan-buttons' }, borrowBtn, repayBtn),
    );

    let timer = 0;
    const win = createWindow({
      id: 'finance',
      title: 'Finance ledger',
      content: body,
      width: 640,
      onClose: () => clearInterval(timer),
    });
    // createWindow returns the already-open window for this id, so only start a timer for a new one.
    if (timed.has(win.el)) return;
    timed.add(win.el);

    function update(): void {
      const state = game.state;
      const player = state.companies.player;
      const rival = state.companies.rival;
      const rivalActive = Boolean(rival?.active);

      statementBox.replaceChildren(statement(player.ledger));
      companiesBox.replaceChildren(companiesTable(state));

      // Cash and net worth: union of both companies' months (plus the open month), aligned on year/month.
      const keys = new Set<number>();
      for (const m of player.ledger) keys.add(monthKey(m));
      if (rivalActive) for (const m of rival.ledger) keys.add(monthKey(m));
      if (keys.size > 0) keys.add(monthKey(state.date));
      const sorted = [...keys].sort((a, b) => a - b);
      const hasHistory = sorted.length > 0;
      emptyCharts.hidden = hasHistory;
      chartsBox.hidden = !hasHistory;
      if (hasHistory) {
        const byKey = (ledger: LedgerMonth[]) => new Map(ledger.map((m) => [monthKey(m), m]));
        const pm = byKey(player.ledger);
        const rm = byKey(rival?.ledger ?? []);
        const labels = sorted.map((k) => {
          const m = pm.get(k) ?? rm.get(k);
          if (m) return monthLabel(m);
          const year = Math.floor((k - 1) / 12);
          return monthLabel({ year, month: k - year * 12 });
        });
        const values = (c: Company | undefined, map: Map<number, LedgerMonth>, pick: 'cash' | 'net') =>
          sorted.map((k) => monthValues(state, c, k, map.get(k))[pick]);
        const blue = cssColor('--player', '#2f6fb5');
        const crimson = cssColor('--rival', '#b5302f');
        const series = [
          { label: 'Cash', color: blue, values: values(player, pm, 'cash') },
          { label: 'Net worth', color: blue, values: values(player, pm, 'net'), dashed: true },
        ];
        if (rivalActive) {
          series.push(
            { label: 'Rival cash', color: crimson, values: values(rival, rm, 'cash') },
            { label: 'Rival net worth', color: crimson, values: values(rival, rm, 'net'), dashed: true },
          );
        }
        lineChart(cashCanvas, series, labels);
        legend.replaceChildren(
          ...series.map((s) =>
            h(
              'span',
              { class: 'finance-legend-item' },
              h('span', { class: `finance-swatch${s.dashed ? ' dashed' : ''}`, style: { borderTopColor: s.color } }),
              s.label,
            ),
          ),
        );
      }

      // Sales by good, summed over the current year.
      const totals: Partial<Record<string, number>> = {};
      for (const m of player.ledger) {
        if (m.year !== state.date.year) continue;
        for (const [goodId, v] of Object.entries(m.salesByGood)) totals[goodId] = (totals[goodId] ?? 0) + (v ?? 0);
      }
      const bars = Object.entries(totals)
        .filter(([, v]) => (v ?? 0) > 0)
        .map(([goodId, v]) => {
          const def = GOODS[goodId];
          return { label: def?.name ?? goodId, value: v ?? 0, color: def?.color ?? '#888' };
        });
      goodsEmpty.hidden = bars.length > 0;
      goodsCanvas.hidden = bars.length === 0;
      if (bars.length > 0) barChart(goodsCanvas, bars);

      // Loans.
      // the player's rate follows national Old Money opinion (sim/politics/mayorEdicts.ts)
      const rate = loanRate(state);
      const interest = Math.round((player.loan * rate) / 12);
      const index = priceIndex(state);
      loanInfo.replaceChildren(
        h('p', null, `Current loan: ${formatMoney(player.loan)} (limit ${formatMoney(maxLoan(index))} at today's prices)`),
        h('p', null, `Monthly interest: ${formatMoney(interest)} (${(rate * 100).toFixed(1)}% a year, set by Old Money)`),
      );
      borrowBtn.textContent = `Borrow ${formatMoney(loanStep(index))}`;
      repayBtn.textContent = `Repay ${formatMoney(repayStep(player, index) || loanStep(index))}`;

      // Price index (society/economy.ts): today's level and the last ten years of month ends.
      const rateNow = inflationRate(state.date.year);
      indexInfo.replaceChildren(
        h('p', null, `Price index: ×${index.toFixed(2)} of 1900 prices (${rateNow >= 0 ? '+' : ''}${(rateNow * 100).toFixed(1)}% a year this decade)`),
      );
      const hist = state.economy.history;
      indexCanvas.hidden = hist.length < 2;
      if (hist.length >= 2) {
        // history[i] is the index at the end of the month `hist.length - i` months before this one
        const now = monthKey(state.date);
        const histLabels = hist.map((_, i) => {
          const k = now - (hist.length - i);
          const year = Math.floor((k - 1) / 12);
          return monthLabel({ year, month: k - year * 12 });
        });
        lineChart(indexCanvas, [{ label: 'Price index', color: cssColor('--brass', '#c9a227'), values: hist }], histLabels, (v) => `×${v.toFixed(v < 10 ? 2 : 1)}`);
      }
    }

    update();
    timer = window.setInterval(update, REFRESH_MS);
  },
};

// Dev-only: `?panel=finance` opens the window once the game is running (for visual checks).
if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('panel') === 'finance') {
  const openWhenReady = () => {
    const game = (window as unknown as { game?: GameController }).game;
    if (game) financePanel.open(game);
    else setTimeout(openWhenReady, 50);
  };
  setTimeout(openWhenReady, 0);
}
