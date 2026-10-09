import { h } from './dom';

export interface WindowOptions {
  id: string;
  title: string;
  content: HTMLElement;
  onClose?: () => void;
  width?: number;
}

export interface GameWindow {
  el: HTMLElement;
  close(): void;
  setContent(el: HTMLElement): void;
}

const open = new Map<string, GameWindow>();
let zTop = 100;

/**
 * Creates a draggable brass-framed window appended to document.body.
 * If a window with the same id is already open, that window is returned (and raised).
 */
export function createWindow(opts: WindowOptions): GameWindow {
  const existing = open.get(opts.id);
  if (existing) {
    existing.el.style.zIndex = String(++zTop);
    return existing;
  }

  const body = h('div', { class: 'window-body' }, opts.content);
  const closeBtn = h('button', {
    class: 'window-close',
    title: 'Close',
    'aria-label': 'Close',
    onClick: () => win.close(),
  }, '✕');
  const titleBar = h('div', { class: 'window-title' }, h('span', null, opts.title), closeBtn);
  const el = h('div', {
    class: 'window',
    style: { width: opts.width ? `${opts.width}px` : '', left: '80px', top: '80px', zIndex: String(++zTop) },
    onMouseDown: () => {
      el.style.zIndex = String(++zTop);
    },
  }, titleBar, body);

  let closed = false;
  const win: GameWindow = {
    el,
    close() {
      if (closed) return;
      closed = true;
      open.delete(opts.id);
      el.remove();
      opts.onClose?.();
    },
    setContent(content: HTMLElement) {
      body.replaceChildren(content);
    },
  };

  titleBar.addEventListener('mousedown', (ev) => {
    if (ev.target === closeBtn) return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const originLeft = el.offsetLeft;
    const originTop = el.offsetTop;
    const onMove = (m: MouseEvent) => {
      el.style.left = `${originLeft + m.clientX - startX}px`;
      el.style.top = `${originTop + m.clientY - startY}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  open.set(opts.id, win);
  document.body.appendChild(el);
  return win;
}
