import { describe, expect, it } from 'vitest';
import { createGame } from './state';
import { addDays, advanceHour, compareDates, dateToDays, formatDate, isSummer, isWinter, START_DATE } from './clock';

describe('clock', () => {
  it('plain hour advance', () => {
    const r = advanceHour({ year: 1900, month: 1, day: 1, hour: 5 });
    expect(r.date).toEqual({ year: 1900, month: 1, day: 1, hour: 6 });
    expect(r.newDay || r.newMonth || r.newYear).toBe(false);
  });

  it('hour rollover', () => {
    const r = advanceHour({ year: 1900, month: 1, day: 30, hour: 23 });
    expect(r.date).toEqual({ year: 1900, month: 2, day: 1, hour: 0 });
    expect(r.newDay).toBe(true);
    expect(r.newMonth).toBe(true);
    expect(r.newYear).toBe(false);
  });

  it('year rollover', () => {
    const r = advanceHour({ year: 1900, month: 12, day: 30, hour: 23 });
    expect(r.date).toEqual({ year: 1901, month: 1, day: 1, hour: 0 });
    expect(r.newYear).toBe(true);
  });

  it('does not mutate input', () => {
    const d = { year: 1900, month: 1, day: 1, hour: 23 };
    advanceHour(d);
    expect(d.hour).toBe(23);
  });

  it('formatDate', () => {
    expect(formatDate({ year: 1905, month: 3, day: 12, hour: 0 })).toBe('12 Mar 1905');
  });

  it('addDays', () => {
    expect(addDays({ year: 1900, month: 1, day: 25, hour: 0 }, 10)).toEqual({ year: 1900, month: 2, day: 5, hour: 0 });
    expect(addDays({ year: 1900, month: 12, day: 30, hour: 3 }, 1)).toEqual({ year: 1901, month: 1, day: 1, hour: 3 });
  });

  it('compareDates and dateToDays', () => {
    const a = { year: 1900, month: 1, day: 1, hour: 0 };
    const b = { year: 1900, month: 1, day: 1, hour: 1 };
    expect(compareDates(a, b)).toBe(-1);
    expect(compareDates(b, a)).toBe(1);
    expect(compareDates(a, { ...a })).toBe(0);
    expect(dateToDays({ year: 1900, month: 1, day: 1, hour: 0 })).toBe(0);
    expect(dateToDays(START_DATE)).toBe(90);
    expect(dateToDays({ year: 1901, month: 1, day: 1, hour: 0 })).toBe(360);
  });

  it('seasons', () => {
    expect([12, 1, 2].every(isWinter)).toBe(true);
    expect(isWinter(3)).toBe(false);
    expect([7, 8, 9].every(isSummer)).toBe(true);
    expect(isSummer(6)).toBe(false);
  });
});

describe('start date', () => {
  it('new games start on 1 April 1900', () => {
    expect(createGame({ seed: 7 }).date).toEqual({ year: 1900, month: 4, day: 1, hour: 0 });
  });
});
