import type { Vec2 } from '../../sim/types';
import { TILE } from '../camera';
import { chimneyOffsets, drawHouse, type HouseTier, windowRects } from '../sprites';
import { type Ctx, type Surface, makeSurface } from './shared';

/** A small garden tree for empty urban tiles. */
export function paintGardenTree(g: Ctx, cx: number, cy: number, r: number, winter: boolean): void {
  g.fillStyle = 'rgba(10,30,15,0.3)';
  g.beginPath();
  g.ellipse(cx + 2, cy + r * 0.8, r, r * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = winter ? '#5b4a3a' : '#3f7a35';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = winter ? 'rgba(250,252,255,0.9)' : '#5f9e48';
  g.beginPath();
  g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.55, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------- glow sprites

let lampGlow: Surface | null = null;
export function getLampGlow(): Surface {
  if (lampGlow) return lampGlow;
  const s = makeSurface(64, 64);
  const g = (s as HTMLCanvasElement).getContext('2d') as Ctx;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,140,0.95)');
  grad.addColorStop(0.15, 'rgba(255,190,100,0.55)');
  grad.addColorStop(0.5, 'rgba(255,160,70,0.16)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  lampGlow = s;
  return s;
}

const houseGlowCache = new Map<string, Surface>();
/**
 * Glow mask for a lit house: |lit − unlit| leaves only the window pixels (warm orange on black),
 * which added with 'lighter' compositing makes exactly those windows shine. A blurred copy adds a halo.
 */
export function getHouseGlow(style: string, variant: number, year: number, tier: HouseTier = 'house'): Surface {
  const key = `${style}|${variant}|${tier}`;
  let s = houseGlowCache.get(key);
  if (s) return s;
  const P = 6;
  const sharp = makeSurface(TILE + P * 2, TILE + P * 2);
  const g = (sharp as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  const unlit = makeSurface(TILE + P * 2, TILE + P * 2);
  drawHouse((unlit as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D, P, P, variant, year, false, tier);
  drawHouse(g, P, P, variant, year, true, tier);
  // one image-level difference (per-primitive difference would also cancel overlapping strokes)
  g.globalCompositeOperation = 'difference';
  g.drawImage(unlit as CanvasImageSource, 0, 0);
  s = makeSurface(TILE + P * 2, TILE + P * 2);
  const o = (s as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  o.fillStyle = '#000';
  o.fillRect(0, 0, TILE + P * 2, TILE + P * 2);
  o.globalCompositeOperation = 'lighter';
  o.filter = 'blur(2px)';
  o.drawImage(sharp as CanvasImageSource, 0, 0);
  o.drawImage(sharp as CanvasImageSource, 0, 0);
  o.filter = 'none';
  o.drawImage(sharp as CanvasImageSource, 0, 0);
  houseGlowCache.set(key, s);
  return s;
}

const chimneyCache = new Map<string, Vec2[]>();
/** chimneyOffsets() allocates; cache per type so smoke emission is allocation-free per frame. */
export function chimneysOf(typeId: string): Vec2[] {
  let c = chimneyCache.get(typeId);
  if (!c) chimneyCache.set(typeId, (c = chimneyOffsets(typeId)));
  return c;
}

const GLOW_PAD = 3;
export interface WindowGlow {
  surf: Surface;
  /** sprite-space offset of the glow image's top-left corner */
  ox: number;
  oy: number;
}
const windowGlowCache = new Map<string, WindowGlow | null>();
/** Pre-rendered warm glow (halo + bright pane) for a building type's `windowRects`, cropped to their bounds. */
export function getWindowGlow(typeId: string): WindowGlow | null {
  const hit = windowGlowCache.get(typeId);
  if (hit !== undefined) return hit;
  const rects = windowRects(typeId);
  if (!rects.length) {
    windowGlowCache.set(typeId, null);
    return null;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const ox = x0 - GLOW_PAD;
  const oy = y0 - GLOW_PAD;
  const surf = makeSurface(x1 - x0 + GLOW_PAD * 2, y1 - y0 + GLOW_PAD * 2);
  const g = (surf as HTMLCanvasElement).getContext('2d') as Ctx;
  g.globalCompositeOperation = 'lighter';
  for (const r of rects) {
    g.fillStyle = 'rgba(255,160,60,0.16)';
    g.fillRect(r.x - ox - 3, r.y - oy - 3, r.w + 6, r.h + 6);
    g.fillStyle = 'rgba(255,170,70,0.25)';
    g.fillRect(r.x - ox - 1, r.y - oy - 1, r.w + 2, r.h + 2);
    g.fillStyle = 'rgba(255,214,122,0.95)';
    g.fillRect(r.x - ox, r.y - oy, r.w, r.h);
  }
  const wg = { surf, ox, oy };
  windowGlowCache.set(typeId, wg);
  return wg;
}
