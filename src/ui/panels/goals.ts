import { chaseChipText, loadUnlocked } from '../../game/achievements';
import type { GameController } from '../../game/controller';
import './panels.css';
import {
  activeAmbitionId,
  ambitionById,
  ambitionsEnabled,
  completedAmbitions,
  tickAmbitions,
} from '../../sim/ambitions';
import { dateToDays } from '../../sim/clock';
import { legacyScore } from '../../sim/legacy';
import { evaluateGoals, goalProgress, scenarioOf } from '../../sim/scenarios';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { card, emptyState, meter, panelHeader, pill, section, statRow, statTile, type Tone } from '../kit';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './goals.css';

function fmt(n: number, isMoney: boolean): string {
  return isMoney ? formatMoney(n) : formatNumber(n);
}

/** "1 of 2 goals met" for a scenario with goals; free play says so (or names the active ambition). */
export function goalsHeadline(state: GameState): { summary: string; tone: Tone } {
  const sc = scenarioOf(state);
  if (sc.goals.length === 0) {
    if (ambitionsEnabled(state)) {
      tickAmbitions(state);
      const id = activeAmbitionId(state);
      const a = id ? ambitionById(id) : null;
      if (a) return { summary: `Ambition: ${a.name}`, tone: 'info' };
      return { summary: 'Free play: ambitions complete', tone: 'positive' };
    }
    return { summary: 'Free play: no goals or deadlines', tone: 'neutral' };
  }
  const { done, failed } = evaluateGoals(state);
  const met = done.filter(Boolean).length;
  const tone: Tone = met === sc.goals.length ? 'positive' : failed ? 'negative' : 'neutral';
  return { summary: `${met} of ${sc.goals.length} goals met`, tone };
}

/** Free Play soft ambition meters (replaces the shrug empty state). */
function buildAmbitions(state: GameState): HTMLElement {
  tickAmbitions(state);
  const id = activeAmbitionId(state);
  const active = id ? ambitionById(id) : null;
  const done = completedAmbitions(state);
  const parts: HTMLElement[] = [];
  if (active) {
    const p = active.progress(state);
    const money = active.id === 'year_profit_50k';
    const progress = `${fmt(Math.min(p.value, p.target), money)} of ${fmt(p.target, money)}`;
    const el = card({
      title: active.name,
      tone: 'info',
      actions: [pill('Active', 'info')],
      children: [
        h('p', { class: 'gl-note' }, active.desc),
        meter(p.value, p.target, { tone: 'info', label: `${active.name}: ${progress}` }),
        h('div', { class: 'gl-line' }, h('span', { class: 'gl-progress' }, progress), h('span', { class: 'gl-by' }, 'soft goal')),
      ],
    });
    el.classList.add('gl-goal', 'gl-ambition');
    parts.push(el);
  } else {
    const free = emptyState({
      title: done.length > 0 ? 'Ambitions complete' : 'Nothing to chase but your legacy',
      body: done.length > 0
        ? 'You have finished the soft ambitions. Legacy and the century clock remain.'
        : 'Pick a scenario from the main menu for goals with deadlines.',
    });
    free.classList.add('p-empty-sm');
    parts.push(free);
  }
  if (done.length > 0) {
    const list = done.map((a) =>
      h('div', { class: 'gl-done-row' }, pill('Done', 'positive'), h('span', null, a.name)),
    );
    parts.push(section('Completed', [h('div', { class: 'gl-done-list' }, list)]));
  }
  return h('div', { class: 'gl-list' }, parts);
}

export function buildGoals(state: GameState): HTMLElement {
  const sc = scenarioOf(state);
  const legacyTile = statTile({ label: 'Legacy', value: formatNumber(legacyScore(state).total), title: 'Fortune, landmarks, reputation and dynasty: see the Legacy panel' });
  legacyTile.classList.add('gl-legacy');
  const head = goalsHeadline(state);
  const chase = chaseChipText(state, loadUnlocked());
  const chaseChip = chase
    ? h('div', { class: 'gl-chase', 'data-chase': '1', title: 'Nearest incomplete achievement' }, chase)
    : null;
  const header = h('div', { class: 'goals-header' }, panelHeader({ title: 'Goals', ...head }), chaseChip);
  const scenario = section(sc.name, [h('p', { class: 'gl-note' }, sc.goals.length === 0 ? 'No hard deadlines. Soft ambitions keep the next chase in view until the century ends.' : sc.blurb)]);
  scenario.classList.add('gl-scenario');
  if (sc.goals.length === 0) {
    return h('div', { class: 'goals-panel' }, header, scenario, section('Ambitions', [buildAmbitions(state)]), statRow([legacyTile]));
  }
  const { done, failed } = evaluateGoals(state);
  const goals = sc.goals.map((g, i) => {
    const p = goalProgress(state, g);
    const money = g.kind === 'money';
    const left = Math.round((dateToDays({ year: g.byYear, month: 1, day: 1, hour: 0 }) - dateToDays(state.date)) / 360 * 10) / 10;
    const status = done[i] ? pill('Done', 'positive') : failed ? pill('Missed', 'negative') : pill(`${Math.max(0, left)} years left`, left <= 2 ? 'warning' : 'neutral');
    const tone: Tone = done[i] ? 'positive' : failed ? 'negative' : 'neutral';
    const progress = g.kind === 'takeover'
      ? done[i] ? 'Complete' : 'Buy 510 of his 1000 shares (you need 1.5x his wealth, and control costs a premium as large again)'
      : `${fmt(Math.min(p.value, p.target), money)} of ${fmt(p.target, money)}`;
    const el = card({
      title: p.label,
      tone,
      actions: [status],
      children: [
        meter(p.value, p.target, { tone: done[i] ? 'positive' : failed ? 'negative' : 'neutral', label: `${p.label}: ${progress}` }),
        h('div', { class: 'gl-line' }, h('span', { class: 'gl-progress' }, progress), h('span', { class: 'gl-by' }, `by ${g.byYear}`)),
      ],
    });
    el.classList.add('gl-goal');
    if (done[i]) el.classList.add('done');
    else if (failed) el.classList.add('failed');
    return el;
  });
  return h('div', { class: 'goals-panel' }, header, scenario, section('Goals', [h('div', { class: 'gl-list' }, goals)]), statRow([legacyTile]));
}

export const goalsPanel: PanelDef = {
  id: 'goals',
  open(game: GameController) {
    const offs: (() => void)[] = [];
    const win = createWindow({
      id: 'goals',
      title: 'Scenario Goals',
      tabTitle: 'Goals',
      content: buildGoals(game.state),
      width: 360,
      onClose: () => offs.forEach((f) => f()),
    });
    const redraw = () => win.setContent(buildGoals(game.state));
    offs.push(game.ctx.bus.on('dayStart', redraw));
  },
};
