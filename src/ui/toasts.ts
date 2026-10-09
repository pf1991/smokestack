import type { EventBus } from '../core/events';
import { h } from './dom';

const MAX_VISIBLE = 4;
const LIFETIME_MS = 4000;

export const Toasts = {
  /** Shows `toast` events inside `root`, stacking at most four. Returns an unsubscribe function. */
  attach(root: HTMLElement, bus: EventBus): () => void {
    const container = h('div', { class: 'toast-stack' });
    root.appendChild(container);
    // Pending auto-dismiss timers, keyed by the toast element they will remove.
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    const dismiss = (el: HTMLElement) => {
      const timer = timers.get(el);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(el);
      el.remove();
    };

    const off = bus.on('toast', (e) => {
      const el = h('div', { class: `toast ${e.tone}` }, e.message);
      container.appendChild(el);
      timers.set(el, setTimeout(() => dismiss(el), LIFETIME_MS));
      while (container.childElementCount > MAX_VISIBLE) {
        const oldest = container.firstElementChild;
        if (!(oldest instanceof HTMLElement)) break;
        dismiss(oldest);
      }
    });

    return () => {
      off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      container.remove();
    };
  },
};
