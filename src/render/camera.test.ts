import { describe, it, expect } from 'vitest';
import {
  type Camera,
  TILE,
  screenToWorld,
  screenToTile,
  tileToScreen,
  zoomAt,
  setZoomTarget,
  stepZoom,
  clampCamera,
  visibleTileRange,
} from './camera';
import type { GameMap } from '../sim/types';

const map = (w: number, h: number): GameMap => ({ width: w, height: h, tiles: [] });
const cam = (o: Partial<Camera> = {}): Camera => ({ x: 100, y: 60, zoom: 1, viewW: 800, viewH: 600, ...o });

describe('camera', () => {
  it('screenToTile inverse of tileToScreen', () => {
    for (const zoom of [1, 2]) {
      const c = cam({ zoom });
      const s = tileToScreen(c, 7, 5);
      const t = screenToTile(c, s.x + 1, s.y + 1);
      expect(t).toEqual({ x: 7, y: 5 });
      const w = screenToWorld(c, s.x, s.y);
      expect(w.x).toBeCloseTo(7 * TILE);
      expect(w.y).toBeCloseTo(5 * TILE);
    }
  });

  it('zoomAt keeps cursor anchor', () => {
    const c = cam();
    const before = screenToWorld(c, 300, 200);
    zoomAt(c, 300, 200, 1.5);
    const after = screenToWorld(c, 300, 200);
    expect(c.zoom).toBeCloseTo(1.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoom clamped', () => {
    const c = cam();
    zoomAt(c, 10, 10, 100);
    expect(c.zoom).toBe(3);
    zoomAt(c, 10, 10, 0.0001);
    expect(c.zoom).toBe(0.5);
  });

  it('clampCamera keeps view inside map', () => {
    const m = map(128, 96);
    const c = cam({ x: -500, y: 99999 });
    clampCamera(c, m);
    expect(c.x).toBe(0);
    expect(c.y).toBe(96 * TILE - 600);
    c.x = 99999;
    clampCamera(c, m);
    expect(c.x).toBe(128 * TILE - 800);
  });

  it('clampCamera centres map when smaller than view', () => {
    const c = cam({ zoom: 0.5, viewW: 4000, viewH: 3000 });
    clampCamera(c, map(128, 96));
    expect(c.x).toBeCloseTo((128 * TILE - 8000) / 2);
    expect(c.y).toBeCloseTo((96 * TILE - 6000) / 2);
  });

  it('visibleTileRange clipped to map', () => {
    const m = map(128, 96);
    const r = visibleTileRange(cam({ x: -200, y: -200 }), m);
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
    const r2 = visibleTileRange(cam({ x: 99999, y: 99999 }), m);
    expect(r2.x1).toBeLessThanOrEqual(127);
    expect(r2.y1).toBeLessThanOrEqual(95);
    const r3 = visibleTileRange(cam({ x: 0, y: 0 }), m);
    expect(r3).toEqual({ x0: 0, y0: 0, x1: 25, y1: 18 });
    // non-tile-aligned camera
    const r4 = visibleTileRange(cam({ x: 10, y: 10 }), m);
    expect(r4).toEqual({ x0: 0, y0: 0, x1: 25, y1: 19 });
  });

  it('eased zoom reaches its target and keeps the cursor world point fixed', () => {
    const c = cam({ x: 300, y: 200 });
    const before = screenToWorld(c, 250, 180);
    setZoomTarget(c, 250, 180, 1.5);
    stepZoom(c, 16);
    expect(c.zoom).toBeGreaterThan(1);
    expect(c.zoom).toBeLessThan(1.5);
    for (let t = 16; t < 500; t += 16) stepZoom(c, 16);
    stepZoom(c, 500 - 31 * 16);
    expect(Math.abs(c.zoom - 1.5)).toBeLessThan(1e-3);
    const after = screenToWorld(c, 250, 180);
    expect(Math.abs(after.x - before.x) / TILE).toBeLessThan(0.01);
    expect(Math.abs(after.y - before.y) / TILE).toBeLessThan(0.01);
  });

  it('zoom target clamps to the bounds', () => {
    const c = cam();
    setZoomTarget(c, 0, 0, 100);
    for (let i = 0; i < 100; i++) stepZoom(c, 16);
    expect(c.zoom).toBeLessThanOrEqual(3);
    expect(c.zoom).toBeGreaterThan(2.99);
  });
});
