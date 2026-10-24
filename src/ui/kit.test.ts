// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  button, card, dataTable, deltaText, emptyState, meter, panelHeader, pill, section, statRow,
  statTile, tooltip,
} from './kit';

describe('kit', () => {
  it('button variants and shortcut', () => {
    expect(button('Go', {}).className).toBe('btn kit-btn kit-btn--secondary');
    for (const v of ['primary', 'secondary', 'quiet', 'danger'] as const) {
      expect(button('x', { variant: v }).classList.contains(`kit-btn--${v}`)).toBe(true);
    }
    const b = button('Build', { shortcut: 'B', title: 'Build it' });
    expect(b.querySelector('kbd')?.textContent).toBe('B');
    expect(b.title).toBe('Build it (B)');
    const fn = vi.fn();
    button('x', { onClick: fn }).click();
    expect(fn).toHaveBeenCalled();
  });

  it('panelHeader, stat, pill, card, empty', () => {
    const ph = panelHeader({ title: 'T', summary: 'S', tone: 'positive' });
    expect(ph.className).toContain('kit-ph');
    expect(ph.querySelector('.kit-ph-summary')?.getAttribute('data-tone')).toBe('positive');
    const t = statTile({ label: 'L', value: '1', delta: '▲ $1', tone: 'positive' });
    expect(t.classList.contains('kit-stat')).toBe(true);
    expect(t.querySelector('.kit-stat-value')?.textContent).toBe('1');
    expect(statRow([t]).contains(t)).toBe(true);
    expect(pill('a', 'warning').className).toBe('kit-pill kit-pill--warning');
    expect(pill('a').className).toBe('kit-pill kit-pill--neutral');
    expect(card({ title: 'x', children: ['y'] }).className).toContain('kit-card');
    expect(emptyState({ title: 'Nothing' }).className).toContain('kit-empty');
  });

  it('meter clamps', () => {
    expect(meter(5, 10).getAttribute('aria-valuenow')).toBe('5');
    const m = meter(15, 10);
    expect(m.getAttribute('aria-valuenow')).toBe('10');
    expect(m.getAttribute('role')).toBe('meter');
    expect(m.getAttribute('aria-valuemax')).toBe('10');
    expect(() => meter(NaN, 10)).not.toThrow();
    expect(meter(NaN, 10).getAttribute('aria-valuenow')).toBe('0');
  });

  it('dataTable', () => {
    const cols = [
      { key: 'n', label: 'Name', render: (r: { n: string }) => r.n, title: (r: { n: string }) => r.n },
      { key: 'v', label: 'Val', align: 'right' as const, render: () => '1' },
    ];
    const empty = dataTable({ columns: cols, rows: [], emptyText: 'No rows' });
    expect(empty.querySelector('.kit-empty-row')?.textContent).toBe('No rows');
    const fn = vi.fn();
    const t = dataTable({ columns: cols, rows: [{ n: 'Long name' }], emptyText: 'x', onRowClick: fn });
    t.querySelector<HTMLElement>('tbody tr')!.click();
    expect(fn).toHaveBeenCalledWith({ n: 'Long name' });
    expect(t.querySelector('tbody td')?.getAttribute('title')).toBe('Long name');
  });

  it('row keydown ignores events from inner controls', () => {
    const fn = vi.fn();
    const t = dataTable({
      columns: [{ key: 'a', label: 'A', render: () => document.createElement('button') }],
      rows: [{}],
      emptyText: 'x',
      onRowClick: fn,
    });
    const btn = t.querySelector('button')!;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fn).not.toHaveBeenCalled();
    t.querySelector('tbody tr')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('section', () => {
    const s = section('A', ['x'], { collapsible: true, open: false });
    expect(s.tagName).toBe('DETAILS');
    expect((s as HTMLDetailsElement).open).toBe(false);
    const p = section('A', ['x']);
    expect(p.className).toBe('p-section kit-section');
    expect(p.querySelector('h3.p-head')).not.toBeNull();
  });

  describe('tooltip', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
    it('shows after delay and hides on Esc', () => {
      const target = document.createElement('button');
      document.body.appendChild(target);
      const off = tooltip(target, () => 'hello');
      target.dispatchEvent(new Event('pointerenter'));
      vi.advanceTimersByTime(100);
      expect(document.querySelector('.kit-tip.kit-tip--on')).toBeNull();
      vi.advanceTimersByTime(150);
      const tip = document.querySelector('.kit-tip.kit-tip--on');
      expect(tip?.textContent).toBe('hello');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.querySelector('.kit-tip.kit-tip--on')).toBeNull();
      off();
    });
    it('disposer stops it', () => {
      const target = document.createElement('button');
      document.body.appendChild(target);
      tooltip(target, () => 'a')();
      target.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(300);
      expect(document.querySelector('.kit-tip--on')).toBeNull();
    });
  });

  it('deltaText', () => {
    expect(deltaText(4077)).toBe('▲ $4,077');
    expect(deltaText(-12000)).toBe('▼ $12,000');
    expect(deltaText(0)).toBe('$0');
  });
});
