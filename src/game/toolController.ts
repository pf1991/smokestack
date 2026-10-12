import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { TILE, type Camera } from '../render/constants';
import { regimeBlend } from '../render/regime';
import type { Ghost, Selection } from '../render/world';
import { canAfford } from '../sim/finance';
import {
  BRIDGE_COST,
  buildRoad,
  canPlaceBuilding,
  DEMOLITION_REFUND,
  demolishBuilding,
  footprint,
  lPath,
  placeBuilding,
  removeRoad,
  ROAD_COST,
} from '../sim/state';
import { buildRail, railQuote, removeRail } from '../sim/rail';
import type { GameState, SimContext, Vec2 } from '../sim/types';
import { formatMoney, formatNumber } from '../ui/format';
import { PANELS } from '../ui/panels/index';
import { reportLostStops, routesUsing } from './feedback';
import { buildingAtPoint, landmarkAtPoint } from './pick';
import type { ToolSpec } from '../ui/tools';

/** The slice of the GameController the tool controller needs (lets tests use a small stub). */
export interface ToolHost {
  ctx: SimContext;
  camera: Camera;
  renderer: { setGhost(g: Ghost | null): void; setSelection(s: Selection | null): void };
  setTool(t: ToolSpec): void;
  openPanel(id: string, arg?: unknown): void;
}

const PICK_RADIUS = 0.75;

/** Top-left tile that centres a w×h footprint on `tile` (same convention as findPlacement). */
export function centredPos(typeId: string, tile: Vec2): Vec2 {
  const def = BUILDINGS[typeId];
  if (!def) return { ...tile };
  return { x: tile.x - Math.floor((def.size.w - 1) / 2), y: tile.y - Math.floor((def.size.h - 1) / 2) };
}

/** Cost of laying road on `tiles` (existing road is free), or the reason it cannot be built. */
export function roadQuote(state: GameState, tiles: Vec2[]): { cost: number; error: string | null } {
  const { map } = state;
  const seen = new Set<number>();
  let cost = 0;
  for (const p of tiles) {
    if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return { cost, error: 'Cannot build road there' };
    const i = p.y * map.width + p.x;
    const t = map.tiles[i];
    if (t.road || seen.has(i)) continue;
    if (t.terrain === 'mountain' || t.buildingId !== null) return { cost, error: 'Cannot build road there' };
    seen.add(i);
    cost += t.terrain === 'water' ? BRIDGE_COST : ROAD_COST;
  }
  if (!canAfford(state.companies.player, cost)) return { cost, error: 'Not enough money' };
  return { cost, error: null };
}

function tileAt(state: GameState, p: Vec2) {
  const { map } = state;
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return undefined;
  return map.tiles[p.y * map.width + p.x];
}

/**
 * Turns pointer input (in tile coordinates) into sim actions for the current tool and keeps the
 * renderer's ghost preview up to date. Failures become `toast` events with tone 'bad'.
 */
export class ToolController {
  /** Receives the clicked building id while the `pickStop` tool is active. */
  onPick: ((buildingId: number) => void) | null = null;
  private tool: ToolSpec = { kind: 'inspect' };
  private hover: Vec2 | null = null;
  private dragStart: Vec2 | null = null;
  private pressed = false;
  private current: Ghost | null = null;

  constructor(private readonly game: ToolHost) {}

  get activeTool(): ToolSpec {
    return this.tool;
  }

  /** Called by the game whenever the tool changes (only `cancel` calls back into game.setTool). */
  setTool(t: ToolSpec): void {
    this.tool = t;
    this.dragStart = null;
    this.pressed = false;
    this.refreshGhost();
  }

  ghost(): Ghost | null {
    return this.current;
  }

  /** Esc: drop any drag in progress and return to the inspect tool. */
  cancel(): void {
    this.dragStart = null;
    this.pressed = false;
    this.tool = { kind: 'inspect' };
    this.game.renderer.setSelection(null);
    this.game.setTool({ kind: 'inspect' });
    this.refreshGhost();
  }

  /** The pointer left the map canvas. */
  leave(): void {
    this.hover = null;
    if (!this.dragStart) this.refreshGhost();
  }

