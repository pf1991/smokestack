// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { createGame } from '../sim/state';
import { PRICE_NOTE, Toolbar } from './toolbar';
import type { ToolSpec } from './tools';
import { applyUiScale } from './scale';

const made: Toolbar[] = [];
afterEach(() => {
  for (const t of made.splice(0)) t.closeDrawer();
});

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onSelect = vi.fn<(t: ToolSpec) => void>();
  const tb = new Toolbar(root, onSelect);
  made.push(tb);
  const state = createGame({ seed: 1 });
  tb.update(state);
  return { root, onSelect, tb, state };
}

const tab = (root: HTMLElement, id: string) => (root.querySelector(`[data-tab="${id}"]`) as HTMLElement).click();

/** First output kind of a factory's first recipe → build-bar tab (mirrors toolbar tabOf). */
function expectedFactoryTab(typeId: string): string {
  const def = BUILDINGS[typeId];
  const first = Object.keys(RECIPES[def.recipes[0]]?.outputs ?? {})[0];
  const kind = GOODS[first]?.kind;
  if (kind === 'material') return 'refine';
  if (kind === 'component') return 'components';
  return 'manufacture';
}

describe('Toolbar', () => {
  it('tab list includes Components after Refine', () => {
    const { root } = setup();
    const ids = [...root.querySelectorAll<HTMLElement>('.tb-tabs [data-tab]')].map((b) => b.dataset.tab);
    expect(ids).toEqual(['extract', 'refine', 'components', 'manufacture', 'retail', 'transport']);
  });

  it('the Components tab lists every factory whose first output is a component', () => {
    const { root } = setup();
    tab(root, 'components');
    const expected = Object.values(BUILDINGS)
      .filter((d) => d.category === 'factory' && expectedFactoryTab(d.id) === 'components')
      .map((d) => d.id)
      .sort();
    const cards = [...root.querySelectorAll<HTMLElement>('[data-panel-tab="components"] [data-building]')]
      .map((el) => el.dataset.building!)
      .sort();
    expect(cards).toEqual(expected);
    expect(cards).toContain('machine_shop');
  });

  it('machine_shop is under Components; smelter and refinery stay under Refine (C2)', () => {
    const { root } = setup();
    expect(root.querySelector('[data-panel-tab="components"] [data-building="machine_shop"]')).not.toBeNull();
    expect(root.querySelector('[data-panel-tab="refine"] [data-building="smelter"]')).not.toBeNull();
    expect(root.querySelector('[data-panel-tab="refine"] [data-building="refinery"]')).not.toBeNull();
  });

  it('chemical_works→refine, electronics_works→components, appliance_plant→manufacture (C2)', () => {
    const { root } = setup();
    expect(root.querySelector('[data-panel-tab="refine"] [data-building="chemical_works"]')).not.toBeNull();
    expect(root.querySelector('[data-panel-tab="components"] [data-building="electronics_works"]')).not.toBeNull();
    expect(root.querySelector('[data-panel-tab="manufacture"] [data-building="appliance_plant"]')).not.toBeNull();
  });

  it('each of the 25 v1 buildings keeps its build-bar tab', () => {
    const { root } = setup();
    const v1: Record<string, string> = {
      lumber_camp: 'extract', farm: 'extract', dairy_farm: 'extract', mine: 'extract',
      sand_pit: 'extract', oil_well: 'extract',
      sawmill: 'refine', flour_mill: 'refine', steel_mill: 'refine', textile_mill: 'refine',
      glassworks: 'refine', refinery: 'refine',
      furniture_factory: 'manufacture', bakery: 'manufacture', toolworks: 'manufacture',
      clothing_factory: 'manufacture', creamery: 'manufacture', juice_plant: 'manufacture',
      toy_factory: 'manufacture', car_plant: 'manufacture', electronics_plant: 'manufacture',
      store: 'retail', warehouse: 'retail', train_station: 'retail', company_housing: 'retail',
    };
    expect(Object.keys(v1)).toHaveLength(25);
    for (const [id, tabId] of Object.entries(v1)) {
      expect(root.querySelector(`[data-panel-tab="${tabId}"] [data-building="${id}"]`), id).not.toBeNull();
    }
  });

  it('locked building disabled with invention year', () => {
    const { root } = setup();
    tab(root, 'manufacture');
    const card = root.querySelector('[data-building="electronics_plant"]') as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(card.textContent).toContain('From 1925');
    expect(root.querySelectorAll('.tool-card:not(.locked)').length).toBeGreaterThan(0);
  });

  it('the sawmill card shows the wood input icon and the lumber output icon', () => {
    const { root } = setup();
    tab(root, 'refine');
    const card = root.querySelector('[data-building="sawmill"]') as HTMLElement;
    const strip = card.querySelector('.tc-recipe')!;
    expect(strip.querySelector('.tc-in [data-good="wood"] img.icon')).not.toBeNull();
    expect(strip.querySelector('.tc-arrow')!.textContent).toBe('→');
    expect(strip.querySelector('.tc-out [data-good="lumber"] img.icon')).not.toBeNull();
    expect(card.querySelector('.tc-head img.icon')!.getAttribute('width')).toBe('28');
  });

  it('an extractor card shows only its output, no arrow', () => {
    const { root } = setup();
    const card = root.querySelector('[data-building="lumber_camp"]') as HTMLElement;
    expect(card.querySelector('.tc-out [data-good="wood"]')).not.toBeNull();
    expect(card.querySelector('.tc-arrow')).toBeNull();
  });

  it('an oil well card in 1900 is locked "From 1910", not clickable, and unlocks with the year', () => {
    const { root, onSelect, tb, state } = setup();
    expect(state.date.year).toBe(1900);
    const card = root.querySelector('[data-building="oil_well"]') as HTMLButtonElement;
    expect(card.classList.contains('locked')).toBe(true);
    expect(card.querySelector('.tc-lock')!.textContent).toBe('From 1910');
    expect(card.querySelector('.tc-lock img.icon[data-icon="lock"]')).not.toBeNull();
    expect(card.disabled).toBe(true);
    card.click();
    expect(onSelect).not.toHaveBeenCalled();
    state.date.year = 1910;
    state.unlocked.push('oil_well');
    tb.update(state);
    expect(card.classList.contains('locked')).toBe(false);
    expect((card.querySelector('.tc-lock') as HTMLElement).hidden).toBe(true);
  });

  it('cards show a base price and upkeep and say town politics can change them', () => {
    const { root } = setup();
    tab(root, 'extract');
    const card = root.querySelector('[data-building="lumber_camp"]') as HTMLElement;
    expect(card.querySelector('.tc-cost')!.textContent).toBe('base $12,000');
    expect(card.querySelector('.tc-maint')!.textContent).toMatch(/^base \+\$[\d,]+\/mo$/);
    expect(card.title).toContain(PRICE_NOTE);
    expect(PRICE_NOTE).toContain('Town politics');
  });

  it('selecting building emits build ToolSpec', () => {
    const { root, onSelect } = setup();
    tab(root, 'extract');
    (root.querySelector('[data-building="lumber_camp"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'build', typeId: 'lumber_camp' });
  });

  it('unlocks when state.unlocked gains the building', () => {
    const { root, tb, state } = setup();
    tab(root, 'manufacture');
    state.unlocked.push('electronics_plant');
    tb.update(state);
    expect((root.querySelector('[data-building="electronics_plant"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('transport tab, bulldoze, keyboard helpers', () => {
    const { root, onSelect, tb } = setup();
    tab(root, 'transport');
    expect((root.querySelector('[data-tool="rail"]') as HTMLButtonElement).disabled).toBe(false);
    (root.querySelector('[data-tool="rail"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'rail' });
    (root.querySelector('[data-tool="road"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'road' });
    tb.selectBulldoze();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'bulldoze' });
    tb.cancel();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'inspect' });
    tb.toggle();
    expect(root.querySelector('.toolbar')!.classList.contains('collapsed')).toBe(true);
  });

  it('train station is buildable from the logistics tab', () => {
    const { root, onSelect, tb, state } = setup();
    tab(root, 'retail');
    tb.update(state);
    const card = root.querySelector('[data-building="train_station"]') as HTMLButtonElement;
    expect(card.disabled).toBe(false);
    card.click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'train_station' });
  });

  it('the Trading House sits in the Retail, Trade & Logistics tab with the money icon and its own line', () => {
    const { root, onSelect, tb, state } = setup();
    tab(root, 'retail');
    tb.update(state);
    expect(root.querySelector('[data-tab="retail"]')!.getAttribute('title')).toBe('Retail, Trade & Logistics');
    const card = root.querySelector('[data-panel-tab="retail"] [data-building="trading_house"]') as HTMLButtonElement;
    expect(card).not.toBeNull();
    expect(card.disabled).toBe(false);
    expect(card.querySelector('.tc-flow')!.textContent).toBe('Sells materials and components to the nation');
    expect(card.querySelector<HTMLElement>('.tc-head img.icon')!.dataset.icon).toBe('money');
    card.click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'trading_house' });
  });

  it('cancel closes the open build drawer', () => {
    const { root, tb } = setup();
    tab(root, 'refine');
    expect((root.querySelector('[data-panel-tab="refine"]') as HTMLElement).hidden).toBe(false);
    tb.cancel();
    expect((root.querySelector('[data-panel-tab="refine"]') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('.toolbar')!.classList.contains('open')).toBe(false);
    tb.closeDrawer(); // no-op when already closed
    expect((root.querySelector('[data-panel-tab="refine"]') as HTMLElement).hidden).toBe(true);
  });

  it('a category click opens its flyout and a second click closes it', () => {
    const { root, tb } = setup();
    const fly = () => root.querySelector('.tb-flyout') as HTMLElement;
    expect(fly().hidden).toBe(true);
    tab(root, 'extract');
    expect(fly().hidden).toBe(false);
    expect(tb.drawerOpen).toBe(true);
    tab(root, 'extract');
    expect(fly().hidden).toBe(true);
    expect(tb.drawerOpen).toBe(false);
  });

  it('Inspect sits first so phones can stop placing without scrolling the tab strip', () => {
    const { root } = setup();
    const kids = [...root.querySelector('.tb-tabs')!.children] as HTMLElement[];
    expect(kids[0]!.dataset.tool).toBe('inspect');
  });

  it('re-tapping the selected build card returns to Inspect (no Esc on phones)', () => {
    const { root, onSelect, tb } = setup();
    tab(root, 'extract');
    const card = root.querySelector('[data-building="lumber_camp"]') as HTMLElement;
    card.click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'lumber_camp' });
    expect(root.querySelector('[data-tool="inspect"]')!.classList.contains('tb-inspect--done')).toBe(true);
    expect(root.querySelector('[data-tool="inspect"] .tb-label')!.textContent).toBe('Done');
    // flyout closed after first pick — open again to re-tap the card
    tab(root, 'extract');
    card.click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'inspect' });
    expect(root.querySelector('[data-tool="inspect"]')!.classList.contains('tb-inspect--done')).toBe(false);
    // programmatic select does not toggle off
    tb.select({ kind: 'build', typeId: 'lumber_camp' });
    tb.select({ kind: 'build', typeId: 'lumber_camp' });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'lumber_camp' });
  });

  it('picking a card selects its tool and closes the flyout', () => {
    const { root, onSelect, tb } = setup();
    tab(root, 'extract');
    (root.querySelector('[data-building="lumber_camp"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'lumber_camp' });
    expect(tb.drawerOpen).toBe(false);
    expect((root.querySelector('.tb-flyout') as HTMLElement).hidden).toBe(true);
  });

  it('Esc (cancel) closes the flyout; categories show icon and label', () => {
    const { root, tb } = setup();
    tab(root, 'refine');
    tb.cancel();
    expect((root.querySelector('.tb-flyout') as HTMLElement).hidden).toBe(true);
    const btn = root.querySelector('[data-tab="refine"]') as HTMLElement;
    expect(btn.querySelector('img.icon')).not.toBeNull();
    expect(btn.textContent).toContain('Refine');
  });

  it('B (toggle) closes the flyout', () => {
    const { root, tb } = setup();
    tab(root, 'extract');
    tb.toggle();
    expect(tb.drawerOpen).toBe(false);
    tb.toggle();
    expect((root.querySelector('.tb-flyout') as HTMLElement).hidden).toBe(true);
  });

  it('an outside press closes the flyout and is swallowed; a press on the bar is not', () => {
    const { root, tb } = setup();
    tab(root, 'extract');
    const inside = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    root.querySelector('.tb-tabs')!.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    expect(tb.drawerOpen).toBe(true);
    const outside = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(tb.drawerOpen).toBe(false);
    const after = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('the flyout stays clear of the side panel', () => {
    const { root } = setup();
    document.documentElement.style.setProperty('--side-panel-w', '546px');
    Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true });
    const fly = root.querySelector('.tb-flyout') as HTMLElement;
    Object.defineProperty(fly, 'offsetWidth', { value: 900, configurable: true });
    tab(root, 'extract');
    // bar rect is all zeros in jsdom: left = clamp(0 - 450, 8, 1366-546-8-900 -> <8 -> 8) -> 8 - 0 - 2
    expect(parseFloat(fly.style.left)).toBe(6);
    document.documentElement.style.removeProperty('--side-panel-w');
  });

  it('placeFlyout writes left and max-width in zoomed px under a UI scale', () => {
    const { root } = setup();
    applyUiScale(1.25);
    document.documentElement.style.setProperty('--side-panel-w', '500px');
    Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true });
    const bar = root.querySelector('.toolbar') as HTMLElement;
    const body = root.querySelector('.tb-body, .tb-flyout') as HTMLElement;
    bar.getBoundingClientRect = () => ({ left: 400, width: 600, top: 0, right: 1000, bottom: 40, height: 40, x: 400, y: 0, toJSON() {} });
    body.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, right: 300, bottom: 40, height: 40, x: 0, y: 0, toJSON() {} });
    tab(root, 'manufacture');
    // screen px: max = 1366 - 500 - 16 = 850; left = min(400 + 300 - 150, 1366 - 500 - 8 - 300) = 550
    expect(body.style.maxWidth).toBe(`${850 / 1.25}px`);
    expect(body.style.left).toBe(`${Math.round((550 - 400 - 2.5) / 1.25)}px`);
    applyUiScale(1);
    document.documentElement.style.removeProperty('--side-panel-w');
  });
});
