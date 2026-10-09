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

  it('rounds to whole dollars before choosing a unit', () => {
    expect(formatMoney(999999.6)).toBe('$1M');
    expect(formatMoney(999999.4)).toBe('$999,999');
  });

  it('never prints negative zero', () => {
    expect(formatMoney(-0.4)).toBe('$0');
    expect(formatMoney(-0)).toBe('$0');
  });

  it('prints $0 for NaN and Infinity instead of NaN', () => {
    expect(formatMoney(NaN)).toBe('$0');
    expect(formatMoney(Infinity)).toBe('$0');
  });

  it('promotes to the next unit when the scaled value rounds to 1000', () => {
    expect(formatMoney(999_995_000)).toBe('$1B');
    expect(formatMoney(999_994_000)).toBe('$999.99M');
  });
});

describe('formatNumber', () => {
  it('rounds and groups thousands', () => {
    expect(formatNumber(1234.4)).toBe('1,234');
    expect(formatNumber(12000)).toBe('12,000');
    expect(formatNumber(-5000)).toBe('-5,000');
  });

  it('never prints -0 or NaN', () => {
    expect(formatNumber(-0.2)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });
});

describe('formatPercent', () => {
  it('turns a fraction into a whole percentage', () => {
    expect(formatPercent(0.734)).toBe('73%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('never prints -0% or NaN%', () => {
    expect(formatPercent(-0.001)).toBe('0%');
    expect(formatPercent(NaN)).toBe('0%');
  });
});
