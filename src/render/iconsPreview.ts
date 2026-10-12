// Dev-only icon sheet: run `npm run dev` and open /icons-preview.html
import { iconEl } from '../ui/icon';
import { h } from '../ui/dom';
import { ICON_IDS } from './icons';

const SIZES = [16, 24, 48];

const sheet = (cls: string) =>
  h('div', { class: `sheet ${cls}` }, ICON_IDS.map((id) =>
    h('div', { class: 'cell', title: id },
      h('div', { class: 'row' }, SIZES.map((s) => iconEl(id, s, id))),
      h('span', null, id))));

document.getElementById('root')!.append(
  h('h2', null, `${ICON_IDS.length} icons at ${SIZES.join(' / ')} px, on walnut`), sheet('walnut'),
  h('h2', null, 'on paper'), sheet('paper'),
  h('h2', null, 'unknown id'), h('div', { class: 'sheet' }, iconEl('no_such_icon', 24, '?')),
);
