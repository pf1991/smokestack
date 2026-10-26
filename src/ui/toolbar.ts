import { BUILDINGS, HOUSING_POOL, HOUSING_RADIUS, type BuildingDef } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { isUnlocked } from '../sim/eras';
import { ROAD_COST } from '../sim/state';
import { RAIL_COST } from '../sim/rail';
import { TREE_COST } from '../sim/society/upgrades';
import { priceIndex } from '../sim/society/economy';
import type { GameState } from '../sim/types';
import { ICON_IDS, type IconId } from '../render/icons';
import { h } from './dom';
import { iconEl } from './icon';
import { shortcutFor, withShortcut } from './shortcuts';
import { formatMoney } from './format';
import { goodIcon, goodTip } from './goodTooltip';
import type { ToolSpec } from './tools';
import { currentUiScale } from './scale';
import { CATEGORY_ICON } from './buildingIcons';
import './toolbar.css';

export type TabId = 'extract' | 'refine' | 'components' | 'manufacture' | 'retail' | 'transport';

const TABS: { id: TabId; label: string; icon: IconId }[] = [
  { id: 'extract', label: 'Extract', icon: 'pick' },
  { id: 'refine', label: 'Refine', icon: 'factory' },
  { id: 'components', label: 'Components', icon: 'gear' },
  { id: 'manufacture', label: 'Manufacture', icon: 'tools' },
  { id: 'retail', label: 'Retail', icon: 'shop' },
  { id: 'transport', label: 'Transport', icon: 'truck' },
];

const TAB_LABEL: Record<TabId, string> = Object.fromEntries(TABS.map((t) => [t.id, t.label])) as Record<TabId, string>;

/** Build-bar tab for a building (same rules as the toolbar cards). */
export function tabOf(def: BuildingDef): TabId | null {
  if (def.category === 'extractor') return 'extract';
  if (def.category === 'retail' || def.category === 'trade' || def.category === 'logistics') return 'retail';
  const first = Object.keys(RECIPES[def.recipes[0]]?.outputs ?? {})[0];
  const kind = first !== undefined ? GOODS[first]?.kind : undefined;
  if (kind === 'material') return 'refine';
  if (kind === 'component') return 'components';
  return 'manufacture';
}

/** Tab to pulse / open when an unlock id (building or good) arrives. */
export function tabForUnlock(defId: string): TabId | null {
  const b = BUILDINGS[defId];
  if (b) return tabOf(b);
  const g = GOODS[defId];
  if (!g) return null;
  if (g.kind === 'raw') return 'extract';
  if (g.kind === 'material') return 'refine';
  if (g.kind === 'component') return 'components';
  return 'manufacture';
}

export function tabLabel(id: TabId): string {
  return TAB_LABEL[id];
}

/** One good in a recipe strip: its icon (or colour chip) with the good tooltip. `data-good` is the codex hook. */
function goodEl(id: string): HTMLElement {
  const el = h('span', { class: 'tc-good', 'data-good': id }, goodIcon(id, 16, GOODS[id]?.name ?? id));
  // cards are built once, so the tooltip is never disposed
  goodTip(el, id);
  return el;
}

/** Building icon: its own atlas glyph if painted, else a fitting one, else its category's. */
const BUILDING_ICON: Record<string, IconId> = {
  lumber_camp: 'tree', train_station: 'train', warehouse: 'crate', store: 'shop', company_housing: 'city',
  // R4 (Table B): extractors show their raw good, works their first output, part makers a gear
  fishing_pier: 'fish',
  ranch: 'cattle', clay_pit: 'clay', copper_mine: 'copper_ore',
  rubber_plantation: 'rubber', bauxite_quarry: 'bauxite',
  smelter: 'copper', tannery: 'leather', sugar_refinery: 'sugar', brickworks: 'bricks', paper_mill: 'paper',
  chemical_works: 'chemicals',
  machine_shop: 'gear', electronics_works: 'gear',
  shoe_factory: 'shoes', confectionery: 'candy', print_works: 'books', cannery: 'canned_food',
  cycle_works: 'bicycles', appliance_plant: 'phonographs', gadget_assembly: 'calculators',
  trading_house: 'money',
};
const buildingIcon = (def: BuildingDef): IconId =>
  ICON_IDS.includes(def.id) ? def.id : (BUILDING_ICON[def.id] ?? CATEGORY_ICON[def.category] ?? 'factory');

