import type { GameDate } from './types';

export const TICKS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const START_DATE: GameDate = { year: 1900, month: 4, day: 1, hour: 0 };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function advanceHour(d: GameDate): { date: GameDate; newDay: boolean; newMonth: boolean; newYear: boolean } {
  // a plain literal (not a spread): this runs every tick, and a fixed shape keeps it cheap
  const date: GameDate = { year: d.year, month: d.month, day: d.day, hour: d.hour + 1 };
  let newDay = false;
  let newMonth = false;
  let newYear = false;
  if (date.hour >= TICKS_PER_DAY) {
    date.hour = 0;
    date.day += 1;
    newDay = true;
    if (date.day > DAYS_PER_MONTH) {
      date.day = 1;
      date.month += 1;
      newMonth = true;
      if (date.month > MONTHS_PER_YEAR) {
        date.month = 1;
        date.year += 1;
        newYear = true;
      }
    }
  }
  return { date, newDay, newMonth, newYear };
}

/** Whole days since START_DATE (hours ignored). */
export function dateToDays(d: GameDate): number {
  return (d.year - START_DATE.year) * MONTHS_PER_YEAR * DAYS_PER_MONTH + (d.month - 1) * DAYS_PER_MONTH + (d.day - 1);
}

function daysToDate(days: number, hour: number): GameDate {
  const perYear = MONTHS_PER_YEAR * DAYS_PER_MONTH;
  const year = START_DATE.year + Math.floor(days / perYear);
  const rem = days - (year - START_DATE.year) * perYear;
  return { year, month: Math.floor(rem / DAYS_PER_MONTH) + 1, day: (rem % DAYS_PER_MONTH) + 1, hour };
}

export function addDays(d: GameDate, n: number): GameDate {
  return daysToDate(dateToDays(d) + n, d.hour);
}

export function compareDates(a: GameDate, b: GameDate): -1 | 0 | 1 {
  const da = dateToDays(a) * TICKS_PER_DAY + a.hour;
  const db = dateToDays(b) * TICKS_PER_DAY + b.hour;
  return da < db ? -1 : da > db ? 1 : 0;
}

export function formatDate(d: GameDate): string {
  return `${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}`;
}

export function isWinter(month: number): boolean {
  return month === 12 || month <= 2;
}

export function isSummer(month: number): boolean {
  return month >= 7 && month <= 9;
}
