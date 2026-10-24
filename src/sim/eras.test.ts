import { describe, expect, it } from 'vitest';
import type { EventBus } from '../core/events';
import { checkUnlocks, eraBanner, eraName, fadeWarnings, isUnlocked } from './eras';
import { testCtx, testState } from './testkit';

function at(year: number, month = 1, day = 1) {
  const state = testState({ year: 1900 });
  state.date = { year, month, day, hour: 0 };
  return testCtx(state);
}

describe('eras', () => {
  it('cars unlocked on 1 Jan 1910 with one news item', () => {
    const ctx = at(1910);
    expect(isUnlocked(ctx.state, 'cars')).toBe(false);
    const unlocks: string[] = [];
    (ctx.bus as EventBus).on('unlock', (e) => unlocks.push(e.defId));
    checkUnlocks(ctx);
    expect(isUnlocked(ctx.state, 'cars')).toBe(true);
    expect(unlocks).toContain('cars');
    const carNews = ctx.state.news.filter((n) => n.kind === 'invention' && /HORSELESS/.test(n.headline));
    expect(carNews).toHaveLength(1);
  });
  it('no duplicate unlock', () => {
    const ctx = at(1910);
    checkUnlocks(ctx);
    const n = ctx.state.news.length;
    const u = ctx.state.unlocked.length;
    checkUnlocks(ctx);
    expect(ctx.state.news).toHaveLength(n);
    expect(ctx.state.unlocked).toHaveLength(u);
  });
  it('oil revealed in 1910', () => {
    const ctx = at(1909, 12, 30);
    checkUnlocks(ctx);
    expect(ctx.state.flags.oilRevealed).toBeUndefined();
    ctx.state.date = { year: 1910, month: 1, day: 1, hour: 0 };
    checkUnlocks(ctx);
    expect(ctx.state.flags.oilRevealed).toBe(true);
    expect(ctx.state.news.some((n) => /BLACK GOLD/.test(n.headline))).toBe(true);
  });
  it('eraName(1955)==="Atomic Age"', () => {
    expect(eraName(1955)).toBe('Atomic Age');
    expect(eraName(1900)).toBe('Steam Age');
    expect(eraName(2000)).toBe('Silicon Age');
  });
  it('radio fade warning in 1964', () => {
    const ctx = at(1964, 12, 30);
    fadeWarnings(ctx);
    expect(ctx.state.news.some((n) => n.kind === 'warning' && /Radios/.test(n.headline))).toBe(true);
    expect(ctx.state.news.some((n) => n.body === 'Demand for radios is expected to decline from next year.')).toBe(true);
    const c2 = at(1963, 12, 30);
    fadeWarnings(c2);
    expect(c2.state.news).toHaveLength(0);
  });
  it('phonograph fade warning in 1954 uses the plural', () => {
    const ctx = at(1954, 12, 30);
    fadeWarnings(ctx);
    expect(ctx.state.news.some((n) =>
      n.kind === 'warning' && n.body === 'Demand for phonographs is expected to decline from next year.')).toBe(true);
  });
  it('1905 checkUnlocks publishes the phonograph headline', () => {
    const ctx = at(1905);
    checkUnlocks(ctx);
    expect(ctx.state.news.some((n) =>
      n.kind === 'invention' && n.headline === 'TALKING MACHINES: The phonograph sings in the parlour')).toBe(true);
  });
  it('radio halving warning in 1972', () => {
    const ctx = at(1972, 12, 30);
    fadeWarnings(ctx);
    expect(ctx.state.news.filter((n) => n.kind === 'warning')).toHaveLength(1);
  });
  it('era banner on 1 Jan 1920 only', () => {
    const ctx = at(1920);
    const toasts: string[] = [];
    (ctx.bus as EventBus).on('toast', (e) => toasts.push(e.message));
    eraBanner(ctx);
    expect(toasts).toEqual(['The Roaring Age begins!']);
    expect(ctx.state.news.some((n) => n.kind === 'historic')).toBe(true);
    const c2 = at(1921);
    eraBanner(c2);
    expect(c2.state.news).toHaveLength(0);
  });
});
