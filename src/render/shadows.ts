/**
 * Sun shadows for the diorama regime (render-only; never touches GameState).
 *
 * The sun rises in the east at 6, stands in the south at noon and sets in the west at 18, so a
 * shadow points west in the morning, north at noon and east in the evening. A caster is a ¾ prism:
 * a ground rectangle `z` px tall (or a spire tapering to a point). Its shadow is the ground rectangle
 * swept along the shadow vector by `z × length`. Every caster in view is traced into ONE path and
 * filled once with the nonzero rule, so overlapping shadows never darken twice.
 */
import { LIGHT_EASE_MS } from './atmosphere';
import type { Vec2 } from '../sim/types';

/** A shadow caster in world (or local) px: ground rect (x, y, w, d), z px tall; `taper` = spire whose top is a point. */
export interface ShadowCaster {
  x: number;
  y: number;
  w: number;
  d: number;
  z: number;
  taper?: boolean;
}

/** Cool dark tone of every shadow; drawn at SHADOW_ALPHA (× regime blend × daylight). */
export const SHADOW_COLOR = '#141c30';
export const SHADOW_ALPHA = 0.3;
/** Tallest caster (px: the steel mill's furnace stack); with MAX_SHADOW_LENGTH it bounds how far a shadow can reach. */
export const MAX_CASTER_Z = 72;
/** Longest shadow in px per px of height (sunrise and sunset). */
export const MAX_SHADOW_LENGTH = 2.5;

const NOON_LENGTH = 0.4;

/**
 * Shadow direction for `hour`: a unit vector pointing away from the sun, and `length`, the shadow
 * length per px of height (0.4 at noon, 2.5 at 6 and 18, 0 at night).
 */
export function sunDirection(hour: number): { dx: number; dy: number; length: number } {
  const h = ((hour % 24) + 24) % 24;
  if (h < 6 || h > 18) return { dx: 0, dy: 0, length: 0 };
  const a = (Math.PI * (h - 6)) / 12;
  const s = Math.abs(h - 12) / 6;
  // in tenths so noon is exactly 0.4 and the horizon exactly 2.5
  const length = (NOON_LENGTH * 10 + (MAX_SHADOW_LENGTH - NOON_LENGTH) * 10 * s) / 10;
  return { dx: -Math.cos(a), dy: -Math.sin(a), length };
}

/** Shadow offset per px of height (direction × length) and the horizon fade `a` (0..1), as the renderer eases them. */
export interface SunVector {
  vx: number;
  vy: number;
  a: number;
}

/** 0 at sunrise and sunset, 1 from two hours after sunrise to two hours before sunset, linear between. */
export function horizonFade(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.min(1, Math.max(0, Math.min(h - 6, 18 - h) / 2));
}

export function sunVector(hour: number): SunVector {
  const s = sunDirection(hour);
  return { vx: s.dx * s.length, vy: s.dy * s.length, a: horizonFade(hour) };
}

/** Hour of the fixed golden-hour sun used while the clock runs. */
export const RUNNING_SUN_HOUR = 16;

/**
 * The sun the shadows aim for. While the game runs (speed > 0) a day lasts 2000 / speed ms, far too
 * fast for shadows to follow, so they hold a long, stable golden-hour sun (and fade with the eased
 * daylight instead). Paused, they show the true hour.
 */
export function targetSun(hour: number, speed: number): SunVector {
  return sunVector(speed > 0 ? RUNNING_SUN_HOUR : hour);
}

/**
 * Eases the rendered sun toward `target` with the light's real-time constant, so switching between
 * the running and the paused sun swings the shadows smoothly. null snaps.
 */
export function easeSun(current: SunVector | null, target: SunVector, dtMs: number): SunVector {
  if (!current) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / LIGHT_EASE_MS);
  return {
    vx: current.vx + (target.vx - current.vx) * k,
    vy: current.vy + (target.vy - current.vy) * k,
    a: current.a + (target.a - current.a) * k,
  };
}

/** Eased light level (atmosphere.ts) at or below which shadows are gone. */
const SHADOW_LIGHT_MIN = 0.55;
const SHADOW_LIGHT_SPAN = 0.4;

/**
 * Shadow layer opacity: SHADOW_ALPHA × regime blend × daylight × the sun's horizon fade. Daylight
 * maps the eased light level so night (0.25) gives 0 and full day gives 1.
 */
export function shadowAlpha(light: number, blend: number, sun: SunVector): number {
  const day = Math.min(1, Math.max(0, (light - SHADOW_LIGHT_MIN) / SHADOW_LIGHT_SPAN));
  return SHADOW_ALPHA * blend * day * Math.min(1, Math.max(0, sun.a));
}

// ---------------------------------------------------------------- geometry (allocation-free core)

const MAX_PTS = 16;
const px = new Float64Array(MAX_PTS);
const py = new Float64Array(MAX_PTS);
const hx = new Float64Array(MAX_PTS);
const hy = new Float64Array(MAX_PTS);
const cx = new Float64Array(MAX_PTS);
const cy = new Float64Array(MAX_PTS);

