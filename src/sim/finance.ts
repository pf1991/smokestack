import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import type { Company, GameDate, LedgerCategory, LedgerMonth, OwnerId } from './types';

export const STARTING_MONEY = 300000;
export const LOAN_STEP = 50000;
export const MAX_LOAN = 500000;
export const LOAN_RATE = 0.06;
export const BANKRUPT_MONTHS = 6;

const MAX_LEDGER_MONTHS = 120;

export function createCompany(id: OwnerId, name: string, money = STARTING_MONEY): Company {
  return {
    id,
    kind: id === 'player' ? 'player' : id === 'rival' ? 'baron' : 'regional',
    name,
    money,
    loan: 0,
    ledger: [],
    monthsInRed: 0,
    roadTiles: 0,
    railTiles: 0,
    active: true,
  };
}

export function canAfford(c: Company, amount: number): boolean {
  return c.money >= amount;
}

export function currentLedger(c: Company, date: GameDate): LedgerMonth {
  const found = c.ledger.find((m) => m.year === date.year && m.month === date.month);
  if (found) return found;
  const entry: LedgerMonth = {
    year: date.year,
    month: date.month,
    income: {},
    expense: {},
    salesByGood: {},
    cashEnd: 0,
    netWorthEnd: 0,
  };
  c.ledger.push(entry);
  if (c.ledger.length > MAX_LEDGER_MONTHS) {
    c.ledger.splice(0, c.ledger.length - MAX_LEDGER_MONTHS);
  }
  return entry;
}

export function spend(c: Company, cat: LedgerCategory, amount: number, date: GameDate): void {
  const n = Math.round(amount);
  c.money -= n;
  const m = currentLedger(c, date);
  m.expense[cat] = (m.expense[cat] ?? 0) + n;
}

export function earn(c: Company, cat: LedgerCategory, amount: number, date: GameDate): void {
  const n = Math.round(amount);
  c.money += n;
  const m = currentLedger(c, date);
  m.income[cat] = (m.income[cat] ?? 0) + n;
}

function isLoanStep(amount: number): boolean {
  return amount > 0 && amount % LOAN_STEP === 0;
}

export function takeLoan(c: Company, amount: number): Result {
  if (!isLoanStep(amount)) return err('Loans come in $50,000 steps');
  if (c.loan + amount > MAX_LOAN) return err('Loan limit is $500,000');
  c.loan += amount;
  c.money += amount;
  return ok();
}

export function repayLoan(c: Company, amount: number): Result {
  if (!isLoanStep(amount)) return err('Loans come in $50,000 steps');
  if (amount > c.loan) return err('Loan is smaller than that repayment');
  if (c.money < amount) return err('Not enough money');
  c.loan -= amount;
  c.money -= amount;
  return ok();
}

export function closeMonth(c: Company, date: GameDate): { interest: number; bankrupt: boolean } {
  const interest = Math.round((c.loan * LOAN_RATE) / 12);
  if (interest > 0) spend(c, 'interest', interest, date);
  const m = currentLedger(c, date);
  m.cashEnd = c.money;
  if (c.money < 0) {
    c.monthsInRed += 1;
  } else {
    c.monthsInRed = 0;
  }
  return { interest, bankrupt: c.monthsInRed >= BANKRUPT_MONTHS };
}

/** Income categories counted in a month's profit (the finance panel's statement uses the same lists). */
export const INCOME_CATEGORIES: LedgerCategory[] = ['sales', 'contracts', 'events', 'demolition'];
/** Expense categories counted in a month's profit. */
export const EXPENSE_CATEGORIES: LedgerCategory[] = ['construction', 'maintenance', 'vehicles', 'interest'];

/** Income minus expense for one ledger month. */
export function monthProfit(m: Pick<LedgerMonth, 'income' | 'expense'>): number {
  const sum = (rec: Partial<Record<LedgerCategory, number>>, cats: LedgerCategory[]) =>
    cats.reduce((t, c) => t + (rec[c] ?? 0), 0);
  return sum(m.income, INCOME_CATEGORIES) - sum(m.expense, EXPENSE_CATEGORIES);
}
