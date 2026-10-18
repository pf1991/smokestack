import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import { BARON_TRAITS, GRUDGE_LABELS } from '../../data/nemesis';
import type { GameController } from '../../game/controller';
import { drawBaronPortrait, type BaronMood } from '../../render/portrait';
import { formatDate } from '../../sim/clock';
import { baronMood } from '../../sim/nemesis/grudges';
import { NEMESIS_NEWS_TAG, type Grudge } from '../../sim/nemesis/types';
import { buyShares, holding, quote } from '../../sim/exchange/trading';
import { CONTROL_SHARES, SHARES_OUTSTANDING } from '../../sim/exchange/types';
import { netWorth } from '../../sim/rival';
import { runDays } from '../../sim/simulation';
import type { GameState, NewsItem } from '../../sim/types';
import { h } from '../dom';
import { formatMoney } from '../format';
import { createWindow, type GameWindow } from '../window';
import type { PanelDef } from './index';

const PLAYER_COLOR = '#2f6fb5';
const RIVAL_COLOR = '#b5302f';
const PORTRAIT_PX = 132;
/** shares the "Buy his shares" button buys at a time */
const BUY_LOT = 50;
/** how many grudges and retaliations the panel lists */
const LIST_MAX = 5;

function portrait(mood: BaronMood, generation: 1 | 2, name: string): HTMLElement {
  const canvas = h('canvas', {
    width: PORTRAIT_PX * 2,
    height: PORTRAIT_PX * 2,
    style: { width: `${PORTRAIT_PX}px`, height: `${PORTRAIT_PX}px`, flex: '0 0 auto' },
    'aria-label': `Portrait of ${name}, looking ${mood}`,
  }) as HTMLCanvasElement;
  // jsdom and very old browsers have no 2D context; the panel still works without the picture
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  if (g) drawBaronPortrait(g, PORTRAIT_PX * 2, mood, generation);
  return canvas;
}

/** Rival stores grouped by city, with the goods his routes deliver to each. */
function storesByCity(state: GameState): { city: string; goods: string[] }[] {
  const out: { city: string; goods: string[] }[] = [];
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'rival' || BUILDINGS[b.typeId].category !== 'retail' || b.cityId === null) continue;
    const goods = new Set<string>();
    for (const r of Object.values(state.routes)) {
      for (const s of r.stops) if (s.buildingId === b.id) for (const g of s.unload) goods.add(g);
    }
    for (const [g, q] of Object.entries(b.input)) if (q > 0) goods.add(g);
    const city = state.cities.find((c) => c.id === b.cityId)?.name ?? '?';
    out.push({ city, goods: [...goods].map((g) => GOODS[g]?.name ?? g) });
  }
  return out.sort((a, b) => a.city.localeCompare(b.city));
}

function worthBar(player: number, rival: number, playerName: string): HTMLElement {
  const p = Math.max(0, player);
  const r = Math.max(0, rival);
  const total = p + r || 1;
  const seg = (v: number, color: string) =>
    h('div', { style: { width: `${(v / total) * 100}%`, background: color, transition: 'width 0.4s' } });
  return h('div', null,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px', gap: '8px' } },
      h('span', { style: { color: '#8fb6e6' } }, `${playerName}: ${formatMoney(player)}`),
      h('span', { style: { color: '#e88a86', textAlign: 'right' } }, `Smogsworth: ${formatMoney(rival)}`)),
    h('div', {
      class: 'rival-worth-bar',
      style: { display: 'flex', height: '14px', border: '1px solid #8a6d17', background: '#1d1a16', overflow: 'hidden' },
    }, seg(p, PLAYER_COLOR), seg(r, RIVAL_COLOR)),
  );
}

function lastQuip(state: GameState): string | null {
  for (let i = state.news.length - 1; i >= 0; i--) {
    const n = state.news[i];
    if (n.kind === 'rival' && n.headline.startsWith("Smogsworth: '")) return n.headline.slice('Smogsworth: '.length);
  }
  return null;
}

