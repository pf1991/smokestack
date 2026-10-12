/**
 * Debug autoplay (`?autoplay=1`): scripts a furniture chain next to the biggest city through the
 * public sim API so screenshots show trucks, sales and money moving without manual play.
 */
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { findPath, roadBuildableIn, roadPassable, waterAvoidingCost } from '../sim/pathfinding';
import { accessTiles, buildRoad, canPlaceBuilding, findPlacement, placeBuilding } from '../sim/state';
import { connectToRoads } from '../sim/testkit';
import type { Building, City, SimContext, Vec2 } from '../sim/types';
import { runTicks } from '../sim/simulation';
import { buyTruck, createRoute } from '../sim/vehicles';
import { suggestStops } from '../sim/routeHelpers';

export function biggestCity(cities: City[]): City | undefined {
  return [...cities].sort((a, b) => b.population - a.population)[0];
}

/** Nearest valid lumber-camp spot to `near`, scanning forest tiles by distance. */
function forestSpot(ctx: SimContext, near: Vec2): Vec2 | null {
  const { state } = ctx;
  const { map } = state;
  const cands: { p: Vec2; d: number }[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i].terrain !== 'forest') continue;
    const p = { x: i % map.width, y: Math.floor(i / map.width) };
    cands.push({ p, d: Math.abs(p.x - near.x) + Math.abs(p.y - near.y) });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) if (canPlaceBuilding(state, 'player', 'lumber_camp', c.p).ok) return c.p;
  return null;
}

/** Makes sure trucks can drive from `a` to `b`, laying a direct road if the network does not link them. */
function ensureLink(ctx: SimContext, a: Building, b: Building): Result {
  const { map } = ctx.state;
  const from = accessTiles(ctx.state, a);
  const to = accessTiles(ctx.state, b);
  if (from.length === 0 || to.length === 0) return err('Stop has no road access');
  if (findPath(map, from[0], to, roadPassable)) return ok();
  const path = findPath(map, from[0], to, roadBuildableIn(ctx.state), waterAvoidingCost);
  if (!path) return err('No road can link the chain');
  const r = buildRoad(ctx, 'player', path);
  return r.ok ? ok() : r;
}

const STAGGER_TICKS = 12;

function place(ctx: SimContext, typeId: string, near: Vec2, radius = 25): Result<Building> {
  const pos = findPlacement(ctx.state, 'player', typeId, near, radius);
  if (!pos) return err(`No room for ${typeId}`);
  return placeBuilding(ctx, 'player', typeId, pos);
}

/**
 * lumber camp → sawmill → furniture factory → store in the biggest city, each leg with two trucks.
 * Runs the sim for half a day between truck purchases.
 * Returns the chain's buildings (for camera framing) or the first error.
 */
export function runAutoplay(ctx: SimContext): Result<Building[]> {
  const city = biggestCity(ctx.state.cities);
  if (!city) return err('No city');
  const store = place(ctx, 'store', city.center, 10);
  if (!store.ok) return store;
  const factory = place(ctx, 'furniture_factory', city.center);
  if (!factory.ok) return factory;
  const forest = forestSpot(ctx, factory.value.pos);
  if (!forest) return err('No forest for a lumber camp');
  const camp = placeBuilding(ctx, 'player', 'lumber_camp', forest);
  if (!camp.ok) return camp;
  const mid = {
    x: Math.round((camp.value.pos.x + factory.value.pos.x) / 2),
    y: Math.round((camp.value.pos.y + factory.value.pos.y) / 2),
  };
  const sawmill = place(ctx, 'sawmill', mid);
  if (!sawmill.ok) return sawmill;

  const chain = [camp.value, sawmill.value, factory.value, store.value];
  for (const b of chain) {
    const r = connectToRoads(ctx, b);
    if (!r.ok) return r;
  }
  const routes: number[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const link = ensureLink(ctx, a, b);
    if (!link.ok) return link;
    const route = createRoute(ctx, 'player', `Autoplay ${i + 1}`, suggestStops(ctx.state, [a.id, b.id]));
    if (!route.ok) return route;
    routes.push(route.value.id);
  }
  // two trucks per leg, the second bought half a day later so they do not drive in lockstep
  for (let k = 0; k < 2; k++) {
    if (k > 0) runTicks(ctx, STAGGER_TICKS);
    for (const id of routes) {
      const t = buyTruck(ctx, 'player', id);
      if (!t.ok) return t;
    }
  }
  return ok(chain);
}

