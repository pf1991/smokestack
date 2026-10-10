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

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

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
    onPointerDown: () => {
      el.style.zIndex = String(++zTop);
    },
  }, titleBar, body);

  let stopDrag: (() => void) | null = null;

  let closed = false;
  const win: GameWindow = {
    el,
    close() {
      if (closed) return;
      closed = true;
      stopDrag?.();
      open.delete(opts.id);
      el.remove();
      opts.onClose?.();
    },
    setContent(content: HTMLElement) {
      body.replaceChildren(content);
    },
  };

  titleBar.addEventListener('pointerdown', (ev) => {
    if (ev.target === closeBtn) return;
    stopDrag?.();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const originLeft = parseFloat(el.style.left) || 0;
    const originTop = parseFloat(el.style.top) || 0;
    const onMove = (m: PointerEvent | MouseEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - titleBar.offsetHeight);
      el.style.left = `${clamp(originLeft + m.clientX - startX, 0, maxLeft)}px`;
      el.style.top = `${clamp(originTop + m.clientY - startY, 0, maxTop)}px`;
    };
    const onUp = () => stopDrag?.();
    stopDrag = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      stopDrag = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  open.set(opts.id, win);
  document.body.appendChild(el);
  return win;
}

/** Closes every open window (used when the game is torn down). */
export function closeAllWindows(): void {
  for (const w of [...open.values()]) w.close();
}
