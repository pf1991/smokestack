import { describe, expect, it } from 'vitest';
import { createGame } from './state';
import { testCtx, testState } from './testkit';
import { defaultWeather, prevailingWind, RAIN_CHANCE, weatherDay } from './weather';

describe('weather', () => {
  it('prevailing winds: summer westerlies, winter northerlies, autumn from the north-west', () => {
    expect(prevailingWind(6).x).toBeGreaterThan(0);
    expect(prevailingWind(1).y).toBeGreaterThan(0);
    expect(prevailingWind(4)).toEqual({ x: 1, y: -0.2 });
    expect(prevailingWind(10)).toEqual({ x: 0.6, y: 0.6 });
    expect(prevailingWind(12)).toEqual({ x: 0.2, y: 1 });
  });

  it('rain chance: 12 months, wetter in winter than in summer', () => {
    expect(RAIN_CHANCE.length).toBe(12);
    expect(RAIN_CHANCE[0]).toBe(0.35);
    expect(RAIN_CHANCE[6]).toBe(0.15);
  });

  it('jitters the wind within ±0.35 of prevailing, clamped to [-1, 1], and tracks rain streaks', () => {
    const ctx = testCtx(testState());
    let rainy = 0;
    for (let month = 1; month <= 12; month++) {
      ctx.state.date.month = month;
      const p = prevailingWind(month);
      for (let d = 0; d < 200; d++) {
        const before = ctx.state.weather.rainDays;
        weatherDay(ctx);
        const w = ctx.state.weather;
        expect(Math.abs(w.windX - Math.max(-1, Math.min(1, p.x)))).toBeLessThanOrEqual(0.35 + 1e-9);
        expect(Math.abs(w.windY - p.y)).toBeLessThanOrEqual(0.35 + 1e-9);
        expect(w.windX).toBeGreaterThanOrEqual(-1);
        expect(w.windX).toBeLessThanOrEqual(1);
        expect(w.windY).toBeGreaterThanOrEqual(-1);
        expect(w.windY).toBeLessThanOrEqual(1);
        expect(w.rainDays).toBe(w.rain ? before + 1 : 0);
        if (w.rain) rainy++;
      }
    }
    // about 25% of days rain across the year
    expect(rainy / 2400).toBeGreaterThan(0.15);
    expect(rainy / 2400).toBeLessThan(0.35);
  });

  it('is deterministic for a seed', () => {
    const a = testCtx(testState({ seed: 3 }));
    const b = testCtx(testState({ seed: 3 }));
    for (let d = 0; d < 50; d++) {
      weatherDay(a);
      weatherDay(b);
    }
    expect(b.state.weather).toEqual(a.state.weather);
  });

  it('a new game starts with the prevailing wind of its month and no rain', () => {
    const s = createGame({ seed: 7 });
    expect(s.weather).toEqual(defaultWeather(s.date.month));
    expect(s.weather.rain).toBe(false);
  });
});
