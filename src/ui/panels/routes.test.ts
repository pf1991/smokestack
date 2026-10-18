// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { buildRoad, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { buildRail, TRAIN } from '../../sim/rail';
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

  it('rail line: only stations are picked, Done creates a train route with a train', () => {
    const { s, ctx, mill, game, host } = setup();
    const a = must(placeBuilding(ctx, 'player', 'train_station', { x: 2, y: 20 }));
    const b = must(placeBuilding(ctx, 'player', 'train_station', { x: 20, y: 20 }));
    must(buildRail(ctx, 'player', lPath({ x: 2, y: 22 }, { x: 22, y: 22 })));
    a.input.coal = 50;
    PANELS.routes.open(host);
    click('[data-act="new-train"]');
    game.tools.onPick!(mill.id); // refused: not a station
    game.tools.onPick!(a.id);
    game.tools.onPick!(b.id);
    expect(win().textContent).toContain('Buy first train');
    const money = s.companies.player.money;
    click('[data-act="done"]');
    const routes = Object.values(s.routes);
    expect(routes).toHaveLength(1);
    expect(routes[0].kind).toBe('train');
    expect(routes[0].stops.map((x) => x.buildingId)).toEqual([a.id, b.id]);
    expect(Object.values(s.vehicles).map((v) => v.kind)).toEqual(['train']);
    expect(s.companies.player.money).toBe(money - TRAIN.cost);
    const stat = win().querySelector('.rt-stat b')!;
    expect(stat.textContent).toContain('1');
    expect(stat.querySelector('img.icon[data-icon="train"]')).not.toBeNull();
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
    s.routes[999] = { id: 999, ownerId: 'rival', name: 'Rival run', color: '#000', stops: [], kind: 'truck', mode: 'manual' };
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

  it('route editor adds a stop to an existing route', () => {
    const { s, ctx, camp, mill, game, host } = setup();
    const mill2 = must(placeBuilding(ctx, 'player', 'sawmill', { x: 16, y: 7 }));
    must(buildRoad(ctx, 'player', lPath({ x: 15, y: 10 }, { x: 18, y: 10 })));
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    PANELS.routes.open(host);
    click('[data-route="' + r.id + '"] .rt-head');
    click('[data-act="add-stop"]');
    expect(game.setTool).toHaveBeenLastCalledWith({ kind: 'pickStop', routeId: r.id });
    expect(game.renderer.setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ routeId: r.id, pick: expect.objectContaining({ valid: expect.arrayContaining([camp.id, mill2.id]) }) }),
    );
    game.tools.onPick!(mill2.id);
    expect(s.routes[r.id].stops.map((x) => x.buildingId)).toEqual([camp.id, mill.id, mill2.id]);
    expect(win().textContent).toContain('loads');
    click('[data-act="add-done"]');
    expect(game.tools.onPick).toBeNull();
    // insert after the first stop
    click('.rt-stop[data-i="0"] [data-act="insert"]');
    game.tools.onPick!(mill2.id);
    expect(s.routes[r.id].stops.map((x) => x.buildingId)).toEqual([camp.id, mill2.id, mill.id, mill2.id]);
  });

  it('minus sells an idle vehicle first', () => {
    const { s, ctx, camp, mill, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    const a = must(buyTruck(ctx, 'player', r.id));
    const b = must(buyTruck(ctx, 'player', r.id));
    const c = must(buyTruck(ctx, 'player', r.id));
    a.state = 'idle';
    c.state = 'stuck';
    PANELS.routes.open(host);
    click('[data-route="' + r.id + '"] .rt-head');
    click('[data-act="truck-minus"]');
    expect(Object.keys(s.vehicles).map(Number).sort()).toEqual([b.id, c.id]);
    click('[data-act="truck-minus"]');
    expect(Object.keys(s.vehicles).map(Number)).toEqual([b.id]);
  });

  it('does not rebuild the window when nothing changed, and swatch cycles the colour', () => {
    vi.useFakeTimers();
    try {
      const { s, ctx, camp, mill, host } = setup();
      const r = must(createRoute(ctx, 'player', 'Wood run', [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: mill.id, load: [], unload: ['wood'] },
      ]));
      PANELS.routes.open(host);
      click('[data-route="' + r.id + '"] .rt-head');
      const chip = win().querySelector('[data-chip="load:wood"]');
      vi.advanceTimersByTime(3000);
      expect(win().querySelector('[data-chip="load:wood"]')).toBe(chip);
      const before = s.routes[r.id].color;
      click('[data-act="color"]');
      expect(s.routes[r.id].color).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('send goods to creates a 2-stop route with a truck, and Undo refunds it', () => {
    const { s, ctx, camp, mill, game, host } = setup();
    const toasts: { message: string; action?: { label: string; run: () => void } }[] = [];
    ctx.bus.on('toast', (e) => toasts.push(e));
    const money = s.companies.player.money;
    PANELS.building.open(host, camp.id);
    click('[data-act="send-goods"]');
    expect(game.setTool).toHaveBeenLastCalledWith({ kind: 'pickStop', routeId: null });
    expect(game.renderer.setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ buildingId: camp.id, pick: expect.objectContaining({ valid: [mill.id] }) }),
    );
    game.tools.onPick!(mill.id);
    const routes = Object.values(s.routes);
    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe('Lumber Camp → Sawmill');
    expect(routes[0].stops[0].load).toEqual(['wood']);
    expect(routes[0].stops[1].unload).toEqual(['wood']);
    expect(Object.values(s.vehicles)).toHaveLength(1);
    expect(s.companies.player.money).toBe(money - TRUCK.cost);
    expect(game.tools.onPick).toBeNull();
    const undo = toasts.find((t) => t.action?.label === 'Undo')!;
    undo.action!.run();
    expect(Object.keys(s.routes)).toHaveLength(0);
    expect(Object.keys(s.vehicles)).toHaveLength(0);
    expect(s.companies.player.money).toBe(money);
  });

  it('insert pre-fills the inserted stop against all other stops', () => {
    const { s, ctx, camp, mill, game, host } = setup();
    for (let y = 8; y < 10; y++) for (let x = 20; x < 22; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
    const camp2 = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 20, y: 8 }));
    must(buildRoad(ctx, 'player', lPath({ x: 15, y: 10 }, { x: 21, y: 10 })));
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    PANELS.routes.open(host);
    click('[data-route="' + r.id + '"] .rt-head');
    click('.rt-stop[data-i="0"] [data-act="insert"]');
    game.tools.onPick!(camp2.id);
    const stops = s.routes[r.id].stops;
    expect(stops.map((x) => x.buildingId)).toEqual([camp.id, camp2.id, mill.id]);
    expect(stops[1].load).toEqual(['wood']);
    expect(stops[1].unload).toEqual([]);
    expect(stops[2].unload).toEqual(['wood']);
  });

  it('collapsing the edited route leaves pick mode; closing the window mid-pick restores inspect', () => {
    const { ctx, camp, mill, game, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    PANELS.routes.open(host);
    click('[data-route="' + r.id + '"] .rt-head');
    click('[data-act="add-stop"]');
    expect(game.tools.onPick).not.toBeNull();
    click('[data-route="' + r.id + '"] .rt-head');
    expect(game.tools.onPick).toBeNull();
    expect(game.setTool).toHaveBeenLastCalledWith({ kind: 'inspect' });
    click('[data-route="' + r.id + '"] .rt-head');
    click('[data-act="add-stop"]');
    game.setTool.mockClear();
    (document.querySelector('.window-close') as HTMLElement).click();
    expect(game.tools.onPick).toBeNull();
    expect(game.setTool).toHaveBeenCalledWith({ kind: 'inspect' });
  });

  it('send goods clears the pick outlines on success; Undo is refused when late or changed', () => {
    vi.useFakeTimers();
    try {
      const { s, ctx, camp, mill, game, host } = setup();
      const toasts: { action?: { label: string; run: () => void }; duration?: number; message: string }[] = [];
      ctx.bus.on('toast', (e) => toasts.push(e));
      PANELS.building.open(host, camp.id);
      click('[data-act="send-goods"]');
      game.tools.onPick!(mill.id);
      const last = game.renderer.setSelection.mock.calls.at(-1)![0];
      expect(last.pick).toBeUndefined();
      const undoToast = toasts.find((t) => t.action)!;
      expect(undoToast.duration).toBeGreaterThanOrEqual(10_000);
      vi.advanceTimersByTime(11_000);
      undoToast.action!.run();
      expect(Object.keys(s.routes)).toHaveLength(1);
      expect(toasts.at(-1)!.message).toContain('Too late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Undo is refused when the route changed', () => {
    const { s, ctx, camp, mill, game, host } = setup();
    const toasts: { action?: { label: string; run: () => void }; message: string }[] = [];
    ctx.bus.on('toast', (e) => toasts.push(e));
    PANELS.building.open(host, camp.id);
    click('[data-act="send-goods"]');
    game.tools.onPick!(mill.id);
    const r = Object.values(s.routes)[0];
    must(buyTruck(ctx, 'player', r.id));
    toasts.find((t) => t.action)!.action!.run();
    expect(Object.keys(s.routes)).toHaveLength(1);
    expect(toasts.at(-1)!.message).toContain('changed');
  });
});
