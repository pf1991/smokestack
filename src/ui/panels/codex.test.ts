// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import type { GameController } from '../../game/controller';
import { GOODS } from '../../data/goods';
import { consumersOf, producersOf, upstreamTree, type ChainNode } from '../../data/chains';
import { createGame, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import type { SimContext } from '../../sim/types';
import { shortcutForEvent, withShortcut } from '../shortcuts';
import { Toolbar } from '../toolbar';
import { PANELS } from './index';
import { goodTooltip } from '../goodTooltip';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup(ctx?: SimContext) {
  const c = ctx ?? { state: createGame({ seed: 7 }), bus: new EventBus() };
  const game = { ctx: c, state: c.state, renderer: { setSelection: () => {} }, openPanel: () => {} } as unknown as GameController;
  return { ctx: c, game };
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const kids = (n: ChainNode) => n.inputs.map((c) => c.good);

describe('chains (pure data over BUILDINGS x RECIPES)', () => {
  it('producersOf lumber includes the sawmill', () => {
    expect(producersOf('lumber')).toContainEqual({ building: 'sawmill', recipe: 'r_lumber' });
  });

  it('consumersOf lumber includes furniture and toys', () => {
    const outs = consumersOf('lumber').map((c) => c.output);
    expect(outs).toContain('furniture');
    expect(outs).toContain('toys');
    expect(consumersOf('lumber')).toContainEqual({ building: 'furniture_factory', recipe: 'r_furniture', output: 'furniture' });
  });

  it('upstreamTree(cars) has steel, glass and fuel, and steel has iron ore and coal', () => {
    const t = upstreamTree('cars');
    expect(t.good).toBe('cars');
    expect(t.via).toEqual({ building: 'car_plant', recipe: 'r_cars' });
    expect(kids(t)).toEqual(['steel', 'glass', 'fuel']);
    const steel = t.inputs.find((n) => n.good === 'steel')!;
    expect(kids(steel)).toEqual(['iron_ore', 'coal']);
    // raw goods have no inputs, but are still made somewhere
    const ore = steel.inputs[0];
    expect(ore.inputs).toEqual([]);
    expect(ore.via).toEqual({ building: 'mine', recipe: 'r_iron' });
  });

  it('a cyclic recipe stops on a revisit instead of recursing forever', () => {
    const catalog = {
      buildings: { a: { recipes: ['x'] }, b: { recipes: ['y'] } },
      recipes: { x: { inputs: { p: 1 }, outputs: { q: 1 } }, y: { inputs: { q: 1 }, outputs: { p: 1 } } },
    };
    const t = upstreamTree('q', 50, catalog);
    expect(t.good).toBe('q');
    expect(kids(t)).toEqual(['p']);
    expect(kids(t.inputs[0])).toEqual(['q']);
    expect(t.inputs[0].inputs[0].inputs).toEqual([]);
  });

  it('depth bounds the tree', () => {
    expect(upstreamTree('cars', 1).inputs.every((n) => n.inputs.length === 0)).toBe(true);
  });

  it('a good nobody makes has no via', () => {
    expect(upstreamTree('nothing_at_all').via).toBeNull();
  });
});

describe('codex panel', () => {
  it('opens with a "N goods · you make M" header', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    expect(q('.codex .kit-ph-summary')!.textContent).toBe(`${Object.keys(GOODS).length} goods · you make 0`);
  });

  it('counts the goods the player makes', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    must(placeBuilding(ctx, 'player', 'sawmill', { x: 4, y: 4 }));
    const { game } = setup(ctx);
    PANELS.codex.open(game);
    expect(q('.codex .kit-ph-summary')!.textContent).toContain('you make 1');
    (q('.cx-filter[data-filter="mine"]') as HTMLElement).click();
    expect(qa('.cx-list tbody tr[data-key]').map((r) => r.dataset.key)).toEqual(['lumber']);
  });

  it('the Consumer filter lists the consumer goods', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    (q('.cx-filter[data-filter="consumer"]') as HTMLElement).click();
    expect(qa('.cx-list tbody tr[data-key]')).toHaveLength(Object.values(GOODS).filter((g) => g.kind === 'consumer').length);
    expect(q('.cx-filter[data-filter="consumer"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('the Materials filter lists the material goods', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    (q('.cx-filter[data-filter="material"]') as HTMLElement).click();
    expect(qa('.cx-list tbody tr[data-key]')).toHaveLength(Object.values(GOODS).filter((g) => g.kind === 'material').length);
    expect(q('.cx-filter[data-filter="material"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('the Components filter lists every component good', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    const components = Object.values(GOODS).filter((g) => g.kind === 'component');
    (q('.cx-filter[data-filter="component"]') as HTMLElement).click();
    expect(qa('.cx-list tbody tr[data-key]').map((r) => r.dataset.key).sort())
      .toEqual(components.map((g) => g.id).sort());
    expect(q('.cx-filter[data-filter="component"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('in 1900 unlocked goods come first; the last row is the latest-era good, locked (C1)', () => {
    const { game } = setup();
    expect(game.state.date.year).toBe(1900);
    PANELS.codex.open(game);
    const rows = qa('.cx-list tbody tr[data-key]');
    expect(rows[0].dataset.key).toBe('wood');
    const latest = Object.values(GOODS).reduce((a, b) => (b.era > a.era ? b : a));
    const last = rows[rows.length - 1];
    expect(last.dataset.key).toBe(latest.id);
    expect(last.getAttribute('data-locked')).toBe('true');
    expect(last.title).toBe(`Unlocks ${latest.era}`);
  });

  it("wire's detail shows today's market bid and ask", () => {
    const { game } = setup();
    PANELS.codex.open(game, 'wire');
    expect(q('.cx-detail')!.textContent).toMatch(/Market bid \$[\d,]+ · ask \$[\d,]+ today/);
  });

  it('the list shows icon, name, base price and town demand', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    const bread = q('.cx-list tr[data-key="bread"]')!;
    expect(bread.querySelector('[data-icon="bread"]')).not.toBeNull();
    expect(bread.textContent).toContain('Bread');
    expect(bread.querySelector('[data-col="price"]')!.textContent).toBe('$21');
    expect(Number(bread.querySelector('[data-col="demand"]')!.textContent!.replace(/,/g, ''))).toBeGreaterThan(0);
    // towns buy no raw goods
    expect(q('.cx-list tr[data-key="wood"] [data-col="demand"]')!.textContent).toBe('–');
  });

  it("I make this with nothing built shows a designed empty state", () => {
    const { game } = setup();
    PANELS.codex.open(game);
    (q('.cx-filter[data-filter="mine"]') as HTMLElement).click();
    expect(q('.cx-list .kit-empty')).not.toBeNull();
  });

  it("openPanel('codex', 'tools') shows the tools detail", () => {
    const { game } = setup();
    PANELS.codex.open(game, 'tools');
    const detail = q('.cx-detail')!;
    expect(detail.dataset.good).toBe('tools');
    expect(detail.textContent).toContain('Tools');
    expect(detail.textContent).toContain('Made in: Toolworks');
    const tree = qa('.cx-tree .cx-link').map((b) => b.dataset.good);
    expect(tree).toEqual(expect.arrayContaining(['steel', 'lumber', 'iron_ore', 'coal', 'wood']));
    expect(q('.cx-list tr[data-key="tools"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('bricks, used in no recipe, discount construction when stocked (E4)', () => {
    const { game } = setup();
    PANELS.codex.open(game, 'bricks');
    expect(q('.cx-line--used')!.textContent).toBe(
      'Used in: Construction (−8% when ≥20 stocked in a warehouse or Trading House)',
    );
  });

  it('a second open with a good re-selects in the open window', () => {
    const { game } = setup();
    PANELS.codex.open(game, 'tools');
    PANELS.codex.open(game, 'bread');
    expect(qa('.window')).toHaveLength(1);
    expect(q('.cx-detail')!.dataset.good).toBe('bread');
  });

  it('nothing selected shows an empty state; a row click selects', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    expect(q('.cx-detail-box .kit-empty')).not.toBeNull();
    (q('.cx-list tr[data-key="steel"]') as HTMLElement).click();
    const detail = q('.cx-detail')!;
    expect(detail.dataset.good).toBe('steel');
    expect(detail.textContent).toContain('Used in:');
    expect(qa('.cx-used .cx-link').map((b) => b.dataset.good)).toEqual(expect.arrayContaining(['tools', 'cars']));
  });

  it('every good in the tree is a link that selects it', () => {
    const { game } = setup();
    PANELS.codex.open(game, 'cars');
    (q('.cx-tree .cx-link[data-good="coal"]') as HTMLElement).click();
    expect(q('.cx-detail')!.dataset.good).toBe('coal');
    expect(q('.cx-detail')!.textContent).toContain('Made in: Mine');
  });

  it('a future good says when it unlocks', () => {
    const { game } = setup();
    PANELS.codex.open(game, 'computers');
    expect(q('.cx-detail')!.textContent).toContain('Unlocks 1980');
    PANELS.codex.open(game, 'bread');
    expect(q('.cx-detail')!.textContent).not.toContain('Unlocks');
  });

  it('opens afresh, selecting the good, after the page body was cleared under an open codex', () => {
    const { game } = setup();
    PANELS.codex.open(game);
    document.body.replaceChildren();
    expect(() => PANELS.codex.open(game, 'bread')).not.toThrow();
    expect(q('.codex')).not.toBeNull();
    expect(q('.cx-detail')!.dataset.good).toBe('bread');
  });

  it('the list keeps its scroll and selection across refreshes', () => {
    const { game } = setup();
    PANELS.codex.open(game, 'cars');
    const scroller = q('.cx-list')!;
    scroller.scrollTop = 120;
    const table = scroller.querySelector('table');
    vi.advanceTimersByTime(3000);
    expect(scroller.querySelector('table')).toBe(table);
    expect(scroller.scrollTop).toBe(120);
    expect(q('.cx-detail')!.dataset.good).toBe('cars');
  });

  it('I opens the codex', () => {
    expect(shortcutForEvent('i')?.action).toEqual({ kind: 'panel', id: 'codex' });
    expect(withShortcut('Codex', 'panel', 'codex')).toBe('Codex (I)');
  });
});

describe('good tooltips', () => {
  it("goodTooltip('bread') names its inputs and works", () => {
    const el = goodTooltip('bread');
    expect(el.textContent).toContain('Bread');
    expect(el.textContent).toContain('$21');
    expect(el.textContent).toContain('Flour');
    expect(el.textContent).toContain('Milk');
    expect(el.textContent).toContain('Made from Flour + Milk in Bakery');
  });

  it('a raw good says where it is gathered', () => {
    expect(goodTooltip('wood').textContent).toContain('Lumber Camp');
  });

  it('build-bar recipe icons show the good tooltip on hover', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tb = new Toolbar(root, () => {});
    tb.update(createGame({ seed: 1 }));
    (root.querySelector('[data-tab="refine"]') as HTMLElement).click();
    const lumber = root.querySelector<HTMLElement>('[data-building="sawmill"] .tc-out [data-good="lumber"]')!;
    lumber.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(q('.kit-tip--on')!.textContent).toContain('Made from Wood in Sawmill');
    lumber.dispatchEvent(new Event('pointerleave'));
    tb.closeDrawer();
  });

  it('the building inspector production rows show the good tooltip', () => {
    const ctx = testCtx(testState({ money: 1e7 }));
    const b = must(placeBuilding(ctx, 'player', 'bakery', { x: 4, y: 4 }));
    const { game } = setup(ctx);
    PANELS.building.open(game, b.id);
    const row = q('.insp-production .insp-flow-row[data-good="flour"]')!;
    row.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(q('.kit-tip--on')!.textContent).toContain('Made from Grain in Flour Mill');
  });
});
