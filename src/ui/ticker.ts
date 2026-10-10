import type { EventBus } from '../core/events';
import type { NewsItem } from '../sim/types';
import { h } from './dom';
import './panels/newspaper.css';

const MAX_HEADLINES = 5;

/** Scrolls the latest headlines along the bottom band (#ticker). */
export const Ticker = {
  attach(el: HTMLElement, bus: EventBus, initial: NewsItem[] = []): () => void {
    let items = initial.slice(-MAX_HEADLINES);
    const render = () => {
      const track = h('span', { class: 'ticker-track' });
      if (items.length === 0) {
        track.append(h('span', { class: 'ticker-item' }, 'The Daily Smokestack — all the news that fits the print, and some that does not'));
      }
      [...items].reverse().forEach((n, i) => {
        if (i > 0) track.append(h('span', { class: 'ticker-sep' }, '✦'));
        track.append(h('span', { class: 'ticker-item' }, h('b', null, n.headline)));
      });
      el.replaceChildren(track);
    };
    render();
    return bus.on('news', (e) => {
      items = [...items, e.item].slice(-MAX_HEADLINES);
      render();
    });
  },
};
