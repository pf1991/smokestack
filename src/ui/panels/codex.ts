import './panels.css';
import './codex.css';
import type { GameController } from '../../game/controller';
import { BUILDINGS } from '../../data/buildings';
import { consumersOf, producersOf, upstreamTree, type ChainNode } from '../../data/chains';
import { GOODS, type GoodDef } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import type { GameState, GoodId } from '../../sim/types';
import { ICON_IDS } from '../../render/icons';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { iconEl } from '../icon';
import { card, dataTable, emptyState, panelHeader, pill } from '../kit';
import { createWindow } from '../window';
import { cityDemand } from './city';
import type { PanelDef } from './index';

type Kind = 'raw' | 'processed' | 'consumer';

/** A good's kind. R4 gives GoodDef a `kind` field: this becomes `(g) => g.kind`. */
const kindOf = (g: GoodDef): Kind => (['raw', 'processed', 'consumer'] as const)[g.tier];

const KIND_LABEL: Record<Kind, string> = { raw: 'Raw', processed: 'Processed', consumer: 'Consumer' };

type FilterId = 'all' | Kind | 'mine';
const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'raw', label: 'Raw' },
  { id: 'processed', label: 'Processed' },
  { id: 'consumer', label: 'Consumer' },
  { id: 'mine', label: 'I make this' },
];

const REFRESH_MS = 1000;

const goodName = (id: GoodId) => GOODS[id]?.name ?? id;
const buildingName = (id: string) => BUILDINGS[id]?.name ?? id;
const unique = <T,>(xs: T[]) => [...new Set(xs)];

/** A good's atlas icon, else a swatch in its colour (goods added before their glyph is painted). */
export function goodIcon(id: GoodId, size = 16): HTMLElement {
  if (ICON_IDS.includes(id)) return iconEl(id, size);
  const chip = h('span', { class: 'cx-chip', 'aria-hidden': 'true' });
  chip.style.width = chip.style.height = `${size}px`;
  if (GOODS[id]?.color) chip.style.background = GOODS[id].color;
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

/** Goods the player's works are set to make right now. */
function goodsMade(state: GameState): Set<GoodId> {
  const out = new Set<GoodId>();
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'player' || !b.recipeId) continue;
    for (const g of Object.keys(RECIPES[b.recipeId]?.outputs ?? {})) out.add(g);
  }
  return out;
}

/** This month's demand for each good, summed over every town (the city inspector's figures). */
function townDemand(state: GameState): Map<GoodId, number> {
  const out = new Map<GoodId, number>();
  for (const city of state.cities) {
    for (const d of cityDemand(state, city)) out.set(d.goodId, (out.get(d.goodId) ?? 0) + d.demand);
  }
  return out;
}

interface Row {
  id: GoodId;
  price: number;
  demand: number;
}

class CodexPanel {
  readonly root = h('div', { class: 'codex' });
  private readonly headerBox = h('div', { class: 'cx-header' });
  private readonly filterBar = h('div', { class: 'cx-filters', role: 'group', 'aria-label': 'Show goods' });
  private readonly listBox = h('div', { class: 'cx-list' });
  private readonly detailBox = h('div', { class: 'cx-detail-box' });
  private filter: FilterId = 'all';
  private selected: GoodId | null = null;
  private readonly shown = new WeakMap<HTMLElement, string>();
  private timer = 0;

  constructor(private readonly game: GameController) {
    for (const f of FILTERS) {
      this.filterBar.append(
        h('button', {
          class: 'cx-filter',
          type: 'button',
          'data-filter': f.id,
          'aria-pressed': 'false',
          onClick: () => {
            this.filter = f.id;
            this.update();
          },
        }, f.label),
      );
    }
    this.root.append(this.headerBox, this.filterBar, h('div', { class: 'cx-body' }, this.listBox, this.detailBox));
    createWindow({
      id: 'codex',
      title: 'Production codex',
      tabTitle: 'Codex',
      content: this.root,
      width: 600,
      onClose: () => {
        clearInterval(this.timer);
        current = null;
      },
    });
    // the list's demand follows the towns as they grow; everything else changes only on a click
    this.timer = window.setInterval(() => this.update(), REFRESH_MS);
    this.update();
  }

