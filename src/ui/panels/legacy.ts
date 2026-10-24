import type { GameController } from '../../game/controller';
import { LEGACY_PARTS, legacyScore } from '../../sim/legacy';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import { formatNumber } from '../format';
import { dataTable, panelHeader, section } from '../kit';
import '../menu.css';
import './panels.css';
import { createWindow } from '../window';
import type { PanelDef } from './index';

type Part = (typeof LEGACY_PARTS)[number];

/** The Legacy window's content: a kit header with the score, then the four parts as a kit table. */
function legacySection(state: GameState): HTMLElement {
  const l = legacyScore(state);
  const table = dataTable<Part>({
    columns: [
      { key: 'part', label: 'Part', render: (p) => h('span', { class: 'legacy-part' }, h('b', null, p.label), h('span', { class: 'legacy-blurb' }, p.blurb)) },
      { key: 'points', label: 'Points', align: 'right', render: (p) => formatNumber(l[p.key]) },
    ],
    rows: [...LEGACY_PARTS],
    rowKey: (p) => p.key,
    emptyText: '',
  });
  table.classList.add('legacy-kit-table');
  table.querySelectorAll('tbody tr').forEach((tr) => tr.classList.add('legacy-row'));
  table.append(h('tfoot', null, h('tr', { class: 'legacy-total' },
    h('th', { scope: 'row' }, 'Legacy'),
    h('td', { 'data-align': 'right' }, formatNumber(l.total)))));
  return h('div', { class: 'legacy-panel' },
    h('div', { class: 'legacy-header' }, panelHeader({ title: 'Legacy', summary: `Legacy score ${formatNumber(l.total)}` })),
    section('Your legacy so far', [table]));
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
