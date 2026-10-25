import type { Result } from '../../core/result';
import './panels.css';
import type { GameController } from '../../game/controller';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, loanStep, maxLoan, monthProfit, repayLoan, repayStep, takeLoan } from '../../sim/finance';
import { inflationRate, priceIndex } from '../../sim/society/economy';
import { loanRate } from '../../sim/politics/mayorEdicts';
import { companyIds } from '../../sim/companies';
import { wealth } from '../../sim/state';
import type { Company, GameState, GoodId, LedgerCategory, LedgerMonth } from '../../sim/types';
import { GOODS } from '../../data/goods';
import { ICON_IDS } from '../../render/icons';
import { cssColor, lineChart } from '../charts';
import { h } from '../dom';
import { nowCard, progressiveDisclosure, type NowItem } from '../disclosure';
import { formatMoney } from '../format';
import { button, dataTable, deltaText, emptyState, meter, panelHeader, section, statRow, statTile, type Tone } from '../kit';
import { openMonth } from '../ledger';
import { iconEl } from '../icon';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import { swap } from './inspect';
import './finance.css';

const REFRESH_MS = 1000;
const STATEMENT_MONTHS = 12;
/** The cash chart waits for this many months of points: one or two points make no line worth reading. */
const CHART_MIN_MONTHS = 3;
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
  salaries: 'Manager salaries',
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

/** Income statement table: one column per month, the rows that had any money in them and a bold profit row. */
function statement(ledger: LedgerMonth[]): HTMLElement {
  const months = ledger.slice(-STATEMENT_MONTHS);
  if (months.length === 0) return h('p', { class: 'finance-empty' }, 'No history yet');
  const cell = (v: number) => h('td', { class: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }, v === 0 ? '–' : formatMoney(v));
  const row = (label: string, values: number[]) =>
    values.some((v) => v !== 0) ? h('tr', null, h('th', { scope: 'row' }, label), values.map(cell)) : null;
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
        CAPITAL_CATS.map((cat) => row(LABELS[cat], months.map((m) => (m.income[cat] ?? 0) - (m.expense[cat] ?? 0)))),
      ),
    ),
  );
}

/** The header line: is the open month making money, and if not, what costs most. */
function summaryOf(ledger: LedgerMonth[], date: GameState['date']): { summary: string; tone: Tone } {
  const open = openMonth(ledger, date);
  const net = open ? monthProfit(open) : 0;
  if (net >= 0.5) return { summary: `Profitable: ${formatMoney(net)} this month so far`, tone: 'positive' };
  if (net <= -0.5) {
    let top: { label: string; v: number } | undefined;
    for (const c of EXPENSE_CATS) {
      const v = open?.expense[c.cat] ?? 0;
      if (v > 0 && (!top || v > top.v)) top = { label: c.label, v };
    }
    const tail = top ? `: ${top.label} is your biggest cost` : '';
    return { summary: `Losing ${formatMoney(-net)} this month${tail}`, tone: 'negative' };
  }
  // nothing booked yet: a brand-new ledger, or a month that has only just begun
  const history = ledger.some((m) => m !== open);
  return { summary: history ? 'Breaking even this month so far' : 'A new ledger: your first month is under way', tone: 'neutral' };
}

/** 1–3 finance decisions for the Now card (E5). */
export function financeNow(state: GameState): NowItem[] {
  const player = state.companies.player;
  const head = summaryOf(player.ledger, state.date);
  const items: NowItem[] = [{ label: head.summary, tone: head.tone }];
  items.push({
    label: `Cash ${formatMoney(player.money)}`,
    detail: player.loan > 0 ? `Loan ${formatMoney(player.loan)} outstanding` : 'No loan',
    tone: player.money < 0 ? 'negative' : player.loan > 0 ? 'warning' : 'neutral',
  });
  const costs = yearCosts(player.ledger, state.date.year);
  if (costs[0]) {
    items.push({
      label: `Biggest cost: ${costs[0].label}`,
      detail: `${formatMoney(costs[0].value)} this year`,
      tone: 'neutral',
    });
  }
  return items.slice(0, 3);
}

