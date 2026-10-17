// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h } from './dom';
import { closeAllWindows, createWindow } from './window';
import { clampPanelWidth, closeActiveTab, MAX_TABS, MIN_PANEL_W, RAIL_W, sidePanelEl } from './sidePanel';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../game/settings';

const open = (id: string, title = `Win ${id}`) => createWindow({ id, title, content: h('div', null, id) });
const panel = () => document.querySelector<HTMLElement>('.side-panel');
const tabs = () => [...document.querySelectorAll<HTMLElement>('.side-panel [role="tab"]')];
const shown = (w: { el: HTMLElement }) => w.el.style.display !== 'none';
const pointer = (target: EventTarget, type: string, x: number) =>
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 100, bubbles: true }));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  closeAllWindows();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('side panel tabs', () => {
  it('opening finance then politics shows politics active and finance hidden, with 2 tabs', () => {
    const fin = open('finance', 'Finance');
    const pol = open('politics', 'Politics');
    expect(tabs()).toHaveLength(2);
    expect(tabs().map((t) => t.textContent)).toEqual(['Finance', 'Politics']);
    expect(shown(pol)).toBe(true);
    expect(shown(fin)).toBe(false);
    expect(pol.docked).toBe(false);
    expect(fin.docked).toBe(true);
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('false');
    expect(panel()!.querySelector('[role="tablist"]')).not.toBeNull();
    // both windows live in the panel
    expect(panel()!.contains(fin.el)).toBe(true);
    expect(panel()!.contains(pol.el)).toBe(true);
  });

  it('a hidden tab keeps its content and keeps receiving setContent', () => {
    const fin = open('finance');
    open('politics');
    fin.setContent(h('div', null, 'updated'));
    expect(fin.el.querySelector('.window-body')!.textContent).toBe('updated');
    expect(shown(fin)).toBe(false);
  });

  it('opening finance again focuses it and keeps 2 tabs', () => {
    const fin = open('finance');
    const pol = open('politics');
    const again = open('finance');
    expect(again).toBe(fin);
    expect(tabs()).toHaveLength(2);
    expect(shown(fin)).toBe(true);
    expect(shown(pol)).toBe(false);
  });

  it('clicking a tab shows it', () => {
    const fin = open('finance');
    const pol = open('politics');
    tabs()[0].click();
    expect(shown(fin)).toBe(true);
    expect(shown(pol)).toBe(false);
  });

  it(`seven opens leave ${MAX_TABS} tabs and close the oldest`, () => {
    expect(MAX_TABS).toBe(6);
    const ws = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => open(id));
    expect(tabs()).toHaveLength(6);
    expect(ws[0].el.isConnected).toBe(false);
    expect(tabs().map((t) => t.textContent)).not.toContain('Win a');
    expect(shown(ws[6])).toBe(true);
  });

  it('the seventh open closes the least recently focused tab, not the first opened', () => {
    const ws = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => open(id));
    open('a'); // focus a: b is now the least recently focused
    open('g');
    expect(ws[0].el.isConnected).toBe(true);
    expect(ws[1].el.isConnected).toBe(false);
  });

  it('closing the active tab activates the most recent remaining one', () => {
    const a = open('a');
    open('b');
    const c = open('c');
    open('a'); // order of focus: b, c, a
    a.close();
    expect(shown(c)).toBe(true);
    expect(tabs()).toHaveLength(2);
  });

  it('the tab close button closes that window and calls onClose', () => {
    let closed = 0;
    createWindow({ id: 'x', title: 'X', content: h('div'), onClose: () => closed++ });
    open('y');
    const btn = tabs()[0].querySelector<HTMLElement>('button')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    expect(btn.getAttribute('title')).toBeTruthy();
    btn.click();
    expect(closed).toBe(1);
    expect(tabs()).toHaveLength(1);
  });

  it('closing the last tab hides the panel', () => {
    const a = open('a');
    expect(panel()!.hidden).toBe(false);
    a.close();
    expect(tabs()).toHaveLength(0);
    expect(panel()!.hidden).toBe(true);
  });

  it('closeAllWindows clears every tab', () => {
    ['a', 'b', 'c', 'd'].forEach((id) => open(id));
    closeAllWindows();
    expect(tabs()).toHaveLength(0);
    expect(panel()!.hidden).toBe(true);
  });
});

