// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from './dom';
import { createWindow } from './window';
import { Toasts } from './toasts';
import { EventBus } from '../core/events';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('h', () => {
  it('creates an element with attributes, class and style', () => {
    const el = h('div', { id: 'a', class: 'x y', style: { color: 'red' }, title: 'hi' });
    expect(el.tagName).toBe('DIV');
    expect(el.id).toBe('a');
    expect(el.className).toBe('x y');
    expect(el.style.color).toBe('red');
    expect(el.getAttribute('title')).toBe('hi');
  });

  it('appends string and node children and skips null and false', () => {
    const child = h('span', null, 'inner');
    const el = h('p', null, 'text ', child, false, null);
    expect(el.childNodes.length).toBe(2);
    expect(el.textContent).toBe('text inner');
  });

  it('attaches on* props as event listeners', () => {
    const fn = vi.fn();
    const el = h('button', { onClick: fn }, 'go');
    el.click();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maps multi-word on* props to lowercase DOM event names', () => {
    const fn = vi.fn();
    const el = h('div', { onMouseDown: fn });
    el.dispatchEvent(new MouseEvent('mousedown'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('accepts a null props argument', () => {
    expect(h('i', null).tagName).toBe('I');
  });
});

describe('createWindow', () => {
  it('appends a window with title, body and a close button', () => {
    const content = h('div', null, 'body text');
    const win = createWindow({ id: 'w1', title: 'Finances', content });
    expect(win.el.classList.contains('window')).toBe(true);
    expect(win.el.querySelector('.window-title')?.textContent).toContain('Finances');
    expect(win.el.querySelector('.window-body')?.textContent).toContain('body text');
    expect(win.el.isConnected).toBe(true);
    win.close();
    expect(win.el.isConnected).toBe(false);
  });

  it('reopening the same id returns the existing window', () => {
    const a = createWindow({ id: 'same', title: 'A', content: h('div') });
    const b = createWindow({ id: 'same', title: 'A', content: h('div') });
    expect(b.el).toBe(a.el);
    a.close();
  });

  it('close button closes the window and calls onClose', () => {
    const onClose = vi.fn();
    const win = createWindow({ id: 'c1', title: 'T', content: h('div'), onClose });
    (win.el.querySelector('.window-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(win.el.isConnected).toBe(false);
  });

  it('dragging the title bar moves the window', () => {
    const win = createWindow({ id: 'd1', title: 'T', content: h('div') });
    const title = win.el.querySelector('.window-title') as HTMLElement;
    title.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 40, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(win.el.style.left).toBe('50px');
    expect(win.el.style.top).toBe('30px');
    win.close();
  });

  it('setContent replaces the body', () => {
    const win = createWindow({ id: 's1', title: 'T', content: h('div', null, 'old') });
    win.setContent(h('div', null, 'new'));
    expect(win.el.querySelector('.window-body')?.textContent).toBe('new');
    win.close();
  });
});

describe('Toasts', () => {
  it('shows toast events with a tone class', () => {
    const root = document.createElement('div');
    const bus = new EventBus();
    Toasts.attach(root, bus);
    bus.emit({ type: 'toast', message: 'Sold!', tone: 'good' });
    bus.emit({ type: 'toast', message: 'Broke!', tone: 'bad' });
    const toasts = root.querySelectorAll('.toast');
    expect(toasts.length).toBe(2);
    expect(toasts[0].classList.contains('good')).toBe(true);
    expect(toasts[1].classList.contains('bad')).toBe(true);
    expect(toasts[0].textContent).toBe('Sold!');
  });

  it('keeps at most four toasts and removes each after four seconds', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const bus = new EventBus();
    Toasts.attach(root, bus);
    for (let i = 0; i < 6; i++) bus.emit({ type: 'toast', message: `m${i}`, tone: 'info' });
    expect(root.querySelectorAll('.toast').length).toBe(4);
    expect(root.querySelector('.toast')?.textContent).toBe('m2');
    vi.advanceTimersByTime(4000);
    expect(root.querySelectorAll('.toast').length).toBe(0);
  });

  it('returned unsubscribe stops toasts', () => {
    const root = document.createElement('div');
    const bus = new EventBus();
    const off = Toasts.attach(root, bus);
    off();
    bus.emit({ type: 'toast', message: 'x', tone: 'info' });
    expect(root.querySelectorAll('.toast').length).toBe(0);
  });
});
