import type { GameController } from '../../game/controller';
import { formatDate } from '../../sim/clock';
import { publishNews } from '../../sim/news';
import type { GameDate, GameState, NewsItem, NewsKind } from '../../sim/types';
import { h } from '../dom';
import { createWindow } from '../window';
import './newspaper.css';
import type { PanelDef } from './index';

interface Ad { head: string; text: string }

/** Humorous fake classifieds keyed by the first year of their era. */
export const ADS: Record<number, Ad[]> = {
  1900: [
    { head: 'Wanted', text: 'Sturdy lad to shovel coal. Must enjoy coal. Must not enjoy it too much. Apply at the boiler house.' },
    { head: 'For Sale', text: 'One gentleman\'s velocipede, lightly crashed. Handsome moustache-guard included.' },
    { head: 'Lost', text: 'A pocket-watch, a spaniel, and the Vicar\'s good opinion. Reward for the watch.' },
    { head: 'Tonics', text: 'Dr. Hargreave\'s Miracle Elixir cures gout, melancholy and squeaky hinges. Not tested on hinges.' },
    { head: 'Lessons', text: 'Learn the telephone in ten evenings! Shouting not included.' },
    { head: 'Notice', text: 'The Society for the Abolition of Mud meets Thursdays. Galoshes required.' },
  ],
  1920: [
    { head: 'Wanted', text: 'Flapper-proof hat. Must survive Charleston and Aunt Mabel.' },
    { head: 'For Sale', text: 'Crystal wireless set. Picks up three stations and one neighbour\'s conversation.' },
    { head: 'Motors', text: 'Motorcar, one careful owner, one careless chauffeur. Dents at no extra charge.' },
    { head: 'Notice', text: 'Dance marathon, Saturday. Last couple standing wins a ham.' },
    { head: 'Lessons', text: 'Fly the aeroplane! First lesson free, second lesson mandatory.' },
    { head: 'Tonics', text: 'Madame Zora\'s Bobbed-Hair Pomade. Guaranteed to stay bobbed.' },
  ],
  1950: [
    { head: 'For Sale', text: 'Television set, 12 inch. Neighbours welcome Tuesdays, bring your own chair.' },
    { head: 'Wanted', text: 'Housewife-proof vacuum. Husband-proof remote not yet invented.' },
    { head: 'Motors', text: 'Fins! Large, glorious fins, car attached. Gas-guzzler and proud.' },
    { head: 'Notice', text: 'Bomb shelter, barely used. Pantry stocked with the finest spam.' },
    { head: 'Lessons', text: 'Rock \'n\' roll for the over-forties. Hips not guaranteed.' },
    { head: 'Wanted', text: 'Atomic-age gentleman seeks atomic-age lady. Must enjoy gelatin salads.' },
  ],
  1980: [
    { head: 'For Sale', text: 'Home computer, 48K. Games on cassette, patience not included.' },
    { head: 'Wanted', text: 'Roommate who does not borrow the Walkman and does not "just check the VCR".' },
    { head: 'Motors', text: 'Hatchback, mustard yellow, cassette stuck on side B. Forever.' },
    { head: 'Notice', text: 'Aerobics at dawn. Leg-warmers compulsory, dignity optional.' },
    { head: 'Lessons', text: 'Learn BASIC in a weekend. 10 PRINT "HELLO" 20 GOTO 10.' },
    { head: 'Wanted', text: 'Man with van. Will pay in pizza and rubik\'s-cube solutions.' },
  ],
};

export function adEra(year: number): number {
  const eras = Object.keys(ADS).map(Number).sort((a, b) => a - b);
  let era = eras[0];
  for (const e of eras) if (year >= e) era = e;
  return era;
}