  /** `world` is the exact world-px point clicked (picks raised roofs); without it the tile centre is used. */
  pointerDown(tile: Vec2, world?: Vec2): void {
    this.hover = { ...tile };
    this.pressed = true;
    const t = this.tool;
    switch (t.kind) {
      case 'build':
        this.build(t.typeId, tile);
        break;
      case 'road':
      case 'rail':
        this.dragStart = { ...tile };
        break;
      case 'bulldoze':
        this.bulldoze(tile, true);
        break;
      case 'inspect':
        this.inspect(tile, world);
        break;
      case 'pickStop': {
        const id = this.buildingAt(tile, world);
        if (id !== null && id !== undefined) this.onPick?.(id);
        break;
      }
    }
    this.refreshGhost();
  }

  pointerMove(tile: Vec2): void {
    if (this.hover && this.hover.x === tile.x && this.hover.y === tile.y) return;
    this.hover = { ...tile };
    // drag-bulldozing clears roads and rails only; buildings need a deliberate click
    const under = tileAt(this.state, tile);
    if (this.pressed && this.tool.kind === 'bulldoze' && (under?.road || under?.rail)) this.bulldoze(tile, false);
    this.refreshGhost();
  }

  pointerUp(tile: Vec2): void {
    this.hover = { ...tile };
    this.pressed = false;
    const start = this.dragStart;
    this.dragStart = null;
    if (start && (this.tool.kind === 'road' || this.tool.kind === 'rail')) {
      const tiles = lPath(start, tile);
      const r = this.tool.kind === 'rail' ? buildRail(this.game.ctx, 'player', tiles) : buildRoad(this.game.ctx, 'player', tiles);
      if (!r.ok) this.toast(r.error, 'bad');
    }
    this.refreshGhost();
  }

  // ------------------------------------------------------------------ actions

  private get state(): GameState {
    return this.game.ctx.state;
  }

  private toast(message: string, tone: 'info' | 'good' | 'bad'): void {
    this.game.ctx.bus.emit({ type: 'toast', message, tone });
  }

  private build(typeId: string, tile: Vec2): void {
    const r = placeBuilding(this.game.ctx, 'player', typeId, centredPos(typeId, tile));
    if (!r.ok) this.toast(r.error, 'bad');
  }

  private bulldoze(tile: Vec2, explicit: boolean): void {
    const t = tileAt(this.state, tile);
    if (!t) return;
    if (t.buildingId !== null) {
      if (!explicit) return;
      const affected = routesUsing(this.state, t.buildingId);
      const r = demolishBuilding(this.game.ctx, t.buildingId, 'player');
      if (!r.ok) this.toast(r.error, 'bad');
      else reportLostStops(this.game.ctx, affected);
    } else if (t.rail) {
      // rail first: on a level crossing the road stays
      const r = removeRail(this.game.ctx, 'player', [tile]);
      if (!r.ok && explicit) this.toast(r.error, 'bad');
    } else if (t.road) {
      const r = removeRoad(this.game.ctx, 'player', [tile]);
      if (!r.ok && explicit) this.toast(r.error, 'bad');
    }
  }