/** "Undercut in Millbrook, 1923", or "Takeover bid, 1925" for a grudge tied to no town. */
export function grudgeLine(state: GameState, g: Grudge): string {
  const town = g.cityId === null ? undefined : state.cities.find((c) => c.id === g.cityId)?.name;
  return `${GRUDGE_LABELS[g.kind]}${town ? ` in ${town}` : ''}, ${g.year}`;
}

/** The heaviest LIST_MAX grudges, heaviest first (older first among equals). */
function topGrudges(state: GameState): Grudge[] {
  return [...state.nemesis.grudges].sort((a, b) => b.weight - a.weight).slice(0, LIST_MAX);
}

/** The last LIST_MAX retaliations (rival news tagged 'nemesis'), newest first. */
function lastStrikes(state: GameState): NewsItem[] {
  const out: NewsItem[] = [];
  for (let i = state.news.length - 1; i >= 0 && out.length < LIST_MAX; i--) {
    const n = state.news[i];
    if (n.kind === 'rival' && n.tag === NEMESIS_NEWS_TAG) out.push(n);
  }
  return out;
}

const sectionTitle = (text: string) =>
  h('div', { style: { fontFamily: 'var(--font-display)', color: 'var(--brass-light)', margin: '10px 0 4px' } }, text);

function traitChips(state: GameState): HTMLElement {
  return h('div', { class: 'rival-traits', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
    state.nemesis.traits.map((t) => h('div', {
      class: 'rival-trait',
      'data-trait': t,
      style: { fontSize: '12px', lineHeight: '1.3' },
    },
    h('span', {
      class: 'rival-trait-label',
      style: {
        display: 'inline-block', padding: '0 6px', marginRight: '6px', background: '#3a1a18',
        border: '1px solid #8a6d17', borderRadius: '2px', color: '#efe3c3', fontWeight: 'bold',
      },
    }, BARON_TRAITS[t].label),
    h('span', { style: { opacity: '0.85' } }, BARON_TRAITS[t].blurb))));
}

function grudgeList(state: GameState): HTMLElement {
  const top = topGrudges(state);
  const heaviest = top[0]?.weight ?? 1;
  if (top.length === 0) return h('div', { class: 'rival-grudges', style: { fontSize: '13px', opacity: '0.8' } }, 'No grudges. He barely knows your name.');
  return h('ul', { class: 'rival-grudges', style: { margin: '0', paddingLeft: '0', listStyle: 'none', fontSize: '13px' } },
    top.map((g) => h('li', {
      title: `Weight ${g.weight.toFixed(1)}`,
      style: {
        padding: '1px 6px', marginBottom: '2px',
        background: `linear-gradient(90deg, rgba(181,48,47,0.45) ${Math.round((g.weight / heaviest) * 100)}%, transparent 0)`,
      },
    }, grudgeLine(state, g))));
}

function strikeList(state: GameState): HTMLElement {
  const strikes = lastStrikes(state);
  if (strikes.length === 0) return h('div', { class: 'rival-strikes', style: { fontSize: '13px', opacity: '0.8' } }, 'He has not struck back. Yet.');
  return h('ul', { class: 'rival-strikes', style: { margin: '0', paddingLeft: '18px', fontSize: '13px' } },
    strikes.map((n) => h('li', { title: n.body },
      h('span', { style: { opacity: '0.7', fontSize: '12px' } }, `${formatDate(n.date)}: `), n.headline)));
}

function render(game: GameController, refresh: () => void): HTMLElement {
  const { state } = game.ctx;
  const rival = state.companies.rival;
  const mine = netWorth(state, 'player');
  const his = netWorth(state, 'rival');
  const nem = state.nemesis;
  // an ousted Baron only rages; otherwise his grudges and his last strike set the face
  const mood: BaronMood = rival.active ? baronMood(state) : 'furious';
  const quip = rival.active ? lastQuip(state) : 'Ousted. The Baron now spends his days writing furious letters to the editor.';

  const head = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
    portrait(mood, nem.head.generation, nem.head.name),
    h('div', { style: { minWidth: '0' } },
      h('div', { class: 'rival-head-name', style: { fontFamily: 'var(--font-display)', fontSize: '17px', color: 'var(--brass-light)' } }, nem.head.name),
      h('div', { class: 'rival-head-age', style: { fontSize: '12px', opacity: '0.8', marginBottom: '6px' } },
        `aged ${state.date.year - nem.head.born} · ${rival.name}${rival.active ? '' : ' (defunct)'}`),
      quip && h('div', { style: { fontStyle: 'italic', fontSize: '13px', lineHeight: '1.35' } }, quip.startsWith("'") ? quip : `“${quip}”`),
      h('div', { style: { fontSize: '12px', marginTop: '6px', opacity: '0.85' } },
        `Cash ${formatMoney(rival.money)} · Loan ${formatMoney(rival.loan)}`)));

  const stores = storesByCity(state);
  const storeList = h('div', null,
    sectionTitle('His stores'),
    stores.length === 0
      ? h('div', { style: { fontSize: '13px', opacity: '0.8' } }, 'None yet. He is scheming.')
      : h('ul', { class: 'rival-stores', style: { margin: '0', paddingLeft: '18px', fontSize: '13px' } },
        stores.map((s) => h('li', null, h('b', null, s.city), s.goods.length ? ` — ${s.goods.join(', ')}` : ' — empty shelves'))));

  // the share route (exchange/trading.ts): a majority of his shares takes his company
  const held = holding(state, 'player', 'rival');
  const q = quote(state, 'player', 'rival', BUY_LOT);
  const button = h('button', {
    class: 'btn rival-takeover',
    disabled: !rival.active,
    style: { width: '100%', marginTop: '12px', opacity: rival.active ? '1' : '0.55' },
    onClick: () => {
      const r = buyShares(game.ctx, 'player', 'rival', BUY_LOT);
      const message = !r.ok ? r.error : game.ctx.state.flags.takeover ? 'Hostile takeover complete! Smogsworth is ousted.' : `Bought ${BUY_LOT} of his shares`;
      game.ctx.bus.emit({ type: 'toast', message, tone: r.ok ? 'good' : 'bad' });
      refresh();
    },
  }, rival.active ? `Buy his shares · ${BUY_LOT} for ${formatMoney(q.total)}` : 'Takeover complete');
  const hint = rival.active
    ? h('div', { class: 'rival-stake', style: { fontSize: '12px', opacity: '0.8', marginTop: '4px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' } },
      h('span', null, `You hold ${held} of his ${SHARES_OUTSTANDING} shares; ${CONTROL_SHARES} takes his company.`),
      h('button', { class: 'btn', type: 'button', onClick: () => game.openPanel('exchange') }, 'Exchange'))
    : null;

  return h('div', { class: 'rival-panel', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    head,
    sectionTitle('His character'),
    traitChips(state),
    sectionTitle('Grudges against you'),
    grudgeList(state),
    sectionTitle('His last strikes'),
    strikeList(state),
    h('div', { style: { fontFamily: 'var(--font-display)', color: 'var(--brass-light)', marginTop: '8px' } }, 'Net worth'),
    worthBar(mine, his, state.companies.player.name),
    storeList,
    button,
    hint);
}

let win: GameWindow | null = null;

export const rivalPanel: PanelDef = {
  id: 'rival',
  open(game) {
    if (win) {
      win.setContent(render(game, refresh));
      return;
    }
    const offs: (() => void)[] = [];
    function refresh(): void {
      if (win) win.setContent(render(game, refresh));
    }
    win = createWindow({
      id: 'rival',
      title: 'The Rival',
      width: 380,
      content: render(game, refresh),
      onClose: () => {
        for (const off of offs) off();
        win = null;
      },
    });
    offs.push(game.ctx.bus.on('monthEnd', refresh));
  },
};

// Debug hook (dev only): `?rival=1` fast-forwards the Baron 18 months and opens this panel.
if (import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('rival') === '1') {
  const tryOpen = (attempt: number) => {
    const game = (window as unknown as { game?: GameController }).game;
    if (!game?.ctx) {
      if (attempt < 50) setTimeout(() => tryOpen(attempt + 1), 100);
      return;
    }
    const speed = game.ctx.state.speed;
    runDays(game.ctx, 540);
    game.ctx.state.speed = speed;
    rivalPanel.open(game);
  };
  setTimeout(() => tryOpen(0), 0);
}