/** The recipe strip: input goods, →, output goods of the building's first recipe (text for non-producers). */
function recipeStrip(def: BuildingDef): HTMLElement {
  if (def.id === 'company_housing') return h('div', { class: 'tc-flow' }, `Houses ${HOUSING_POOL} hands within ${HOUSING_RADIUS} tiles of a factory`);
  const recipe = def.recipes.map((r) => RECIPES[r]).find(Boolean);
  if (!recipe) return h('div', { class: 'tc-flow' }, def.category === 'retail' ? 'Sells goods to the city' : def.category === 'trade' ? 'Sells materials and components to the nation' : def.id === 'train_station' ? 'Loads and unloads trains' : 'Stores goods');
  const ins = Object.keys(recipe.inputs);
  const outs = Object.keys(recipe.outputs);
  const more = def.recipes.length - 1;
  return h('div', { class: 'tc-recipe' },
    ins.length > 0 ? h('span', { class: 'tc-in' }, ins.map(goodEl)) : null,
    ins.length > 0 ? h('span', { class: 'tc-arrow', 'aria-label': 'makes' }, '→') : null,
    h('span', { class: 'tc-out' }, outs.map(goodEl)),
    more > 0 ? h('span', { class: 'tc-more', title: `${more} more recipe${more > 1 ? 's' : ''}` }, `+${more}`) : null);
}

/** Buildings shown but not yet buildable (their system arrives in a later task, e.g. railways). */
const COMING_SOON = new Set<string>();
/** Tool-card tooltip line: the card shows the catalogue price; the build ghost shows the site's. */
export const PRICE_NOTE = 'Town politics (permits, land prices, objections, tax breaks) can change the price; the build preview shows the price at each site.';

interface Card {
  el: HTMLButtonElement;
  def: BuildingDef;
  locked: boolean | null;
  tab: TabId;
  /** permanently disabled until its feature ships */
  soon: boolean;
  cost: HTMLElement;
  maint: HTMLElement;
}

