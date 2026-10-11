// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { buildRoad, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { PANELS } from './index';

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
});
