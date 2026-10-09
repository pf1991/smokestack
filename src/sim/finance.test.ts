import { describe, expect, it } from 'vitest';
import type { GameDate } from './types';
import {
  BANKRUPT_MONTHS,
  canAfford,
  closeMonth,
  createCompany,
  currentLedger,
  earn,
  LOAN_RATE,
  LOAN_STEP,
  MAX_LOAN,
  repayLoan,
  spend,
  STARTING_MONEY,
  takeLoan,
} from './finance';

const d: GameDate = { year: 1900, month: 1, day: 1, hour: 0 };

describe('finance', () => {
  it('exposes the pinned constants', () => {
    expect(STARTING_MONEY).toBe(300000);
    expect(LOAN_STEP).toBe(50000);
    expect(MAX_LOAN).toBe(500000);
    expect(LOAN_RATE).toBe(0.06);
    expect(BANKRUPT_MONTHS).toBe(6);
  });

  it('createCompany starts with starting money and no loan', () => {
    const c = createCompany('player', 'Acme');
    expect(c.money).toBe(STARTING_MONEY);
    expect(c.loan).toBe(0);
    expect(canAfford(c, STARTING_MONEY)).toBe(true);
    expect(canAfford(c, STARTING_MONEY + 1)).toBe(false);
  });

  it('spend and earn round and record in ledger', () => {
    const c = createCompany('player', 'Acme');
    spend(c, 'construction', 1000.4, d);
    expect(c.money).toBe(299000);
    expect(currentLedger(c, d).expense.construction).toBe(1000);
    earn(c, 'sales', 250.6, d);
    expect(c.money).toBe(299251);
    expect(currentLedger(c, d).income.sales).toBe(251);
  });

  it('currentLedger creates the month with zeroed fields once', () => {
    const c = createCompany('player', 'Acme');
    const m = currentLedger(c, d);
    expect(m).toMatchObject({ year: 1900, month: 1, income: {}, expense: {}, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 });
    expect(currentLedger(c, d)).toBe(m);
    expect(c.ledger).toHaveLength(1);
  });

  it('loan steps and cap', () => {
    const c = createCompany('player', 'Acme');
    expect(takeLoan(c, 50000)).toEqual({ ok: true, value: undefined });
    expect(c.loan).toBe(50000);
    expect(c.money).toBe(350000);
    expect(takeLoan(c, 30000)).toEqual({ ok: false, error: 'Loans come in $50,000 steps' });
    expect(takeLoan(c, -50000)).toEqual({ ok: false, error: 'Loans come in $50,000 steps' });
    expect(takeLoan(c, 0)).toEqual({ ok: false, error: 'Loans come in $50,000 steps' });
    c.loan = 0;
    expect(takeLoan(c, 550000)).toEqual({ ok: false, error: 'Loan limit is $500,000' });
    expect(c.loan).toBe(0);
  });

  it('repay needs cash', () => {
    const c = createCompany('player', 'Acme', 40000);
    expect(takeLoan(c, 100000).ok).toBe(true);
    c.money = 30000;
    expect(repayLoan(c, 50000)).toEqual({ ok: false, error: 'Not enough money' });
    expect(c.loan).toBe(100000);
    c.money = 80000;
    expect(repayLoan(c, 50000).ok).toBe(true);
    expect(c.loan).toBe(50000);
    expect(c.money).toBe(30000);
    expect(repayLoan(c, 30000).ok).toBe(false);
    expect(repayLoan(c, 100000).ok).toBe(false);
    expect(c.loan).toBe(50000);
  });

  it('interest monthly', () => {
    const c = createCompany('player', 'Acme');
    c.loan = 100000;
    const before = c.money;
    const r = closeMonth(c, d);
    expect(r.interest).toBe(500);
    expect(r.bankrupt).toBe(false);
    expect(c.money).toBe(before - 500);
    expect(currentLedger(c, d).expense.interest).toBe(500);
    expect(currentLedger(c, d).cashEnd).toBe(c.money);
  });

  it('bankrupt after six red months', () => {
    const c = createCompany('player', 'Acme', -1);
    for (let i = 0; i < BANKRUPT_MONTHS - 1; i++) {
      expect(closeMonth(c, d).bankrupt).toBe(false);
    }
    expect(c.monthsInRed).toBe(5);
    expect(closeMonth(c, d).bankrupt).toBe(true);
    expect(c.monthsInRed).toBe(6);
  });

  it('a positive month resets monthsInRed', () => {
    const c = createCompany('player', 'Acme', -1);
    closeMonth(c, d);
    closeMonth(c, d);
    expect(c.monthsInRed).toBe(2);
    c.money = 1000;
    expect(closeMonth(c, d).bankrupt).toBe(false);
    expect(c.monthsInRed).toBe(0);
  });

  it('ledger capped at 120', () => {
    const c = createCompany('player', 'Acme');
    for (let i = 0; i < 130; i++) {
      const date: GameDate = { year: 1900 + Math.floor(i / 12), month: (i % 12) + 1, day: 1, hour: 0 };
      currentLedger(c, date);
    }
    expect(c.ledger).toHaveLength(120);
    expect(c.ledger[0]).toMatchObject({ year: 1900 + Math.floor(10 / 12), month: (10 % 12) + 1 });
    expect(c.ledger[119]).toMatchObject({ year: 1900 + Math.floor(129 / 12), month: (129 % 12) + 1 });
  });
});