  private vehicleAt(tile: Vec2): number | null {
    let best: number | null = null;
    let bestD = PICK_RADIUS;
    for (const v of Object.values(this.state.vehicles)) {
      const d = Math.max(Math.abs(v.pos.x - tile.x), Math.abs(v.pos.y - tile.y));
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }

  /** True when the diorama dominates, so buildings are drawn (and picked) with their height. */
  private get raised(): boolean {
    return regimeBlend(this.game.camera.zoom) >= 0.5;
  }

  /** The building drawn at the click: raised roofs included, frontmost first (see game/pick.ts). */
  private buildingAt(tile: Vec2, world?: Vec2): number | null {
    const p = world ?? { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE };
    return buildingAtPoint(this.state, p, this.raised);
  }

  private inspect(tile: Vec2, world?: Vec2): void {
    const { renderer } = this.game;
    // buildings are drawn over vehicles, so a raised roof hides (and wins over) a truck behind it
    const id = this.buildingAt(tile, world);
    if (id !== null) {
      renderer.setSelection({ buildingId: id });
      if (PANELS.building) this.game.openPanel('building', id);
      else this.describeBuilding(id);
      return;
    }
    const vehicleId = this.vehicleAt(tile);
    if (vehicleId !== null) {
      if (PANELS.vehicle) this.game.openPanel('vehicle', vehicleId);
      renderer.setSelection({ vehicleId });
      return;
    }
    renderer.setSelection(null);
    // a click on a landmark's raised tower inspects its city even from the tile above
    const lm = this.raised && world ? landmarkAtPoint(this.state, world) : null;
    const cityId = lm ? this.state.cities.indexOf(lm.city) : tileAt(this.state, tile)?.cityId;
    if (cityId !== null && cityId !== undefined) {
      if (PANELS.city) this.game.openPanel('city', cityId);
      else {
        const city = this.state.cities[cityId];
        if (city) this.toast(`${city.name} — population ${formatNumber(city.population)}`, 'info');
      }
    }
  }

  /** Stand-in for the Task 19 inspector: a one-line summary toast. */
  private describeBuilding(id: number): void {
    const b = this.state.buildings[id];
    if (!b) return;
    const def = BUILDINGS[b.typeId];
    const stock = (inv: Record<string, number>) =>
      Object.entries(inv)
        .filter(([, q]) => q > 0)
        .map(([g, q]) => `${GOODS[g]?.name ?? g} ${Math.floor(q)}`)
        .join(' ');
    const parts = [def?.name ?? b.typeId, b.status.replace('_', ' ')];
    const inp = stock(b.input);
    const out = stock(b.output);
    if (inp) parts.push(`in ${inp}`);
    if (out) parts.push(`out ${out}`);
    this.toast(parts.join(' · '), 'info');
  }

  // ------------------------------------------------------------------ ghost

  private computeGhost(): Ghost | null {
    const t = this.tool;
    const hover = this.hover;
    if (t.kind === 'road' || t.kind === 'rail') {
      const end = hover ?? this.dragStart;
      if (!end) return null;
      const tiles = this.dragStart ? lPath(this.dragStart, end) : [end];
      if (t.kind === 'rail') {
        const q = railQuote(this.state, 'player', tiles);
        const label = q.error ?? (q.cost > 0 ? `Rail ${formatMoney(q.cost)}` : 'Rail (already built)');
        return { kind: 'tiles', tiles, valid: q.error === null, label };
      }
      const q = roadQuote(this.state, tiles);
      const label = q.error ?? (q.cost > 0 ? `Road ${formatMoney(q.cost)}` : 'Road (already built)');
      return { kind: 'tiles', tiles, valid: q.error === null, label };
    }
    if (!hover) return null;
    if (t.kind === 'build') {
      const def = BUILDINGS[t.typeId];
      const pos = centredPos(t.typeId, hover);
      const r = canPlaceBuilding(this.state, 'player', t.typeId, pos);
      const label = r.ok ? `${def?.name ?? t.typeId} ${formatMoney(r.value.cost)}` : r.error;
      return { kind: 'building', typeId: t.typeId, pos, valid: r.ok, label };
    }
    if (t.kind === 'bulldoze') {
      const tile = tileAt(this.state, hover);
      if (!tile) return null;
      if (tile.buildingId !== null) {
        const b = this.state.buildings[tile.buildingId];
        if (!b) return null;
        const def = BUILDINGS[b.typeId];
        const mine = b.ownerId === 'player';
        const label = mine ? `Demolish ${def.name} +${formatMoney(def.cost * DEMOLITION_REFUND)}` : 'Not your building';
        return { kind: 'tiles', tiles: footprint(b), valid: mine, label };
      }
      if (tile.rail) {
        const mine = tile.railOwner === null || tile.railOwner === 'player';
        return { kind: 'tiles', tiles: [hover], valid: mine, label: mine ? 'Remove rail' : 'Not your rail' };
      }
      if (tile.road) {
        let label = 'Remove road';
        if (tile.roadOwner !== null && tile.roadOwner !== 'player') label = 'Not your road';
        else if (tile.roadOwner === null && tile.cityId !== null) label = 'City streets belong to the town';
        return { kind: 'tiles', tiles: [hover], valid: label === 'Remove road', label };
      }
      return { kind: 'tiles', tiles: [hover], valid: false, label: 'Nothing to demolish' };
    }
    return null;
  }

  /** Recomputes the ghost and pushes it to the renderer. Also called by the game after each sim step batch. */
  refreshGhost(): void {
    this.current = this.computeGhost();
    this.game.renderer.setGhost(this.current);
  }
}
