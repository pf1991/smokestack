// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { addCompany } from '../../sim/companies';
import { placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import type { GameState, LedgerMonth } from '../../sim/types';
import { closeAllWindows } from '../window';
import { companiesTable, financePanel } from './finance';

describe('finance companies table', () => {
  it('lists every company in companyIds order with cash and net worth, marking closed ones', () => {
    const s = testState();
    addCompany(s, { id: 'regional_2', kind: 'regional', name: 'Ashby Drapery Co.', money: 2000, loan: 500 });
    const one = addCompany(s, { id: 'regional_1', kind: 'regional', name: 'Millbrook Mercantile', money: 1000, loan: 0 });
    one.active = false;
    const rows = [...companiesTable(s).querySelectorAll('tbody tr')].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    );
    expect(rows.map((r) => r[0])).toEqual([s.companies.player.name, s.companies.rival.name, 'Millbrook Mercantile (closed)', 'Ashby Drapery Co.']);
    expect(rows[3][1]).toBe('$2,000');
    expect(rows[3][2]).toBe('$1,500');
  });
});

function openFinance(prep?: (s: GameState) => void): HTMLElement {
  const s = testState();
  prep?.(s);
  const game = { ctx: testCtx(s), state: s };
  financePanel.open(game as unknown as GameController);
  return document.querySelector('.window-body') as HTMLElement;
}

function month(year: number, m: number, income: LedgerMonth['income'], expense: LedgerMonth['expense']): LedgerMonth {
  return { year, month: m, income, expense, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 };
}

