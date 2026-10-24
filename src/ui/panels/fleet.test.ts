// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { buildRoad, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { PANELS } from './index';
import { filterVehicles } from './fleet';
import { buyHubTruck } from '../../sim/logistics/hubs';

function setup() {
  const s = testState();
  const ctx = testCtx(s);
  for (let y = 8; y < 10; y++) for (let x = 2; x < 4; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
  const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 15, y: 10 })));
  const stops = [
    { buildingId: camp.id, load: ['wood'], unload: [] },
    { buildingId: mill.id, load: [], unload: ['wood'] },
  ];
  const r1 = must(createRoute(ctx, 'player', 'Wood run', stops));
  const r2 = must(createRoute(ctx, 'player', 'Second run', stops));
  const game = {
    ctx,
    renderer: { setSelection: vi.fn() },
    centerOn: vi.fn(),
    openPanel: vi.fn(),
  };
  return { s, ctx, r1, r2, game, host: game as unknown as GameController };
}

const win = () => document.querySelector('.window') as HTMLElement;
const click = (sel: string) => (win().querySelector(sel) as HTMLElement).click();
const rows = () => [...win().querySelectorAll<HTMLElement>('.fl-row')].map((r) => Number(r.dataset.vehicle));

afterEach(() => {
  (document.querySelector('.window-close') as HTMLElement | null)?.click();
  document.body.replaceChildren();
});

describe('fleet panel', () => {
  it('fleet filter shows only idle or stuck', () => {
    const { ctx, r1, host } = setup();
    const a = must(buyTruck(ctx, 'player', r1.id));
    const b = must(buyTruck(ctx, 'player', r1.id));
    const c = must(buyTruck(ctx, 'player', r1.id));
    b.state = 'idle';
    c.state = 'stuck';
    PANELS.fleet.open(host);
    expect(rows()).toEqual([a.id, b.id, c.id]);
    expect(win().querySelector('.fl-summary')!.textContent).toContain('3 trucks · 0 trains · 1 idle · 1 stuck');
    click('[data-filter="problem"]');
    expect(rows()).toEqual([b.id, c.id]);
    click('[data-filter="train"]');
    expect(rows()).toEqual([]);
  });

  it('fleet reassign via dropdown, locate and sell', () => {
    const { s, ctx, r1, r2, game, host } = setup();
    const a = must(buyTruck(ctx, 'player', r1.id));
    PANELS.fleet.open(host);
    const sel = win().querySelector('.fl-route') as HTMLSelectElement;
    expect(sel.value).toBe(String(r1.id));
    sel.value = String(r2.id);
    sel.dispatchEvent(new Event('change'));
    expect(s.vehicles[a.id].routeId).toBe(r2.id);
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    expect(s.vehicles[a.id].routeId).toBeNull();
    expect(s.vehicles[a.id].state).toBe('idle');
    click('[data-act="locate"]');
    expect(game.centerOn).toHaveBeenCalled();
    expect(game.renderer.setSelection).toHaveBeenLastCalledWith({ vehicleId: a.id });
    expect(game.openPanel).toHaveBeenCalledWith('vehicle', a.id);
    click('[data-act="sell"]');
    expect(s.vehicles[a.id]).toBeUndefined();
    expect(rows()).toEqual([]);
  });

  it('shows each vehicle’s age and replaces an old one on the same route (Task 8)', () => {
    const { s, ctx, r1, host } = setup();
    const a = must(buyTruck(ctx, 'player', r1.id));
    a.builtYear = s.date.year - 41;
    PANELS.fleet.open(host);
    expect(win().querySelector('.fl-age')!.textContent).toBe('41 yr · 74%');
    const m = s.companies.player.money;
    click('[data-act="replace"]');
    expect(s.vehicles[a.id]).toBeUndefined();
    const [fresh] = Object.values(s.vehicles);
    expect(fresh.routeId).toBe(r1.id);
    expect(s.companies.player.money).toBe(m - 4000); // $8,000 new less the $4,000 refund
    expect(rows()).toEqual([fresh.id]);
    expect(win().querySelector('.fl-age')!.textContent).toBe('0 yr');
  });

  it('updates in place without replacing rows', () => {
    vi.useFakeTimers();
    try {
      const { ctx, r1, host } = setup();
      must(buyTruck(ctx, 'player', r1.id));
      PANELS.fleet.open(host);
      const row = win().querySelector('.fl-row');
      vi.advanceTimersByTime(3000);
      expect(win().querySelector('.fl-row')).toBe(row);
    } finally {
      vi.useRealTimers();
    }
  });

  it('locate clears camera follow', () => {
    const { ctx, r1, game, host } = setup();
    must(buyTruck(ctx, 'player', r1.id));
    const follow = vi.fn();
    (game as unknown as { follow: typeof follow }).follow = follow;
    PANELS.fleet.open(host);
    click('[data-act="locate"]');
    expect(follow).toHaveBeenCalledWith(null);
  });

  it('shows each truck’s model and offers an upgrade for the selected route', () => {
    const { s, ctx, r1, host } = setup();
    s.date.year = 1925;
    const a = must(buyTruck(ctx, 'player', r1.id));
    PANELS.fleet.open(host);
    expect(win().querySelector('.fl-model')!.textContent).toBe('Motor Truck');
    a.model = 'steam_lorry';
    a.capacity = 20;
    (host as unknown as { ctx: typeof ctx }).ctx.state.companies.player.money = 1e7;
    const sel = win().querySelector('.fl-route-filter') as HTMLSelectElement;
    sel.value = String(r1.id);
    sel.dispatchEvent(new Event('change'));
    click('[data-act="upgrade-route"]');
    expect(Object.values(s.vehicles).map((v) => v.model)).toEqual(['motor_truck']);
  });
});

describe('fleet hub trucks', () => {
  it('shows "Hub: Warehouse" in the route column; picking a route takes the truck off the hub', () => {
    const { s, ctx, r1, host } = setup();
    s.companies.player.money = 1e7;
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 5, y: 11 }));
    const truck = must(buyHubTruck(ctx, 'player', wh.id));
    PANELS.fleet.open(host);
    const sel = document.querySelector<HTMLSelectElement>(`[data-vehicle="${truck.id}"] select.fl-route`)!;
    expect(sel.value).toBe('hub');
    expect(sel.selectedOptions[0].textContent).toBe('Hub: Warehouse');
    sel.value = String(r1.id);
    sel.dispatchEvent(new Event('change'));
    expect(truck.hubId).toBeNull();
    expect(truck.routeId).toBe(r1.id);
  });

  it('a hub truck waiting at home is not a problem; a stuck one is', () => {
    const { s, ctx } = setup();
    s.companies.player.money = 1e7;
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 5, y: 11 }));
    const truck = must(buyHubTruck(ctx, 'player', wh.id));
    expect(filterVehicles([truck], 'problem')).toEqual([]);
    truck.state = 'stuck';
    expect(filterVehicles([truck], 'problem')).toEqual([truck]);
  });
});
