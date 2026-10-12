import { describe, expect, it } from 'vitest';
import { casterShadow, easeSun, shadowPolygon, sunDirection, sunVector, traceShadow } from './shadows';

const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

describe('sunDirection', () => {
  it('casts 0.4 px of shadow per px of height at noon, 2.5 at sunrise and sunset, none at night', () => {
    expect(sunDirection(12).length).toBe(0.4);
    expect(sunDirection(6).length).toBe(2.5);
    expect(sunDirection(18).length).toBe(2.5);
    expect(sunDirection(0).length).toBe(0);
    expect(sunDirection(3).length).toBe(0);
    expect(sunDirection(21).length).toBe(0);
  });
  it('points away from the sun: west in the morning, north at noon, east in the evening', () => {
    expect(sunDirection(6).dx).toBeLessThan(0);
    expect(sunDirection(8).dx).toBeLessThan(0);
    expect(sunDirection(16).dx).toBeGreaterThan(0);
    expect(sunDirection(12).dy).toBeLessThan(0);
    expect(Math.abs(sunDirection(12).dx)).toBeLessThan(1e-9);
  });
  it('is a unit vector by day, and shadows grow longer away from noon', () => {
    for (let h = 6; h <= 18; h++) {
      const s = sunDirection(h);
      expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(1, 9);
    }
    for (let h = 12; h < 18; h++) expect(sunDirection(h + 1).length).toBeGreaterThan(sunDirection(h).length);
    for (let h = 12; h > 6; h--) expect(sunDirection(h - 1).length).toBeGreaterThan(sunDirection(h).length);
  });
});

describe('shadowPolygon', () => {
  it('is the footprint rectangle at height 0', () => {
    const p = shadowPolygon(10, 20, 30, 40, 0, sunDirection(16));
    expect(new Set(p.map(key))).toEqual(new Set(['10,20', '40,20', '40,60', '10,60']));
    expect(p).toHaveLength(4);
  });
  it('extrudes the footprint along the sun vector by height × length', () => {
    const sun = sunDirection(17);
    const p = shadowPolygon(0, 0, 10, 10, 20, sun);
    const tx = sun.dx * sun.length * 20;
    const ty = sun.dy * sun.length * 20;
    // the far corner of the moved footprint is on the outline
    expect(p.some((q) => Math.abs(q.x - (10 + tx)) < 1e-9 && Math.abs(q.y - ty) < 1e-9)).toBe(true);
    // the footprint's own corner opposite the sun stays
    expect(p.some((q) => q.x === 0 && q.y === 10)).toBe(true);
    expect(p.length).toBe(6);
  });
  it('has no shadow at night beyond the footprint', () => {
    expect(shadowPolygon(0, 0, 8, 8, 30, sunDirection(23))).toHaveLength(4);
  });
});

describe('traceShadow', () => {
  const sink = () => {
    const pts: { x: number; y: number }[] = [];
    let polys = 0;
    return {
      pts,
      polys: () => polys,
      moveTo(x: number, y: number) { polys++; pts.push({ x, y }); },
      lineTo(x: number, y: number) { pts.push({ x, y }); },
      closePath() {},
    };
  };
  const tower = { x: 0, y: 0, w: 20, d: 20, z: 30 };
  it('traces the whole swept footprint for buildings drawn over their shadow', () => {
    const s = sink();
    const v = sunVector(17);
    traceShadow(s, tower, 100, 200, v.vx, v.vy, false);
    expect(s.polys()).toBe(1);
    expect(s.pts.some((p) => p.x === 100 && p.y === 220)).toBe(true);
  });
  it('with cut, leaves out the caster silhouette: nothing at noon, only east of it in the evening', () => {
    const noon = sink();
    const n = sunVector(12);
    traceShadow(noon, tower, 0, 0, n.vx, n.vy, true);
    expect(noon.polys()).toBe(0);
    const eve = sink();
    const v = sunVector(17);
    traceShadow(eve, tower, 0, 0, v.vx, v.vy, true);
    expect(eve.polys()).toBeGreaterThan(0);
    for (const p of eve.pts) expect(p.x).toBeGreaterThanOrEqual(20 - 1e-9);
    const morning = sink();
    const m = sunVector(7);
    traceShadow(morning, tower, 0, 0, m.vx, m.vy, true);
    for (const p of morning.pts) expect(p.x).toBeLessThanOrEqual(1e-9);
  });
  it('casts spires to a point', () => {
    const v = sunVector(18);
    const p = casterShadow({ x: 0, y: 0, w: 10, d: 10, z: 40, taper: true }, v.vx, v.vy);
    expect(p.some((q) => Math.abs(q.x - (5 + v.vx * 40)) < 1e-9)).toBe(true);
    expect(p).toHaveLength(5);
  });
});

describe('easeSun', () => {
  it('snaps on the first frame and eases toward the clock after', () => {
    expect(easeSun(null, 16, 16)).toEqual(sunVector(16));
    const from = sunVector(8);
    const to = sunVector(16);
    const mid = easeSun(from, 16, 100);
    expect(mid.vx).toBeGreaterThan(from.vx);
    expect(mid.vx).toBeLessThan(to.vx);
    const far = easeSun(from, 16, 60_000);
    expect(far.vx).toBeCloseTo(to.vx, 6);
  });
});
