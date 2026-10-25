// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyUiScale, currentUiScale, resolveUiScale, startUiScale } from './scale';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../game/settings';

describe('ui scale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--ui-scale');
  });

  it("'auto' resolves by viewport width", () => {
    expect(resolveUiScale('auto', 390)).toBe(0.75);
    expect(resolveUiScale('auto', 599)).toBe(0.75);
    expect(resolveUiScale('auto', 600)).toBe(0.8);
    expect(resolveUiScale('auto', 899)).toBe(0.8);
    expect(resolveUiScale('auto', 1366)).toBe(0.9);
    expect(resolveUiScale('auto', 1439)).toBe(0.9);
    expect(resolveUiScale('auto', 1440)).toBe(1);
    expect(resolveUiScale('auto', 1920)).toBe(1);
    expect(resolveUiScale('auto', 2200)).toBe(1);
    expect(resolveUiScale('auto', 2560)).toBe(1.15);
    expect(resolveUiScale(1.3, 1366)).toBe(1.3);
  });

  it('the setting defaults to auto and round-trips', () => {
    expect(DEFAULT_SETTINGS.uiScale).toBe('auto');
    expect(loadSettings().uiScale).toBe('auto');
    saveSettings({ ...loadSettings(), uiScale: 1.15 });
    expect(loadSettings().uiScale).toBe(1.15);
    saveSettings({ ...loadSettings(), uiScale: 'auto' });
    expect(loadSettings().uiScale).toBe('auto');
    localStorage.setItem('smokestack:settings', JSON.stringify({ uiScale: 7 }));
    expect(loadSettings().uiScale).toBe('auto');
  });

  it('applyUiScale sets --ui-scale on the root element', () => {
    applyUiScale(0.8);
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('0.8');
    expect(currentUiScale()).toBe(0.8);
  });

  it('auto mode re-applies on window resize and follows saved changes', () => {
    const stop = startUiScale();
    expect(currentUiScale()).toBe(resolveUiScale('auto', window.innerWidth));
    saveSettings({ ...loadSettings(), uiScale: 1.3 });
    expect(currentUiScale()).toBe(1.3);
    saveSettings({ ...loadSettings(), uiScale: 'auto' });
    Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(currentUiScale()).toBe(0.9);
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(currentUiScale()).toBe(1);
    stop();
  });

  it('never zooms the map canvas', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    applyUiScale(1.3);
    expect(canvas.style.getPropertyValue('zoom')).toBe('');
    expect(getComputedStyle(canvas).getPropertyValue('zoom')).not.toBe('1.3');
  });

  it('forces the scale to 1 where CSS zoom is unsupported', () => {
    const real = (globalThis as { CSS?: unknown }).CSS;
    (globalThis as { CSS?: unknown }).CSS = { supports: (p: string) => p !== 'zoom' };
    try {
      applyUiScale(1.3);
      expect(currentUiScale()).toBe(1);
    } finally {
      (globalThis as { CSS?: unknown }).CSS = real;
    }
  });
});
