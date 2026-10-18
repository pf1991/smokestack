import type { EventBus } from '../core/events';
import { loadSettings, onSettingsSaved, type TickerMode } from '../game/settings';
import type { NewsItem } from '../sim/types';
import { h } from './dom';
import './panels/newspaper.css';

const MAX_HEADLINES = 5;
const MASTHEAD = 'The Daily Smokestack — all the news that fits the print, and some that does not';
/** Strip height per mode, published as --ticker-h so the build bar can sit above it. */
const STRIP_PX: Record<TickerMode, number> = { scroll: 28, headline: 22, off: 0 };

/** The news strip (#ticker): scrolling headlines, the latest headline only, or hidden (settings.ticker). */
export const Ticker = {
  attach(el: HTMLElement, bus: EventBus, initial: NewsItem[] = [], onOpen?: () => void): () => void {
    let items = initial.slice(-MAX_HEADLINES);
    let mode = loadSettings().ticker;
    const render = () => {
      el.hidden = mode === 'off';
      el.classList.toggle('headline', mode === 'headline');
      document.documentElement.style.setProperty('--ticker-h', `${STRIP_PX[mode]}px`);
      if (mode === 'off') {
        el.removeAttribute('role');
        el.removeAttribute('tabindex');
        el.replaceChildren();
        return;
      }
      if (mode === 'headline') {
        const latest = items[items.length - 1];
        el.title = 'Open the newspaper';
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.replaceChildren(h('span', { class: 'ticker-item' }, h('b', null, latest ? latest.headline : MASTHEAD)));
        return;
      }
      el.removeAttribute('title');
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      const track = h('span', { class: 'ticker-track' });
      if (items.length === 0) track.append(h('span', { class: 'ticker-item' }, MASTHEAD));
      [...items].reverse().forEach((n, i) => {
        if (i > 0) track.append(h('span', { class: 'ticker-sep' }, '◆'));
        track.append(h('span', { class: 'ticker-item' }, h('b', null, n.headline)));
      });
      el.replaceChildren(track);
    };
    const click = () => {
      if (mode === 'headline') onOpen?.();
    };
    const key = (e: KeyboardEvent) => {
      if (mode === 'headline' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onOpen?.();
      }
    };
    el.addEventListener('click', click);
    el.addEventListener('keydown', key);
    render();
    const offNews = bus.on('news', (e) => {
      items = [...items, e.item].slice(-MAX_HEADLINES);
      render();
    });
    const offSettings = onSettingsSaved((s) => {
      if (s.ticker === mode) return;
      mode = s.ticker;
      render();
    });
    return () => {
      offNews();
      offSettings();
      el.removeEventListener('click', click);
      el.removeEventListener('keydown', key);
    };
  },
};