describe('side panel width', () => {
  it('clamps to 320 and to 60% of the viewport', () => {
    expect(MIN_PANEL_W).toBe(320);
    expect(clampPanelWidth(100, 1366)).toBe(320);
    expect(clampPanelWidth(5000, 1366)).toBeCloseTo(0.6 * 1366);
    expect(clampPanelWidth(500, 1366)).toBe(500);
  });

  it('defaults to min(420px, 34vw) when no width is saved', () => {
    open('a');
    expect(panel()!.style.width).toBe('min(420px, 34vw)');
  });

  it('dragging the grip resizes, clamps and persists through settings', () => {
    open('a');
    const grip = panel()!.querySelector<HTMLElement>('.side-panel-grip')!;
    expect(grip).not.toBeNull();
    const start = Math.min(420, 0.34 * window.innerWidth); // the default width (jsdom has no layout)
    pointer(grip, 'pointerdown', 600);
    pointer(document, 'pointermove', 500); // 100 px to the left: wider
    pointer(document, 'pointerup', 500);
    const w1 = parseFloat(panel()!.style.width);
    expect(w1).toBe(clampPanelWidth(start + 100, window.innerWidth));
    expect(loadSettings().panelWidth).toBe(w1);

    pointer(grip, 'pointerdown', 600);
    pointer(document, 'pointermove', 5000); // far right: clamps at 320
    pointer(document, 'pointerup', 5000);
    expect(panel()!.style.width).toBe('320px');
    expect(loadSettings().panelWidth).toBe(320);

    pointer(grip, 'pointerdown', 600);
    pointer(document, 'pointermove', -5000); // far left: clamps at 60% of the viewport
    pointer(document, 'pointerup', -5000);
    expect(parseFloat(panel()!.style.width)).toBeCloseTo(0.6 * window.innerWidth);
  });

  it('a saved width is used when the panel opens', () => {
    saveSettings({ ...DEFAULT_SETTINGS, panelWidth: 380 });
    open('a');
    expect(panel()!.style.width).toBe('380px');
  });

  it('loadSettings rejects a malformed panelWidth', () => {
    localStorage.setItem('smokestack:settings', JSON.stringify({ panelWidth: 'wide' }));
    expect(loadSettings().panelWidth).toBeNull();
    localStorage.setItem('smokestack:settings', JSON.stringify({ panelWidth: -4 }));
    expect(loadSettings().panelWidth).toBeNull();
    localStorage.setItem('smokestack:settings', JSON.stringify({ panelWidth: 400 }));
    expect(loadSettings().panelWidth).toBe(400);
    expect(DEFAULT_SETTINGS.panelWidth).toBeNull();
  });
});

describe('side panel collapse', () => {
  it('collapse, then the rail click, expands it', () => {
    const a = open('a');
    open('b');
    const btn = panel()!.querySelector<HTMLElement>('.side-panel-collapse')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    expect(btn.getAttribute('title')).toBeTruthy();
    btn.click();
    expect(panel()!.classList.contains('collapsed')).toBe(true);
    expect(panel()!.style.width).toBe(`${RAIL_W}px`);
    const rail = panel()!.querySelector<HTMLElement>('.side-panel-rail')!;
    expect(rail.textContent).toContain('2');
    expect(a.docked).toBe(true);
    rail.click();
    expect(panel()!.classList.contains('collapsed')).toBe(false);
    expect(panel()!.style.width).toBe('min(420px, 34vw)');
  });

  it('dock() collapses the panel and undock() focuses that tab and expands it', () => {
    const a = open('a');
    const b = open('b');
    b.dock();
    expect(panel()!.classList.contains('collapsed')).toBe(true);
    expect(b.docked).toBe(true);
    a.undock();
    expect(panel()!.classList.contains('collapsed')).toBe(false);
    expect(a.docked).toBe(false);
    expect(shown(a)).toBe(true);
    expect(shown(b)).toBe(false);
  });

  it('reopening an open window expands a collapsed panel', () => {
    const a = open('a');
    a.dock();
    open('a');
    expect(panel()!.classList.contains('collapsed')).toBe(false);
    expect(a.docked).toBe(false);
  });
});

describe('closeActiveTab', () => {
  it('closes the active tab and reports it', () => {
    open('a');
    const b = open('b');
    expect(closeActiveTab()).toBe(true);
    expect(b.el.isConnected).toBe(false);
    expect(tabs()).toHaveLength(1);
  });

  it('returns false when there is no tab', () => {
    expect(closeActiveTab()).toBe(false);
  });

  it('the panel sits at z-index 100 and is the element sidePanelEl returns', () => {
    open('a');
    expect(sidePanelEl()).toBe(panel());
    expect(panel()!.style.zIndex).toBe('100');
  });
});

describe('side panel width variable', () => {
  it('publishes --side-panel-w for the toast stack (0px when no tab is open)', () => {
    const a = open('a');
    const v = () => document.documentElement.style.getPropertyValue('--side-panel-w');
    expect(v()).toBe('min(420px, 34vw)');
    a.dock();
    expect(v()).toBe(`${RAIL_W}px`);
    a.close();
    expect(v()).toBe('0px');
  });
});
