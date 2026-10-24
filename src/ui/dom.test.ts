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

  it('flattens nested arrays of children', () => {
    const items = ['a', 'b'].map((t) => h('li', null, t));
    const ul = h('ul', null, items, [[h('li', null, 'c')]], 42);
    expect(ul.children.length).toBe(3);
    expect(ul.textContent).toBe('abc42');
  });

  it('sets value, checked, selected and disabled as DOM properties', () => {
    const input = h('input', { type: 'text', value: 'hello' }) as HTMLInputElement;
    expect(input.value).toBe('hello');
    expect(input.hasAttribute('value')).toBe(false);

    const box = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.hasAttribute('checked')).toBe(false);

    const opt = h('option', { selected: true }) as HTMLOptionElement;
    expect(opt.selected).toBe(true);
    expect(opt.hasAttribute('selected')).toBe(false);

    const btn = h('button', { disabled: true }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('ignores on* props that are not functions and never writes inline handlers', () => {
    const el = h('button', { onClick: 'alert(1)' } as Record<string, unknown>);
    expect(el.hasAttribute('onclick')).toBe(false);
    expect(el.getAttribute('onClick')).toBeNull();
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

  const pointer = (target: EventTarget, type: string, x: number, y: number) =>
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

  it('the title bar does not drag the window: it lives in the side panel', () => {
    const win = createWindow({ id: 'd1', title: 'T', content: h('div') });
    const title = win.el.querySelector('.window-title') as HTMLElement;
    pointer(title, 'pointerdown', 300, 300);
    pointer(document, 'pointermove', 320, 310);
    pointer(document, 'pointerup', 320, 310);
    expect(win.el.style.left).toBe('');
    expect(win.el.style.top).toBe('');
    expect(win.el.closest('.side-panel')).not.toBeNull();
    win.close();
    expect(win.el.isConnected).toBe(false);
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

  it('each toast carries a tone icon and its text', () => {
    const root = document.createElement('div');
    const bus = new EventBus();
    Toasts.attach(root, bus);
    bus.emit({ type: 'toast', message: 'Sold!', tone: 'good' });
    bus.emit({ type: 'toast', message: 'Broke!', tone: 'bad' });
    bus.emit({ type: 'toast', message: 'Note', tone: 'info' });
    const toasts = [...root.querySelectorAll<HTMLElement>('.toast')];
    expect(toasts.map((t) => t.dataset.tone)).toEqual(['positive', 'negative', 'info']);
    expect(toasts.map((t) => (t.querySelector('img.icon') as HTMLElement).dataset.icon)).toEqual(['positive', 'negative', 'info']);
    expect(toasts[1].querySelector('.toast-text')!.textContent).toBe('Broke!');
  });

  it('a fourth toast removes the first', () => {
    const root = document.createElement('div');
    const bus = new EventBus();
    Toasts.attach(root, bus);
    for (let i = 0; i < 3; i++) bus.emit({ type: 'toast', message: `m${i}`, tone: 'info' });
    expect(root.querySelectorAll('.toast').length).toBe(3);
    bus.emit({ type: 'toast', message: 'm3', tone: 'info' });
    expect([...root.querySelectorAll('.toast')].map((t) => t.textContent)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps at most three toasts and removes each after four seconds', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const bus = new EventBus();
    Toasts.attach(root, bus);
    for (let i = 0; i < 6; i++) bus.emit({ type: 'toast', message: `m${i}`, tone: 'info' });
    expect(root.querySelectorAll('.toast').length).toBe(3);
    expect(root.querySelector('.toast')?.textContent).toBe('m3');
    vi.advanceTimersByTime(4000);
    expect(root.querySelectorAll('.toast').length).toBe(0);
  });

  it('evicted toasts have their timers cleared', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const bus = new EventBus();
    Toasts.attach(root, bus);
    for (let i = 0; i < 6; i++) bus.emit({ type: 'toast', message: `m${i}`, tone: 'info' });
    expect(vi.getTimerCount()).toBe(3);
  });

  it('returned unsubscribe stops toasts and clears all timers', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const bus = new EventBus();
    const off = Toasts.attach(root, bus);
    bus.emit({ type: 'toast', message: 'a', tone: 'info' });
    bus.emit({ type: 'toast', message: 'b', tone: 'info' });
    off();
    expect(vi.getTimerCount()).toBe(0);
    expect(root.querySelectorAll('.toast-stack').length).toBe(0);
    bus.emit({ type: 'toast', message: 'x', tone: 'info' });
    expect(root.querySelectorAll('.toast').length).toBe(0);
  });
});
