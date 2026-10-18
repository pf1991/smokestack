// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { addCompany } from '../../sim/companies';
import { testState } from '../../sim/testkit';
import { companiesTable } from './finance';

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
