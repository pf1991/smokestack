// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../core/events';
import { DEMAND_PER_1000 } from '../../data/goods';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { demolishBuilding, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import type { Building, SimContext } from '../../sim/types';
import { PANELS } from './index';

function host(ctx: SimContext) {
  const selections: unknown[] = [];
  return {
    ctx,
    renderer: { setSelection: (s: unknown) => selections.push(s) },
    openPanel: () => {},
    selections,
  };
}

function place(ctx: SimContext, typeId: string, x: number, y: number, owner: 'player' | 'rival' = 'player'): Building {
  return must(placeBuilding(ctx, owner, typeId, { x, y }));
}

const text = () => document.body.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('building panel', () => {
  it('recipe change updates building.recipeId and resets progress', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    b.progress = 0.5;
    PANELS.building.open(host(ctx) as never, b.id);
    const sel = document.querySelector<HTMLSelectElement>('select.insp-recipe')!;
    expect(sel).toBeTruthy();
    expect(sel.value).toBe(b.recipeId);
    sel.value = 'r_cotton';
    sel.dispatchEvent(new Event('change'));
    expect(b.recipeId).toBe('r_cotton');
    expect(b.progress).toBe(0);
  });

  it('status reason text for no_input names missing good', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'sawmill', 5, 5);
    b.status = 'no_input';
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('Waiting for Wood');
  });

  it('panel closes when building demolished', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector('.window')).toBeTruthy();
    must(demolishBuilding(ctx, b.id));
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.window')).toBeNull();
  });

  it('demolish needs two clicks, refunds, and toasts', () => {
    const ctx = testCtx(testState());
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    const btn = document.querySelector<HTMLButtonElement>('button.insp-demolish')!;
    btn.click();
    expect(ctx.state.buildings[b.id]).toBeDefined();
    expect(btn.textContent).toContain('$2,500');
    btn.click();
    expect(ctx.state.buildings[b.id]).toBeUndefined();
    expect(events.some((e) => e.type === 'toast')).toBe(true);
  });

  it('rival buildings have no demolish button and a disabled recipe selector', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5, 'rival');
    PANELS.building.open(host(ctx) as never, b.id);
    expect(document.querySelector<HTMLElement>('button.insp-demolish')!.hidden).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('select.insp-recipe')!.disabled).toBe(true);
  });

  it('warns about missing road access and lists serving routes', () => {
    const ctx = testCtx(testState());
    const b = place(ctx, 'farm', 5, 5);
    PANELS.building.open(host(ctx) as never, b.id);
    expect(text()).toContain('No road access');
    expect(text()).toContain('Not on any route');
  });
});

describe('city panel', () => {
  it('lists craved goods sorted by unmet demand', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 10000 }] });
    const ctx = testCtx(state);
    const c = state.cities[0];
    // furniture: big unmet value; bread: fully satisfied; tools: some unmet; clothes: some unmet
    for (const g of Object.keys(DEMAND_PER_1000)) c.market[g] = { sold30: 100, demand30: 100, pending: 0 };
    c.market.furniture = { sold30: 0, demand30: 100, pending: 0 };
    c.market.bread = { sold30: 100, demand30: 100, pending: 0 };
    c.market.tools = { sold30: 0, demand30: 100, pending: 0 };
    c.market.clothes = { sold30: 50, demand30: 100, pending: 0 };
    PANELS.city.open(host(ctx) as never, 0);
    const rows = [...document.querySelectorAll<HTMLElement>('tr.insp-good')];
    const crave = rows.filter((r) => r.textContent!.includes('Craves')).map((r) => r.dataset.good);
    expect(crave).toHaveLength(3);
    expect(crave[0]).toBe('furniture');
    expect(crave).not.toContain('bread');
    // rows are ordered by unmet demand x price, so craves come first
    expect(rows[0].dataset.good).toBe('furniture');
    expect(text()).toContain('Town 0');
  });

  it('shows population trend', () => {
    const state = testState({ cities: [{ x: 10, y: 10, population: 6000 }] });
    state.cities[0].prevPopulation = 5000;
    PANELS.city.open(host(testCtx(state)) as never, 0);
    expect(text()).toContain('▲');
  });
});

describe('vehicle panel', () => {
  it('shows route and next stop, and Sell removes the vehicle', () => {
    const ctx = testCtx(testState({ money: 1_000_000 }));
    const a = place(ctx, 'farm', 5, 5);
    const m = place(ctx, 'sawmill', 20, 5);
    for (let x = 4; x < 25; x++) ctx.state.map.tiles[8 * 40 + x].road = true;
    const route = must(
      createRoute(ctx, 'player', 'Wood Run', [
        { buildingId: a.id, load: ['grain'], unload: [] },
        { buildingId: m.id, load: [], unload: ['grain'] },
      ]),
    );
    const v = must(buyTruck(ctx, 'player', route.id));
    PANELS.vehicle.open(host(ctx) as never, v.id);
    expect(text()).toContain('Wood Run');
    document.querySelector<HTMLButtonElement>('button.insp-sell')!.click();
    expect(ctx.state.vehicles[v.id]).toBeUndefined();
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.window')).toBeNull();
  });
});
