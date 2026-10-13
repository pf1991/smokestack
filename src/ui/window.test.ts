// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { h } from './dom';
import { closeAllWindows, COMPACT_WIDTH, createWindow, MAX_FLOATING, placeWindow, Z_RENUMBER_AT } from './window';
import { openInspector, type InspectorHost } from './panels/inspect';

const open = (id: string) => createWindow({ id, title: `Win ${id}`, content: h('div', null, id), width: 300 });
const tabs = () => [...document.querySelectorAll<HTMLElement>('.dock-tab')];

afterEach(() => {
  closeAllWindows();
  document.body.innerHTML = '';
});

describe('window manager', () => {
  it('docks the least recently focused window beyond MAX_FLOATING', () => {
    expect(MAX_FLOATING).toBe(2);
    const a = open('a');
    const b = open('b');
    const c = open('c');
    const floating = [a, b, c].filter((w) => !w.docked);
    expect(floating).toHaveLength(2);
    expect(a.docked).toBe(true);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].textContent).toContain('Win a');
    expect(b.docked).toBe(false);
    expect(c.docked).toBe(false);
  });

  it('clicking a tab undocks that window and docks the next-oldest', () => {
    const a = open('a');
    const b = open('b');
    const c = open('c');
    tabs()[0].click();
    expect(a.docked).toBe(false);
    expect(b.docked).toBe(true);
    expect(c.docked).toBe(false);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].textContent).toContain('Win b');
  });

  it('closing a docked window removes its tab', () => {
    const a = open('a');
    open('b');
    open('c');
    a.close();
    expect(tabs()).toHaveLength(0);
  });

  it('the tab close button closes the window', () => {
    const a = open('a');
    open('b');
    open('c');
    const btn = tabs()[0].querySelector<HTMLElement>('button')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    btn.click();
    expect(tabs()).toHaveLength(0);
    expect(document.body.contains(a.el)).toBe(false);
  });

  it('reopening a docked window by id undocks and raises it', () => {
    const a = open('a');
    open('b');
    open('c');
    const again = open('a');
    expect(again).toBe(a);
    expect(a.docked).toBe(false);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].textContent).not.toContain('Win a');
  });

  it('reopening through openInspector (the panel path) undocks a docked window', () => {
    const host = {} as InspectorHost;
    const view = () => ({ el: h('div'), update: () => true });
    const opts = (id: string) => ({ id, title: `Insp ${id}`, width: 300, build: view });
    openInspector(host, opts('i1'));
    openInspector(host, opts('i2'));
    openInspector(host, opts('i3'));
    expect(tabs().map((t) => t.textContent)).toEqual([expect.stringContaining('Insp i1')]);
    openInspector(host, opts('i1'));
    expect(tabs().map((t) => t.textContent)).toEqual([expect.stringContaining('Insp i2')]);
  });

  it('a dragged window keeps its position while docked; undocking returns it to a slot', () => {
    const a = open('a');
    a.el.style.left = '123px';
    a.el.style.top = '222px';
    open('b');
    open('c');
    expect(a.docked).toBe(true);
    expect(a.el.style.left).toBe('123px');
    expect(a.el.style.top).toBe('222px');
    a.undock();
    expect(a.docked).toBe(false);
    expect(a.el.style.left).not.toBe('123px');
    expect(a.el.style.top).not.toBe('222px');
  });

  it('five windows: 2 floating, 3 tabs, each tab reachable', () => {
    const ws = ['a', 'b', 'c', 'd', 'e'].map(open);
    const floatingCount = () => ws.filter((w) => !w.docked).length;
    expect(floatingCount()).toBe(2);
    expect(tabs()).toHaveLength(3);
    for (const w of ws.filter((x) => x.docked)) {
      const tab = tabs().find((t) => t.textContent?.includes(w.el.querySelector('.window-title span')!.textContent!));
      tab!.click();
      expect(w.docked).toBe(false);
      expect(floatingCount()).toBe(2);
      expect(tabs()).toHaveLength(3);
    }
    const docked = ws.find((w) => w.docked)!;
    docked.close();
    expect(tabs()).toHaveLength(2);
  });

  it('renumbers open windows compactly from 100 when the z counter passes Z_RENUMBER_AT, keeping their order (M12)', () => {
    expect(Z_RENUMBER_AT).toBe(3000);
    const a = open('a');
    const b = open('b');
    const z = (w: { el: HTMLElement }) => Number(w.el.style.zIndex);
    // raise a and b alternately until the counter has passed the threshold
    for (let i = 0; i < Z_RENUMBER_AT; i++) open(i % 2 ? 'a' : 'b');
    for (let i = 0; i < 10; i++) {
      open('a');
      expect(z(a)).toBeLessThanOrEqual(Z_RENUMBER_AT + 1);
      expect(z(a)).toBeGreaterThan(z(b));
      open('b');
      expect(z(b)).toBeGreaterThan(z(a));
    }
    expect(z(b)).toBeLessThan(400); // renumbered, then ~120 raises more
    expect(Math.min(z(a), z(b))).toBeGreaterThanOrEqual(100);
    // a new window still opens on top
    const c = open('c');
    expect(z(c)).toBeGreaterThan(Math.max(z(a), z(b)));
  });

  it('closeAllWindows clears every tab', () => {
    ['a', 'b', 'c', 'd'].forEach(open);
    expect(tabs().length).toBeGreaterThan(0);
    closeAllWindows();
    expect(tabs()).toHaveLength(0);
  });
});

describe('placeWindow', () => {
  it('keeps windows under the HUD and inside a compact viewport', () => {
    const p = placeWindow(1366, 768, 64, 700, 0, 520);
    expect(COMPACT_WIDTH).toBe(1366);
    expect(p.top).toBeGreaterThanOrEqual(72);
    expect(p.left + 420).toBeLessThanOrEqual(1366);
    expect(p.top + p.maxHeight!).toBeLessThanOrEqual(692);
  });

  it('puts index 1 to the left of index 0 without overlap', () => {
    const p0 = placeWindow(1920, 1080, 64, 1000, 0, 480);
    const p1 = placeWindow(1920, 1080, 64, 1000, 1, 480);
    expect(p1.left + 480).toBeLessThanOrEqual(p0.left);
    expect(p0.left + 480).toBeLessThanOrEqual(1920);
  });
});
