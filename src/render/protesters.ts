/**
 * Smog protesters (Phase 3 Task 3): in every town at smog tier 3+ (sim/society/escalation.ts), 5–9
 * small marchers with placards walk back and forth along the road tiles nearest the player's
 * largest polluter in the town's zone (`protestSite`). Diorama only, drawn per frame in world space
 * after the vehicles (they walk the road like them) and before the buildings.
 *
 * Each town's route is cached for the game month (and dropped when its site building is gone):
 * a breadth-first walk over road tiles from the site's access road, up to PATH_TILES long. Drawing
 * is one batch per town: every marcher's coat, head, stick and placard go into shared paths, so a
 * town costs the same handful of fill/stroke calls whatever its marcher count.
 *
 * Strike pickets (Phase 3 Task 4) reuse the same marchers: 3–5 per striking works (fixed per
 * building), pacing at the works' southernmost access tile (and the next road tile along, when there
 * is one). Diorama only, per frame, drawn just after the buildings: a picket on a road behind its
 * works would otherwise vanish under the works' roof.
 */
import { BUILDINGS } from '../data/buildings';
import { dateToDays } from '../sim/clock';
import { protestSite } from '../sim/society/escalation';
import { strikeActive } from '../sim/society/strikeState';
import { accessTiles } from '../sim/state';
import type { Building, City, GameState, Vec2 } from '../sim/types';
import { TILE } from './constants';
import { hash } from './chunk';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type TileRange = { x0: number; y0: number; x1: number; y1: number };

/** Longest marching route, in road tiles. */
export const PATH_TILES = 6;
/** How far (Chebyshev tiles) from the site to look for a road when it has no access road. */
const ROAD_SEARCH = 6;
/** Marching speed, tiles per real second. */
const SPEED = 0.45;
export const MIN_MARCHERS = 5;
export const MAX_MARCHERS = 9;

const COAT = '#3b3430';
const SKIN = '#d9b48f';
const STICK = '#6b4a2b';
const PLACARD = '#f3e9d2';
const SLOGAN = '#b5302f';
const INK = '#1d1a16';

interface Route {
  month: number;
  siteId: number;
  /** tile coordinates along the road, start (nearest the site) first */
  path: Vec2[];
}

/** Marchers in a town at tier 3+: MIN_MARCHERS..MAX_MARCHERS, fixed per town. */
export function marcherCount(city: City): number {
  return MIN_MARCHERS + (hash(city.id, 0, 0x9a7e, 3) % (MAX_MARCHERS - MIN_MARCHERS + 1));
}

/** The road route marchers walk near the protest site: BFS over road tiles, longest shortest path ≤ PATH_TILES. */
export function protestRoute(state: GameState, site: Building): Route['path'] {
  const { map } = state;
  const { width, height, tiles } = map;
  const starts = accessTiles(state, site);
  if (starts.length === 0) {
    // nearest road tile by expanding Chebyshev rings around the site
    for (let r = 1; r <= ROAD_SEARCH && starts.length === 0; r++) {
      for (let y = site.pos.y - r; y <= site.pos.y + r; y++) {
        for (let x = site.pos.x - r; x <= site.pos.x + r; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          if (Math.max(Math.abs(x - site.pos.x), Math.abs(y - site.pos.y)) !== r) continue;
          if (tiles[y * width + x].road) starts.push({ x, y });
        }
      }
    }
    if (starts.length === 0) return [];
  }
  const start = starts[0];
  const prev = new Map<number, number>();
  const depth = new Map<number, number>();
  const s0 = start.y * width + start.x;
  depth.set(s0, 0);
  const queue = [s0];
  let far = s0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const d = depth.get(i)!;
    if (d > depth.get(far)!) far = i;
    if (d >= PATH_TILES - 1) continue;
    const y = (i / width) | 0;
    const x = i - y * width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (depth.has(j) || !tiles[j].road) continue;
      depth.set(j, d + 1);
      prev.set(j, i);
      queue.push(j);
    }
  }
  const out: Vec2[] = [];
  for (let i: number | undefined = far; i !== undefined; i = prev.get(i)) out.push({ x: i % width, y: (i / width) | 0 });
  return out.reverse();
}

export class Protesters {
  private routes = new Map<number, Route>();
  private owner: GameState | null = null;

  /** Cached route of `city` for this game month (rebuilt when the month turns or the site is gone). */
  route(state: GameState, city: City): Vec2[] {
    if (this.owner !== state) {
      this.routes.clear();
      this.owner = state;
    }
    const month = state.date.year * 12 + state.date.month;
    const hit = this.routes.get(city.id);
    if (hit && hit.month === month && (hit.siteId < 0 || state.buildings[hit.siteId])) return hit.path;
    const site = protestSite(state, city);
    const path = site ? protestRoute(state, site) : [];
    this.routes.set(city.id, { month, siteId: site?.id ?? -1, path });
    return path;
  }

  /** World-space draw (the caller has applied the camera transform). `r` culls towns out of view. */
  draw(g: Ctx, state: GameState, r: TileRange, nowMs: number): void {
    for (const city of state.cities) {
      if ((city.smog?.tier ?? 0) < 3) continue;
      const path = this.route(state, city);
      if (path.length === 0) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of path) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      if (x1 < r.x0 - 1 || y1 < r.y0 - 1 || x0 > r.x1 + 1 || y0 > r.y1 + 1) continue;
      drawMarchers(g, path, marcherCount(city), city.id, nowMs);
    }
  }
}

