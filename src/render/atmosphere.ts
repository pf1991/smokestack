import type { GameDate } from '../sim/types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ambient light 0.25 (night) .. 1.0 (day) for an hour of the day. */
export function lightLevel(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 8 && h <= 17) return 1;
  if (h >= 21 || h <= 4) return 0.25;
  if (h > 4 && h < 8) return lerp(0.25, 1, (h - 4) / 4);
  // 17 < h < 21
  return lerp(1, 0.25, (h - 17) / 4);
}

/** Era colour grading: sepia 0.8 -> 0 and saturate 0.6 -> 1.15 from 1900 to 1965. */
export function eraGrade(year: number): { sepia: number; saturate: number } {
  const t = clamp01((year - 1900) / 65);
  return {
    sepia: lerp(0.8, 0, t),
    saturate: lerp(0.6, 1.15, t),
  };
}

/** Season overlay: cool blue in winter, warm in summer, null in spring and autumn. */
export function seasonTint(month: number): string | null {
  if (month === 12 || month === 1 || month === 2) return 'rgba(170, 200, 255, 0.18)';
  if (month >= 6 && month <= 8) return 'rgba(255, 170, 60, 0.12)';
  return null;
}

/** Draws the night overlay and season tint over the whole world viewport. */
export function applyAtmosphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  date: GameDate,
): void {
  ctx.save();
  const night = (1 - lightLevel(date.hour)) * 0.8;
  if (night > 0) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(10, 20, 60, ${night.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  const tint = seasonTint(date.month);
  if (tint) {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** CSS filter string applied to the world canvas element for an era. */
export function cssFilterFor(year: number): string {
  const g = eraGrade(year);
  return `sepia(${g.sepia.toFixed(2)}) saturate(${g.saturate.toFixed(2)})`;
}