  /** Selects `good`; `reveal` scrolls its list row into view (selections from outside the list). */
  select(good: GoodId, reveal = false): void {
    if (!GOODS[good]) return;
    this.selected = good;
    this.update();
    if (!reveal) return;
    const row = [...this.listBox.querySelectorAll<HTMLElement>('tr[data-key]')].find((tr) => tr.dataset.key === good);
    if (!row) return;
    // scroll the list box only (scrollIntoView would also scroll the window body past the header)
    const r = row.getBoundingClientRect();
    const box = this.listBox.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) this.listBox.scrollTop += r.top - box.top - (box.height - r.height) / 2;
  }

  /** Replaces `box`'s children when `key` changed, keeping its scroll where it was. */
  private swap(box: HTMLElement, key: string, build: () => HTMLElement): void {
    if (this.shown.get(box) === key) return;
    this.shown.set(box, key);
    const top = box.scrollTop;
    box.replaceChildren(build());
    box.scrollTop = top;
  }

  update(): void {
    const state = this.game.state;
    const made = goodsMade(state);
    const all = Object.values(GOODS);
    const summary = `${all.length} goods · you make ${made.size}`;
    this.swap(this.headerBox, summary, () => panelHeader({ title: 'Production codex', summary, icon: 'chain' }));

    for (const b of this.filterBar.querySelectorAll<HTMLElement>('.cx-filter')) {
      const on = String(b.dataset.filter === this.filter);
      if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
    }

    const demand = townDemand(state);
    const rows: Row[] = all
      .filter((g) => (this.filter === 'all' ? true : this.filter === 'mine' ? made.has(g.id) : kindOf(g) === this.filter))
      .map((g) => ({ id: g.id, price: g.basePrice, demand: Math.round(demand.get(g.id) ?? 0) }));
    this.swap(this.listBox, JSON.stringify([this.filter, this.selected, rows]), () => this.list(rows));

    const year = state.date.year;
    const sel = this.selected;
    this.swap(this.detailBox, `${sel}|${sel && GOODS[sel].era > year}`, () => (sel ? this.detail(sel, year) : emptyState({
      icon: 'chain',
      title: 'Pick a good',
      body: 'Its recipe tree, the works that make it and what it goes into appear here.',
    })));
  }

  private list(rows: Row[]): HTMLElement {
    if (rows.length === 0 && this.filter === 'mine') {
      return emptyState({ title: 'You make nothing yet', body: 'Build a works and set it running: its goods are listed here.' });
    }
    const table = dataTable<Row>({
      columns: [
        {
          key: 'good',
          label: 'Good',
          render: (r) => h('span', { class: 'cx-good' }, goodIcon(r.id, 16), h('span', { class: 'cx-good-name' }, goodName(r.id))),
          title: (r) => goodName(r.id),
        },
        { key: 'price', label: 'Price', align: 'right', render: (r) => formatMoney(r.price) },
        { key: 'demand', label: 'Demand', align: 'right', render: (r) => (r.demand > 0 ? formatNumber(r.demand) : '–') },
      ],
      rows,
      emptyText: 'No goods',
      rowKey: (r) => r.id,
      onRowClick: (r) => this.select(r.id),
    });
    table.querySelector('th[data-col="price"]')?.setAttribute('title', 'Base price in 1900 dollars');
    table.querySelector('th[data-col="demand"]')?.setAttribute('title', 'What every town together wants this month');
    for (const tr of table.querySelectorAll<HTMLElement>('tbody tr[data-key]')) {
      tr.setAttribute('aria-selected', String(tr.dataset.key === this.selected));
    }
    return table;
  }

  private link(good: GoodId): HTMLElement {
    return h('button', {
      class: 'cx-link',
      type: 'button',
      'data-good': good,
      'aria-current': good === this.selected ? 'true' : undefined,
      title: `Show ${goodName(good)} in the codex`,
      onClick: () => this.select(good, true),
    }, goodIcon(good, 16), h('span', null, goodName(good)));
  }

  private treeRows(node: ChainNode, level: number): HTMLElement[] {
    const where = node.via ? buildingName(node.via.building) : null;
    const row = h(
      'li',
      { class: 'cx-node', 'data-level': level },
      this.link(node.good),
      where ? h('span', { class: 'cx-where' }, node.inputs.length > 0 ? `in ${where}` : `from ${where}`) : null,
    );
    row.style.setProperty('--cx-level', String(level));
    return [row, ...node.inputs.flatMap((n) => this.treeRows(n, level + 1))];
  }

  private detail(good: GoodId, year: number): HTMLElement {
    const g = GOODS[good];
    const makers = unique(producersOf(good).map((p) => buildingName(p.building)));
    const uses = unique(consumersOf(good).map((c) => c.output));
    const head = h(
      'div',
      { class: 'cx-detail-head' },
      goodIcon(good, 32),
      h('div', { class: 'cx-detail-title' },
        h('h3', null, g.name),
        h('div', { class: 'cx-detail-meta' },
          pill(KIND_LABEL[kindOf(g)]),
          h('span', null, `Base ${formatMoney(g.basePrice)}`),
          g.era > year ? pill(`Unlocks ${g.era}`, 'warning') : null)),
    );
    const usedIn = uses.length > 0
      ? h('div', { class: 'cx-used' }, uses.map((u) => this.link(u)))
      : h('span', { class: 'cx-muted' }, kindOf(g) === 'consumer' ? 'Sold to towns' : 'Nothing yet');
    const el = card({
      children: [
        head,
        h('div', { class: 'cx-line' }, h('span', { class: 'cx-label' }, 'Made in: '), makers.length > 0 ? makers.join(', ') : 'nowhere yet'),
        h('div', { class: 'cx-line cx-line--used' }, h('span', { class: 'cx-label' }, 'Used in: '), usedIn),
        h('div', { class: 'cx-sub' }, 'Recipe tree'),
        h('ul', { class: 'cx-tree' }, this.treeRows(upstreamTree(good), 0)),
      ],
    });
    el.classList.add('cx-detail');
    el.dataset.good = good;
    return el;
  }
}

let current: CodexPanel | null = null;

export const codexPanel: PanelDef = {
  id: 'codex',
  open(game: GameController, arg?: unknown) {
    if (current) createWindow({ id: 'codex', title: 'Production codex', content: h('div') }); // raises the open window
    else current = new CodexPanel(game);
    if (typeof arg === 'string') current.select(arg, true);
  },
};
