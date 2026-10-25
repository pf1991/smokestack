// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { GOODS } from '../../data/goods';
import { buildRoad, lPath, placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { buildRail, TRAIN } from '../../sim/rail';
import type { GoodId } from '../../sim/types';
import { buyTruck, createRoute, TRUCK, updateRoute } from '../../sim/vehicles';
import type { ToolSpec } from '../tools';
import { PANELS } from './index';
import { lineStatus } from './routes';

// updateRoute stays real; the spy lets the automation controls prove they go through it
vi.mock('../../sim/vehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sim/vehicles')>();
  return { ...actual, updateRoute: vi.fn(actual.updateRoute) };
});

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
    const stat = win().querySelector('.rt-vehicles')!.parentElement!;
    expect(stat.textContent).toBe('1 train');
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

  it('automation: the Manual/Auto switch, auto-sizing and a Leave-at select per manual stop go through updateRoute', () => {
    const { s, ctx, camp, mill, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    must(buyTruck(ctx, 'player', r.id));
    const spy = vi.mocked(updateRoute);
    spy.mockClear();
    PANELS.routes.open(host, r.id);
    const auto = () => win().querySelector('.rt-auto') as HTMLElement;
    expect(auto().classList.contains('p-section')).toBe(true);
    expect(auto().querySelector('[data-act="mode"]')!.textContent).toBe('Manual');
    expect(auto().textContent).toContain('Last month: no departures');
    const selects = () => auto().querySelectorAll<HTMLSelectElement>('[data-act="minload"]');
    expect(selects()).toHaveLength(1); // the mill stop loads nothing: no select

    // Leave at 100% on the first stop
    const sel = selects()[0];
    sel.value = '1';
    sel.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenLastCalledWith(ctx, r.id, { stops: expect.any(Array) });
    expect(s.routes[r.id].stops[0].minLoad).toBe(1);
    expect(selects()[0].value).toBe('1');

    // auto-sizing on, at most 4
    const box = auto().querySelector('[data-act="autosize"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenLastCalledWith(ctx, r.id, { autoSize: { on: true, maxTrucks: 5 } });
    const max = auto().querySelector('[data-act="max-trucks"]') as HTMLInputElement;
    max.value = '4';
    max.dispatchEvent(new Event('change'));
    expect(s.routes[r.id].autoSize).toEqual({ on: true, maxTrucks: 4 });

    // the switch: Auto hides the Leave-at selects
    (auto().querySelector('[data-act="mode"]') as HTMLElement).click();
    expect(spy).toHaveBeenLastCalledWith(ctx, r.id, { mode: 'auto' });
    expect(s.routes[r.id].mode).toBe('auto');
    expect(auto().querySelector('[data-act="mode"]')!.textContent).toBe('Auto');
    expect(selects()).toHaveLength(0);

    s.routes[r.id].stats = { loaded: 0, empty: 0, backlogDays: 0, last: 72 };
    PANELS.routes.open(host, r.id);
    click('.rt-head'); // collapse and reopen: the section is rebuilt from the route
    click('.rt-head');
    expect(auto().textContent).toContain('Last month: 72% loaded');
  });

  it('warns about a truck holding cargo that no stop unloads', () => {
    const { ctx, camp, mill, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    const v = must(buyTruck(ctx, 'player', r.id));
    PANELS.routes.open(host, r.id);
    expect(win().textContent).not.toContain('no stop unloads');
    v.cargo = { coal: 5 };
    PANELS.routes.open(host, r.id); // re-renders
    expect(win().textContent).toContain('trucks holding cargo no stop unloads: 1');
  });

  it('rail lines have no automation section', () => {
    const { ctx, host } = setup();
    const a = must(placeBuilding(ctx, 'player', 'train_station', { x: 2, y: 20 }));
    const b = must(placeBuilding(ctx, 'player', 'train_station', { x: 20, y: 20 }));
    must(buildRail(ctx, 'player', lPath({ x: 2, y: 22 }, { x: 22, y: 22 })));
    const r = must(createRoute(ctx, 'player', 'Line', [
      { buildingId: a.id, load: [], unload: [] },
      { buildingId: b.id, load: [], unload: [] },
    ], 'train'));
    PANELS.routes.open(host, r.id);
    expect(win().querySelector('[data-route]')!.classList.contains('open')).toBe(true);
    expect(win().querySelector('.rt-auto')).toBeNull();
  });

  it('empty game: an empty state whose New route action starts a draft', () => {
    const { game, host } = setup();
    PANELS.routes.open(host);
    const empty = win().querySelector('.kit-empty') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.querySelector('.kit-empty-title')!.textContent).toBe('No routes yet');
    expect(empty.querySelector('.kit-empty-body')!.textContent).toBe(
      'Routes carry goods between your works and stores. Pick a start and an end on the map.');
    const action = empty.querySelector('button') as HTMLButtonElement;
    expect(action.classList.contains('kit-btn--primary')).toBe(true);
    expect(action.textContent).toBe('New route');
    action.click();
    expect(game.setTool).toHaveBeenCalledWith({ kind: 'pickStop', routeId: null });
    expect(win().querySelector('[data-act="done"]')).not.toBeNull();
  });

  it('header: summary of lines and attention, New route primary and New rail line secondary', () => {
    const { ctx, camp, mill, host } = setup();
    PANELS.routes.open(host);
    expect(win().querySelector('.kit-ph-summary')!.textContent).toBe('0 lines, 0 need attention');
    expect(win().querySelector('[data-act="new"]')!.classList.contains('kit-btn--primary')).toBe(true);
    expect(win().querySelector('[data-act="new-train"]')!.classList.contains('kit-btn--secondary')).toBe(true);
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    PANELS.routes.open(host, r.id);
    expect(win().querySelector('.kit-ph-summary')!.textContent).toBe('1 line, 1 needs attention');
  });

  it('line card: colour bar, title, A to B with the good icon, status pill, vehicles and rate', () => {
    const { ctx, camp, mill, host } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    must(buyTruck(ctx, 'player', r.id));
    PANELS.routes.open(host);
    const card = win().querySelector(`[data-route="${r.id}"]`) as HTMLElement;
    expect(card.querySelector('.rt-swatch')).not.toBeNull();
    expect((card.querySelector('.rt-name') as HTMLInputElement).value).toBe('Wood run');
    expect(card.querySelector('.rt-stops-line')!.textContent).toBe('Lumber Camp → Sawmill');
    expect(card.querySelector('.rt-flow [data-good="wood"]')).not.toBeNull();
    expect(card.querySelector('.rt-status')!.textContent).toBe('Flowing');
    expect(card.querySelector('.rt-status')!.classList.contains('kit-pill--positive')).toBe(true);
    expect(card.querySelector('.rt-vehicles')!.textContent).toBe('1 truck');
    expect(card.querySelector('.rt-rate')!.textContent).toMatch(/\/mo$/);
  });

  it('the status pill follows the buildings without rebuilding the card', () => {
    vi.useFakeTimers();
    try {
      const { ctx, camp, mill, host } = setup();
      const r = must(createRoute(ctx, 'player', 'Wood run', [
        { buildingId: camp.id, load: ['wood'], unload: [] },
        { buildingId: mill.id, load: [], unload: ['wood'] },
      ]));
      must(buyTruck(ctx, 'player', r.id));
      PANELS.routes.open(host);
      const name = win().querySelector('.rt-name');
      mill.status = 'no_input';
      vi.advanceTimersByTime(1000);
      expect(win().querySelector('.rt-status')!.textContent).toBe('Starved');
      expect(win().querySelector('.kit-ph-summary')!.textContent).toBe('1 line, 1 needs attention');
      expect(win().querySelector('.rt-name')).toBe(name);
    } finally {
      vi.useRealTimers();
    }
  });

  function storeChipSetup() {
    const s = testState({ width: 60, height: 40, money: 1e7, cities: [{ x: 30, y: 20 }], streets: true });
    const ctx = testCtx(s);
    for (let y = 8; y < 10; y++) for (let x = 2; x < 4; x++) s.map.tiles[y * s.map.width + x].terrain = 'forest';
    const camp = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 2, y: 8 }));
    const store = must(placeBuilding(ctx, 'player', 'store', { x: 28, y: 18 }));
    must(buildRoad(ctx, 'player', lPath({ x: 2, y: 10 }, { x: 28, y: 10 })));
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
    return { s, ctx, camp, store, host: game as unknown as GameController };
  }

  it('a store unload list longer than the chip cap shows 10 chips and +N (C1)', () => {
    const { s, ctx, camp, store, host } = storeChipSetup();
    const consumers = Object.values(GOODS).filter((g) => g.kind === 'consumer');
    expect(consumers.length).toBeGreaterThan(10);
    const r = must(createRoute(ctx, 'player', 'To store', [
      { buildingId: camp.id, load: [], unload: [] },
      { buildingId: store.id, load: [], unload: [] },
    ]));
    PANELS.routes.open(host, r.id);
    const stop = () => win().querySelector('.rt-stop[data-i="1"]')!;
    expect(stop().querySelectorAll('.rt-chip').length).toBe(10);
    const more = stop().querySelector('.rt-chip-more') as HTMLElement;
    expect(more.textContent).toBe(`+${consumers.length - 10}`);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    expect(stop().querySelectorAll('.rt-chip').length).toBe(consumers.length);
    expect(s.routes[r.id]).toBeDefined();
  });

  it('pressed unload chips stay visible after collapsing the overflow', () => {
    const { ctx, camp, store, host } = storeChipSetup();
    const consumers = Object.keys(GOODS).filter((g) => GOODS[g].kind === 'consumer') as GoodId[];
    const late = consumers[consumers.length - 1]!;
    const r = must(createRoute(ctx, 'player', 'To store', [
      { buildingId: camp.id, load: [], unload: [] },
      { buildingId: store.id, load: [], unload: [] },
    ]));
    PANELS.routes.open(host, r.id);
    const stop = () => win().querySelector('.rt-stop[data-i="1"]')!;
    (stop().querySelector('.rt-chip-more') as HTMLElement).click();
    (stop().querySelector(`[data-chip="unload:${late}"]`) as HTMLElement).click();
    expect(stop().querySelector(`[data-chip="unload:${late}"]`)!.getAttribute('aria-pressed')).toBe('true');
    (stop().querySelector('.rt-chip-more') as HTMLElement).click();
    expect(stop().querySelectorAll('.rt-chip').length).toBe(10);
    expect(stop().querySelector(`[data-chip="unload:${late}"]`)).not.toBeNull();
    expect(stop().querySelector(`[data-chip="unload:${late}"]`)!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('lineStatus', () => {
  function line() {
    const { ctx, camp, mill } = setup();
    const r = must(createRoute(ctx, 'player', 'Wood run', [
      { buildingId: camp.id, load: ['wood'], unload: [] },
      { buildingId: mill.id, load: [], unload: ['wood'] },
    ]));
    return { ctx, camp, mill, r };
  }

  it('No vehicles when nothing runs on the route', () => {
    const { ctx, r } = line();
    expect(lineStatus(ctx.state, r)).toEqual({ label: 'No vehicles', tone: 'negative' });
  });

  it('Starved when a destination is no_input', () => {
    const { ctx, mill, r } = line();
    must(buyTruck(ctx, 'player', r.id));
    mill.status = 'no_input';
    expect(lineStatus(ctx.state, r)).toEqual({ label: 'Starved', tone: 'warning' });
  });

  it('Backed up when a source is output_full', () => {
    const { ctx, camp, r } = line();
    must(buyTruck(ctx, 'player', r.id));
    camp.status = 'output_full';
    expect(lineStatus(ctx.state, r)).toEqual({ label: 'Backed up', tone: 'warning' });
  });

  it('Flowing otherwise', () => {
    const { ctx, camp, mill, r } = line();
    must(buyTruck(ctx, 'player', r.id));
    camp.status = 'ok';
    mill.status = 'ok';
    expect(lineStatus(ctx.state, r)).toEqual({ label: 'Flowing', tone: 'positive' });
  });
});
