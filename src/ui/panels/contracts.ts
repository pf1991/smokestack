import type { GameController } from '../../game/controller';
import { GOODS } from '../../data/goods';
import { addDays, dateToDays, formatDate } from '../../sim/clock';
import { acceptContract } from '../../sim/contracts';
import type { Contract, GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { createWindow } from '../window';
import type { PanelDef } from './index';

const CSS = `
.cb-board{min-width:520px;padding:14px;border:6px solid #5a3b21;border-radius:4px;color:#1d1a16;
 background:radial-gradient(circle at 20% 30%,rgba(255,255,255,.07) 0 2px,transparent 3px),
 radial-gradient(circle at 70% 60%,rgba(0,0,0,.12) 0 2px,transparent 3px),
 radial-gradient(circle at 40% 80%,rgba(0,0,0,.10) 0 1px,transparent 2px),
 linear-gradient(135deg,#b98a56,#a67846 50%,#b58450);background-size:23px 23px,31px 31px,17px 17px,100% 100%;
 box-shadow:inset 0 0 22px rgba(0,0,0,.45)}
.cb-board h3{margin:10px 0 8px;color:#f6e7c3;text-shadow:0 1px 2px #000}
.cb-board h3:first-of-type{margin-top:0}
.cb-grid{display:flex;flex-wrap:wrap;gap:14px}
.cb-card{position:relative;width:220px;padding:16px 12px 10px;background-color:#f3e9d2;box-shadow:2px 4px 8px rgba(0,0,0,.45);
 background-image:linear-gradient(transparent 23px,rgba(120,90,50,.18) 24px);background-size:100% 24px}
.cb-card:nth-child(odd){transform:rotate(-1.2deg)}.cb-card:nth-child(even){transform:rotate(1deg)}
.cb-card::before{content:"";position:absolute;top:-5px;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;
 background:radial-gradient(circle at 35% 30%,#ff8a7a,#a52a1c 70%);box-shadow:1px 2px 3px rgba(0,0,0,.5)}
.cb-card.done{background-color:#dcebd0}.cb-card.failed{background-color:#ecd0cb}
.cb-title{font-weight:bold;font-size:15px}.cb-line{font-size:12px;margin:3px 0}
.cb-reward{font-weight:bold;color:#2d6a2d}
.cb-bar{height:10px;border:1px solid #5a3b21;background:#e4d5b2;margin:6px 0 2px}
.cb-bar>i{display:block;height:100%;background:linear-gradient(#5aa65a,#3c8d3c)}
.cb-btn{margin-top:6px;padding:4px 14px;background:#c9a227;border:2px solid #8a6d17;color:#1d1a16;font-family:inherit;font-weight:bold;cursor:pointer}
.cb-btn:hover{background:#e8c75a}
.cb-empty{color:#f6e7c3;font-style:italic;text-shadow:0 1px 2px #000}
`;

function daysLeft(state: GameState, c: Contract): number {
  return dateToDays(c.deadline) - dateToDays(state.date);
}

function card(game: GameController, c: Contract, rerender: () => void): HTMLElement {
  const state = game.state;
  const good = GOODS[c.goodId];
  const city = state.cities[c.cityId];
  const head = h('div', { class: 'cb-title' }, `${good?.icon ?? ''} ${formatNumber(c.qty)} ${good?.name ?? c.goodId}`);
  const where = h('div', { class: 'cb-line' }, `for ${city?.name ?? '?'}`);
  const reward = h('div', { class: 'cb-line' }, 'Reward ', h('span', { class: 'cb-reward' }, formatMoney(c.reward)), ' + 5% growth');
  const body: (HTMLElement | null)[] = [head, where, reward];
  if (c.status === 'offered') {
    body.push(h('div', { class: 'cb-line' }, `Due ${formatDate(c.deadline)}`));
    body.push(
      h('button', {
        class: 'cb-btn',
        onClick: () => {
          const r = acceptContract(game.ctx, c.id);
          if (!r.ok) game.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
          rerender();
        },
      }, 'Accept'),
    );
  } else if (c.status === 'active') {
    const pct = Math.min(100, (c.delivered / Math.max(1, c.qty)) * 100);
    body.push(h('div', { class: 'cb-bar' }, h('i', { style: { width: `${pct}%` } })));
    body.push(h('div', { class: 'cb-line' }, `${formatNumber(c.delivered)} / ${formatNumber(c.qty)} delivered`));
    const d = daysLeft(state, c);
    body.push(h('div', { class: 'cb-line' }, d >= 0 ? `${d} days left` : 'Overdue'));
  } else {
    body.push(h('div', { class: 'cb-line' }, c.status === 'done' ? 'Delivered. The town thanks you.' : 'Failed. The mayor is displeased.'));
  }
  return h('div', { class: `cb-card ${c.status}` }, ...body);
}

export function buildBoard(game: GameController, rerender: () => void): HTMLElement {
  const cs = game.state.contracts;
  const section = (title: string, list: Contract[], empty: string) => [
    h('h3', null, title),
    list.length ? h('div', { class: 'cb-grid' }, list.map((c) => card(game, c, rerender))) : h('div', { class: 'cb-empty' }, empty),
  ];
  return h(
    'div',
    { class: 'cb-board' },
    h('style', null, CSS),
    section('Wanted', cs.filter((c) => c.status === 'offered'), 'No notices pinned. Mayors post every other month.'),
    section('In progress', cs.filter((c) => c.status === 'active'), 'Accept a notice to start delivering.'),
    section('Recent results', cs.filter((c) => c.status === 'done' || c.status === 'failed').slice(-6).reverse(), 'Nothing yet.'),
  );
}

export const contractsPanel: PanelDef = {
  id: 'contracts',
  open(game) {
    const offs: (() => void)[] = [];
    let win: ReturnType<typeof createWindow> | null = null;
    const rerender = () => win?.setContent(buildBoard(game, rerender));
    win = createWindow({
      id: 'contracts',
      title: "Mayor's Contracts",
      content: buildBoard(game, rerender),
      onClose: () => offs.forEach((f) => f()),
    });
    offs.push(game.ctx.bus.on('contract', rerender), game.ctx.bus.on('dayStart', rerender));
  },
};

// Dev screenshot hook: ?contracts=1 seeds a few notices and opens the panel.
if (import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('contracts') === '1') {
  const t = setInterval(() => {
    const game = (window as unknown as { game?: GameController }).game;
    if (!game?.ctx) return;
    clearInterval(t);
    const s = game.state;
    const mk = (cityId: number, goodId: string, qty: number, status: Contract['status'], delivered: number, days: number): Contract => ({
      id: s.nextId++, cityId, goodId, qty, delivered, status, deadline: addDays(s.date, days),
      reward: Math.round(qty * GOODS[goodId].basePrice * 1.5),
    });
    s.contracts.push(
      mk(0, 'bread', 90, 'offered', 0, 110), mk(1, 'tools', 20, 'offered', 0, 95), mk(2, 'clothes', 30, 'offered', 0, 80),
      mk(0, 'cheese', 60, 'active', 41, 64), mk(1, 'furniture', 25, 'active', 6, 22),
      mk(2, 'toys', 40, 'done', 40, 0), mk(3, 'juice', 50, 'failed', 12, -3),
    );
    game.openPanel('contracts');
  }, 200);
}
