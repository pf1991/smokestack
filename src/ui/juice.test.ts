// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONEY_MILESTONES, RollingCounter, crossedMilestone, rollValue, showStamp } from './juice';

describe('rollValue', () => {
  it('eases out from start to exact end', () => {
    expect(rollValue(0, 100, 0)).toBe(0);
    expect(rollValue(0, 100, 1)).toBe(100);
    expect(rollValue(0, 100, 2)).toBe(100);
    expect(rollValue(0, 100, 0.5)).toBeGreaterThan(50);
  });
});

describe('crossedMilestone', () => {
  it('returns the highest milestone crossed upward', () => {
    expect(MONEY_MILESTONES[0]).toBe(100_000);
    expect(crossedMilestone(90_000, 120_000)).toBe(100_000);
    expect(crossedMilestone(120_000, 90_000)).toBeNull();
    expect(crossedMilestone(50_000, 2_000_000)).toBe(1_000_000);
    expect(crossedMilestone(100_000, 100_500)).toBeNull();
  });
});

describe('RollingCounter', () => {
  const fmt = (n: number) => `$${Math.round(n)}`;
  it('rolls to the target and re-targets from the shown value', () => {
    const el = document.createElement('div');
    const c = new RollingCounter(el, fmt);
    c.set(100, 0);
    c.tick(600);
    expect(el.textContent).toBe('$100');
    c.set(200, 1000);
    c.tick(1300);
    const mid = Number(el.textContent!.slice(1));
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
    c.set(0, 1300);
    c.tick(1300);
    expect(Number(el.textContent!.slice(1))).toBe(mid);
    c.tick(5000);
    expect(el.textContent).toBe('$0');
  });
  it('snap shows the value at once', () => {
    const el = document.createElement('div');
    const c = new RollingCounter(el, fmt);
    c.snap(500);
    expect(el.textContent).toBe('$500');
  });
});

describe('showStamp', () => {
  afterEach(() => vi.useRealTimers());
  it('appends to #ui and removes after 2200ms', () => {
    vi.useFakeTimers();
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.appendChild(ui);
    showStamp('Millionaire', 'good');
    const s = ui.querySelector('.stamp.good');
    expect(s?.textContent).toBe('Millionaire');
    vi.advanceTimersByTime(2200);
    expect(ui.querySelector('.stamp')).toBeNull();
    ui.remove();
  });
  it('offsets simultaneous stamps', () => {
    vi.useFakeTimers();
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.appendChild(ui);
    showStamp('A', 'good');
    showStamp('B', 'good');
    const [a, b] = Array.from(ui.querySelectorAll<HTMLElement>('.stamp'));
    expect(a.style.top).not.toBe(b.style.top);
    ui.remove();
  });
});
