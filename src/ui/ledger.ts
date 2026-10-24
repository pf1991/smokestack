import type { GameDate, LedgerMonth } from '../sim/types';

/**
 * The ledger entry for the month the game is in (still open), or undefined when nothing has been
 * booked to it yet. The top bar and the finance panel both read "this month so far" through it.
 */
export function openMonth(ledger: LedgerMonth[], date: Pick<GameDate, 'year' | 'month'>): LedgerMonth | undefined {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const m = ledger[i];
    if (m.year === date.year && m.month === date.month) return m;
  }
  return undefined;
}
