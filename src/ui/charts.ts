import { formatMoney } from './format';

const NICE_MANTISSAS = [1, 2, 5];

/**
 * Evenly spaced "nice" tick values (steps of 1, 2 or 5 × 10^n) covering [min, max] using at most
 * `count` intervals. Zero is always a tick when the range includes it.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    const pad = Math.max(1, Math.abs(lo) * 0.1);
    lo -= pad;
    hi += pad;
  }
  const intervals = Math.max(1, Math.floor(count));
  for (let e = -12; e <= 15; e++) {
    for (const m of NICE_MANTISSAS) {
      const step = m * 10 ** e;
      const first = Math.floor(lo / step);
      const last = Math.ceil(hi / step);
      if (last - first <= intervals) {
        const ticks: number[] = [];
        for (let k = first; k <= last; k++) ticks.push(Number((k * step).toFixed(10)));
        return ticks;
      }
    }
  }
  return [min, max];
}

/** Reads a CSS custom property from the document root, falling back when unset or unavailable. */
export function cssColor(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Sizes the canvas backing store for devicePixelRatio and returns a context scaled to CSS pixels. */
function prepare(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const g = canvas.getContext('2d');
  if (!g) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  // CSS size, not the backing store: the store is rescaled by dpr on every draw.
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 180;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

// right margin leaves room for the last x label, which is centred on the final point
const PAD = { left: 64, right: 32, top: 10, bottom: 24 };

/** Axis text is cream, since charts sit on the dark walnut window. */
function textColor(): string {
  return cssColor('--paper', '#f3e9d2');
}

function gridColor(): string {
  return 'rgba(243, 233, 210, 0.15)';
}

/**
 * Multi-series line chart. Non-finite values leave a gap in the line. Y axis uses `format`
 * (formatMoney by default); X labels are thinned so at most about six appear.
 */
export function lineChart(
  canvas: HTMLCanvasElement,
  series: { label: string; color: string; values: number[]; dashed?: boolean }[],
  labels: string[],
  format: (v: number) => string = formatMoney,
): void {
  const p = prepare(canvas);
  if (!p) return;
  const { g, w, h } = p;
  const n = labels.length;
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (n === 0 || all.length === 0) return;

  const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  g.font = '11px Georgia, serif';
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  g.strokeStyle = gridColor();
  g.fillStyle = textColor();
  g.lineWidth = 1;
  for (const t of ticks) {
    const ty = y(t);
    g.beginPath();
    g.moveTo(PAD.left, ty);
    g.lineTo(PAD.left + plotW, ty);
    g.stroke();
    g.fillText(format(t), PAD.left - 6, ty);
  }

  g.textAlign = 'center';
  g.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) g.fillText(labels[i], x(i), PAD.top + plotH + 6);

  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 2;
    g.setLineDash(s.dashed ? [6, 4] : []);
    g.beginPath();
    let pen = false;
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      if (pen) g.lineTo(x(i), y(v));
      else g.moveTo(x(i), y(v));
      pen = true;
    });
    g.stroke();
  }
  g.setLineDash([]);
}

/** Vertical bar chart with value axis from zero; each bar takes its own colour. */
export function barChart(canvas: HTMLCanvasElement, bars: { label: string; value: number; color: string }[]): void {
  const p = prepare(canvas);
  if (!p) return;
  const { g, w, h } = p;
  if (bars.length === 0) return;

  const ticks = niceTicks(0, Math.max(0, ...bars.map((b) => b.value)), 4);
  const yMax = ticks[ticks.length - 1] || 1;
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  g.font = '11px Georgia, serif';
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  g.strokeStyle = gridColor();
  g.fillStyle = textColor();
  g.lineWidth = 1;
  for (const t of ticks) {
    const ty = y(t);
    g.beginPath();
    g.moveTo(PAD.left, ty);
    g.lineTo(PAD.left + plotW, ty);
    g.stroke();
    g.fillText(formatMoney(t), PAD.left - 6, ty);
  }

  const slot = plotW / bars.length;
  const barW = Math.max(4, slot * 0.6);
  g.textAlign = 'center';
  g.textBaseline = 'top';
  bars.forEach((b, i) => {
    const cx = PAD.left + slot * (i + 0.5);
    const top = y(b.value);
    g.fillStyle = b.color;
    g.fillRect(cx - barW / 2, top, barW, PAD.top + plotH - top);
    g.fillStyle = textColor();
    g.fillText(b.label, cx, PAD.top + plotH + 6, slot);
  });
}

/**
 * A small axis-free line of `values` (oldest first), scaled to its own range: a share price's last
 * months beside its figure. Fewer than two finite values draw nothing.
 */
export function sparkline(canvas: HTMLCanvasElement, values: number[], color: string): void {
  const p = prepare(canvas);
  if (!p) return;
  const { g, w, h } = p;
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 2) return;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vs) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const pad = 2;
  const x = (i: number) => pad + (i / (vs.length - 1)) * (w - 2 * pad);
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad));
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  vs.forEach((v, i) => (i === 0 ? g.moveTo(x(i), y(v)) : g.lineTo(x(i), y(v))));
  g.stroke();
}
