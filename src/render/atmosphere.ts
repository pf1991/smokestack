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

/** Whether lamps and windows are lit for this hour; independent of speed and easing. */
export function isLit(hour: number): boolean {
  return lightLevel(hour) < 0.8;
}

/** Real-time constant (ms) for easing the rendered light level toward the clock's light level. */
export const LIGHT_EASE_MS = 1500;
/** At the fastest speed the light never drops below this, so day/night cannot flash. */
export const FAST_MIN_LIGHT = 0.7;

/**
 * Next rendered light level: eases `current` toward `lightLevel(hour)` with a ~1.5 s real-time
 * constant (frame-rate independent), and at speed 8 keeps it at or above FAST_MIN_LIGHT.
 * `current === null` (first frame) snaps to the target.
 */
export function easeLight(current: number | null, hour: number, dtMs: number, speed: number): number {
  let target = lightLevel(hour);
  if (speed >= 8) target = Math.max(target, FAST_MIN_LIGHT);
  if (current === null) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / LIGHT_EASE_MS);
  const next = current + (target - current) * k;
  return speed >= 8 ? Math.max(FAST_MIN_LIGHT, next) : next;
}

/** Era colour grading: sepia 0.45 -> 0 and saturate 0.85 -> 1.15 from 1900 to 1965. */
export function eraGrade(year: number): { sepia: number; saturate: number } {
  const t = clamp01((year - 1900) / 65);
  return {
    sepia: lerp(0.45, 0, t),
    saturate: lerp(0.85, 1.15, t),
  };
}

/** Season overlay: cool blue in winter, warm in summer, null in spring and autumn. */
export function seasonTint(month: number): string | null {
  if (month === 12 || month === 1 || month === 2) return 'rgba(170, 200, 255, 0.18)';
  if (month >= 6 && month <= 8) return 'rgba(255, 170, 60, 0.12)';
  return null;
}

/** Draws the night overlay and season tint over the whole world viewport (`light` defaults to the hour's level). */
export function applyAtmosphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  date: GameDate,
  light: number = lightLevel(date.hour),
): void {
  ctx.save();
  const night = (1 - light) * 0.8;
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
