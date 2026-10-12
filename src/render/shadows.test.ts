import { describe, expect, it } from 'vitest';
import { lightLevel, easeLight } from './atmosphere';
import { RUNNING_SUN_HOUR, SHADOW_ALPHA, type SunVector, casterShadow, easeSun, horizonFade, shadowAlpha, shadowPolygon, sunDirection, sunVector, targetSun, traceShadow } from './shadows';

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

describe('targetSun, easeSun and shadowAlpha', () => {
  it('holds a golden-hour sun while running and shows the true hour while paused', () => {
    expect(targetSun(8, 0)).toEqual(sunVector(8));
    expect(targetSun(16, 0)).toEqual(sunVector(16));
    for (const speed of [1, 2, 4, 8]) for (const h of [0, 3, 8, 12, 20]) expect(targetSun(h, speed)).toEqual(sunVector(RUNNING_SUN_HOUR));
    expect(RUNNING_SUN_HOUR).toBe(16);
    expect(sunVector(16).vx).toBeGreaterThan(1.5); // long, eastward
  });
  it('snaps on the first frame and eases between states after', () => {
    expect(easeSun(null, sunVector(16), 16)).toEqual(sunVector(16));
    const from = sunVector(8);
    const to = sunVector(16);
    const mid = easeSun(from, to, 100);
    expect(mid.vx).toBeGreaterThan(from.vx);
    expect(mid.vx).toBeLessThan(to.vx);
    expect(easeSun(from, to, 60_000).vx).toBeCloseTo(to.vx, 6);
  });
  it('fades to 0 at the horizon and is full by day', () => {
    expect(horizonFade(6)).toBe(0);
    expect(horizonFade(18)).toBe(0);
    expect(horizonFade(7)).toBeGreaterThan(0);
    expect(horizonFade(7)).toBeLessThan(1);
    expect(horizonFade(17)).toBeLessThan(1);
    expect(horizonFade(8)).toBe(1);
    expect(horizonFade(16)).toBe(1);
  });
  it('alpha is 0 in night light, full in daylight, and scales with the regime blend', () => {
    const sun = sunVector(16);
    expect(shadowAlpha(lightLevel(0), 1, sun)).toBe(0);
    expect(shadowAlpha(lightLevel(22), 1, sun)).toBe(0);
    expect(shadowAlpha(lightLevel(12), 1, sun)).toBe(SHADOW_ALPHA);
    expect(shadowAlpha(lightLevel(12), 0.5, sun)).toBeCloseTo(SHADOW_ALPHA / 2, 9);
    expect(shadowAlpha(lightLevel(12), 1, sunVector(6))).toBe(0);
  });
  it('in a running game the shadow stays long and stable, and its alpha follows the eased light', () => {
    // the renderer's loop: 16 ms frames, light eased by easeLight, sun by easeSun(targetSun)
    for (const speed of [1, 2, 4, 8] as const) {
      const msHour = 2000 / 24 / speed;
      let sun: SunVector | null = null;
      let light: number | null = null;
      let minLen = Infinity, maxLen = 0, minA = Infinity, maxA = 0;
      for (let f = 0, t = 0; f < 3000; f++, t += 16) {
        const hour = Math.floor(t / msHour) % 24;
        light = easeLight(light, hour, 16, speed);
        sun = easeSun(sun, targetSun(hour, speed), 16);
        if (f < 1500) continue;
        const len = Math.hypot(sun.vx, sun.vy);
        minLen = Math.min(minLen, len);
        maxLen = Math.max(maxLen, len);
        const a = shadowAlpha(light, 1, sun);
        minA = Math.min(minA, a);
        maxA = Math.max(maxA, a);
      }
      expect(minLen, `speed ${speed}`).toBeCloseTo(Math.hypot(sunVector(16).vx, sunVector(16).vy), 6);
      expect(maxLen - minLen, `speed ${speed}`).toBeLessThan(1e-6);
      expect(maxA, `speed ${speed}`).toBeGreaterThan(0.05);
      if (speed === 1) expect(minA).toBeLessThan(0.01); // dark at night
    }
  });
});