/** Four distinct ads for the month, picked by a stable hash so the page does not reshuffle on redraw. */
export function pickAds(year: number, month: number): Ad[] {
  const pool = ADS[adEra(year)];
  const out: Ad[] = [];
  let k = (year * 31 + month * 17) >>> 0;
  while (out.length < 4) {
    k = (Math.imul(k, 1664525) + 1013904223) >>> 0;
    const ad = pool[(k >>> 8) % pool.length];
    if (!out.includes(ad)) out.push(ad);
  }
  return out;
}

const KIND_RANK: Record<NewsKind, number> = { historic: 0, invention: 1, random: 2, rival: 3, contract: 4, market: 5, warning: 6 };
const KIND_LABEL: Record<NewsKind, string> = {
  historic: 'Special Edition', random: 'Local News', invention: 'Science & Progress', market: 'Markets & Trade',
  rival: 'Rivalry Corner', contract: 'Commerce', warning: 'Public Notice',
};
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const sameMonth = (a: GameDate, b: GameDate) => a.year === b.year && a.month === b.month;

export function monthsWithNews(state: GameState): { year: number; month: number }[] {
  const keys = new Set<number>();
  for (const n of state.news) keys.add(n.date.year * 12 + (n.date.month - 1));
  keys.add(state.date.year * 12 + (state.date.month - 1));
  return [...keys].sort((a, b) => a - b).map((k) => ({ year: Math.floor(k / 12), month: (k % 12) + 1 }));
}

export function leadStory(items: NewsItem[]): NewsItem | null {
  if (items.length === 0) return null;
  return [...items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.id - a.id)[0];
}

function storyEl(n: NewsItem): HTMLElement {
  return h('article', { class: `story ${n.kind}` },
    h('div', { class: 'byline' }, `${KIND_LABEL[n.kind]} · ${n.date.day} ${MONTH_FULL[n.date.month - 1].slice(0, 3)}`),
    h('h3', null, n.headline),
    h('p', null, n.body));
}

export function renderPaper(state: GameState, ym: { year: number; month: number }, nav: { prev?: () => void; next?: () => void }): HTMLElement {
  const date: GameDate = sameMonth(state.date, { ...state.date, ...ym }) ? state.date : { year: ym.year, month: ym.month, day: 30, hour: 0 };
  const items = state.news.filter((n) => n.date.year === ym.year && n.date.month === ym.month);
  const lead = leadStory(items);
  const rest = items.filter((n) => n !== lead).sort((a, b) => b.id - a.id);
  const left = rest.filter((_, i) => i % 2 === 0);
  const right = rest.filter((_, i) => i % 2 === 1);
  const ads = pickAds(ym.year, ym.month);
  const idx = monthsWithNews(state);
  const pos = idx.findIndex((m) => m.year === ym.year && m.month === ym.month);

  return h('div', { class: 'paper' },
    h('div', { class: 'paper-nav' },
      h('button', { title: 'Previous month', disabled: pos <= 0, onClick: nav.prev }, '‹'),
      h('span', null, `Vol. ${ym.year - 1899} · No. ${ym.month}`),
      h('button', { title: 'Next month', disabled: pos >= idx.length - 1, onClick: nav.next }, '›')),
    h('h1', { class: 'masthead' }, 'THE DAILY SMOKESTACK'),
    h('div', { class: 'masthead-ears' },
      h('span', null, '“All the soot that\'s fit to print”'),
      h('span', null, 'Weather: smoky, with sooty intervals')),
    h('div', { class: 'masthead-sub' }, `Est. 1900 · Price 2¢ · ${formatDate(date)}`),
    lead
      ? h('section', { class: 'lead' },
          h('span', { class: 'kicker' }, KIND_LABEL[lead.kind]),
          h('h2', null, lead.headline),
          h('p', null, lead.body))
      : h('div', { class: 'paper-quiet' }, `A quiet month in ${MONTH_FULL[ym.month - 1]}. The presses idle, and the editor takes an early luncheon.`),
    rest.length > 0 && h('section', { class: 'paper-cols' },
      h('div', { class: 'col' }, left.map(storyEl)),
      h('div', { class: 'col' }, right.map(storyEl))),
    h('section', { class: 'classifieds' },
      h('h4', null, 'Classified Advertisements'),
      h('div', { class: 'ads' }, ads.map((a) => h('div', { class: 'ad' }, h('b', null, a.head), a.text)))),
    h('div', { class: 'paper-foot' }, 'Printed by the Smokestack Steam Press · Sold in all good chimney-shops'));
}

