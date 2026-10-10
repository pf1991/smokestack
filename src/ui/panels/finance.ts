import type { GameController } from '../../game/controller';
import { GOODS } from '../../data/goods';
import type { Result } from '../../core/result';
import { LOAN_RATE, LOAN_STEP, repayLoan, takeLoan } from '../../sim/finance';
import type { Company, LedgerCategory, LedgerMonth } from '../../sim/types';
import { barChart, cssColor, lineChart } from '../charts';
import { h } from '../dom';
import { formatMoney } from '../format';
import { createWindow } from '../window';
import type { PanelDef } from './index';

const REFRESH_MS = 1000;
const STATEMENT_MONTHS = 12;
const INCOME_CATS: { cat: LedgerCategory; label: string }[] = [
  { cat: 'sales', label: 'Sales' },
  { cat: 'contracts', label: 'Mayor’s contracts' },
  { cat: 'events', label: 'Events' },
  { cat: 'demolition', label: 'Demolition refunds' },
];
const EXPENSE_CATS: { cat: LedgerCategory; label: string }[] = [
  { cat: 'construction', label: 'Construction' },
  { cat: 'maintenance', label: 'Maintenance' },
  { cat: 'vehicles', label: 'Vehicles' },
  { cat: 'interest', label: 'Interest' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthKey = (m: { year: number; month: number }) => m.year * 12 + m.month;
const monthLabel = (m: { year: number; month: number }) => `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`;
const sumCats = (rec: Partial<Record<LedgerCategory, number>>, cats: { cat: LedgerCategory }[]) =>
  cats.reduce((s, c) => s + (rec[c.cat] ?? 0), 0);

/** Income statement table: one column per month, a row per category and a bold profit row. */
function statement(ledger: LedgerMonth[]): HTMLElement {
  const months = ledger.slice(-STATEMENT_MONTHS);
  if (months.length === 0) return h('p', { class: 'finance-empty' }, 'No history yet');
  const row = (label: string, values: number[], cls?: string) =>
    h(
      'tr',
      { class: cls },
      h('th', { scope: 'row' }, label),
      values.map((v) =>
        h('td', { class: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }, v === 0 ? '–' : formatMoney(v)),
      ),
    );
  const profit = months.map((m) => sumCats(m.income, INCOME_CATS) - sumCats(m.expense, EXPENSE_CATS));
  return h(
    'div',
    { class: 'finance-scroll' },
    h(
      'table',
      { class: 'finance-table' },
      h(
        'thead',
        null,
        h('tr', null, h('th', null, 'Ledger'), months.map((m) => h('th', { scope: 'col' }, monthLabel(m)))),
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
      ),
    ),
  );
}

/** Windows that already have a refresh timer running (so a second open just re-raises them). */
const timed = new WeakSet<HTMLElement>();

export const financePanel: PanelDef = {
  id: 'finance',
  open(game: GameController) {
    const statementBox = h('div');
    const emptyCharts = h('p', { class: 'finance-empty' }, 'No history yet');
    const cashCanvas = h('canvas', { class: 'finance-chart', height: 180 }) as HTMLCanvasElement;
    const goodsCanvas = h('canvas', { class: 'finance-chart', height: 180 }) as HTMLCanvasElement;
    const chartsBox = h('div', { class: 'finance-charts' }, cashCanvas, goodsCanvas);
    const goodsEmpty = h('p', { class: 'finance-empty' }, 'No sales this year');
    const loanInfo = h('div', { class: 'finance-loan-info' });

    const act = (fn: (c: Company) => Result) => {
      const res = fn(game.state.companies.player);
      if (!res.ok) game.ctx.bus.emit({ type: 'toast', message: res.error, tone: 'bad' });
      update();
    };
    const borrow = () => act((c) => takeLoan(c, LOAN_STEP));
    const repay = () => act((c) => repayLoan(c, LOAN_STEP));

    const body = h(
      'div',
      { class: 'finance' },
      h('h3', null, 'Income statement (last 12 months)'),
      statementBox,
      h('h3', null, 'Cash and net worth'),
      emptyCharts,
      chartsBox,
      h('h3', null, 'Sales this year'),
      goodsEmpty,
      h('p', { class: 'finance-note' }, 'Revenue by good, current year'),
      h('h3', null, 'Loans'),
      h(
        'div',
        { class: 'finance-loan' },
        loanInfo,
        h(
          'div',
          { class: 'finance-loan-buttons' },
          h('button', { type: 'button', onClick: borrow }, `Borrow ${formatMoney(LOAN_STEP)}`),
          h('button', { type: 'button', onClick: repay }, `Repay ${formatMoney(LOAN_STEP)}`),
        ),
      ),
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

      statementBox.replaceChildren(statement(player.ledger));

      // Cash and net worth: union of both companies' months, aligned on year/month.
      const rivalActive = Boolean(rival?.active);
      const keys = new Set<number>();
      for (const m of player.ledger) keys.add(monthKey(m));
      if (rivalActive) for (const m of rival.ledger) keys.add(monthKey(m));
      const sorted = [...keys].sort((a, b) => a - b);
      const hasHistory = sorted.length > 0;
      emptyCharts.hidden = hasHistory;
      chartsBox.hidden = !hasHistory;
      if (hasHistory) {
        const byKey = (ledger: LedgerMonth[]) => new Map(ledger.map((m) => [monthKey(m), m]));
        const pm = byKey(player.ledger);
        const rm = byKey(rival?.ledger ?? []);
        const pick = (map: Map<number, LedgerMonth>, f: (m: LedgerMonth) => number) =>
          sorted.map((k) => {
            const m = map.get(k);
            return m ? f(m) : Number.NaN;
          });
        const labels = sorted.map((k) => {
          const m = pm.get(k) ?? rm.get(k);
          return m ? monthLabel(m) : '';
        });
        const blue = cssColor('--player', '#2f6fb5');
        const crimson = cssColor('--rival', '#b5302f');
        const series = [
          { label: 'Cash', color: blue, values: pick(pm, (m) => m.cashEnd) },
          { label: 'Net worth', color: blue, values: pick(pm, (m) => m.netWorthEnd), dashed: true },
        ];
        if (rivalActive) {
          series.push(
            { label: 'Rival cash', color: crimson, values: pick(rm, (m) => m.cashEnd) },
            { label: 'Rival net worth', color: crimson, values: pick(rm, (m) => m.netWorthEnd), dashed: true },
          );
        }
        lineChart(cashCanvas, series, labels);
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
      const interest = Math.round((player.loan * LOAN_RATE) / 12);
      loanInfo.replaceChildren(
        h('p', null, `Current loan: ${formatMoney(player.loan)}`),
        h('p', null, `Monthly interest: ${formatMoney(interest)}`),
      );
    }

    update();
    timer = window.setInterval(update, REFRESH_MS);
  },
};