/** This year's spending by category, nonzero only, largest first. */
function yearCosts(ledger: LedgerMonth[], year: number): { label: string; value: number }[] {
  const totals = new Map<LedgerCategory, number>();
  for (const m of ledger) {
    if (m.year !== year) continue;
    for (const c of EXPENSE_CATS) totals.set(c.cat, (totals.get(c.cat) ?? 0) + (m.expense[c.cat] ?? 0));
  }
  return EXPENSE_CATS.map((c) => ({ label: c.label, value: totals.get(c.cat) ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Horizontal bars (label, meter, value), scaled to the largest, with a total row. */
function bars(rows: { label: string; value: number; icon?: string }[], of: string): HTMLElement {
  const total = rows.reduce((t, r) => t + r.value, 0);
  const max = rows[0]?.value ?? 0;
  return h(
    'div',
    { class: 'finance-costs' },
    rows.map((r) => {
      const share = `${Math.round((r.value / total) * 100)}% of ${of}`;
      return h(
        'div',
        { class: 'finance-cost', title: `${r.label}: ${formatMoney(r.value)}, ${share}` },
        h('span', { class: 'finance-cost-label' }, r.icon ? iconEl(r.icon, 16) : null, h('span', { class: 'finance-cost-name' }, r.label)),
        meter(r.value, max, { label: `${r.label}: ${share}` }),
        h('span', { class: 'finance-cost-value' }, formatMoney(r.value)),
      );
    }),
    h(
      'div',
      { class: 'finance-cost-total' },
      h('span', { class: 'finance-cost-label' }, 'Total'),
      h('span'),
      h('span', { class: 'finance-cost-value' }, formatMoney(total)),
    ),
  );
}

/** This year's sales by good, nonzero only, largest first; goods with an atlas icon carry it. */
function yearSales(ledger: LedgerMonth[], year: number): { label: string; value: number; icon?: string }[] {
  const totals = new Map<string, number>();
  for (const m of ledger) {
    if (m.year !== year) continue;
    for (const [goodId, v] of Object.entries(m.salesByGood)) totals.set(goodId, (totals.get(goodId) ?? 0) + (v ?? 0));
  }
  return [...totals]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([goodId, value]) => ({
      label: GOODS[goodId as GoodId]?.name ?? goodId,
      value,
      icon: ICON_IDS.includes(goodId) ? goodId : undefined,
    }));
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
  interface Row { name: string; cash: number; net: number }
  const money = (v: number) => h('span', { class: v < 0 ? 'neg' : '' }, formatMoney(v));
  const rows: Row[] = companyIds(state).map((id) => {
    const c = state.companies[id];
    return { name: c.active ? c.name : `${c.name} (closed)`, cash: c.money, net: wealth(state, id) };
  });
  const table = dataTable<Row>({
    columns: [
      { key: 'name', label: 'Company', render: (r) => r.name, title: (r) => r.name },
      { key: 'cash', label: 'Cash', align: 'right', render: (r) => money(r.cash) },
      { key: 'net', label: 'Net worth', align: 'right', render: (r) => money(r.net) },
    ],
    rows,
    emptyText: 'No companies',
  });
  table.classList.add('finance-companies');
  table.querySelector('th[data-col="net"]')?.setAttribute('title', NET_WORTH_TITLE);
  return h('div', { class: 'finance-scroll' }, table);
}

const NET_WORTH_TITLE = 'Cash minus loans, plus works, vehicles and shares held';

/** Windows that already have a refresh timer running (so a second open just re-raises them). */
const timed = new WeakSet<HTMLElement>();

const labelOf = (btn: HTMLElement) => btn.querySelector('.kit-btn-label') as HTMLElement;

export const financePanel: PanelDef = {
  id: 'finance',
  open(game: GameController) {
    const headerBox = h('div', { class: 'finance-header' });
    const tilesBox = h('div', { class: 'finance-tiles' });
    const costsBox = h('div');
    const statementBox = h('div');
    const companiesBox = h('div');
    const emptyCharts = emptyState({
      title: 'Charts appear after three months',
      body: 'Cash and net worth are plotted at each month’s close.',
    });
    const cashCanvas = h('canvas', { class: 'finance-chart' }) as HTMLCanvasElement;
    const legend = h('div', { class: 'finance-legend' });
    const chartsBox = h('div', { class: 'finance-charts' }, cashCanvas, legend);
    const indexInfo = h('div', { class: 'finance-index-info' });
    const indexCanvas = h('canvas', { class: 'finance-chart finance-index-chart' }) as HTMLCanvasElement;

    const act = (fn: (c: Company) => Result) => {
      const res = fn(game.state.companies.player);
      if (!res.ok) game.ctx.bus.emit({ type: 'toast', message: res.error, tone: 'bad' });
      update();
    };
    // loans are scaled by the price index when taken; the balance owed stays nominal
    const borrow = () => act((c) => takeLoan(c, loanStep(priceIndex(game.state)), priceIndex(game.state)));
    const repay = () => act((c) => repayLoan(c, repayStep(c, priceIndex(game.state)) || loanStep(priceIndex(game.state)), priceIndex(game.state)));
    const borrowBtn = button('Borrow', { variant: 'secondary', onClick: borrow }) as HTMLButtonElement;
    const repayBtn = button('Repay', { variant: 'secondary', onClick: repay }) as HTMLButtonElement;

    const chartsSection = section('Cash and net worth', [emptyCharts, chartsBox]);
    chartsSection.classList.add('finance-charts-section');
    const salesBox = h('div');
    const salesSection = section('Sales by product (this year)', [salesBox], { collapsible: true, open: false });
    salesSection.classList.add('finance-sales');
    const statementSection = section('Income statement', [statementBox], { collapsible: true, open: false });
    statementSection.classList.add('finance-statement');
    const pricesSection = section('Prices', [indexInfo, indexCanvas], { collapsible: true, open: false });
    pricesSection.classList.add('finance-prices');
    // a closed section has no width to draw into: draw the sparkline when it is opened
    pricesSection.addEventListener('toggle', () => update());

    const full = h(
      'div',
      { class: 'finance-full' },
      chartsSection,
      salesSection,
      statementSection,
      section('Companies', [companiesBox]),
      pricesSection,
    );
    const disc = progressiveDisclosure({
      panelId: 'finance',
      expandLabel: 'Show full ledger',
      coachText: 'Cash, profit and costs sit up top. Open the full ledger for charts, the income statement and every company.',
      now: nowCard(financeNow(game.state)),
      full,
    });

    const body = h(
      'div',
      { class: 'finance' },
      headerBox,
      disc.el,
      tilesBox,
      section('Where the money goes', [costsBox]),
      // pinned to the foot of the panel so Borrow and Repay stay in reach while the charts scroll
      h('div', { class: 'p-actions' }, borrowBtn, repayBtn),
    );

    let timer = 0;
    const win = createWindow({
      id: 'finance',
      title: 'Finance ledger',
      tabTitle: 'Finance',
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
      const index = priceIndex(state);
      // the player's rate follows national Old Money opinion (sim/politics/mayorEdicts.ts)
      const rate = loanRate(state);

      // 1. Header: are we making money this month, and if not, what costs most.
      const head = summaryOf(player.ledger, state.date);
      swap(headerBox, `${head.tone}|${head.summary}`, () => panelHeader({ title: 'Finance', ...head }));
      disc.setNow(nowCard(financeNow(state)));

      // 2. Cash, this month's profit against last month's, net worth and the loan.
      const open = openMonth(player.ledger, state.date);
      const net = open ? monthProfit(open) : 0;
      const prev = [...player.ledger].reverse().find((m) => m !== open && monthKey(m) < monthKey(state.date));
      const prevNet = prev ? monthProfit(prev) : undefined;
      const worth = wealth(state, 'player');
      const interest = Math.round((player.loan * rate) / 12);
      const tiles = [player.money, net, prevNet ?? 'none', worth, player.loan, rate, interest, maxLoan(index)];
      swap(tilesBox, JSON.stringify(tiles), () => {
        const diff = prevNet === undefined ? undefined : net - prevNet;
        return statRow([
          statTile({ label: 'Cash', value: formatMoney(player.money), title: 'Money in hand' }),
          statTile({
            label: 'Profit',
            value: formatMoney(net),
            delta: diff === undefined || !prev ? undefined : `${deltaText(diff)} vs ${MONTHS[prev.month - 1]}`,
            tone: diff === undefined || Math.abs(diff) < 0.5 ? 'neutral' : diff > 0 ? 'positive' : 'negative',
            title: prevNet === undefined ? 'This month so far' : `This month so far; last month ${formatMoney(prevNet)}`,
          }),
          statTile({ label: 'Net worth', value: formatMoney(worth), title: NET_WORTH_TITLE }),
          statTile({
            label: 'Loan',
            value: formatMoney(player.loan),
            delta: `at ${(rate * 100).toFixed(1)}%`,
            tone: player.loan > 0 ? 'warning' : 'neutral',
            title: `Interest ${formatMoney(interest)} a month at ${(rate * 100).toFixed(1)}% a year, set by Old Money. Limit ${formatMoney(maxLoan(index))} at today's prices`,
          }),
        ]);
      });

      // 3. Where the money goes: this year's costs by category.
      const costs = yearCosts(player.ledger, state.date.year);
      swap(costsBox, JSON.stringify(costs), () =>
        costs.length > 0
          ? bars(costs, "this year's costs")
          : emptyState({ title: 'No costs yet this year', body: 'Construction, upkeep, vehicles and wages show here as they are paid.' }),
      );

      // 5. and 6. The statement and the companies (the sections themselves stay, so an open statement stays open).
      const shown = player.ledger.slice(-STATEMENT_MONTHS);
      swap(statementBox, JSON.stringify(shown.map((m) => [m.year, m.month, m.income, m.expense])), () => statement(player.ledger), '.finance-scroll');
      const firms = companyIds(state).map((id) => {
        const c = state.companies[id];
        // net worth moves with works, vehicles and shares too, not only cash and loan
        return [c.name, c.active, c.money, c.loan, wealth(state, id)];
      });
      swap(companiesBox, JSON.stringify(firms), () => companiesTable(state), '.finance-scroll');

      // Sales by product this year (closed by default; the section stays, so its open state does too).
      const sold = yearSales(player.ledger, state.date.year);
      swap(salesBox, JSON.stringify(sold), () =>
        sold.length > 0 ? bars(sold, "this year's sales") : emptyState({ title: 'No sales yet this year', body: 'Goods sold to towns and contracts show here.' }),
      );

      // 4. Cash and net worth: union of both companies' months (plus the open month), aligned on year/month.
      const keys = new Set<number>();
      for (const m of player.ledger) keys.add(monthKey(m));
      if (rivalActive) for (const m of rival.ledger) keys.add(monthKey(m));
      if (keys.size > 0) keys.add(monthKey(state.date));
      const sorted = [...keys].sort((a, b) => a - b);
      const hasHistory = sorted.length >= CHART_MIN_MONTHS;
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
        swap(legend, series.map((s) => s.label).join('|'), () =>
          h(
            'div',
            { class: 'finance-legend-items' },
            series.map((s) =>
              h(
                'span',
                { class: 'finance-legend-item' },
                h('span', { class: `finance-swatch${s.dashed ? ' dashed' : ''}`, style: { borderTopColor: s.color } }),
                s.label,
              ),
            ),
          ),
        );
      }

      // 7. Price index (society/economy.ts): today's level and the last ten years of month ends.
      const rateNow = inflationRate(state.date.year);
      const indexText = `Price index: ×${index.toFixed(2)} of 1900 prices (${rateNow >= 0 ? '+' : ''}${(rateNow * 100).toFixed(1)}% a year this decade)`;
      swap(indexInfo, indexText, () => h('p', null, indexText));
      const hist = state.economy.history;
      indexCanvas.hidden = hist.length < 2;
      if (hist.length >= 2 && (pricesSection as HTMLDetailsElement).open) {
        // history[i] is the index at the end of the month `hist.length - i` months before this one
        const now = monthKey(state.date);
        const histLabels = hist.map((_, i) => {
          const k = now - (hist.length - i);
          const year = Math.floor((k - 1) / 12);
          return monthLabel({ year, month: k - year * 12 });
        });
        lineChart(indexCanvas, [{ label: 'Price index', color: cssColor('--brass', '#c9a227'), values: hist }], histLabels, (v) => `×${v.toFixed(v < 10 ? 2 : 1)}`);
      }

      // 8. The loan buttons.
      labelOf(borrowBtn).textContent = `Borrow ${formatMoney(loanStep(index))}`;
      labelOf(repayBtn).textContent = `Repay ${formatMoney(repayStep(player, index) || loanStep(index))}`;
      repayBtn.disabled = player.loan <= 0;
      repayBtn.title = player.loan <= 0 ? 'No loan to repay' : '';
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
