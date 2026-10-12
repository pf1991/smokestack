import { describe, it, expect } from 'vitest';
import type { GameDate } from '../sim/types';
import { lightLevel, eraGrade, seasonTint, applyAtmosphere, cssFilterFor, easeLight, FAST_MIN_LIGHT, isLit } from './atmosphere';

interface Call {
  op: string;
  comp: string;
  fill: string;
}

function fakeCtx() {
  const calls: Call[] = [];
  let saves = 0;
  let restores = 0;
  const state = { globalCompositeOperation: 'source-over', fillStyle: '' as string };
  const ctx = {
    get globalCompositeOperation() {
      return state.globalCompositeOperation;
    },
    set globalCompositeOperation(v: string) {
      state.globalCompositeOperation = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    save() {
      saves++;
    },
    restore() {
      restores++;
    },
    fillRect() {
      calls.push({ op: 'fillRect', comp: state.globalCompositeOperation, fill: state.fillStyle });
    },
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    balanced: () => saves === restores,
  };
}

const date = (hour: number, month = 5, year = 1950): GameDate => ({ year, month, day: 1, hour });

describe('lightLevel', () => {
  it('is full light during the day', () => {
    expect(lightLevel(12)).toBe(1);
    expect(lightLevel(8)).toBe(1);
    expect(lightLevel(17)).toBe(1);
  });
  it('is dim at night', () => {
    expect(lightLevel(0)).toBe(0.25);
    expect(lightLevel(23)).toBe(0.25);
    expect(lightLevel(21)).toBe(0.25);
    expect(lightLevel(4)).toBe(0.25);
  });
  it('ramps between dawn and dusk', () => {
    const l = lightLevel(6);
    expect(l).toBeGreaterThan(0.25);
    expect(l).toBeLessThan(1);
    expect(lightLevel(19)).toBeGreaterThan(0.25);
    expect(lightLevel(19)).toBeLessThan(1);
  });
});

describe('eraGrade', () => {
  it('starts sepia in 1900 and reaches full colour in 1965', () => {
    expect(eraGrade(1900)).toEqual({ sepia: 0.45, saturate: 0.85 });
    expect(eraGrade(1965).sepia).toBe(0);
    expect(eraGrade(1965).saturate).toBeCloseTo(1.15);
  });
  it('is constant after 1965', () => {
    expect(eraGrade(1990)).toEqual(eraGrade(1965));
  });
  it('is clamped before 1900', () => {
    expect(eraGrade(1850)).toEqual(eraGrade(1900));
  });
});

describe('cssFilterFor', () => {
  it('formats with two decimals', () => {
    expect(cssFilterFor(1900)).toBe('sepia(0.45) saturate(0.85)');
    expect(cssFilterFor(1990)).toBe('sepia(0.00) saturate(1.15)');
  });
});

describe('seasonTint', () => {
  it('is cool in winter, warm in summer, null otherwise', () => {
    expect(seasonTint(1)).toMatch(/^rgba\(/);
    expect(seasonTint(7)).toMatch(/^rgba\(/);
    expect(seasonTint(1)).not.toBe(seasonTint(7));
    expect(seasonTint(4)).toBeNull();
    expect(seasonTint(10)).toBeNull();
  });
});

describe('applyAtmosphere', () => {
  it('draws a multiply night overlay at night and restores state', () => {
    const { ctx, calls, balanced } = fakeCtx();
    applyAtmosphere(ctx, 800, 600, date(0, 4));
    const night = calls.find((c) => c.comp === 'multiply');
    expect(night).toBeDefined();
    expect(night!.fill).toContain('rgba(10, 20, 60');
    expect(balanced()).toBe(true);
  });

  it('draws no night overlay at midday in spring', () => {
    const { ctx, calls, balanced } = fakeCtx();
    applyAtmosphere(ctx, 800, 600, date(12, 4));
    expect(calls.some((c) => c.comp === 'multiply')).toBe(false);
    expect(balanced()).toBe(true);
  });
});

describe('easeLight', () => {
  it('snaps on the first frame and eases with a ~1.5 s time constant', () => {
    expect(easeLight(null, 12, 16, 1)).toBe(1);
    // one time constant covers ~63% of the gap from 1 to 0.25
    expect(easeLight(1, 23, 1500, 1)).toBeCloseTo(1 - 0.75 * (1 - Math.exp(-1)), 5);
    // a single 16 ms frame barely moves it
    expect(easeLight(1, 23, 16, 1)).toBeGreaterThan(0.99);
  });

  it('never flashes at speed 8: stays at or above the floor through whole days', () => {
    let l: number | null = null;
    let min = 1;
    let maxStep = 0;
    // one game day per 250 ms at speed 8, 60 fps for ~5 s
    for (let f = 0; f < 300; f++) {
      const hour = Math.floor(((f * 16) / 250) * 24) % 24;
      const next: number = easeLight(l, hour, 16, 8);
      if (l !== null) maxStep = Math.max(maxStep, Math.abs(next - l));
      l = next;
      min = Math.min(min, l);
    }
    expect(min).toBeGreaterThanOrEqual(FAST_MIN_LIGHT);
    expect(maxStep).toBeLessThan(0.01);
  });
});

describe('isLit', () => {
  it('is false at noon and true at night, independent of speed easing', () => {
    expect(isLit(12)).toBe(false);
    expect(isLit(22)).toBe(true);
  });
});