describe('finance panel', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeAllWindows();
    document.body.replaceChildren();
  });

  it('empty game: neutral summary, four tiles, chart empty state, closed statement', () => {
    const body = openFinance();
    const summary = body.querySelector('.kit-ph-summary') as HTMLElement;
    expect(body.querySelector('.kit-ph-title')?.textContent).toBe('Finance');
    expect(summary.textContent).toBe('A new ledger: your first month is under way');
    expect(summary.dataset.tone).toBe('neutral');
    expect(body.querySelectorAll('.kit-stat-row .kit-stat')).toHaveLength(4);
    const charts = body.querySelector('.finance-charts-section') as HTMLElement;
    expect(charts.querySelector('.kit-empty-title')?.textContent).toBe('Charts appear after three months');
    expect((charts.querySelector('.finance-charts') as HTMLElement).hidden).toBe(true);
    const statement = body.querySelector('.finance-statement') as HTMLDetailsElement;
    expect(statement.tagName).toBe('DETAILS');
    expect(statement.open).toBe(false);
  });

  it('losing month names the biggest cost', () => {
    const body = openFinance((s) => {
      const { year, month: m } = s.date;
      s.companies.player.ledger.push(month(year, m, { sales: 100 }, { vehicles: 900, maintenance: 200 }));
    });
    const summary = body.querySelector('.kit-ph-summary') as HTMLElement;
    expect(summary.textContent).toContain('Losing $1,000 this month');
    expect(summary.textContent).toContain('Vehicles is your biggest cost');
    expect(summary.dataset.tone).toBe('negative');
  });

  it('profitable month says so', () => {
    const body = openFinance((s) => {
      const { year, month: m } = s.date;
      s.companies.player.ledger.push(month(year, m, { sales: 1500 }, { maintenance: 200 }));
    });
    expect(body.querySelector('.kit-ph-summary')?.textContent).toBe('Profitable: $1,300 this month so far');
  });

  it('the statement hides rows that are zero in every shown month and keeps Profit', () => {
    const body = openFinance((s) => {
      const { year, month: m } = s.date;
      s.companies.player.ledger.push(month(year, m - 1 || 1, { sales: 500 }, { vehicles: 100 }));
      s.companies.player.ledger.push(month(year, m, { sales: 300 }, { vehicles: 50, fines: 0 }));
    });
    const labels = [...body.querySelectorAll('.finance-statement tbody th')].map((t) => t.textContent);
    expect(labels).toContain('Sales');
    expect(labels).toContain('Vehicles');
    expect(labels).toContain('Profit');
    expect(labels).not.toContain('Smoke fines');
    expect(labels).not.toContain('Construction');
  });

  it('keeps the statement open across refreshes', () => {
    vi.useFakeTimers();
    try {
      const body = openFinance();
      const statement = body.querySelector('.finance-statement') as HTMLDetailsElement;
      statement.open = true;
      vi.advanceTimersByTime(3000);
      expect(body.querySelector('.finance-statement')).toBe(statement);
      expect(statement.open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Repay is disabled at loan 0; both footer buttons are secondary', () => {
    const body = openFinance((s) => {
      s.companies.player.loan = 0;
    });
    const btns = [...body.querySelectorAll<HTMLButtonElement>('.p-actions .kit-btn')];
    expect(btns).toHaveLength(2);
    expect(btns.every((b) => b.classList.contains('kit-btn--secondary'))).toBe(true);
    const repay = btns.find((b) => b.textContent?.startsWith('Repay'))!;
    expect(repay.disabled).toBe(true);
  });

  it('where the money goes: nonzero costs this year, largest first, as meters', () => {
    const body = openFinance((s) => {
      const { year, month: m } = s.date;
      s.companies.player.ledger.push(month(year, m, {}, { maintenance: 200, vehicles: 900, fines: 0 }));
    });
    const rows = [...body.querySelectorAll('.finance-cost')];
    expect(rows.map((r) => r.querySelector('.finance-cost-label')?.textContent)).toEqual(['Vehicles', 'Maintenance']);
    expect(rows[0].querySelector('.kit-meter')).not.toBeNull();
    expect(rows[0].querySelector('.finance-cost-value')?.textContent).toBe('$900');
  });
  it('companies table refreshes when a rival net worth moves with cash and loan unchanged', () => {
    vi.useFakeTimers();
    try {
      let state: GameState | undefined;
      const body = openFinance((s) => {
        state = s;
      });
      const s = state!;
      const rivalNet = () => {
        const row = [...body.querySelectorAll('.finance-companies tbody tr')].find((tr) => tr.textContent?.includes(s.companies.rival.name));
        return row?.querySelector('td[data-col="net"]')?.textContent;
      };
      const before = rivalNet();
      const money = s.companies.rival.money;
      must(placeBuilding(testCtx(s), 'rival', 'sawmill', { x: 20, y: 15 }));
      s.companies.rival.money = money;
      vi.advanceTimersByTime(1000);
      expect(rivalNet()).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sales by product: closed section with an empty state when nothing sold', () => {
    const body = openFinance();
    const sales = body.querySelector('.finance-sales') as HTMLDetailsElement;
    expect(sales.tagName).toBe('DETAILS');
    expect(sales.open).toBe(false);
    expect(sales.querySelector('summary')?.textContent).toBe('Sales by product (this year)');
    expect(sales.querySelector('.kit-empty-title')?.textContent).toBe('No sales yet this year');
    // right after the cash chart
    expect(body.querySelector('.finance-charts-section')?.nextElementSibling).toBe(sales);
  });

  it('sales by product: nonzero goods this year, largest first, with icons, open across refreshes', () => {
    vi.useFakeTimers();
    try {
      const body = openFinance((s) => {
        const { year, month: m } = s.date;
        const entry = month(year, m, { sales: 1700 }, {});
        entry.salesByGood = { wood: 500, coal: 1200, grain: 0 };
        s.companies.player.ledger.push(entry);
        const old = month(year - 1, 12, { sales: 9000 }, {});
        old.salesByGood = { cotton: 9000 };
        s.companies.player.ledger.unshift(old);
      });
      const sales = body.querySelector('.finance-sales') as HTMLDetailsElement;
      sales.open = true;
      vi.advanceTimersByTime(2000);
      expect(sales.open).toBe(true);
      const rows = [...sales.querySelectorAll('.finance-cost')];
      expect(rows.map((r) => r.querySelector('.finance-cost-label')?.textContent)).toEqual(['Coal', 'Wood']);
      expect(rows[0].querySelector('.finance-cost-value')?.textContent).toBe('$1,200');
      expect(rows[0].querySelector('img.icon')?.getAttribute('data-icon')).toBe('coal');
      expect(rows[0].querySelector('.kit-meter')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
