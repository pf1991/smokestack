import { BUILDINGS, HOUSING_POOL, HOUSING_RADIUS, type BuildingDef } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { isUnlocked } from '../sim/eras';
import { ROAD_COST } from '../sim/state';
import { RAIL_COST } from '../sim/rail';
import type { GameState, Inventory } from '../sim/types';
import { type Child, h } from './dom';
import { iconEl } from './icon';
import { formatMoney } from './format';
import type { ToolSpec } from './tools';
import './hud.css';

type TabId = 'extract' | 'refine' | 'manufacture' | 'retail' | 'transport';

const TABS: { id: TabId; label: string }[] = [
  { id: 'extract', label: 'Extract' },
  { id: 'refine', label: 'Refine' },
  { id: 'manufacture', label: 'Manufacture' },
  { id: 'retail', label: 'Retail & Logistics' },
  { id: 'transport', label: 'Transport' },
];

function tabOf(def: BuildingDef): TabId | null {
  if (def.category === 'extractor') return 'extract';
  if (def.category === 'retail' || def.category === 'logistics') return 'retail';
  const outs = def.recipes.flatMap((r) => Object.keys(RECIPES[r]?.outputs ?? {}));
  return outs.length > 0 && outs.every((g) => GOODS[g]?.tier === 1) ? 'refine' : 'manufacture';
}

function goodsRow(inv: Inventory[]): HTMLElement[] {
  const ids = new Set<string>();
  for (const i of inv) for (const g of Object.keys(i)) ids.add(g);
  return [...ids].map((g) => iconEl(g, 16, GOODS[g]?.name ?? g));
}

function flow(def: BuildingDef): Child[] {
  const recipes = def.recipes.map((r) => RECIPES[r]).filter(Boolean);
  if (def.id === 'company_housing') return [`Houses ${HOUSING_POOL} hands; must stand within ${HOUSING_RADIUS} tiles of a factory`];
  if (recipes.length === 0) return [def.category === 'retail' ? 'Sells goods to the city' : 'Stores goods'];
  const ins = goodsRow(recipes.map((r) => r.inputs));
  const outs = goodsRow(recipes.map((r) => r.outputs));
  return [ins.length > 0 ? ins : iconEl('pick', 16, 'Extracts'), ' → ', outs];
}

/** Buildings shown but not yet buildable (their system arrives in a later task, e.g. railways). */
const COMING_SOON = new Set<string>();

interface Card {
  el: HTMLButtonElement;
  def: BuildingDef;
  locked: boolean | null;
  tab: TabId;
  /** permanently disabled until its feature ships */
  soon: boolean;
}

export class Toolbar {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tabButtons = new Map<TabId, HTMLElement>();
  private readonly panels = new Map<TabId, HTMLElement>();
  private readonly cards: Card[] = [];
  private readonly toolButtons = new Map<string, HTMLElement>();
  private activeTab: TabId | null = null;
  private selectedKey = 'inspect';

