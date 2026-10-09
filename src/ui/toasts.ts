import type { EventBus } from '../core/events';
import { h } from './dom';

const MAX_VISIBLE = 4;
const LIFETIME_MS = 4000;

export const Toasts = {
  /** Shows `toast` events inside `root`, stacking at most four. Returns an unsubscribe function. */
  attach(root: HTMLElement, bus: EventBus): () => void {
    const container = h('div', { class: 'toast-stack' });
    root.appendChild(container);

    const off = bus.on('toast', (e) => {
      const el = h('div', { class: `toast ${e.tone}` }, e.message);
      container.appendChild(el);
      while (container.childElementCount > MAX_VISIBLE) {
        container.firstElementChild?.remove();
      }
      setTimeout(() => el.remove(), LIFETIME_MS);
    });

    return () => {
      off();
      container.remove();
    };
  },
};
