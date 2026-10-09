function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function abbreviate(value: number, suffix: string): string {
  const fixed = value.toFixed(2).replace(/\.?0+$/, '');
  return `${fixed}${suffix}`;
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${abbreviate(abs / 1e9, 'B')}`;
  if (abs >= 1e6) return `${sign}$${abbreviate(abs / 1e6, 'M')}`;
  return `${sign}$${groupThousands(abs)}`;
}

export function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${groupThousands(Math.abs(n))}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
