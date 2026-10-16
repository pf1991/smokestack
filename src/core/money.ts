/** Pure money formatting, shared by sim and UI (the sim must not import from src/ui). */
/** Rounds to an integer, mapping NaN/Infinity to 0 and -0 to 0 so output never shows "NaN" or "-0". */
export function wholeNumber(n: number): number {
  const finite = Number.isFinite(n) ? n : 0;
  return Math.round(finite) || 0;
}

export function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Scales `value` to two decimals with trailing zeros stripped; returns the text and the numeric result. */
function scaled(value: number): { text: string; num: number } {
  const text = value.toFixed(2).replace(/\.?0+$/, '');
  return { text, num: Number(text) };
}

export function formatMoney(n: number): string {
  const r = wholeNumber(n);
  const sign = r < 0 ? '-' : '';
  const abs = Math.abs(r);
  if (abs < 1e6) return `${sign}$${groupThousands(abs)}`;
  const millions = scaled(abs / 1e6);
  if (abs < 1e9 && millions.num < 1000) return `${sign}$${millions.text}M`;
  return `${sign}$${scaled(abs / 1e9).text}B`;
}
