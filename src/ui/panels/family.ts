/**
 * The Family window (Phase 4 Task 5, spec §7.2): the head of the family, the spouse and the children,
 * each with a procedural portrait, age and traits (with what each does), plus the generation and the
 * family's prestige. "Name heir" on a child names them heir (sim/dynasty nameHeir); with none named,
 * the eldest living child inherits.
 */
import { DYNASTY_TRAITS } from '../../data/dynasty';
import type { GameController } from '../../game/controller';
import { drawFamilyPortrait } from '../../render/portrait';
import { MARRIAGE_FIRST_YEAR, nameHeir } from '../../sim/dynasty/family';
import { age, canMarry, HEIR_MIN_AGE, isFemale, successor, type Person } from '../../sim/dynasty/types';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import { button, emptyState, panelHeader, section as kitSection, statRow, statTile } from '../kit';
import './panels.css';
import { createWindow, type GameWindow } from '../window';
import type { PanelDef } from './index';

const HEAD_PX = 96;
const CHILD_PX = 64;

function portrait(person: Person, year: number, px: number): HTMLElement {
  const canvas = h('canvas', {
    width: px * 2,
    height: px * 2,
    style: { width: `${px}px`, height: `${px}px`, flex: '0 0 auto' },
    'aria-label': `Portrait of ${person.name}`,
  }) as HTMLCanvasElement;
  // jsdom has no 2D context; the panel works without the picture
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  // the dead are pictured at the age they died
  if (g) drawFamilyPortrait(g, px * 2, person, { year: person.died ?? year, female: isFemale(person) });
  return canvas;
}

/** One block of the panel: a kit section (its overline is the shared `.p-head`). */
const section = (title: string, ...content: HTMLElement[]) => kitSection(title, content);

/** A compact kit empty state carrying the block's class (tests look for it). */
function none(cls: string, title: string, body?: string): HTMLElement {
  const el = emptyState({ title, body });
  el.classList.add(cls, 'family-muted', 'p-empty-sm');
  return el;
}

function traitList(person: Person): HTMLElement {
  if (person.traits.length === 0) return h('div', { class: 'family-traits family-muted' }, 'No marked traits.');
  return h('div', { class: 'family-traits' },
    person.traits.map((t) => h('div', { class: 'family-trait', 'data-trait': t },
      h('span', { class: 'family-trait-label' }, DYNASTY_TRAITS[t]?.label ?? t),
      h('span', { class: 'family-trait-blurb' }, DYNASTY_TRAITS[t]?.blurb ?? ''))));
}

function personRow(cls: string, person: Person, year: number, px: number, ...extra: (HTMLElement | string | null)[]): HTMLElement {
  return h('div', { class: `family-person ${cls}`, 'data-person': String(person.id) },
    portrait(person, year, px),
    h('div', { class: 'family-person-text' },
      h('div', { class: 'family-name' }, person.name),
      h('div', { class: 'family-age' },
        person.alive || person.died === undefined ? `aged ${age(person, year)}` : `died ${person.died}, aged ${age(person, year)}`),
      traitList(person),
      ...extra));
}

function render(game: GameController, refresh: () => void): HTMLElement {
  const { state } = game.ctx;
  const d = state.dynasty;
  const year = state.date.year;
  const heir = successor(d);

  const head = personRow('family-head', d.head, year, HEAD_PX,
    h('div', { class: 'family-role' }, d.head.alive ? 'Head of the family' : 'The family line has ended.'));

  const spouse = d.spouse
    ? personRow('family-spouse', d.spouse, year, CHILD_PX)
    : none('family-spouse', 'Unmarried',
      !canMarry(d, year)
        ? undefined
        : year < MARRIAGE_FIRST_YEAR
          ? `The family will propose a match from ${MARRIAGE_FIRST_YEAR}.`
          : 'The family will propose a match each spring.');

  const children = d.children.length === 0
    ? d.spouse
      ? none('family-children', 'No children yet', 'The eldest living child inherits unless you name an heir.')
      : none('family-children', 'No children', 'Marry to secure an heir.')
    : h('div', { class: 'family-children' },
      d.children.map((c) => {
        const isHeir = heir?.id === c.id;
        const minor = age(c, year) < HEIR_MIN_AGE;
        const badge = isHeir
          ? h('div', { class: 'family-heir-badge' },
            `${d.heirId === c.id ? 'Named heir' : 'Heir (eldest)'}${minor ? ` · under ${HEIR_MIN_AGE}: the head holds on until they come of age` : ''}`)
          : null;
        const heirBtn = button('Name heir', {
          variant: 'secondary',
          title: `Name ${c.name} heir`,
          disabled: !c.alive || d.heirId === c.id || !d.head.alive,
          onClick: () => {
            const r = nameHeir(state, c.id);
            game.ctx.bus.emit(r.ok
              ? { type: 'toast', message: `${c.name} is named heir.`, tone: 'good' }
              : { type: 'toast', message: r.error, tone: 'bad' });
            refresh();
          },
        });
        heirBtn.classList.add('family-name-heir');
        return personRow('family-child', c, year, CHILD_PX, badge, heirBtn);
      }));

  const gen = statTile({ label: 'Generation', value: String(d.generation), title: 'Heads of the family so far' });
  gen.classList.add('family-generation');
  const prestige = statTile({ label: 'Prestige', value: String(d.prestige), title: 'Family prestige: it counts toward your Legacy' });
  prestige.classList.add('family-prestige');
  return h('div', { class: 'family-panel' },
    h('div', { class: 'family-header' }, panelHeader({ title: 'Family', summary: `${d.head.name}, ${age(d.head, year)}` })),
    statRow([gen, prestige]),
    section('Head of the family', head),
    section('Spouse', spouse),
    section('Children', children));
}

let win: GameWindow | null = null;

export const familyPanel: PanelDef = {
  id: 'family',
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
      id: 'family',
      title: `The ${familyTitle(game.ctx.state)} Family`,
      tabTitle: 'Family',
      width: 400,
      content: render(game, refresh),
      onClose: () => {
        for (const off of offs) off();
        win = null;
      },
    });
    offs.push(game.ctx.bus.on('monthEnd', refresh));
  },
};

function familyTitle(state: GameState): string {
  return state.dynasty.head.name.split(' ').slice(-1)[0];
}