export class Toolbar {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<TabId, HTMLElement>();
  private readonly panels = new Map<TabId, HTMLElement>();
  private readonly cards: Card[] = [];
  private readonly toolButtons = new Map<string, HTMLElement>();
  private activeTab: TabId | null = null;
  private selectedKey = 'inspect';
  /** tool cards whose price follows the price index: [nums element, 1900 price, text around it] */
  private readonly priced: { el: HTMLElement; base: number; text: (money: string) => string }[] = [];
  private priceSig = -1;
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private cardPulseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, private readonly onSelect: (t: ToolSpec) => void) {
    this.root = root;
    const tabsRow = h('div', { class: 'tb-tabs' });
    const body = h('div', { class: 'tb-flyout' });
    this.body = body;
    body.hidden = true;
    // Inspect / Done first so phones never have to scroll past every build tab to stop placing
    const inspect = h('button', {
      class: 'tb-tab tb-inspect',
      'data-tool': 'inspect',
      title: withShortcut('Inspect', 'escape'),
      onClick: () => this.select({ kind: 'inspect' }),
    }, iconEl('star', 18), h('span', { class: 'tb-label' }, 'Inspect'), h('kbd', { class: 'tb-key' }, shortcutFor('escape') ?? ''));
    this.toolButtons.set('inspect', inspect);
    tabsRow.appendChild(inspect);
    for (const t of TABS) {
      const btn = h('button', {
        class: 'tb-tab',
        'data-tab': t.id,
        title: t.id === 'retail' ? 'Retail, Trade & Logistics' : t.label,
        'aria-expanded': 'false',
        onClick: () => this.openTab(t.id),
      }, iconEl(t.icon, 18), h('span', { class: 'tb-label' }, t.label));
      this.tabButtons.set(t.id, btn);
      tabsRow.appendChild(btn);
      const panel = h('div', { class: 'tb-panel', 'data-panel-tab': t.id });
      panel.hidden = true;
      this.panels.set(t.id, panel);
      body.appendChild(panel);
    }

    for (const def of Object.values(BUILDINGS)) {
      const tab = tabOf(def);
      if (!tab) continue;
      // base figures: town politics and company edicts move both (PRICE_NOTE, the build preview)
      const cost = h('span', { class: 'tc-cost' }, `base ${formatMoney(def.cost)}`);
      const maint = h('span', { class: 'tc-maint' }, `base +${formatMoney(def.maintenance)}/mo`);
      cost.title = PRICE_NOTE;
      const soon = COMING_SOON.has(def.id);
      const lock = h('div', { class: 'tc-lock' }, iconEl('lock', 12), soon ? 'Coming soon' : `From ${def.era}`);
      lock.hidden = !soon;
      const el = h('button', {
        class: 'tool-card',
        'data-building': def.id,
        title: `${def.name}: ${def.description}\n${PRICE_NOTE}`,
        disabled: soon,
        onClick: () => !el.disabled && this.select({ kind: 'build', typeId: def.id }, { toggle: true }),
      },
        h('div', { class: 'tc-head' }, iconEl(buildingIcon(def), 28), h('div', { class: 'tc-name' }, def.name)),
        recipeStrip(def),
        h('div', { class: 'tc-nums' }, cost, maint),
        lock) as HTMLButtonElement;
      if (soon) el.classList.add('locked');
      this.cards.push({ el, def, locked: soon ? true : null, tab, soon, cost, maint });
      this.panels.get(tab)!.appendChild(el);
    }

    const transport = this.panels.get('transport')!;
    const toolCard = (key: string, icon: IconId, name: string, desc: string, nums: string, spec: ToolSpec | null, price?: { base: number; text: (money: string) => string }) => {
      const numsEl = h('div', { class: 'tc-nums' }, nums);
      if (price) this.priced.push({ el: numsEl, ...price });
      const el = h('button', {
        class: 'tool-card',
        'data-tool': key,
        title: desc,
        disabled: spec === null,
        onClick: () => spec && this.select(spec, { toggle: true }),
      },
        h('div', { class: 'tc-head' }, iconEl(icon, 28), h('div', { class: 'tc-name' }, name)),
        h('div', { class: 'tc-flow' }, desc),
        numsEl) as HTMLButtonElement;
      this.toolButtons.set(key, el);
      transport.appendChild(el);
    };
    const perTile = (m: string) => `${m}/tile`;
    toolCard('road', 'route', 'Road', 'Drag to lay roads (bridges over water)', perTile(formatMoney(ROAD_COST)), { kind: 'road' }, { base: ROAD_COST, text: perTile });
    toolCard('rail', 'train', 'Rail', 'Drag to lay track (level crossings over roads, never water)', perTile(formatMoney(RAIL_COST)), { kind: 'rail' }, { base: RAIL_COST, text: perTile });
    toolCard('trees', 'tree', 'Plant trees', 'Drag over open grass to plant forest: woods soak up smog', perTile(formatMoney(TREE_COST)), { kind: 'trees' }, { base: TREE_COST, text: perTile });
    toolCard('bulldoze', 'close', 'Bulldoze', `Demolish for a 25% refund (${shortcutFor('bulldoze') ?? 'Del'})`, 'Click a building, road or rail', { kind: 'bulldoze' });

    this.bar = h('div', { class: 'toolbar' }, body, tabsRow);
    root.appendChild(this.bar);
    this.root.classList.add('tb-root');
  }

  private openTab(id: TabId): void {
    this.activeTab = this.activeTab === id ? null : id;
    for (const [tid, panel] of this.panels) panel.hidden = tid !== this.activeTab;
    this.body.hidden = this.activeTab === null;
    if (this.activeTab !== null) {
      this.placeFlyout();
      window.addEventListener('pointerdown', this.onOutside, true);
      window.addEventListener('resize', this.onResize);
      window.addEventListener('uiscalechange', this.onResize);
    } else {
      window.removeEventListener('pointerdown', this.onOutside, true);
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('uiscalechange', this.onResize);
    }
    for (const [tid, btn] of this.tabButtons) {
      btn.classList.toggle('active', tid === this.activeTab);
      btn.setAttribute('aria-expanded', String(tid === this.activeTab));
    }
    this.bar.classList.toggle('open', this.activeTab !== null);
  }

  private readonly onResize = (): void => this.placeFlyout();

  /** A press outside the bar closes the flyout and does not reach the map. */
  private readonly onOutside = (e: Event): void => {
    if (this.activeTab === null || this.bar.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    this.closeDrawer();
  };

  /** Centres the flyout on the bar, then keeps it on the map left of the side panel (>= 8 px from the left edge). */
  private placeFlyout(): void {
    const bar = this.bar.getBoundingClientRect();
    const panel = parseFloat(document.documentElement.style.getPropertyValue('--side-panel-w')) || 0;
    const max = window.innerWidth - panel - 16;
    // rects, innerWidth and --side-panel-w are screen px; style.left is in zoomed px (#ui is zoomed), so divide by the scale
    const s = currentUiScale();
    this.body.style.maxWidth = `${max / s}px`; // the stylesheet's vw-based cap is not reliable under zoom
    const w = Math.min(this.body.getBoundingClientRect().width || this.body.offsetWidth * s, max);
    const left = Math.max(8, Math.min(bar.left + bar.width / 2 - w / 2, window.innerWidth - panel - 8 - w));
    this.body.style.left = `${Math.round((left - bar.left - 2 * s) / s)}px`; // 2 px: the bar's border
  }

  private static keyOf(t: ToolSpec): string {
    return t.kind === 'build' ? `build:${t.typeId}` : t.kind;
  }

  /**
   * Selects a tool. Pass `{ toggle: true }` from a tool-card click so a second tap on the same
   * sticky tool returns to Inspect (phones have no Esc). Programmatic callers must omit toggle.
   */
  select(t: ToolSpec, opts?: { toggle?: boolean }): void {
    this.closeDrawer();
    const key = Toolbar.keyOf(t);
    if (opts?.toggle && t.kind !== 'inspect' && key === this.selectedKey) t = { kind: 'inspect' };
    this.selectedKey = Toolbar.keyOf(t);
    for (const c of this.cards) c.el.classList.toggle('selected', `build:${c.def.id}` === this.selectedKey);
    for (const [k, el] of this.toolButtons) el.classList.toggle('selected', k === this.selectedKey);
    const inspect = this.toolButtons.get('inspect');
    if (inspect) {
      const armed = this.selectedKey !== 'inspect';
      inspect.classList.toggle('tb-inspect--done', armed);
      const label = inspect.querySelector('.tb-label');
      if (label) label.textContent = armed ? 'Done' : 'Inspect';
      inspect.title = withShortcut(armed ? 'Done — stop building' : 'Inspect', 'escape');
    }
    this.onSelect(t);
  }

  /** Esc: back to inspecting, closing any open build drawer. */
  cancel(): void {
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
    this.closeDrawer();
    this.bar.classList.toggle('collapsed');
  }

  /** Opens a build tab (used by invention toast actions). */
  showTab(id: TabId): void {
    if (this.activeTab !== id) this.openTab(id);
  }

  /**
   * Pulses a build-bar tab for ~10s (invention fanfare). Clears any prior pulse first.
   */
  pulseTab(id: TabId, ms = 10_000): void {
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
    for (const [tid, btn] of this.tabButtons) {
      if (tid === id) btn.dataset.pulse = '1';
      else delete btn.dataset.pulse;
    }
    this.pulseTimer = setTimeout(() => {
      this.pulseTimer = null;
      const btn = this.tabButtons.get(id);
      if (btn) delete btn.dataset.pulse;
    }, ms);
  }

  /**
   * Pulses a building tool card for ~10s (E5 systems coach: Trading House). Clears any prior card pulse.
   */
  pulseBuilding(typeId: string, ms = 10_000): void {
    if (this.cardPulseTimer !== null) {
      clearTimeout(this.cardPulseTimer);
      this.cardPulseTimer = null;
    }
    for (const c of this.cards) {
      if (c.def.id === typeId) c.el.dataset.pulse = '1';
      else delete c.el.dataset.pulse;
    }
    this.cardPulseTimer = setTimeout(() => {
      this.cardPulseTimer = null;
      const card = this.cards.find((c) => c.def.id === typeId);
      if (card) delete card.el.dataset.pulse;
    }, ms);
  }

  update(state: GameState): void {
    // prices follow the price index (sim/society/economy.ts): refresh the figures when it moves a cent
    const index = priceIndex(state);
    const sig = Math.round(index * 100);
    if (sig !== this.priceSig) {
      this.priceSig = sig;
      const at = (n: number) => formatMoney(Math.round(n * index));
      for (const c of this.cards) {
        c.cost.textContent = `base ${at(c.def.cost)}`;
        c.maint.textContent = `base +${at(c.def.maintenance)}/mo`;
      }
      for (const p of this.priced) p.el.textContent = p.text(at(p.base));
    }
    for (const c of this.cards) {
      if (c.soon) continue;
      // era lock: state.unlocked gains each building in its era year (sim/eras.ts checkUnlocks; events can
      // bring one forward), and the sim refuses to build anything not in it, so it is the source of truth
      const locked = !isUnlocked(state, c.def.id);
      if (locked === c.locked) continue;
      c.locked = locked;
      c.el.disabled = locked;
      c.el.classList.toggle('locked', locked);
      c.el.setAttribute('aria-disabled', String(locked));
      (c.el.querySelector('.tc-lock') as HTMLElement).hidden = !locked;
    }
  }
}