  constructor(root: HTMLElement, private readonly onSelect: (t: ToolSpec) => void) {
    this.root = root;
    const tabsRow = h('div', { class: 'tb-tabs' });
    const body = h('div', { class: 'tb-body' });
    for (const t of TABS) {
      const btn = h('button', { class: 'tb-tab', 'data-tab': t.id, onClick: () => this.openTab(t.id) }, t.label);
      this.tabButtons.set(t.id, btn);
      tabsRow.appendChild(btn);
      const panel = h('div', { class: 'tb-panel', 'data-panel-tab': t.id });
      panel.hidden = true;
      this.panels.set(t.id, panel);
      body.appendChild(panel);
    }
    const inspect = h('button', {
      class: 'tb-tab tb-inspect',
      'data-tool': 'inspect',
      title: 'Inspect (Esc)',
      onClick: () => this.select({ kind: 'inspect' }),
    }, 'Inspect');
    this.toolButtons.set('inspect', inspect);
    tabsRow.appendChild(inspect);

    for (const def of Object.values(BUILDINGS)) {
      const tab = tabOf(def);
      if (!tab) continue;
      const cost = h('span', { class: 'tc-cost' }, formatMoney(def.cost));
      const maint = h('span', { class: 'tc-maint' }, `+${formatMoney(def.maintenance)}/mo`);
      const soon = COMING_SOON.has(def.id);
      const lock = h('div', { class: 'tc-lock' }, soon ? 'Coming soon' : `Invented in ${def.era}`);
      lock.hidden = !soon;
      const el = h('button', {
        class: 'tool-card',
        'data-building': def.id,
        title: def.description,
        disabled: soon,
        onClick: () => !soon && this.select({ kind: 'build', typeId: def.id }),
      },
        h('div', { class: 'tc-name' }, def.name),
        h('div', { class: 'tc-flow' }, flow(def)),
        h('div', { class: 'tc-nums' }, cost, maint),
        lock) as HTMLButtonElement;
      if (soon) el.classList.add('locked');
      this.cards.push({ el, def, locked: soon ? true : null, tab, soon });
      this.panels.get(tab)!.appendChild(el);
    }

    const transport = this.panels.get('transport')!;
    const toolCard = (key: string, name: string, desc: string, nums: string, spec: ToolSpec | null) => {
      const el = h('button', {
        class: 'tool-card',
        'data-tool': key,
        title: desc,
        disabled: spec === null,
        onClick: () => spec && this.select(spec),
      },
        h('div', { class: 'tc-name' }, name),
        h('div', { class: 'tc-flow' }, desc),
        h('div', { class: 'tc-nums' }, nums)) as HTMLButtonElement;
      this.toolButtons.set(key, el);
      transport.appendChild(el);
    };
    toolCard('road', 'Road', 'Drag to lay roads (bridges over water)', `${formatMoney(ROAD_COST)}/tile`, { kind: 'road' });
    toolCard('rail', 'Rail', 'Drag to lay track (level crossings over roads, never water)', `${formatMoney(RAIL_COST)}/tile`, { kind: 'rail' });
    toolCard('bulldoze', 'Bulldoze', 'Demolish for a 25% refund (Del)', 'Click a building, road or rail', { kind: 'bulldoze' });

    this.bar = h('div', { class: 'toolbar' }, tabsRow, body);
    root.appendChild(this.bar);
    this.root.classList.add('tb-root');
  }

  private openTab(id: TabId): void {
    this.activeTab = this.activeTab === id ? null : id;
    for (const [tid, panel] of this.panels) panel.hidden = tid !== this.activeTab;
    for (const [tid, btn] of this.tabButtons) btn.classList.toggle('active', tid === this.activeTab);
    this.bar.classList.toggle('open', this.activeTab !== null);
  }

  private static keyOf(t: ToolSpec): string {
    return t.kind === 'build' ? `build:${t.typeId}` : t.kind;
  }

  select(t: ToolSpec): void {
    this.selectedKey = Toolbar.keyOf(t);
    for (const c of this.cards) c.el.classList.toggle('selected', `build:${c.def.id}` === this.selectedKey);
    for (const [k, el] of this.toolButtons) el.classList.toggle('selected', k === this.selectedKey);
    this.onSelect(t);
  }

  /** Esc: back to inspecting, closing any open build drawer. */
  cancel(): void {
    this.closeDrawer();
    this.select({ kind: 'inspect' });
  }

  /** True while a build drawer (tab panel) is open. */
  get drawerOpen(): boolean {
    return this.activeTab !== null;
  }

  /** Closes the open build drawer (tab panel), if any. */
  closeDrawer(): void {
    if (this.activeTab !== null) this.openTab(this.activeTab);
  }

  /** Delete: pick the bulldozer. */
  selectBulldoze(): void {
    this.select({ kind: 'bulldoze' });
  }

  /** B: show or hide the toolbar. */
  toggle(): void {
    this.bar.classList.toggle('collapsed');
  }

  update(state: GameState): void {
    for (const c of this.cards) {
      if (c.soon) continue;
      const locked = !isUnlocked(state, c.def.id);
      if (locked === c.locked) continue;
      c.locked = locked;
      c.el.disabled = locked;
      c.el.classList.toggle('locked', locked);
      (c.el.querySelector('.tc-lock') as HTMLElement).hidden = !locked;
    }
  }
}