/** Point at distance `d` (tiles) along the polyline through the tile centres, in world px. */
function along(path: Vec2[], d: number): { x: number; y: number; dx: number; dy: number } {
  const n = path.length;
  if (n === 1) return { x: (path[0].x + 0.5) * TILE, y: (path[0].y + 0.5) * TILE, dx: 1, dy: 0 };
  const k = Math.min(n - 2, Math.max(0, Math.floor(d)));
  const t = Math.min(1, Math.max(0, d - k));
  const a = path[k];
  const b = path[k + 1];
  return { x: (a.x + (b.x - a.x) * t + 0.5) * TILE, y: (a.y + (b.y - a.y) * t + 0.5) * TILE, dx: b.x - a.x, dy: b.y - a.y };
}

/** One town's marchers, batched: 4 fills and 2 strokes whatever the count. */
export function drawMarchers(g: Ctx, path: Vec2[], count: number, seed: number, nowMs: number): void {
  const len = Math.max(0, path.length - 1);
  const coats: [number, number][] = [];
  const t = nowMs / 1000;
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let dx: number;
    let dy: number;
    if (len === 0) {
      // a single road tile: they mill about in a small circle
      const a = t * 0.6 + (i / count) * Math.PI * 2;
      x = (path[0].x + 0.5) * TILE + Math.cos(a) * TILE * 0.3;
      y = (path[0].y + 0.5) * TILE + Math.sin(a) * TILE * 0.22;
      dx = -Math.sin(a);
      dy = Math.cos(a);
    } else {
      // ping-pong along the route, spread out along it
      const u = (t * SPEED) / len + i / count + (hash(seed, i, 0x51, 7) % 100) / 1000;
      const ph = u - Math.floor(u);
      const back = ph >= 0.5;
      const p = along(path, (back ? 2 - 2 * ph : 2 * ph) * len);
      x = p.x;
      y = p.y;
      dx = back ? -p.dx : p.dx;
      dy = back ? -p.dy : p.dy;
    }
    // walk two abreast: a sideways offset from the centre line, alternating by marcher
    const side = (i % 2 === 0 ? -1 : 1) * (3 + (i % 3));
    x += -dy * side;
    y += dx * side;
    // a little bob as they step
    y -= Math.abs(Math.sin(t * 7 + i * 1.7)) * 0.8;
    coats.push([x, y]);
  }
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // sticks
  g.beginPath();
  for (const [x, y] of coats) {
    g.moveTo(x + 1.6, y - 2);
    g.lineTo(x + 1.6, y - 10);
  }
  g.strokeStyle = STICK;
  g.lineWidth = 0.9;
  g.stroke();
  // coats
  g.beginPath();
  for (const [x, y] of coats) g.rect(x - 1.6, y - 3, 3.2, 5);
  g.fillStyle = COAT;
  g.fill();
  // heads
  g.beginPath();
  for (const [x, y] of coats) {
    g.moveTo(x + 1.3, y - 4.2);
    g.arc(x, y - 4.2, 1.3, 0, Math.PI * 2);
  }
  g.fillStyle = SKIN;
  g.fill();
  // placards: paper boards, an ink rim and a red slogan stripe
  g.beginPath();
  for (const [x, y] of coats) g.rect(x - 1.6, y - 14, 6.4, 4.4);
  g.fillStyle = PLACARD;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.6;
  g.stroke();
  g.beginPath();
  for (const [x, y] of coats) g.rect(x - 0.6, y - 12.4, 4.4, 1.2);
  g.fillStyle = SLOGAN;
  g.fill();
  g.restore();
}

export const MIN_PICKETS = 3;
export const MAX_PICKETS = 5;

/** Pickets at a striking works: MIN_PICKETS..MAX_PICKETS, fixed per building. */
export function picketCount(b: Building): number {
  return MIN_PICKETS + (hash(b.id, 0, 0x51c7, 5) % (MAX_PICKETS - MIN_PICKETS + 1));
}

/**
 * Where a striking works' pickets stand: its southernmost access road tile and the next road tile beside it
 * (a two-tile beat), or that tile alone; without road access, the tile just below the works.
 */
export function picketPath(state: GameState, b: Building): Vec2[] {
  const { width, height, tiles } = state.map;
  const access = accessTiles(state, b);
  if (access.length === 0) {
    const { w, h } = BUILDINGS[b.typeId].size;
    return [{ x: Math.min(width - 1, b.pos.x + (w >> 1)), y: Math.min(height - 1, b.pos.y + h) }];
  }
  // the southernmost access tile (then the westernmost): the gate the viewer sees
  const a = access.reduce((best, t) => (t.y > best.y || (t.y === best.y && t.x < best.x) ? t : best));
  for (const [nx, ny] of [[a.x + 1, a.y], [a.x - 1, a.y], [a.x, a.y + 1], [a.x, a.y - 1]]) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (tiles[ny * width + nx].road) return [a, { x: nx, y: ny }];
  }
  return [a];
}

/** World-space draw of the pickets at every striking works among `buildings` (the visible ones). */
export function drawPickets(g: Ctx, state: GameState, buildings: readonly Building[], nowMs: number): void {
  const today = dateToDays(state.date);
  for (const b of buildings) {
    if (!b.strike || !strikeActive(b.strike, today)) continue;
    drawMarchers(g, picketPath(state, b), picketCount(b), b.id, nowMs);
  }
}
