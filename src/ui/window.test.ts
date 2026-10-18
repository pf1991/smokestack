// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { h } from './dom';
import * as windowModule from './window';
import { closeAllWindows, createWindow } from './window';
import { openInspector, type InspectorHost } from './panels/inspect';

const open = (id: string) => createWindow({ id, title: `Win ${id}`, content: h('div', null, id), width: 300 });
const tabs = () => [...document.querySelectorAll<HTMLElement>('.side-panel [role="tab"]')];
const active = () => [...document.querySelectorAll<HTMLElement>('.side-panel .window')].filter((w) => w.style.display !== 'none');

afterEach(() => {
  closeAllWindows();
  document.body.innerHTML = '';
});

describe('window manager (side panel)', () => {
  it('drops the floating-window API and the dock strip', () => {
    const mod = windowModule as Record<string, unknown>;
    expect(mod.MAX_FLOATING).toBeUndefined();
    expect(mod.placeWindow).toBeUndefined();
    open('a');
    open('b');
    open('c');
    expect(document.querySelector('.dock')).toBeNull();
    expect(document.querySelector('.dock-tab')).toBeNull();
  });

  it('every window keeps .window, .window-title, .window-body and .window-close', () => {
    const a = open('a');
    expect(a.el.classList.contains('window')).toBe(true);
    expect(a.el.querySelector('.window-title')!.textContent).toContain('Win a');
    expect(a.el.querySelector('.window-body')!.textContent).toBe('a');
    (a.el.querySelector('.window-close') as HTMLElement).click();
    expect(a.el.isConnected).toBe(false);
  });

  it('only the most recently opened window is displayed; the rest are tabs', () => {
    const ws = ['a', 'b', 'c'].map(open);
    expect(tabs()).toHaveLength(3);
    expect(active()).toEqual([ws[2].el]);
    expect(ws.map((w) => w.docked)).toEqual([true, true, false]);
  });

  it('every tab is reachable by clicking it', () => {
    const ws = ['a', 'b', 'c', 'd', 'e'].map(open);
    for (const [i, w] of ws.entries()) {
      tabs()[i].click();
      expect(active()).toEqual([w.el]);
      expect(w.docked).toBe(false);
      expect(tabs()).toHaveLength(5);
    }
  });

  it('reopening through openInspector (the panel path) focuses that tab', () => {
    const host = {} as InspectorHost;
    const view = () => ({ el: h('div'), update: () => true });
    const opts = (id: string) => ({ id, title: `Insp ${id}`, width: 300, build: view });
    openInspector(host, opts('i1'));
    openInspector(host, opts('i2'));
    openInspector(host, opts('i3'));
    expect(tabs()).toHaveLength(3);
    openInspector(host, opts('i1'));
    expect(tabs()).toHaveLength(3);
    expect(active()[0].querySelector('.window-title')!.textContent).toContain('Insp i1');
  });

  it('a window width option is not applied to the window element: windows fill the panel', () => {
    const a = open('a');
    expect(a.el.style.width).toBe('');
  });
});

describe('tabTitle', () => {
  it('the tab shows the short title; the tooltip and aria-label keep the full one', () => {
    createWindow({ id: 'fam', title: 'The Gilded Family', tabTitle: 'Family', content: h('div') });
    createWindow({ id: 'plain', title: 'Plain', content: h('div') });
    const [fam, plain] = tabs();
    expect(fam.querySelector('.side-panel-tab-title')?.textContent).toBe('Family');
    expect(fam.title).toBe('The Gilded Family');
    expect(fam.getAttribute('aria-label')).toBe('The Gilded Family');
    expect(plain.querySelector('.side-panel-tab-title')?.textContent).toBe('Plain');
  });
});
