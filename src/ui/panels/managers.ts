/**
 * The Managers window (Phase 4b spec 7.4): the year's candidates with Hire, and the player's staff with
 * their post, skills, pay, years to 70, an Assign select and Fire. Rebuilt on hires, departures and
 * month and year ends, and after each click, so a click never lands on a replaced button.
 */
import { BUILDINGS } from '../../data/buildings';
import type { GameController } from '../../game/controller';
import { assign, fire, hire, managerAge, RETIRE_AT, severance, takesManager } from '../../sim/logistics/managers';
import type { Manager, Skill } from '../../sim/logistics/types';
import { atPrices } from '../../sim/society/economy';
import type { Building, GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney } from '../format';
import { button, emptyState, meter, panelHeader, section, tooltip } from '../kit';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './panels.css';
import './managers.css';

/** The L/P/F chips of a manager. */
export function skillChips(m: Manager): HTMLElement {
  const chip = (letter: string, title: string, v: number) => h('span', { 'data-skill': v, title: `${title} ${v}` }, `${letter}${v}`);
  return h('span', { class: 'mgr-skills' }, chip('L', 'Logistics', m.skills.logistics), chip('P', 'Production', m.skills.production), chip('F', 'Frugality', m.skills.frugality));
}

/** The top of the skill scale (`Skill` in sim/logistics/types.ts runs 1 to 5). */
export const SKILL_MAX = 5 satisfies Skill;

const SKILLS = [
  { key: 'logistics', label: 'Logistics', what: 'Hubs dispatch more and smarter trucks' },
  { key: 'production', label: 'Production', what: 'Works produce more per day' },
  { key: 'frugality', label: 'Frugality', what: 'Lower upkeep and salary demands' },
] as const;

/** Three labelled meters (Logistics, Production, Frugality), each with a tooltip saying what it does. */
function skillMeters(m: Manager, disposers: (() => void)[]): HTMLElement {
  return h('div', { class: 'mgr-meters' }, SKILLS.map((sk) => {
    const v = m.skills[sk.key];
    const bar = meter(v, SKILL_MAX, { label: sk.label, tone: v >= 4 ? 'positive' : 'neutral' });
    bar.removeAttribute('title'); // the kit tooltip explains it instead
    const row = h('div', { class: 'mgr-skill', tabindex: '0', 'data-skill-key': sk.key },
      h('span', { class: 'mgr-skill-label' }, sk.label),
      bar,
      h('span', { class: 'mgr-skill-value' }, `${v}/${SKILL_MAX}`));
    disposers.push(tooltip(row, () => h('div', { class: 'mgr-tip' },
      h('b', null, `${sk.label} ${v} of ${SKILL_MAX}`), h('div', null, sk.what))));
    return row;
  }));
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

function render(game: GameController, rerender: () => void, disposers: (() => void)[]): HTMLElement {
  const { state } = game.ctx;
  const L = state.logistics;
  const year = state.date.year;

  const market = L.market.map((m) => {
    const hireBtn = button('Hire', {
      variant: 'secondary',
      title: `Hire ${m.name}`,
      onClick: () => {
        toastResult(game, hire(game.ctx, 'player', m.id), `${m.name} hired`);
        rerender();
      },
    });
    hireBtn.dataset.act = 'hire';
    return h('div', { class: 'mgr-row mgr-card', 'data-manager': m.id },
      h('div', { class: 'mgr-card-head' },
        h('span', { class: 'mgr-name', title: m.name }, m.name),
        h('span', { class: 'mgr-sub' }, `Age ${managerAge(m, year)} · ${payText(state, m)}`),
        hireBtn),
      skillMeters(m, disposers));
  });

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
    const fireBtn = button('Fire', {
      variant: 'danger',
      title: `Severance ${formatMoney(severance(state, m))}`,
      onClick: () => {
        toastResult(game, fire(game.ctx, 'player', m.id), `${m.name} dismissed`);
        rerender();
      },
    });
    fireBtn.dataset.act = 'fire';
    const postLabel = post ? postName(post) : 'No post';
    return h('div', { class: 'mgr-row mgr-card', 'data-manager': m.id },
      h('div', { class: 'mgr-card-head' },
        h('span', { class: 'mgr-name', title: m.name }, m.name),
        h('span', { class: `mgr-post${post ? '' : ' mgr-post--none'}`, title: postLabel }, postLabel)),
      h('div', { class: 'mgr-sub' }, `${payText(state, m)} · `,
        h('span', { title: 'Retires at 70' }, `${Math.max(0, RETIRE_AT - managerAge(m, year))} y to 70`)),
      skillMeters(m, disposers),
      h('div', { class: 'mgr-acts' }, select, fireBtn));
  });

  const hired = staff.length;
  return h('div', { class: 'managers-panel' },
    h('div', { class: 'mgr-header' }, panelHeader({ title: 'Managers', summary: `${market.length} on the market · ${hired} on staff` })),
    section('On the market', [market.length
      ? h('div', { class: 'mgr-list' }, market)
      : emptyState({ title: 'No candidates this year', body: 'A fresh list of candidates arrives each new year.' })]),
    section('Your staff', [staff.length
      ? h('div', { class: 'mgr-list' }, staff)
      : emptyState({ title: 'No managers yet', body: 'A manager at a busy works or hub pays for themselves.' })]));
}

/** Windows whose bus listeners are already on (a second open only raises the window). */
const wired = new WeakSet<HTMLElement>();

export const managersPanel: PanelDef = {
  id: 'managers',
  open(game: GameController) {
    const offs: (() => void)[] = [];
    let disposers: (() => void)[] = [];
    const build = () => {
      for (const d of disposers) d();
      disposers = [];
      return render(game, rerender, disposers);
    };
    let win: ReturnType<typeof createWindow> | null = null;
    const rerender = () => win?.setContent(build());
    win = createWindow({
      id: 'managers',
      title: 'Managers',
      width: 420,
      content: build(),
      onClose: () => {
        for (const off of offs) off();
        for (const d of disposers) d();
        disposers = [];
        win = null;
      },
    });
    // createWindow returns the already-open window for this id: that one is wired up already
    if (wired.has(win.el)) {
      for (const d of disposers) d();
      return;
    }
    wired.add(win.el);
    for (const t of ['managerHired', 'managerLeft', 'monthEnd', 'yearEnd'] as const) offs.push(game.ctx.bus.on(t, rerender));
  },
};
