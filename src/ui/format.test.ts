import { describe, expect, it } from 'vitest';
import { formatMoney, formatNumber, formatPercent } from './format';

describe('formatMoney', () => {
  it('uses thousands separators below one million', () => {
    expect(formatMoney(1234)).toBe('$1,234');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(999999)).toBe('$999,999');
  });

  it('puts the minus sign before the dollar sign', () => {
    expect(formatMoney(-5000)).toBe('-$5,000');
  });

  it('abbreviates millions with two decimals and strips trailing zeros', () => {
    expect(formatMoney(1250000)).toBe('$1.25M');
    expect(formatMoney(2000000)).toBe('$2M');
    expect(formatMoney(1500000)).toBe('$1.5M');
    expect(formatMoney(-1250000)).toBe('-$1.25M');
  });

  it('abbreviates billions with B', () => {
    expect(formatMoney(1000000000)).toBe('$1B');
    expect(formatMoney(2500000000)).toBe('$2.5B');
  });
});

describe('formatNumber', () => {
  it('rounds and groups thousands', () => {
    expect(formatNumber(1234.4)).toBe('1,234');
    expect(formatNumber(12000)).toBe('12,000');
  });
});

describe('formatPercent', () => {
  it('turns a fraction into a whole percentage', () => {
    expect(formatPercent(0.734)).toBe('73%');
    expect(formatPercent(1)).toBe('100%');
  });
});
