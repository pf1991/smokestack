import { describe, expect, it } from 'vitest';
import { addCompany, companyIds } from './companies';
import { runDays } from './simulation';
import { testCtx, testState } from './testkit';

const reg = (id: string) => ({ id, name: id, money: 1000, loan: 0, kind: 'regional' as const });

describe('companies', () => {
  it('companyIds orders player, baron, then sorted rest', () => {
    const s = testState();
    addCompany(s, reg('r_b'));
    addCompany(s, reg('r_a'));
    expect(companyIds(s)).toEqual(['player', 'rival', 'r_a', 'r_b']);
  });

  it('addCompany throws on duplicate id', () => {
    const s = testState();
    addCompany(s, reg('r_a'));
    expect(() => addCompany(s, reg('r_a'))).toThrow();
  });

  it('finance closes the month for a regional company without gameOver', () => {
    const ctx = testCtx(testState());
    const c = addCompany(ctx.state, { ...reg('r_a'), money: -5_000_000 });
    c.monthsInRed = 50;
    const over: string[] = [];
    ctx.bus.on('gameOver', (e) => over.push(e.reason));
    runDays(ctx, 35);
    for (const id of companyIds(ctx.state)) expect(ctx.state.companies[id].ledger.length).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });
});
