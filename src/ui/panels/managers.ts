/**
 * The Managers window (Phase 4b spec 7.4): the year's candidates with Hire, and the player's staff with
 * their post, skills, pay, years to 70, an Assign select and Fire. Rebuilt on hires, departures and
 * month and year ends, and after each click, so a click never lands on a replaced button.
 */
import { BUILDINGS } from '../../data/buildings';
import type { GameController } from '../../game/controller';
import { assign, fire, hire, managerAge, RETIRE_AT, severance, takesManager } from '../../sim/logistics/managers';
import type { Manager } from '../../sim/logistics/types';
import { atPrices } from '../../sim/society/economy';
import type { Building, GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney } from '../format';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './panels.css';
import './managers.css';

/** The L/P/F chips of a manager. */
export function skillChips(m: Manager): HTMLElement {
  const chip = (letter: string, title: string, v: number) => h('span', { 'data-skill': v, title: `${title} ${v}` }, `${letter}${v}`);
  return h('span', { class: 'mgr-skills' }, chip('L', 'Logistics', m.skills.logistics), chip('P', 'Production', m.skills.production), chip('F', 'Frugality', m.skills.frugality));
}

/** Monthly pay at today's prices. */
export const payText = (state: GameState, m: Manager): string => `${formatMoney(Math.round(atPrices(state, m.salary)))}/mo`;

/** The player's works and warehouses, in id order. */
export function playerPosts(state: GameState): Building[] {
  return Object.values(state.buildings).filter((b) => b.ownerId === 'player' && takesManager(b)).sort((a, b) => a.id - b.id);
}

export const postName = (b: Building): string => `${BUILDINGS[b.typeId].name} #${b.id}`;

function toastResult(game: Pick<GameController, 'ctx'>, r: { ok: boolean; error?: string }, good: string): void {
  game.ctx.bus.emit(r.ok ? { type: 'toast', message: good, tone: 'good' } : { type: 'toast', message: r.error ?? 'Not possible', tone: 'bad' });
}

function render(game: GameController, rerender: () => void): HTMLElement {
  const { state } = game.ctx;
  const L = state.logistics;
  const year = state.date.year;

  const market = L.market.map((m) =>
    h('div', { class: 'mgr-row', 'data-manager': m.id },
      h('div', { class: 'p-row' }, h('span', { class: 'mgr-name' }, m.name), h('span', null, `Age ${managerAge(m, year)}`)),
      h('div', { class: 'p-row' }, skillChips(m), h('span', null, payText(state, m)),
        h('button', {
          class: 'btn', 'data-act': 'hire', title: `Hire ${m.name}`,
          onClick: () => {
            toastResult(game, hire(game.ctx, 'player', m.id), `${m.name} hired`);
            rerender();
          },
        }, 'Hire'))));

  const staff = L.managers.filter((m) => m.employer === 'player').map((m) => {
    const post = m.post === null ? null : state.buildings[m.post];
    const free = playerPosts(state).filter((b) => b.id === m.post || !L.managers.some((x) => x.post === b.id));
    const select = h('select', {
      'aria-label': `Post for ${m.name}`,
      onChange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        toastResult(game, assign(game.ctx, 'player', m.id, v === '' ? null : Number(v)), v === '' ? `${m.name} unposted` : `${m.name} posted`);
        rerender();
      },
    }, h('option', { value: '' }, 'No post'), free.map((b) => h('option', { value: b.id, selected: b.id === m.post }, postName(b))));
    return h('div', { class: 'mgr-row', 'data-manager': m.id },
      h('div', { class: 'p-row' }, h('span', { class: 'mgr-name' }, m.name), h('span', null, post ? postName(post) : 'No post')),
      h('div', { class: 'p-row' }, skillChips(m), h('span', null, payText(state, m)), h('span', { title: 'Retires at 70' }, `${Math.max(0, RETIRE_AT - managerAge(m, year))} y to 70`)),
      h('div', { class: 'mgr-acts' }, select,
        h('button', {
          class: 'btn', 'data-act': 'fire', title: `Severance ${formatMoney(severance(state, m))}`,
          onClick: () => {
            toastResult(game, fire(game.ctx, 'player', m.id), `${m.name} dismissed`);
            rerender();
          },
        }, 'Fire')));
  });

  return h('div', { class: 'managers-panel' },
    h('div', { class: 'p-section' }, h('div', { class: 'p-head' }, 'On the market'),
      market.length ? market : h('div', { class: 'p-row mgr-empty' }, 'No candidates this year')),
    h('div', { class: 'p-section' }, h('div', { class: 'p-head' }, 'Your staff'),
      staff.length ? staff : h('div', { class: 'p-row mgr-empty' }, 'No managers hired')));
}

export const managersPanel: PanelDef = {
  id: 'managers',
  open(game: GameController) {
    const offs: (() => void)[] = [];
    let win: ReturnType<typeof createWindow> | null = null;
    const rerender = () => win?.setContent(render(game, rerender));
    win = createWindow({
      id: 'managers',
      title: 'Managers',
      width: 420,
      content: render(game, rerender),
      onClose: () => {
        for (const off of offs) off();
        win = null;
      },
    });
    for (const t of ['managerHired', 'managerLeft', 'monthEnd', 'yearEnd'] as const) offs.push(game.ctx.bus.on(t, rerender));
  },
};