/** z-component of (h[k-1] − h[k-2]) × (p[i] − h[k-2]). */
function cross(k: number, i: number): number {
  return (hx[k - 1] - hx[k - 2]) * (py[i] - hy[k - 2]) - (hy[k - 1] - hy[k - 2]) * (px[i] - hx[k - 2]);
}

/** Convex hull (monotone chain) of px/py[0..n) into hx/hy; returns the vertex count. Collinear points are dropped. */
function hull(n: number): number {
  // insertion sort by x, then y (n ≤ 8)
  for (let i = 1; i < n; i++) {
    const x = px[i], y = py[i];
    let j = i - 1;
    while (j >= 0 && (px[j] > x || (px[j] === x && py[j] > y))) {
      px[j + 1] = px[j];
      py[j + 1] = py[j];
      j--;
    }
    px[j + 1] = x;
    py[j + 1] = y;
  }
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k >= 2 && cross(k, i) <= 1e-9) k--;
    hx[k] = px[i];
    hy[k] = py[i];
    k++;
  }
  const lower = k + 1;
  for (let i = n - 2; i >= 0; i--) {
    while (k >= lower && cross(k, i) <= 1e-9) k--;
    hx[k] = px[i];
    hy[k] = py[i];
    k++;
  }
  return Math.max(1, k - 1);
}

/** Hull of caster `c` swept by (vx, vy) per px of height, offset by (ox, oy); returns the count in hx/hy. */
function sweep(c: ShadowCaster, ox: number, oy: number, vx: number, vy: number, zk = 1): number {
  const x0 = ox + c.x, y0 = oy + c.y, x1 = x0 + c.w, y1 = y0 + c.d;
  px[0] = x0; py[0] = y0;
  px[1] = x1; py[1] = y0;
  px[2] = x1; py[2] = y1;
  px[3] = x0; py[3] = y1;
  const tx = vx * c.z * zk, ty = vy * c.z * zk;
  if (c.taper) {
    px[4] = (x0 + x1) / 2 + tx;
    py[4] = (y0 + y1) / 2 + ty;
    return hull(5);
  }
  px[4] = x0 + tx; py[4] = y0 + ty;
  px[5] = x1 + tx; py[5] = y0 + ty;
  px[6] = x1 + tx; py[6] = y1 + ty;
  px[7] = x0 + tx; py[7] = y1 + ty;
  return hull(8);
}

/** Clips hx/hy[0..n) to the half-plane `axis` (0 = x, 1 = y) `sign` × (v − at) ≥ 0, into cx/cy; returns the count. */
function clip(n: number, axis: 0 | 1, at: number, sign: 1 | -1): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = axis === 0 ? hx[i] : hy[i];
    const aj = axis === 0 ? hx[j] : hy[j];
    const di = sign * (ai - at);
    const dj = sign * (aj - at);
    if (di >= 0) {
      cx[m] = hx[i];
      cy[m] = hy[i];
      m++;
    }
    if ((di >= 0) !== (dj >= 0)) {
      const t = di / (di - dj);
      cx[m] = hx[i] + (hx[j] - hx[i]) * t;
      cy[m] = hy[i] + (hy[j] - hy[i]) * t;
      m++;
    }
  }
  return m;
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

function emit(g: PathSink, xs: Float64Array, ys: Float64Array, n: number): void {
  if (n < 3) return;
  g.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) g.lineTo(xs[i], ys[i]);
  g.closePath();
}

/**
 * Adds caster `c` (offset by ox, oy) to the current path for sun vector (vx, vy).
 * `cut` leaves out the caster's own on-screen silhouette, for casters painted BEFORE the shadow layer
 * (houses, landmarks in the chunk cache): only the ground beside and beyond it is darkened.
 * Buildings drawn after the shadow layer pass `cut = false`; their sprite covers their own shadow.
 * `zk` scales the caster's height (a building still rising from its scaffold casts a growing shadow).
 */
export function traceShadow(g: PathSink, c: ShadowCaster, ox: number, oy: number, vx: number, vy: number, cut: boolean, zk = 1): void {
  const n = sweep(c, ox, oy, vx, vy, zk);
  if (!cut) return emit(g, hx, hy, n);
  const x0 = ox + c.x, x1 = x0 + c.w, top = oy + c.y - c.z;
  const tx = vx * c.z;
  if (tx > 0.5) emit(g, cx, cy, clip(n, 0, x1, 1));
  else if (tx < -0.5) emit(g, cx, cy, clip(n, 0, x0, -1));
  if (vy * c.z < -c.z - 0.5) emit(g, cx, cy, clip(n, 1, top, -1));
}

/** `traceShadow` as a polygon (allocates; for tests and tools). */
export function casterShadow(c: ShadowCaster, vx: number, vy: number): Vec2[] {
  const n = sweep(c, 0, 0, vx, vy);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push({ x: hx[i], y: hy[i] });
  return out;
}

/** Footprint (x, y, w, h) extruded along the sun vector by `height` × length: the shadow outline. */
export function shadowPolygon(x: number, y: number, w: number, h: number, height: number, sun: ReturnType<typeof sunDirection>): Vec2[] {
  return casterShadow({ x, y, w, d: h, z: height }, sun.dx * sun.length, sun.dy * sun.length);
}
