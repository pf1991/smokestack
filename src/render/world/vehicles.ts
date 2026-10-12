import { GOODS } from '../../data/goods';
import type { GameState, Vec2, Vehicle } from '../../sim/types';
import { TILE } from '../camera';
import type { ParticleSystem } from '../particles';
import { LOCO_HALF, LOCO_STACK, WAGON_HALF, drawLocomotive, drawTruck, drawWagon } from '../sprites';
import { type Dir, SPRITE_MARGIN, type TileRange } from './shared';

const LANE_OFFSET = 4;
/** Wagons behind every locomotive (40 units each at TRAIN capacity 120). */
const TRAIN_WAGONS = 3;
/** Steam gives way to diesel from this year. */
export const DIESEL_YEAR = 1950;
/** Minimum spacing (tiles) between recorded locomotive positions, and how many are kept. */
const TRAIL_STEP = 0.2;
const TRAIL_MAX = 16;
const DIR_ANGLE: Record<Dir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

export interface TrainTrail {
  /** tile coordinates, newest first */
  pts: Vec2[];
  /** unit heading of the last recorded step */
  hx: number;
  hy: number;
}

/** The renderer-owned vehicle state the functions below read and update. */
export interface VehicleRenderState {
  vehicleDir: Map<number, Dir>;
  /** Recent locomotive positions (tile coords, newest first) so wagons follow the track. */
  trainTrails: Map<number, TrainTrail>;
  particles: ParticleSystem;
}

export function vehiclePose(vehicleDir: Map<number, Dir>, v: Vehicle, alpha: number): { x: number; y: number; dir: Dir } {
  const a = Math.min(1, Math.max(0, alpha));
  const tx = v.prevPos.x + (v.pos.x - v.prevPos.x) * a;
  const ty = v.prevPos.y + (v.pos.y - v.prevPos.y) * a;
  const dx = v.pos.x - v.prevPos.x;
  const dy = v.pos.y - v.prevPos.y;
  let dir = vehicleDir.get(v.id) ?? 'E';
  if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
    dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    vehicleDir.set(v.id, dir);
  }
  let x = (tx + 0.5) * TILE;
  let y = (ty + 0.5) * TILE;
  // keep right
  if (v.kind === 'truck') {
    if (dir === 'E') y += LANE_OFFSET;
    else if (dir === 'W') y -= LANE_OFFSET;
    else if (dir === 'S') x -= LANE_OFFSET;
    else x += LANE_OFFSET;
  }
  return { x, y, dir };
}

export function drawVehicles(ctx: CanvasRenderingContext2D, vs: VehicleRenderState, state: GameState, r: TileRange, alpha: number, dt: number): void {
  for (const id in state.vehicles) {
    const v = state.vehicles[id];
    if (v.pos.x < r.x0 - SPRITE_MARGIN || v.pos.x > r.x1 + SPRITE_MARGIN || v.pos.y < r.y0 - SPRITE_MARGIN || v.pos.y > r.y1 + SPRITE_MARGIN) continue;
    const p = vehiclePose(vs.vehicleDir, v, alpha);
    if (v.kind === 'train') {
      drawTrainConsist(ctx, vs, state, v, p, dt);
      continue;
    }
    let cargo: string | null = null;
    for (const g in v.cargo) {
      if (v.cargo[g] > 0) {
        cargo = GOODS[g]?.color ?? null;
        break;
      }
    }
    drawTruck(ctx, p.x, p.y, p.dir, v.ownerId, cargo);
  }
}

/** Records the locomotive's position; a reversal (terminus) restarts the trail. Returns the polyline, loco first. */
function trainPolyline(trainTrails: Map<number, TrainTrail>, id: number, cur: Vec2): Vec2[] {
  let t = trainTrails.get(id);
  if (!t) {
    t = { pts: [cur], hx: 0, hy: 0 };
    trainTrails.set(id, t);
  }
  const last = t.pts[0];
  const dx = cur.x - last.x;
  const dy = cur.y - last.y;
  const d = Math.hypot(dx, dy);
  if (d > 3) {
    t.pts = [cur]; // teleported (bought, loaded save): start over
    t.hx = 0;
    t.hy = 0;
  } else if (d >= TRAIL_STEP) {
    const hx = dx / d;
    const hy = dy / d;
    if (hx * t.hx + hy * t.hy < -0.5) t.pts = [cur];
    else {
      t.pts.unshift(cur);
      if (t.pts.length > TRAIL_MAX) t.pts.length = TRAIL_MAX;
    }
    t.hx = hx;
    t.hy = hy;
  }
  return t.pts[0] === cur ? t.pts : [cur, ...t.pts];
}

