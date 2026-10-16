import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { BUILDINGS } from '../data/buildings';
import { canAfford } from './finance';
import { findPath, roadBuildableIn, roadPassable, waterAvoidingCost } from './pathfinding';
import { accessTiles, buildRoad, roadTileCost } from './state';
import type { Building, GameState, OwnerId, SimContext, Vec2 } from './types';

/** Cost of laying road on `tiles` (tiles that already carry road are free). */
export function roadCost(state: GameState, tiles: Vec2[]): number {
  const { map } = state;
  const seen = new Set<number>();
  let cost = 0;
  for (const p of tiles) {
    const i = p.y * map.width + p.x;
    const t = map.tiles[i];
    if (!t || t.road || seen.has(i)) continue;
    seen.add(i);
    cost += roadTileCost(state, t.terrain === 'water');
  }
  return cost;
}

/**
 * The shortest buildable path (roadBuildable, water-avoiding) from a tile orthogonally adjacent to
 * the footprint to one of the `targetCount` road tiles nearest the building; [] when the building
 * already has road access, null when no road can reach it.
 */
export function planRoadConnection(state: GameState, building: Building, targetCount = 24): Vec2[] | null {
  const { map } = state;
  if (accessTiles(state, building).length > 0) return [];
  const roadBuildable = roadBuildableIn(state);
  const { w, h } = BUILDINGS[building.typeId].size;
  const { x: bx, y: by } = building.pos;
  const starts: Vec2[] = [];
  for (let y = by - 1; y <= by + h; y++) {
    for (let x = bx - 1; x <= bx + w; x++) {
      const insideX = x >= bx && x < bx + w;
      const insideY = y >= by && y < by + h;
      if (insideX === insideY) continue;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (roadBuildable(map.tiles[y * map.width + x], x, y)) starts.push({ x, y });
    }
  }
  const cx = bx + w / 2;
  const cy = by + h / 2;
  const roads: { p: Vec2; d: number }[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (!map.tiles[i].road) continue;
    const p = { x: i % map.width, y: Math.floor(i / map.width) };
    roads.push({ p, d: Math.abs(p.x - cx) + Math.abs(p.y - cy) });
  }
  roads.sort((a, b) => a.d - b.d);
  const targets = roads.slice(0, targetCount).map((r) => r.p);
  let best: Vec2[] | null = null;
  for (const s of starts) {
    const path = findPath(map, s, targets, roadBuildable, waterAvoidingCost);
    if (path && (!best || path.length < best.length)) best = path;
  }
  return best;
}

export interface ConnectOpts {
  /** road tiles considered as destinations (default: the 24 nearest) */
  targetCount?: number;
  /** company that pays (default: the building's owner) */
  owner?: OwnerId;
  /** refuse with 'Not enough money' when the payer would be left with less than this (default 0) */
  reserve?: number;
}

/**
 * Connects a building to the existing road network: if it already has an access road tile it does
 * nothing; otherwise it builds the path found by `planRoadConnection` with `buildRoad`, paid by
 * `owner`. Fails cleanly (changing nothing) when no road can reach it or it is unaffordable.
 * A number as the third argument is the legacy `targetCount`.
 */
export function connectToRoads(
  ctx: SimContext,
  building: Building,
  opts: number | ConnectOpts = {},
): Result<{ built: number; cost: number }> {
  const o: ConnectOpts = typeof opts === 'number' ? { targetCount: opts } : opts;
  const owner = o.owner ?? building.ownerId;
  const path = planRoadConnection(ctx.state, building, o.targetCount ?? 24);
  if (!path) return err('No road can reach this building');
  if (path.length === 0) return ok({ built: 0, cost: 0 });
  const cost = roadCost(ctx.state, path);
  if (!canAfford(ctx.state.companies[owner], cost + (o.reserve ?? 0))) return err('Not enough money');
  return buildRoad(ctx, owner, path);
}

/**
 * Makes sure a truck can drive from `a` to `b`: if the road network does not already link their
 * access tiles, lays the cheapest direct road (roadBuildable, water-avoiding), paid by `owner`.
 */
export function ensureRoadLink(
  ctx: SimContext,
  owner: OwnerId,
  a: Building,
  b: Building,
  reserve = 0,
): Result<{ built: number; cost: number }> {
  const { state } = ctx;
  const from = accessTiles(state, a);
  const to = accessTiles(state, b);
  if (from.length === 0 || to.length === 0) return err('Stop has no road access');
  if (findPath(state.map, from[0], to, roadPassable)) return ok({ built: 0, cost: 0 });
  return buildDirectRoad(ctx, owner, a, b, reserve);
}

/**
 * Lays the cheapest direct road (roadBuildable, water-avoiding) between the access tiles of `a` and
 * `b` even when the network already links them by a detour, paid by `owner`; atomic.
 */
export function buildDirectRoad(
  ctx: SimContext,
  owner: OwnerId,
  a: Building,
  b: Building,
  reserve = 0,
): Result<{ built: number; cost: number }> {
  const { state } = ctx;
  const from = accessTiles(state, a);
  const to = accessTiles(state, b);
  if (from.length === 0 || to.length === 0) return err('Stop has no road access');
  const path = findPath(state.map, from[0], to, roadBuildableIn(state), waterAvoidingCost);
  if (!path) return err('No road can link these buildings');
  const cost = roadCost(state, path);
  if (!canAfford(state.companies[owner], cost + reserve)) return err('Not enough money');
  return buildRoad(ctx, owner, path);
}
