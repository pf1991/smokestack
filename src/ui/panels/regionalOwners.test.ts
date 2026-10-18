// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerColor } from '../../render/ownerColors';
import { floatColor } from '../../render/world';
import { addCompany } from '../../sim/companies';
import { placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import type { SimContext } from '../../sim/types';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { storeTitle } from './city';
import { PANELS } from './index';

const FIRM = 'Millbrook Mercantile';

function setup(): SimContext {
  const ctx = testCtx(testState({ money: 1_000_000, width: 60, height: 30, cities: [{ x: 30, y: 15, population: 8000 }] }));
  addCompany(ctx.state, { id: 'regional_1', kind: 'regional', name: FIRM, money: 1_000_000, loan: 0 });
  return ctx;
}

const host = (ctx: SimContext) => ({ ctx, renderer: { setSelection: () => {} }, openPanel: () => {} });

/** jsdom reports inline colours as rgb(); compare against the same normalisation. */
function css(color: string): string {
  const el = document.createElement('span');
  el.style.background = color;
  return el.style.background;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('regional owners in the panels', () => {
  it("building inspector: the firm's name and colour, not the Baron's", () => {
    const ctx = setup();
    const b = must(placeBuilding(ctx, 'regional_1', 'farm', { x: 3, y: 3 }));
    PANELS.building.open(host(ctx) as never, b.id);
    const badge = document.querySelector<HTMLElement>('.insp-head .insp-badge')!;
    expect(badge.textContent).toBe(FIRM);
    expect(badge.classList.contains('owner-regional')).toBe(true);
    expect(badge.classList.contains('owner-rival')).toBe(false);
    expect(badge.style.background).toBe(css(ownerColor('regional_1')));
  });

  it("vehicle inspector: the firm's name and colour, not the Baron's", () => {
    const ctx = setup();
    const a = must(placeBuilding(ctx, 'regional_1', 'farm', { x: 3, y: 3 }));
    const m = must(placeBuilding(ctx, 'regional_1', 'sawmill', { x: 12, y: 3 }));
    for (let x = 2; x < 16; x++) ctx.state.map.tiles[6 * 60 + x].road = true;
    const route = must(
      createRoute(ctx, 'regional_1', 'Grain line', [
        { buildingId: a.id, load: ['grain'], unload: [] },
        { buildingId: m.id, load: [], unload: ['grain'] },
      ]),
    );
    const v = must(buyTruck(ctx, 'regional_1', route.id));
    PANELS.vehicle.open(host(ctx) as never, v.id);
    const badge = [...document.querySelectorAll<HTMLElement>('.insp-badge')].find((x) => x.textContent === FIRM);
    expect(badge).toBeDefined();
    expect(badge!.classList.contains('owner-regional')).toBe(true);
    expect(badge!.style.background).toBe(css(ownerColor('regional_1')));
  });

  it('player and Baron badges keep their classes and no inline colour', () => {
    const ctx = setup();
    const b = must(placeBuilding(ctx, 'rival', 'farm', { x: 3, y: 3 }));
    PANELS.building.open(host(ctx) as never, b.id);
    const badge = document.querySelector<HTMLElement>('.insp-head .insp-badge')!;
    expect(badge.textContent).toBe(ctx.state.companies.rival.name);
    expect(badge.className).toBe('insp-badge owner-rival');
    expect(badge.style.background).toBe('');
  });

  it('city panel: a regional store dot is titled "<Firm name> store" in the firm colour', () => {
    const ctx = setup();
    const store = must(placeBuilding(ctx, 'regional_1', 'store', { x: 30, y: 15 }));
    store.input.furniture = 5;
    PANELS.city.open(host(ctx) as never, 0);
    const dot = document.querySelector<HTMLElement>('tr.insp-good[data-good="furniture"] .dot')!;
    expect(dot.title).toBe(`${FIRM} store`);
    expect(dot.style.background).toBe(css(ownerColor('regional_1')));
    expect(storeTitle(ctx.state, 'player')).toBe('Your store');
    expect(storeTitle(ctx.state, 'rival')).toBe('Rival store');
  });

  it("sale floaters: the firm's colour, the player's green and the Baron's crimson unchanged", () => {
    expect(floatColor('regional_1')).toBe(ownerColor('regional_1'));
    expect(floatColor('player')).toBe('#7ee07e');
    expect(floatColor('rival')).toBe('#b5302f');
  });
});