export function autoNewsEnabled(): boolean {
  try {
    return localStorage.getItem('smokestack:autoNews') !== 'off';
  } catch {
    return true;
  }
}

export const newspaperPanel: PanelDef = {
  id: 'newspaper',
  open(game: GameController) {
    const state = game.state;
    const content = h('div', null);
    let cur = monthsWithNews(state).length - 1;
    const draw = () => {
      const months = monthsWithNews(state);
      cur = Math.max(0, Math.min(cur, months.length - 1));
      content.replaceChildren(renderPaper(state, months[cur], {
        prev: () => { cur -= 1; draw(); },
        next: () => { cur += 1; draw(); },
      }));
    };
    draw();
    const win = createWindow({ id: 'newspaper', title: 'The Daily Smokestack', content, width: 820 });
    const body = win.el.querySelector('.window-body');
    if (body && !body.contains(content)) {
      // already open (e.g. an earlier auto-open): show the latest edition instead of a stale one
      body.replaceChildren(content);
      return;
    }
    win.el.classList.add('news-window');
    win.el.style.left = `${Math.max(0, Math.round((window.innerWidth - 820) / 2))}px`;
    win.el.style.top = '64px';
  },
};

/**
 * Hooks the paper into a running game: opens it at month end when a historic event happened that
 * month (unless `localStorage['smokestack:autoNews']` is 'off'). `?news=1` publishes a few demo
 * stories and opens the paper immediately (visual check).
 */
export function attachNewspaper(game: GameController): void {
  game.ctx.bus.on('monthEnd', (e) => {
    const happened = game.state.news.some((n) => n.kind === 'historic' && sameMonth(n.date, e.date));
    if (happened && autoNewsEnabled()) newspaperPanel.open(game);
  });
  if (new URLSearchParams(location.search).get('news') === '1') {
    const ctx = game.ctx;
    ctx.state.date = { year: 1929, month: 10, day: 24, hour: 12 };
    publishNews(ctx, 'historic', 'WALL STREET IN WRECKAGE! FORTUNES VANISH BEFORE LUNCH',
      'Ticker tapes ran out of paper and brokers ran out of windows at ground level. Shoppers are tightening their belts; the wise are tightening theirs one notch further.');
    publishNews(ctx, 'random', 'FURNITURE WORKERS DOWN TOOLS OVER TEA BREAK',
      'Labour has laid down its spanners for ten days, demanding a longer interval and a better biscuit. The management is said to be "reviewing the biscuit situation".');
    publishNews(ctx, 'market', 'FURNITURE LEADS THE MARKET THIS MONTH',
      'Your enterprise took $4,210 from furniture alone, the best-selling line on the books. Smogsworth says: "Let them have the leftovers."');
    publishNews(ctx, 'random', 'COALHAVEN FESTIVAL: BUNTING, BRASS BANDS AND BRISK TRADE',
      'Pockets are open and purses are loose as the town makes merry for a month. Shopkeepers are advised to stock up and sleep later.');
    publishNews(ctx, 'invention', 'ECCENTRIC INVENTOR PERFECTS THE WIRELESS, TWO YEARS EARLY',
      'A gentleman in a cellar has solved what the universities could not, mostly by accident and partly with a kettle.');
    publishNews(ctx, 'warning', 'CITIZENS OF COALHAVEN COUGH IN PROTEST',
      'The air, once merely brisk, is now chewable. The council has promised a committee.');
    newspaperPanel.open(game);
  }
}
