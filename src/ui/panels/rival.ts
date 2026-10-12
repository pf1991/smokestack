import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import type { GameController } from '../../game/controller';
import { drawBaronPortrait, type BaronMood } from '../../render/portrait';
import { canTakeover, netWorth, takeover, takeoverPrice } from '../../sim/rival';
import { runDays } from '../../sim/simulation';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney } from '../format';
import { createWindow, type GameWindow } from '../window';
import type { PanelDef } from './index';

const PLAYER_COLOR = '#2f6fb5';
const RIVAL_COLOR = '#b5302f';
const PORTRAIT_PX = 132;

function portrait(mood: BaronMood): HTMLElement {
  const canvas = h('canvas', {
    width: PORTRAIT_PX * 2,
    height: PORTRAIT_PX * 2,
    style: { width: `${PORTRAIT_PX}px`, height: `${PORTRAIT_PX}px`, flex: '0 0 auto' },
    'aria-label': `Portrait of Baron Smogsworth, looking ${mood}`,
  }) as HTMLCanvasElement;
  // jsdom and very old browsers have no 2D context; the panel still works without the picture
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  if (g) drawBaronPortrait(g, PORTRAIT_PX * 2, mood);
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

function render(game: GameController, refresh: () => void): HTMLElement {
  const { state } = game.ctx;
  const rival = state.companies.rival;
  const mine = netWorth(state, 'player');
  const his = netWorth(state, 'rival');
  const mood: BaronMood = rival.active && his >= mine ? 'smug' : 'furious';
  const quip = rival.active ? lastQuip(state) : 'Ousted. The Baron now spends his days writing furious letters to the editor.';

  const head = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
    portrait(mood),
    h('div', { style: { minWidth: '0' } },
      h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '17px', color: 'var(--brass-light)' } }, 'Baron Cornelius Smogsworth'),
      h('div', { style: { fontSize: '12px', opacity: '0.8', marginBottom: '6px' } }, `${rival.name}${rival.active ? '' : ' (defunct)'}`),
      quip && h('div', { style: { fontStyle: 'italic', fontSize: '13px', lineHeight: '1.35' } }, quip.startsWith("'") ? quip : `“${quip}”`),
      h('div', { style: { fontSize: '12px', marginTop: '6px', opacity: '0.85' } },
        `Cash ${formatMoney(rival.money)} · Loan ${formatMoney(rival.loan)}`)));

  const stores = storesByCity(state);
  const storeList = h('div', null,
    h('div', { style: { fontFamily: 'var(--font-display)', color: 'var(--brass-light)', margin: '10px 0 4px' } }, 'His stores'),
    stores.length === 0
      ? h('div', { style: { fontSize: '13px', opacity: '0.8' } }, 'None yet. He is scheming.')
      : h('ul', { class: 'rival-stores', style: { margin: '0', paddingLeft: '18px', fontSize: '13px' } },
        stores.map((s) => h('li', null, h('b', null, s.city), s.goods.length ? ` — ${s.goods.join(', ')}` : ' — empty shelves'))));

  const able = canTakeover(state);
  const price = takeoverPrice(state);
  const button = h('button', {
    class: 'btn rival-takeover',
    disabled: !able,
    style: { width: '100%', marginTop: '12px', opacity: able ? '1' : '0.55' },
    onClick: () => {
      const r = takeover(game.ctx);
      game.ctx.bus.emit(r.ok
        ? { type: 'toast', message: 'Hostile takeover complete! Smogsworth is ousted.', tone: 'good' }
        : { type: 'toast', message: r.error, tone: 'bad' });
      refresh();
    },
  }, rival.active ? `Hostile Takeover · ${formatMoney(price)}` : 'Takeover complete');
  const need = Math.max(1_000_000, 3 * his);
  const hint = rival.active && !able
    ? h('div', { style: { fontSize: '12px', opacity: '0.8', marginTop: '4px' } },
      `Reach ${formatMoney(need)} net worth (3× his, at least $1M) to buy him out.`)
    : null;

  return h('div', { class: 'rival-panel', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    head,
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
