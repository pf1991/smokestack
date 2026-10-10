// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { buildRoad, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { buyTruck, createRoute, TRUCK } from '../../sim/vehicles';
import type { ToolSpec } from '../tools';
import { PANELS } from './index';

function setup() {
  const s = testState();
  const ctx = testCtx(s);
  for (let y = 8; y < 10; y++) for (let x = 2; x < 4; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
  const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
  const mill = must(placeBuilding(ctx, 'player', 'sawmill', { x: 12, y: 7 }));
  must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 15, y: 10 })));
  const listeners: ((t: ToolSpec) => void)[] = [];
  const game = {
    ctx,
    tools: { onPick: null as ((id: number) => void) | null },
    renderer: { setSelection: vi.fn() },
    setTool: vi.fn((t: ToolSpec) => listeners.forEach((f) => f(t))),
    onToolChange: (f: (t: ToolSpec) => void) => {
      listeners.push(f);
      return () => listeners.splice(listeners.indexOf(f), 1);
    },
  };
  return { s, ctx, camp, mill, game, host: game as unknown as GameController };
}

const win = () => document.querySelector('.window') as HTMLElement;
const click = (sel: string) => (win().querySelector(sel) as HTMLElement).click();

afterEach(() => {
  (document.querySelector('.window-close') as HTMLElement | null)?.click();
  document.body.replaceChildren();
});

describe('routes panel', () => {
  it('picking two buildings then Done creates the route and buys a truck', () => {
    const { s, camp, mill, game, host } = setup();
    PANELS.routes.open(host);
    click('[data-act="new"]');
    expect(game.setTool).toHaveBeenCalledWith({ kind: 'pickStop', routeId: null });
    game.tools.onPick!(camp.id);
    game.tools.onPick!(mill.id);
    expect(win().textContent).toContain('Lumber Camp');
    const money = s.companies.player.money;
    click('[data-act="done"]');
    const routes = Object.values(s.routes);
    expect(routes).toHaveLength(1);
    expect(routes[0].stops.map((x) => x.buildingId)).toEqual([camp.id, mill.id]);
    expect(routes[0].stops[0].load).toEqual(['wood']);
    expect(routes[0].stops[1].unload).toEqual(['wood']);
    expect(Object.values(s.vehicles)).toHaveLength(1);
    expect(s.companies.player.money).toBe(money - TRUCK.cost);
    expect(game.tools.onPick).toBeNull();
  });

  it('truck checkbox off skips the truck; fewer than two stops does not save', () => {
    const { s, camp, mill, game, host } = setup();
    PANELS.routes.open(host);
    click('[data-act="new"]');
    game.tools.onPick!(camp.id);
    click('[data-act="done"]');
    expect(Object.values(s.routes)).toHaveLength(0);
    game.tools.onPick!(mill.id);
    (win().querySelector('[data-act="buy-first"]') as HTMLInputElement).click();
    click('[data-act="done"]');
    expect(Object.values(s.routes)).toHaveLength(1);
    expect(Object.values(s.vehicles)).toHaveLength(0);
  });

  it('cancelling the tool (Esc) discards the draft', () => {
    const { s, camp, game, host } = setup();
    PANELS.routes.open(host);
    click('[data-act="new"]');
    game.tools.onPick!(camp.id);
    game.setTool({ kind: 'inspect' });
    expect(win().querySelector('[data-act="done"]')).toBeNull();
    expect(Object.values(s.routes)).toHaveLength(0);
  });

  it('lists only player routes and warns about missing roads', () => {
    const { s, ctx, camp, mill, host } = setup();
    must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    s.routes[999] = { id: 999, ownerId: 'rival', name: 'Rival run', color: '#000', stops: [], kind: 'truck' };
    for (let x = 6; x <= 8; x++) s.map.tiles[10 * s.map.width + x].road = false;
    PANELS.routes.open(host);
    const names = [...win().querySelectorAll<HTMLInputElement>('.rt-name')].map((i) => i.value);
    expect(names).toEqual(['Wood run']);
    expect(win().textContent).toContain('no road between Lumber Camp and Sawmill');
  });

  it('truck + / - buy and sell; delete needs two clicks', () => {
    const { s, ctx, camp, mill, game, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    must(buyTruck(ctx, 'player', r.id));
    PANELS.routes.open(host);
    click('[data-route="' + r.id + '"] .rt-head');
    expect(game.renderer.setSelection).toHaveBeenLastCalledWith({ routeId: r.id });
    click('[data-act="truck-plus"]');
    expect(Object.values(s.vehicles)).toHaveLength(2);
    click('[data-act="truck-minus"]');
    expect(Object.values(s.vehicles)).toHaveLength(1);
    click('[data-act="delete"]');
    expect(s.routes[r.id]).toBeDefined();
    click('[data-act="delete"]');
    expect(s.routes[r.id]).toBeUndefined();
    expect(Object.values(s.vehicles)).toHaveLength(0);
  });

  it('stop controls edit via updateRoute: chips, reorder, remove', () => {
    const { s, ctx, camp, mill, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    PANELS.routes.open(host);
    click('[data-route="' + r.id + '"] .rt-head');
    click('.rt-stop[data-i="0"] [data-chip="load:wood"]');
    expect(s.routes[r.id].stops[0].load).toEqual([]);
    click('.rt-stop[data-i="0"] [data-act="down"]');
    expect(s.routes[r.id].stops.map((x) => x.buildingId)).toEqual([mill.id, camp.id]);
    click('.rt-stop[data-i="0"] [data-act="remove"]');
    expect(s.routes[r.id].stops).toHaveLength(1);
  });

  it('closing the window clears the map selection', () => {
    const { game, host } = setup();
    PANELS.routes.open(host);
    (document.querySelector('.window-close') as HTMLElement).click();
    expect(game.renderer.setSelection).toHaveBeenLastCalledWith(null);
  });
});
