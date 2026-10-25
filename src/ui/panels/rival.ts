import { BUILDINGS } from '../../data/buildings';
import './panels.css';
import { GOODS } from '../../data/goods';
import { BARON_TRAITS, GRUDGE_LABELS } from '../../data/nemesis';
import type { GameController } from '../../game/controller';
import { drawBaronPortrait, type BaronMood } from '../../render/portrait';
import { formatDate } from '../../sim/clock';
import { baronMood } from '../../sim/nemesis/grudges';
import { NEMESIS_NEWS_TAG, type Grudge } from '../../sim/nemesis/types';
import { buyShares, CONTROL_WEALTH_RATIO, holding, quote, takeoverRefusal } from '../../sim/exchange/trading';
import { CONTROL_SHARES, SHARES_OUTSTANDING } from '../../sim/exchange/types';
import { wealth } from '../../sim/state';
import { runDays } from '../../sim/simulation';
import type { GameState, NewsItem } from '../../sim/types';
import { h } from '../dom';
import { formatMoney } from '../format';
import { button as kitButton, dataTable, emptyState, panelHeader, section as kitSection, type Tone } from '../kit';
import { createWindow, type GameWindow } from '../window';
import type { PanelDef } from './index';

const PLAYER_COLOR = 'var(--player)';
const RIVAL_COLOR = 'var(--rival)';
const MOOD_TONE: Record<BaronMood, Tone> = { smug: 'neutral', scheming: 'warning', gloating: 'warning', furious: 'negative' };
/** the same size as the Family panel's head of the family */
const PORTRAIT_PX = 96;
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
  const seg = (v: number, color: string) => h('div', { style: { width: `${(v / total) * 100}%`, background: color } });
  return h('div', { class: 'rival-worth', title: 'Cash minus loans, plus works, vehicles and shares held' },
    h('div', { class: 'p-row rival-worth-labels' },
      h('span', { class: 'rival-you' }, `${playerName}: ${formatMoney(player)}`),
      h('span', { class: 'rival-him' }, `Smogsworth: ${formatMoney(rival)}`)),
    h('div', { class: 'rival-worth-bar' }, seg(p, PLAYER_COLOR), seg(r, RIVAL_COLOR)),
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

/** Active-fights row: kind · town · weight · year. */
export function fightLine(state: GameState, g: Grudge): string {
  const town = g.cityId === null ? undefined : state.cities.find((c) => c.id === g.cityId)?.name;
  const parts = [GRUDGE_LABELS[g.kind]];
  if (town) parts.push(town);
  parts.push(`wt ${g.weight.toFixed(1)}`, String(g.year));
  return parts.join(' · ');
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

/** One block of the panel: the kit section (its overline is the shared `.p-head`). */
const section = (title: string, ...content: (HTMLElement | null)[]) => kitSection(title, content);

/** A kit empty state that keeps the list's class (tests and styles look for it). */
function none(cls: string, title: string, body?: string): HTMLElement {
  const el = emptyState({ title, body });
  el.classList.add(cls, 'rival-none', 'p-empty-sm');
  return el;
}

function traitChips(state: GameState): HTMLElement {
  return h('div', { class: 'rival-traits' },
    state.nemesis.traits.map((t) => h('div', { class: 'rival-trait', 'data-trait': t },
      h('span', { class: 'rival-trait-label' }, BARON_TRAITS[t].label),
      h('span', { class: 'rival-trait-blurb' }, BARON_TRAITS[t].blurb))));
}

/** Active fights: the heaviest grudges with kind, town, and weight. */
function fightList(state: GameState): HTMLElement {
  const top = topGrudges(state);
  const heaviest = top[0]?.weight ?? 1;
  if (top.length === 0) return none('rival-fights', 'No active fights', 'He barely knows your name.');
  return h('ul', { class: 'rival-fights rival-grudges' },
    top.map((g) => h('li', {
      title: `Weight ${g.weight.toFixed(1)}`,
      // the bar behind each fight is its weight against the heaviest
      style: { background: `linear-gradient(90deg, var(--negative-bg) ${Math.round((g.weight / heaviest) * 100)}%, transparent 0)` },
    }, fightLine(state, g))));
}

function strikeList(state: GameState): HTMLElement {
  const strikes = lastStrikes(state);
  if (strikes.length === 0) return none('rival-strikes', 'He has not struck back', 'Yet. Cross him in a town and he will.');
  return h('ul', { class: 'rival-strikes' },
    strikes.map((n) => h('li', { title: n.body },
      h('span', { class: 'rival-date' }, `${formatDate(n.date)}: `), n.headline)));
}

function render(game: GameController, refresh: () => void): HTMLElement {
  const { state } = game.ctx;
  const rival = state.companies.rival;
  const mine = wealth(state, 'player');
  const his = wealth(state, 'rival');
  const nem = state.nemesis;
  // an ousted Baron only rages; otherwise his grudges and his last strike set the face
  const mood: BaronMood = rival.active ? baronMood(state) : 'furious';
  const quip = rival.active ? lastQuip(state) : 'Ousted. The Baron now spends his days writing furious letters to the editor.';

  const head = h('div', { class: 'p-section rival-head' },
    portrait(mood, nem.head.generation, nem.head.name),
    h('div', { class: 'rival-head-text' },
      h('div', { class: 'rival-head-name' }, nem.head.name),
      h('div', { class: 'rival-head-age' },
        `aged ${state.date.year - nem.head.born} · ${rival.name}${rival.active ? '' : ' (defunct)'}`),
      quip && h('div', { class: 'rival-quip' }, quip.startsWith("'") ? quip : `“${quip}”`),
      h('div', { class: 'rival-cash' }, `Cash ${formatMoney(rival.money)} · Loan ${formatMoney(rival.loan)}`)));

  const stores = storesByCity(state);
  const storeTable = (): HTMLElement => {
    const t = dataTable<{ city: string; goods: string[] }>({
      columns: [
        { key: 'city', label: 'Town', render: (r) => h('b', null, r.city), title: (r) => r.city },
        { key: 'goods', label: 'Goods on his shelves', render: (r) => (r.goods.length ? r.goods.join(', ') : 'Empty shelves'), title: (r) => r.goods.join(', ') },
      ],
      rows: stores,
      emptyText: '',
    });
    t.classList.add('rival-stores');
    return t;
  };
  const storeList = section('His stores', stores.length === 0 ? none('rival-stores-none', 'No stores yet', 'He is scheming.') : storeTable());

  // the share route (exchange/trading.ts): a majority of his shares takes his company
  const held = holding(state, 'player', 'rival');
  const q = quote(state, 'player', 'rival', BUY_LOT);
  // the lot that would take control needs 1.5x his wealth (exchange/trading.ts takeoverRefusal)
  const gate = rival.active ? takeoverRefusal(state, 'player', 'rival', BUY_LOT) : null;
  const usable = rival.active && !gate;
  const button = kitButton(rival.active
    ? `Buy his shares · ${BUY_LOT} for ${formatMoney(q.total)}${q.premium > 0 ? ` (incl. ${formatMoney(q.premium)} control premium)` : ''}`
    : 'Takeover complete', {
    variant: 'primary',
    disabled: !usable,
    title: gate ?? undefined,
    onClick: () => {
      const r = buyShares(game.ctx, 'player', 'rival', BUY_LOT);
      const message = !r.ok ? r.error : game.ctx.state.flags.takeover ? 'Hostile takeover complete! Smogsworth is ousted.' : `Bought ${BUY_LOT} of his shares`;
      game.ctx.bus.emit({ type: 'toast', message, tone: r.ok ? 'good' : 'bad' });
      refresh();
    },
  });
  button.classList.add('rival-takeover');
  const hint = rival.active
    ? h('div', { class: 'rival-stake' },
      h('span', null, gate ?? `You hold ${held} of his ${SHARES_OUTSTANDING} shares; ${CONTROL_SHARES} takes his company (you need ${CONTROL_WEALTH_RATIO}× his wealth, and the lot that takes control pays a control premium as large again).`),
      kitButton('Exchange', { variant: 'secondary', onClick: () => game.openPanel('exchange') }))
    : null;

  return h('div', { class: 'rival-panel' },
    h('div', { class: 'rival-header' }, panelHeader({ title: 'Rival', summary: `${nem.head.name}: ${rival.active ? mood : 'ousted'}`, tone: MOOD_TONE[mood] })),
    head,
    section('His character', traitChips(state)),
    section('Active fights', fightList(state)),
    section('His last strikes', strikeList(state)),
    section('Net worth', worthBar(mine, his, state.companies.player.name)),
    storeList,
    hint && section('Takeover', hint),
    // pinned to the foot of the panel, like Finance's loan buttons
    h('div', { class: 'p-actions' }, button));
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
      tabTitle: 'Rival',
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