/**
 * Point `s` tiles back along the polyline. Past its end the train extends straight backwards;
 * `onTrack` is false there when the tile under the point carries no rail (that wagon is hidden).
 */
function sampleBack(state: GameState, pl: Vec2[], s: number, back: Vec2): { x: number; y: number; onTrack: boolean } {
  let rest = s;
  for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i];
    const b = pl[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len) {
      const k = len > 0 ? rest / len : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, onTrack: true };
    }
    rest -= len;
  }
  const end = pl[pl.length - 1];
  let ux = back.x;
  let uy = back.y;
  if (pl.length >= 2) {
    const p = pl[pl.length - 2];
    const l = Math.hypot(end.x - p.x, end.y - p.y);
    if (l > 1e-6) {
      ux = (end.x - p.x) / l;
      uy = (end.y - p.y) / l;
    }
  }
  const x = end.x + ux * rest;
  const y = end.y + uy * rest;
  const { map } = state;
  const tx = Math.round(x);
  const ty = Math.round(y);
  const onTrack = tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && map.tiles[ty * map.width + tx].rail;
  return { x, y, onTrack };
}

/** Locomotive plus wagons following the track behind it; steam puffs before 1950, diesel exhaust after. */
function drawTrainConsist(ctx: CanvasRenderingContext2D, vs: VehicleRenderState, state: GameState, v: Vehicle, p: { x: number; y: number; dir: Dir }, dt: number): void {
  const cur = { x: p.x / TILE - 0.5, y: p.y / TILE - 0.5 };
  const pl = trainPolyline(vs.trainTrails, v.id, cur);
  const ang = DIR_ANGLE[p.dir];
  const back = { x: -Math.cos(ang), y: -Math.sin(ang) };
  // loco heading: from a point half a tile back, else its cardinal direction
  const behind = sampleBack(state, pl, 0.5, back);
  const locoAngle = pl.length >= 2 && Math.hypot(cur.x - behind.x, cur.y - behind.y) > 0.3
    ? Math.atan2(cur.y - behind.y, cur.x - behind.x)
    : ang;
  // wagons fill up in order with the carried goods
  const fills: (string | null)[] = [];
  let carried = 0;
  const goods: string[] = [];
  for (const g in v.cargo) {
    if (v.cargo[g] <= 0) continue;
    carried += v.cargo[g];
    goods.push(g);
  }
  const perWagon = v.capacity / TRAIN_WAGONS;
  for (let i = 0; i < TRAIN_WAGONS; i++) {
    const loaded = carried > i * perWagon + 1e-6;
    const g = goods.length > 0 ? goods[i % goods.length] : undefined;
    fills.push(loaded && g ? (GOODS[g]?.color ?? '#777') : null);
  }
  for (let i = TRAIN_WAGONS - 1; i >= 0; i--) {
    const s = (LOCO_HALF + 1 + WAGON_HALF + i * (2 * WAGON_HALF + 1)) / TILE;
    const c = sampleBack(state, pl, s, back);
    if (!c.onTrack) continue;
    const f = sampleBack(state, pl, s - 0.25, back);
    const b = sampleBack(state, pl, s + 0.25, back);
    const a = Math.hypot(f.x - b.x, f.y - b.y) > 1e-3 ? Math.atan2(f.y - b.y, f.x - b.x) : locoAngle;
    drawWagon(ctx, (c.x + 0.5) * TILE, (c.y + 0.5) * TILE, a, fills[i], v.id + i);
  }
  const diesel = state.date.year >= DIESEL_YEAR;
  drawLocomotive(ctx, p.x, p.y, locoAngle, v.ownerId, diesel);
  // smoke from the stack
  const moving = Math.abs(v.pos.x - v.prevPos.x) + Math.abs(v.pos.y - v.prevPos.y) > 1e-6;
  const stack = diesel ? LOCO_STACK.diesel : LOCO_STACK.steam;
  const ca = Math.cos(locoAngle);
  const sa = Math.sin(locoAngle);
  const sx = p.x + stack.x * ca - stack.y * sa;
  const sy = p.y + stack.x * sa + stack.y * ca;
  const density = diesel ? (moving ? 0.2 : 0) : moving ? 0.9 : v.state === 'loading' ? 0.3 : 0.08;
  if (density > 0) vs.particles.emitSmoke(sx, sy - 3, density, dt);
}
