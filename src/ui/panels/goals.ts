import type { GameController } from '../../game/controller';
import './panels.css';
import { dateToDays } from '../../sim/clock';
import { legacyScore } from '../../sim/legacy';
import { evaluateGoals, goalProgress, scenarioOf } from '../../sim/scenarios';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import '../menu.css';
import { createWindow } from '../window';
import type { PanelDef } from './index';

function fmt(n: number, isMoney: boolean): string {
  return isMoney ? formatMoney(n) : formatNumber(n);
}

export function buildGoals(state: GameState): HTMLElement {
  const sc = scenarioOf(state);
  const legacy = h('div', { class: 'gl-line gl-legacy' }, h('b', null, 'Legacy'), h('span', null, formatNumber(legacyScore(state).total)));
  if (sc.goals.length === 0) {
    return h('div', { class: 'p-section gl-list' },
      h('div', { class: 'gl-note' }, `${sc.name}: no goals, no deadlines. Build whatever you like until the century ends.`),
      legacy);
  }
  const { done, failed } = evaluateGoals(state);
  return h('div', { class: 'p-section gl-list' },
    h('div', { class: 'gl-note' }, `${sc.name} - ${sc.blurb}`),
    ...sc.goals.map((g, i) => {
      const p = goalProgress(state, g);
      const pct = Math.min(100, Math.max(0, (p.value / p.target) * 100));
      const money = g.kind === 'money';
      const left = Math.round((dateToDays({ year: g.byYear, month: 1, day: 1, hour: 0 }) - dateToDays(state.date)) / 360 * 10) / 10;
      const status = done[i] ? 'Done!' : failed ? 'Missed' : `${Math.max(0, left)} years left`;
      return h('div', { class: `gl-goal ${done[i] ? 'done' : failed ? 'failed' : ''}` },
        h('div', { class: 'gl-line' }, h('b', null, p.label), h('span', null, `by ${g.byYear}`)),
        h('div', { class: 'gl-bar' }, h('i', { style: { width: `${pct}%` } })),
        h('div', { class: 'gl-line' },
          g.kind === 'takeover' ? h('span', null, done[i] ? 'Complete' : 'Buy 510 of his 1000 shares (you need 1.5x his wealth, and control costs a premium as large again)') : h('span', null, `${fmt(Math.min(p.value, p.target), money)} / ${fmt(p.target, money)}`),
          h('span', null, status)));
    }),
    legacy);
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
