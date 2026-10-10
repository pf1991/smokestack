// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../core/events';
import type { Ghost, Selection } from '../render/world';
import { buildRoad, placeBuilding, ROAD_COST } from '../sim/state';
import { must, testCtx, testState } from '../sim/testkit';
import type { SimContext } from '../sim/types';
import type { ToolSpec } from '../ui/tools';
import { ToolController, type ToolHost } from './toolController';

function setup(ctx: SimContext = testCtx()) {
  const events: GameEvent[] = [];
  ctx.bus.onAny((e) => events.push(e));
  const renderer = {
    ghost: null as Ghost | null,
    selection: null as Selection | null,
    setGhost(g: Ghost | null) {
      this.ghost = g;
    },
    setSelection(s: Selection | null) {
      this.selection = s;
    },
  };
  let tc: ToolController | null = null;
  const game: ToolHost & { tool: ToolSpec } = {
    ctx,
    camera: { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 },
    renderer,
    tool: { kind: 'inspect' },
    setTool: vi.fn((t: ToolSpec) => {
      game.tool = t;
      tc?.setTool(t);
    }),
    openPanel: vi.fn(),
  };
  tc = new ToolController(game);
  const toasts = () => events.filter((e): e is Extract<GameEvent, { type: 'toast' }> => e.type === 'toast');
  return { ctx, game, tc, renderer, events, toasts };
}

describe('ToolController', () => {
  it('road drag builds L path on release', () => {
    const { ctx, tc, renderer } = setup();
    tc.setTool({ kind: 'road' });
    const before = ctx.state.companies.player.money;
    tc.pointerDown({ x: 2, y: 2 });
    tc.pointerMove({ x: 6, y: 2 });
    tc.pointerMove({ x: 6, y: 5 });
    const g = tc.ghost();
    expect(g?.kind).toBe('tiles');
    if (g?.kind !== 'tiles') throw new Error('expected tiles ghost');
    expect(g.tiles).toHaveLength(8);
    expect(g.valid).toBe(true);
    expect(g.label).toContain('$4,000');
    expect(renderer.ghost).toEqual(g);
    // nothing is built while dragging
    expect(ctx.state.map.tiles[2 * 40 + 4].road).toBe(false);
    tc.pointerUp({ x: 6, y: 5 });
    const W = ctx.state.map.width;
    for (const p of [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 4 }, { x: 6, y: 5 }]) {
      expect(ctx.state.map.tiles[p.y * W + p.x].road).toBe(true);
    }
    expect(ctx.state.map.tiles[5 * W + 2].road).toBe(false);
    expect(ctx.state.companies.player.money).toBe(before - 8 * ROAD_COST);
    // after release the preview collapses back to the hovered tile
    const after = tc.ghost();
    expect(after?.kind === 'tiles' ? after.tiles : []).toHaveLength(1);
  });

  it('invalid build emits bad toast and changes nothing', () => {
    const ctx = testCtx(testState({ terrain: 'water' }));
    const { tc, toasts } = setup(ctx);
    tc.setTool({ kind: 'build', typeId: 'sawmill' });
    tc.pointerMove({ x: 10, y: 10 });
    const g = tc.ghost();
    expect(g).toMatchObject({ kind: 'building', typeId: 'sawmill', valid: false, label: 'Wrong terrain' });
    // the footprint is centred on the cursor
    expect(g?.kind === 'building' ? g.pos : null).toEqual({ x: 9, y: 9 });
    const snapshot = JSON.stringify(ctx.state);
    tc.pointerDown({ x: 10, y: 10 });
    tc.pointerUp({ x: 10, y: 10 });
    expect(JSON.stringify(ctx.state)).toBe(snapshot);
    expect(toasts()).toEqual([{ type: 'toast', message: 'Wrong terrain', tone: 'bad' }]);
  });

  it('valid build places and labels the ghost with name and cost', () => {
    const { ctx, tc } = setup();
    tc.setTool({ kind: 'build', typeId: 'sawmill' });
    tc.pointerMove({ x: 10, y: 10 });
    expect(tc.ghost()).toMatchObject({ valid: true, label: 'Sawmill $20,000' });
    tc.pointerDown({ x: 10, y: 10 });
    tc.pointerUp({ x: 10, y: 10 });
    const placed = Object.values(ctx.state.buildings);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ typeId: 'sawmill', pos: { x: 9, y: 9 }, ownerId: 'player' });
  });

  it('escape returns to inspect tool', () => {
    const { game, tc, renderer } = setup();
    game.setTool({ kind: 'road' });
    tc.pointerDown({ x: 1, y: 1 });
    tc.pointerMove({ x: 4, y: 1 });
    expect(renderer.ghost).not.toBeNull();
    tc.cancel();
    expect(game.setTool).toHaveBeenLastCalledWith({ kind: 'inspect' });
    expect(game.tool).toEqual({ kind: 'inspect' });
    expect(tc.ghost()).toBeNull();
    expect(renderer.ghost).toBeNull();
    // releasing after cancel builds nothing
    tc.pointerUp({ x: 4, y: 1 });
    expect(game.ctx.state.map.tiles[1 * 40 + 2].road).toBe(false);
  });

  it('bulldoze on road tile removes road', () => {
    const { ctx, tc } = setup();
    must(buildRoad(ctx, 'player', [{ x: 3, y: 3 }, { x: 4, y: 3 }]));
    tc.setTool({ kind: 'bulldoze' });
    tc.pointerDown({ x: 4, y: 3 });
    tc.pointerUp({ x: 4, y: 3 });
    const W = ctx.state.map.width;
    expect(ctx.state.map.tiles[3 * W + 4].road).toBe(false);
    expect(ctx.state.map.tiles[3 * W + 3].road).toBe(true);
  });

  it('bulldoze on building demolishes it', () => {
    const { ctx, tc } = setup();
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    tc.setTool({ kind: 'bulldoze' });
    tc.pointerDown({ x: 6, y: 7 });
    tc.pointerUp({ x: 6, y: 7 });
    expect(ctx.state.buildings[b.id]).toBeUndefined();
  });

  it('inspect selects a building and opens the building panel', () => {
    const { ctx, tc, renderer, game } = setup();
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    tc.pointerDown({ x: 5, y: 5 });
    tc.pointerUp({ x: 5, y: 5 });
    expect(renderer.selection).toEqual({ buildingId: b.id });
    expect(game.openPanel).toHaveBeenCalledWith('building', b.id);
  });

  it('pickStop forwards the building id to onPick', () => {
    const { ctx, tc } = setup();
    const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 5, y: 5 }));
    const onPick = vi.fn();
    tc.onPick = onPick;
    tc.setTool({ kind: 'pickStop', routeId: null });
    tc.pointerDown({ x: 20, y: 20 });
    tc.pointerDown({ x: 7, y: 6 });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(b.id);
  });
});
