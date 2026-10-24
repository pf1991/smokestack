/**
 * A good's icon and its short tooltip, shared by the build bar, the building inspector and the
 * production codex (so the toolbar does not pull in the codex panel).
 */
import './goodTooltip.css';
import { BUILDINGS } from '../data/buildings';
import { producersOf } from '../data/chains';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { ICON_IDS } from '../render/icons';
import type { GoodId } from '../sim/types';
import { h } from './dom';
import { formatMoney } from './format';
import { iconEl } from './icon';
import { tooltip } from './kit';

const goodName = (id: GoodId) => GOODS[id]?.name ?? id;
const buildingName = (id: string) => BUILDINGS[id]?.name ?? id;

/**
 * A good's atlas icon, else a `.good-chip` swatch in its colour (goods added before their glyph is
 * painted). With `label` the chip is an image with that name; without, it is decorative.
 */
export function goodIcon(id: GoodId, size = 16, label?: string): HTMLElement {
  if (ICON_IDS.includes(id)) return iconEl(id, size, label);
  const chip = h('span', label ? { class: 'good-chip', role: 'img', 'aria-label': label } : { class: 'good-chip', 'aria-hidden': 'true' });
  chip.style.width = chip.style.height = `${size}px`;
  if (GOODS[id]?.color) chip.style.setProperty('--chip', GOODS[id].color);
  return chip;
}

/** "Made from Flour + Milk in Bakery", "Gathered at Farm", or "Not made anywhere". */
export function madeFromLine(good: GoodId): string {
  const via = producersOf(good)[0];
  if (!via) return 'Not made anywhere';
  const ins = Object.keys(RECIPES[via.recipe]?.inputs ?? {}).map(goodName);
  return ins.length > 0 ? `Made from ${ins.join(' + ')} in ${buildingName(via.building)}` : `Gathered at ${buildingName(via.building)}`;
}

/** The codex's short form, shown over good icons: name, base price, and what it is made from where. */
export function goodTooltip(good: GoodId): HTMLElement {
  const g = GOODS[good];
  return h(
    'div',
    { class: 'cx-tip' },
    h('div', { class: 'cx-tip-head' }, goodIcon(good, 16), h('strong', null, goodName(good)), g ? h('span', { class: 'cx-tip-price' }, formatMoney(g.basePrice)) : null),
    h('div', { class: 'cx-tip-line' }, madeFromLine(good)),
  );
}

/**
 * Gives `el` the good tooltip. While the pointer is on it, the nearest ancestor's native `title`
 * (a tool card's description) is parked, so the browser does not show a second, plain tooltip over
 * ours; it comes back on leave and on dispose. Returns the disposer.
 */
export function goodTip(el: HTMLElement, good: GoodId): () => void {
  let host: HTMLElement | null = null;
  let parked = '';
  const park = () => {
    const at = el.parentElement?.closest<HTMLElement>('[title]') ?? null;
    if (!at) return;
    host = at;
    parked = at.title;
    at.removeAttribute('title');
  };
  const restore = () => {
    if (host && !host.hasAttribute('title')) host.setAttribute('title', parked);
    host = null;
  };
  el.addEventListener('pointerenter', park);
  el.addEventListener('pointerleave', restore);
  const off = tooltip(el, () => goodTooltip(good));
  return () => {
    restore();
    el.removeEventListener('pointerenter', park);
    el.removeEventListener('pointerleave', restore);
    off();
  };
}
