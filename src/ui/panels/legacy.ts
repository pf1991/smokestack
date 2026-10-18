import type { GameController } from '../../game/controller';
import { LEGACY_PARTS, legacyScore } from '../../sim/legacy';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import { formatNumber } from '../format';
import '../menu.css';
import './panels.css';
import { createWindow } from '../window';
import type { PanelDef } from './index';

/** The Legacy window's content: the table under the shared section header. */
function legacySection(state: GameState): HTMLElement {
  return h('div', { class: 'p-section legacy-panel' }, h('div', { class: 'p-head' }, 'Your legacy so far'), buildLegacy(state));
}

/** The four Legacy parts, one line of explanation each, and the total. Shared with the end screen. */
export function buildLegacy(state: GameState): HTMLElement {
  const l = legacyScore(state);
  return h('div', { class: 'legacy-table' },
    ...LEGACY_PARTS.map((p) =>
      h('div', { class: 'legacy-row' },
        h('div', { class: 'gl-line' }, h('b', null, p.label), h('span', null, formatNumber(l[p.key]))),
        h('div', { class: 'gl-note' }, p.blurb))),
    h('div', { class: 'gl-line legacy-total' }, h('b', null, 'Legacy'), h('span', null, formatNumber(l.total))));
}

export const legacyPanel: PanelDef = {
  id: 'legacy',
  open(game: GameController) {
    const offs: (() => void)[] = [];
    const win = createWindow({
      id: 'legacy',
      title: 'Legacy',
      content: legacySection(game.state),
      width: 380,
      onClose: () => offs.forEach((f) => f()),
    });
    offs.push(game.ctx.bus.on('dayStart', () => win.setContent(legacySection(game.state))));
  },
};
