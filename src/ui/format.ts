import { groupThousands, wholeNumber } from '../core/money';

export { formatMoney } from '../core/money';

export function formatNumber(n: number): string {
  const r = wholeNumber(n);
  const sign = r < 0 ? '-' : '';
  return `${sign}${groupThousands(Math.abs(r))}`;
}

export function formatPercent(fraction: number): string {
  const finite = Number.isFinite(fraction) ? fraction : 0;
  return `${Math.round(finite * 100) || 0}%`;
}
