// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../game/settings';
import type { NewsItem } from '../sim/types';
import { Ticker } from './ticker';

const item = (headline: string): NewsItem => ({ headline } as NewsItem);

function setup(mode: 'scroll' | 'headline' | 'off', initial: NewsItem[] = [item('Old news'), item('Latest news')]) {
  localStorage.clear();
  saveSettings({ ...DEFAULT_SETTINGS, ticker: mode });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const bus = new EventBus();
  const open = vi.fn();
  Ticker.attach(el, bus, initial, open);
  return { el, bus, open };
}

describe('Ticker', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to headline mode and round-trips the setting', () => {
    expect(loadSettings().ticker).toBe('headline');
    for (const m of ['scroll', 'headline', 'off'] as const) {
      saveSettings({ ...DEFAULT_SETTINGS, ticker: m });
      expect(loadSettings().ticker).toBe(m);
    }
    localStorage.setItem('smokestack:settings', JSON.stringify({ ticker: 'bogus' }));
    expect(loadSettings().ticker).toBe('headline');
  });

  it('headline mode shows only the latest headline; a click opens the newspaper', () => {
    const { el, open } = setup('headline');
    expect(el.textContent).toBe('Latest news');
    expect(el.querySelector('.ticker-track')).toBeNull();
    el.click();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('follows new headlines', () => {
    const { el, bus } = setup('headline');
    bus.emit({ type: 'news', item: item('Fresh') });
    expect(el.textContent).toBe('Fresh');
  });

  it('scroll mode keeps the scrolling track', () => {
    const { el } = setup('scroll');
    expect(el.querySelector('.ticker-track')).not.toBeNull();
    expect(el.textContent).toContain('Old news');
  });

  it('off hides the strip, and a settings change applies live', () => {
    const { el } = setup('off');
    expect(el.hidden).toBe(true);
    saveSettings({ ...DEFAULT_SETTINGS, ticker: 'headline' });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('Latest news');
    saveSettings({ ...DEFAULT_SETTINGS, ticker: 'off' });
    expect(el.hidden).toBe(true);
  });

  it('the headline strip is a keyboard-reachable button', () => {
    const { el, open } = setup('headline');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.tabIndex).toBe(0);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('the scroll strip is not a button', () => {
    const { el, open } = setup('scroll');
    expect(el.getAttribute('role')).toBeNull();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it('the detach function stops listening to settings changes', () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, ticker: 'scroll' });
    const el = document.createElement('div');
    const off = Ticker.attach(el, new EventBus(), [], undefined);
    off();
    saveSettings({ ...DEFAULT_SETTINGS, ticker: 'off' });
    expect(el.hidden).toBe(false);
  });
});
