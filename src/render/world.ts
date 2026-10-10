/**
 * World renderer: composes everything the player sees on the map canvas.
 *
 * Layer order: terrain → roads → houses → buildings (y-sorted) → vehicles → particles →
 * selection / route polyline → ghost → overlays → atmosphere → night lights (additive).
 * With `attachOverlay`, selection, ghost, ghost label and sale floaters move to a second, unfiltered
 * canvas drawn last, so the era sepia does not wash out their colours. The rendered light level is
 * eased in real time (`easeLight`) so fast speeds never strobe between day and night.
 *
 * Roads, bridges, street lamps, garden trees and houses are static between invalidations, so they
 * are painted into per-chunk cached surfaces (one day and one night variant per chunk, lazily, with a
 * small render budget per frame). Night glows (lit house windows, factory windows, street lamps,
 * headlights) are drawn after the atmosphere with 'lighter' compositing so they shine through it.
 */
import type { EventBus } from '../core/events';
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { STATION_TYPE, stationAccess } from '../sim/rail';
import { accessTiles } from '../sim/state';
import type { Building, GameMap, GameState, Tile, Vec2, Vehicle } from '../sim/types';
import { applyAtmosphere, cssFilterFor, easeLight } from './atmosphere';
import { TILE, type Camera, visibleTileRange } from './camera';
import { OVERLAYS } from './overlays';
import { ParticleSystem } from './particles';
import {
  HEADROOM,
  chimneyOffsets,
  drawHouse,
  drawLocomotive,
  drawWagon,
  LOCO_HALF,
  LOCO_STACK,
  WAGON_HALF,
  drawTruck,
  getBuildingSprite,
  houseStyle,
  windowRects,
} from './sprites';
import { CHUNK, TerrainRenderer, hash, isWinter } from './terrain';

// ---------------------------------------------------------------- public types

export type Ghost =
  | { kind: 'building'; typeId: string; pos: Vec2; valid: boolean; label: string }
  | { kind: 'tiles'; tiles: Vec2[]; valid: boolean; label: string };

export interface Selection {
  buildingId?: number;
  routeId?: number;
  /** A route still being drafted in the route editor (not in `state.routes` yet). */
  draftRoute?: { color: string; stops: { buildingId: number }[] };
  vehicleId?: number;
}

type Dir = 'N' | 'E' | 'S' | 'W';
type Surface = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ---------------------------------------------------------------- pure helpers

const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** Neighbour bitmask of a road or rail tile: N=1, E=2, S=4, W=8. */
export function roadMask(map: GameMap, x: number, y: number, layer: 'road' | 'rail'): number {
  const at = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && map.tiles[ty * map.width + tx][layer];
  return (at(x, y - 1) ? N : 0) | (at(x + 1, y) ? E : 0) | (at(x, y + 1) ? S : 0) | (at(x - 1, y) ? W : 0);
}

/** Road surface era: dirt before 1925, asphalt from 1925, centre-line dashes from 1930. */
export function roadEra(year: number): 'dirt' | 'asphalt' | 'lanes' {
  if (year < 1925) return 'dirt';
  if (year < 1930) return 'asphalt';
  return 'lanes';
}

/** Street lamps stand on every 4th road tile (diagonal stagger) inside cities. */
export function hasLamp(tile: Tile, x: number, y: number): boolean {
  return tile.road && tile.cityId !== null && tile.terrain !== 'water' && (x + y) % 4 === 0;
}

const h01 = (x: number, y: number, seed: number, salt: number): number => hash(x, y, seed, salt) / 4294967296;
const bitCount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

function makeSurface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------------------------------------------------------------- constants

const CHUNK_PX = CHUNK * TILE;
/** Chunk surfaces have a transparent border so chimneys and lamp heads may cross chunk seams. */
const PAD = 8;
const SURF_PX = CHUNK_PX + PAD * 2;
const RENDERS_PER_FRAME = 3;
/** Minimum surface cap (~1.1 MB each); raised per frame to 2 × visible chunks + 8 so the visible set always fits. */
const MIN_SURFACE_CAP = 48;
/** Frames between sweeps of direction entries for vehicles that no longer exist. */
const VEHICLE_DIR_SWEEP = 600;
const SPRITE_MARGIN = 2;
const HOUSE_VARIANTS = 16;

const BRASS = '#c9a13a';
const PLAYER_FLOAT = '#7ee07e';
const RIVAL_FLOAT = '#b5302f';
const LANE_OFFSET = 4;
/** Wagons behind every locomotive (40 units each at TRAIN capacity 120). */
const TRAIN_WAGONS = 3;
/** Steam gives way to diesel from this year. */
export const DIESEL_YEAR = 1950;
/** Minimum spacing (tiles) between recorded locomotive positions, and how many are kept. */
const TRAIL_STEP = 0.2;
const TRAIL_MAX = 16;
const DIR_ANGLE: Record<Dir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

interface TrainTrail {
  /** tile coordinates, newest first */
  pts: Vec2[];
  /** unit heading of the last recorded step */
  hx: number;
  hy: number;
}

const MONEY = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
/** Sales per building are summed and shown as at most one floater per this many real ms. */
export const FLOAT_FLUSH_MS = 800;
const FLOAT_JITTER_PX = 14;

// ---------------------------------------------------------------- road painter

/** Paints one road tile (dirt or asphalt, with optional sidewalks and lamp post) at (0,0). */
function paintRoadTile(g: Ctx, mask: number, era: 'dirt' | 'asphalt' | 'lanes', urban: boolean, winter: boolean, x: number, y: number, seed: number, lamp: boolean): void {
  const C = TILE / 2;
  const band = (hw: number, color: string): void => {
    g.fillStyle = color;
    g.fillRect(C - hw, C - hw, hw * 2, hw * 2);
    if (mask & N) g.fillRect(C - hw, 0, hw * 2, C);
    if (mask & S) g.fillRect(C - hw, C, hw * 2, C);
    if (mask & W) g.fillRect(0, C - hw, C, hw * 2);
    if (mask & E) g.fillRect(C, C - hw, C, hw * 2);
  };
  if (era === 'dirt') {
    const hw = urban ? 7 : 6;
    if (urban) band(hw + 3, winter ? 'rgba(196,200,206,0.9)' : 'rgba(176,150,108,0.85)');
    band(hw + 1, winter ? '#6e5f50' : '#7d6040');
    band(hw, winter ? '#94826c' : '#a5825a');
    // wheel ruts
    g.fillStyle = winter ? 'rgba(120,104,88,0.7)' : 'rgba(110,82,50,0.75)';
    for (const off of [-3, 3]) {
      if (mask & (E | W) || mask === 0) {
        const x0 = mask & W ? 0 : C - 3;
        const x1 = mask & E ? TILE : C + 3;
        g.fillRect(x0, C + off, x1 - x0, 1);
      }
      if (mask & (N | S)) {
        const y0 = mask & N ? 0 : C - 3;
        const y1 = mask & S ? TILE : C + 3;
        g.fillRect(C + off, y0, 1, y1 - y0);
      }
    }
    // pebbles / puddles
    for (let i = 0; i < 4; i++) {
      const px = C - hw + 1 + Math.floor(h01(x, y, seed, 900 + i) * (hw * 2 - 2));
      const py = C - hw + 1 + Math.floor(h01(x, y, seed, 910 + i) * (hw * 2 - 2));
      g.fillStyle = i % 2 ? 'rgba(70,52,30,0.5)' : 'rgba(200,175,130,0.6)';
      g.fillRect(px, py, 2, 1);
    }
    if (winter) {
      g.fillStyle = 'rgba(250,252,255,0.75)';
      for (let i = 0; i < 5; i++) {
        g.fillRect(C - hw + Math.floor(h01(x, y, seed, 920 + i) * hw * 2), C - hw + Math.floor(h01(x, y, seed, 930 + i) * hw * 2), 3, 1);
      }
    }
  } else {
    const hw = 8;
    if (urban) {
      band(hw + 4, winter ? '#dfe3e6' : '#b9b3a6'); // sidewalk
      band(hw + 1, '#8c877d'); // kerb
    } else {
      band(hw + 1, 'rgba(60,60,60,0.45)');
    }
    band(hw, '#4b4d50');
    // texture
    for (let i = 0; i < 6; i++) {
      const px = C - hw + Math.floor(h01(x, y, seed, 940 + i) * hw * 2);
      const py = C - hw + Math.floor(h01(x, y, seed, 950 + i) * hw * 2);
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.15)';
      g.fillRect(px, py, 2, 1);
    }
    if (era === 'lanes' && bitCount(mask) <= 2) {
      g.fillStyle = '#e6d48a';
      if (mask & W) g.fillRect(2, C - 1, 9, 2);
      if (mask & E) g.fillRect(TILE - 11, C - 1, 9, 2);
      if (mask & N) g.fillRect(C - 1, 2, 2, 9);
      if (mask & S) g.fillRect(C - 1, TILE - 11, 2, 9);
    } else if (era === 'lanes' && urban) {
      // zebra crossings on city junction arms
      g.fillStyle = 'rgba(235,235,225,0.75)';
      for (let k = -6; k <= 4; k += 4) {
        if (mask & W) g.fillRect(1, C + k, 4, 2);
        if (mask & E) g.fillRect(TILE - 5, C + k, 4, 2);
        if (mask & N) g.fillRect(C + k, 1, 2, 4);
        if (mask & S) g.fillRect(C + k, TILE - 5, 2, 4);
      }
    }
    if (winter) {
      g.fillStyle = 'rgba(245,248,252,0.55)';
      g.fillRect(C - hw, C - hw, 2, 2);
      g.fillRect(C + hw - 3, C + hw - 2, 3, 2);
    }
  }
  if (lamp) {
    // post at the north-west kerb corner
    const lx = C - 11;
    const ly = C - 11;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(lx + 1, ly + 2, 3, 2);
    g.fillStyle = '#2b2b2e';
    g.fillRect(lx, ly - 5, 2, 7);
    g.fillStyle = era === 'dirt' ? '#3a3328' : '#3a3d42';
    g.fillRect(lx - 1, ly - 7, 4, 3);
    g.fillStyle = '#f2df9a';
    g.fillRect(lx, ly - 6, 2, 1);
  }
}

/** Paints a bridge deck on a water tile: wooden planks before 1925, steel girders afterwards. */
function paintBridgeTile(g: Ctx, mask: number, era: 'dirt' | 'asphalt' | 'lanes'): void {
  const C = TILE / 2;
  // deck runs north-south only when the tile connects vertically and not horizontally
  const isH = !((mask & (N | S)) !== 0 && (mask & (E | W)) === 0);
  g.save();
  if (!isH) {
    g.translate(C, C);
    g.rotate(Math.PI / 2);
    g.translate(-C, -C);
  }
  const hw = 8;
  // shadow on the water
  g.fillStyle = 'rgba(10,30,50,0.35)';
  g.fillRect(0, C - hw + 3, TILE, hw * 2);
  if (era === 'dirt') {
    // piers
    g.fillStyle = '#4a3420';
    g.fillRect(5, C + hw - 1, 3, 4);
    g.fillRect(TILE - 8, C + hw - 1, 3, 4);
    g.fillStyle = '#9a7248';
    g.fillRect(0, C - hw, TILE, hw * 2);
    g.fillStyle = 'rgba(60,40,20,0.55)';
    for (let i = 0; i < TILE; i += 4) g.fillRect(i, C - hw, 1, hw * 2);
    g.fillStyle = 'rgba(255,230,180,0.18)';
    for (let i = 2; i < TILE; i += 8) g.fillRect(i, C - hw + 1, 2, hw * 2 - 2);
    // railings with posts
    g.fillStyle = '#5a3d22';
    g.fillRect(0, C - hw - 1, TILE, 2);
    g.fillRect(0, C + hw - 1, TILE, 2);
    for (let i = 2; i < TILE; i += 8) {
      g.fillRect(i, C - hw - 2, 2, 3);
      g.fillRect(i, C + hw - 2, 2, 3);
    }
  } else {
    // concrete piers
    g.fillStyle = '#8f9396';
    g.fillRect(3, C + hw, 4, 4);
    g.fillRect(TILE - 7, C + hw, 4, 4);
    g.fillStyle = '#55585c';
    g.fillRect(0, C - hw, TILE, hw * 2);
    if (era === 'lanes') {
      g.fillStyle = '#e6d48a';
      g.fillRect(2, C - 1, 9, 2);
      g.fillRect(TILE - 11, C - 1, 9, 2);
    }
    // steel truss girders on both sides
    for (const sy of [C - hw - 3, C + hw]) {
      g.fillStyle = '#6f7d8a';
      g.fillRect(0, sy, TILE, 3);
      g.strokeStyle = '#3f4a55';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= TILE; i += 8) {
        g.moveTo(i, sy + 0.5);
        g.lineTo(i + 4, sy + 2.5);
        g.lineTo(i + 8, sy + 0.5);
      }
      g.stroke();
    }
  }
  g.restore();
}

/** Rail gauge: each rail sits this many px either side of the track centreline. */
const GAUGE = 4;
const RAIL_STEEL = '#8e949b';
const RAIL_SHINE = '#c9ced3';

/**
 * Paints one rail tile at (0,0): a ballast bed, sleepers ("ties") and two steel rails. Two
 * perpendicular arms are drawn as a quarter-circle curve; anything else as straight arms from the
 * centre. On a level crossing (`road` true) the ballast is replaced by timber decking set into the
 * road, with striped crossbuck posts on the corners.
 */
function paintRailTile(g: Ctx, mask: number, road: boolean, winter: boolean, x: number, y: number, seed: number): void {
  const C = TILE / 2;
  const m = mask === 0 ? E | W : mask === N || mask === S ? N | S : mask === E || mask === W ? E | W : mask;
  const curve = bitCount(m) === 2 && (m & (N | S)) !== 0 && (m & (E | W)) !== 0;
  const ballast = winter ? '#b9b7b2' : '#857a6c';
  const tie = road ? '#6b5236' : '#4a3626';

  if (curve) {
    // arc centred on the tile corner shared by the two arms
    const cx = m & E ? TILE : 0;
    const cy = m & S ? TILE : 0;
    const a0 = m & E ? (m & S ? Math.PI : Math.PI / 2) : m & S ? -Math.PI / 2 : 0;
    const a1 = a0 + Math.PI / 2;
    const arc = (r: number, w: number, color: string): void => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.arc(cx, cy, r, a0, a1);
      g.stroke();
    };
    g.lineCap = 'butt';
    if (!road) {
      arc(C, 14, 'rgba(40,30,20,0.25)');
      arc(C, 12, ballast);
    }
    g.strokeStyle = tie;
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = a0 + ((k + 0.5) / 5) * (Math.PI / 2);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.moveTo(cx + ca * (C - 6), cy + sa * (C - 6));
      g.lineTo(cx + ca * (C + 6), cy + sa * (C + 6));
    }
    g.stroke();
    for (const r of [C - GAUGE, C + GAUGE]) {
      arc(r, 1.6, RAIL_STEEL);
      arc(r - 0.4, 0.6, RAIL_SHINE);
    }
  } else {
    const arms: [number, number, number, number][] = [];
    // [x0, y0, x1, y1] from the centre out to each connected edge
    if (m & N) arms.push([C, C, C, 0]);
    if (m & S) arms.push([C, C, C, TILE]);
    if (m & W) arms.push([C, C, 0, C]);
    if (m & E) arms.push([C, C, TILE, C]);
    const band = (hw: number, color: string): void => {
      g.fillStyle = color;
      for (const [x0, y0, x1, y1] of arms) {
        if (x0 === x1) g.fillRect(C - hw, Math.min(y0, y1), hw * 2, Math.abs(y1 - y0));
        else g.fillRect(Math.min(x0, x1), C - hw, Math.abs(x1 - x0), hw * 2);
      }
      g.fillRect(C - hw, C - hw, hw * 2, hw * 2);
    };
    if (!road) {
      band(7, 'rgba(40,30,20,0.25)');
      band(6, ballast);
      // ballast grit
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
        const vertical = (m & (N | S)) !== 0 && (m & (E | W)) === 0;
        const along = h01(x, y, seed, 960 + i) * TILE;
        const across = C - 5 + h01(x, y, seed, 970 + i) * 10;
        g.fillRect(vertical ? across : along, vertical ? along : across, 1, 1);
      }
    } else {
      band(6, 'rgba(70,52,30,0.85)'); // timber decking between and beside the rails
    }
    // sleepers every 4 px along each arm
    g.fillStyle = tie;
    for (const [x0, y0, x1, y1] of arms) {
      const vertical = x0 === x1;
      const len = Math.abs(vertical ? y1 - y0 : x1 - x0);
      const dir = Math.sign(vertical ? y1 - y0 : x1 - x0);
      for (let d = 2; d < len; d += 4) {
        const p = C + dir * d;
        if (vertical) g.fillRect(C - 6, p - 1, 12, 2);
        else g.fillRect(p - 1, C - 6, 2, 12);
      }
    }
    // rails
    for (const [x0, y0, x1, y1] of arms) {
      const vertical = x0 === x1;
      for (const off of [-GAUGE, GAUGE]) {
        g.fillStyle = RAIL_STEEL;
        if (vertical) g.fillRect(C + off - 0.8, Math.min(y0, y1), 1.6, Math.abs(y1 - y0));
        else g.fillRect(Math.min(x0, x1), C + off - 0.8, Math.abs(x1 - x0), 1.6);
        g.fillStyle = RAIL_SHINE;
        if (vertical) g.fillRect(C + off - 0.8, Math.min(y0, y1), 0.6, Math.abs(y1 - y0));
        else g.fillRect(Math.min(x0, x1), C + off - 0.8, Math.abs(x1 - x0), 0.6);
      }
    }
  }

  if (road) {
    // crossbuck posts on two opposite corners: white with red stripes
    g.lineCap = 'butt';
    for (const [px, py] of [[5, 5], [TILE - 5, TILE - 5]]) {
      const cross = (w: number, color: string, dx: number, dy: number): void => {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(px - 3.5 + dx, py - 3.5 + dy);
        g.lineTo(px + 3.5 + dx, py + 3.5 + dy);
        g.moveTo(px + 3.5 + dx, py - 3.5 + dy);
        g.lineTo(px - 3.5 + dx, py + 3.5 + dy);
        g.stroke();
      };
      cross(2.5, 'rgba(0,0,0,0.35)', 1, 1);
      cross(2.5, '#b8322a', 0, 0);
      cross(1.1, '#f4efe2', 0, 0);
      g.fillStyle = '#2b2b2e';
      g.fillRect(px - 1, py - 1, 2, 2);
    }
  }
}


/** A small garden tree for empty urban tiles. */
function paintGardenTree(g: Ctx, cx: number, cy: number, r: number, winter: boolean): void {
  g.fillStyle = 'rgba(10,30,15,0.3)';
  g.beginPath();
  g.ellipse(cx + 2, cy + r * 0.8, r, r * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = winter ? '#5b4a3a' : '#3f7a35';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = winter ? 'rgba(250,252,255,0.9)' : '#5f9e48';
  g.beginPath();
  g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.55, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------- glow sprites

let lampGlow: Surface | null = null;
function getLampGlow(): Surface {
  if (lampGlow) return lampGlow;
  const s = makeSurface(64, 64);
  const g = (s as HTMLCanvasElement).getContext('2d') as Ctx;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,140,0.95)');
  grad.addColorStop(0.15, 'rgba(255,190,100,0.55)');
  grad.addColorStop(0.5, 'rgba(255,160,70,0.16)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  lampGlow = s;
  return s;
}

const houseGlowCache = new Map<string, Surface>();
/**
 * Glow mask for a lit house: |lit − unlit| leaves only the window pixels (warm orange on black),
 * which added with 'lighter' compositing makes exactly those windows shine. A blurred copy adds a halo.
 */
function getHouseGlow(style: string, variant: number, year: number): Surface {
  const key = `${style}|${variant}`;
  let s = houseGlowCache.get(key);
  if (s) return s;
  const P = 6;
  const sharp = makeSurface(TILE + P * 2, TILE + P * 2);
  const g = (sharp as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  const unlit = makeSurface(TILE + P * 2, TILE + P * 2);
  drawHouse((unlit as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D, P, P, variant, year, false);
  drawHouse(g, P, P, variant, year, true);
  // one image-level difference (per-primitive difference would also cancel overlapping strokes)
  g.globalCompositeOperation = 'difference';
  g.drawImage(unlit as CanvasImageSource, 0, 0);
  s = makeSurface(TILE + P * 2, TILE + P * 2);
  const o = (s as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  o.fillStyle = '#000';
  o.fillRect(0, 0, TILE + P * 2, TILE + P * 2);
  o.globalCompositeOperation = 'lighter';
  o.filter = 'blur(2px)';
  o.drawImage(sharp as CanvasImageSource, 0, 0);
  o.drawImage(sharp as CanvasImageSource, 0, 0);
  o.filter = 'none';
  o.drawImage(sharp as CanvasImageSource, 0, 0);
  houseGlowCache.set(key, s);
  return s;
}

const chimneyCache = new Map<string, Vec2[]>();
/** chimneyOffsets() allocates; cache per type so smoke emission is allocation-free per frame. */
function chimneysOf(typeId: string): Vec2[] {
  let c = chimneyCache.get(typeId);
  if (!c) chimneyCache.set(typeId, (c = chimneyOffsets(typeId)));
  return c;
}

const GLOW_PAD = 3;
interface WindowGlow {
  surf: Surface;
  /** sprite-space offset of the glow image's top-left corner */
  ox: number;
  oy: number;
}
const windowGlowCache = new Map<string, WindowGlow | null>();
/** Pre-rendered warm glow (halo + bright pane) for a building type's `windowRects`, cropped to their bounds. */
function getWindowGlow(typeId: string): WindowGlow | null {
  const hit = windowGlowCache.get(typeId);
  if (hit !== undefined) return hit;
  const rects = windowRects(typeId);
  if (!rects.length) {
    windowGlowCache.set(typeId, null);
    return null;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const ox = x0 - GLOW_PAD;
  const oy = y0 - GLOW_PAD;
  const surf = makeSurface(x1 - x0 + GLOW_PAD * 2, y1 - y0 + GLOW_PAD * 2);
  const g = (surf as HTMLCanvasElement).getContext('2d') as Ctx;
  g.globalCompositeOperation = 'lighter';
  for (const r of rects) {
    g.fillStyle = 'rgba(255,160,60,0.16)';
    g.fillRect(r.x - ox - 3, r.y - oy - 3, r.w + 6, r.h + 6);
    g.fillStyle = 'rgba(255,170,70,0.25)';
    g.fillRect(r.x - ox - 1, r.y - oy - 1, r.w + 2, r.h + 2);
    g.fillStyle = 'rgba(255,214,122,0.95)';
    g.fillRect(r.x - ox, r.y - oy, r.w, r.h);
  }
  const wg = { surf, ox, oy };
  windowGlowCache.set(typeId, wg);
  return wg;
}

// ---------------------------------------------------------------- chunk cache

interface ChunkMeta {
  /** flat [x, y, variant, lit] per house */
  houses: number[];
  /** flat [worldX, worldY] per street lamp */
  lamps: number[];
  empty: boolean;
}

interface ChunkCache {
  dirty: boolean;
  version: number;
  meta: ChunkMeta | null;
  surf: [Surface | null, Surface | null];
  surfVersion: [number, number];
  surfSig: [string, string];
  /** frame number each variant surface was last drawn (for LRU eviction) */
  lastUsed: [number, number];
}

// ---------------------------------------------------------------- renderer

export class WorldRenderer {
  readonly particles = new ParticleSystem();
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private terrain: TerrainRenderer;
  private chunks = new Map<number, ChunkCache>();
  private chunkCols: number;
  private surfaceCount = 0;
  private surfaceCap = MIN_SURFACE_CAP;
  private curSig = '';
  private frame = 0;
  private lastNow: number | null = null;
  private lastFilter = '';
  private ghost: Ghost | null = null;
  private selection: Selection | null = null;
  private vehicleDir = new Map<number, Dir>();
  /** Recent locomotive positions (tile coords, newest first) so wagons follow the track. */
  private trainTrails = new Map<number, TrainTrail>();
  private sortBuf: Building[] = [];
  /** sale floaters live apart from smoke/sparks so they can be drawn on the unfiltered overlay */
  private readonly floaters = new ParticleSystem();
  private pendingSales = new Map<number, { revenue: number; ownerId: Building['ownerId'] }>();
  private lastFloat = new Map<number, number>();
  private light: number | null = null;
  private overlay: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    state: GameState,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.state = state;
    this.terrain = new TerrainRenderer(state.map, state.seed);
    this.chunkCols = Math.ceil(state.map.width / CHUNK);
  }

  /**
   * Draws selection, ghost, ghost label and sale floaters on a separate canvas stacked above the
   * world canvas (same size and transform), so the era CSS filter does not wash their colours out.
   */
  attachOverlay(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.overlay = { canvas, ctx };
  }

  setGhost(g: Ghost | null): void {
    this.ghost = g;
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
  }

  /** Marks cached road/house chunks stale: all of them, or only those touching `tiles`. */
  invalidate(tiles?: Vec2[]): void {
    if (!tiles) {
      for (const c of this.chunks.values()) c.dirty = true;
      return;
    }
    for (const t of tiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = t.x + dx;
          const ty = t.y + dy;
          if (tx < 0 || ty < 0) continue;
          const c = this.chunks.get(Math.floor(ty / CHUNK) * this.chunkCols + Math.floor(tx / CHUNK));
          if (c) c.dirty = true;
        }
      }
    }
  }

  /** Subscribes to sim events for float texts, sparks and cache invalidation. Returns an unsubscribe. */
  attachEffects(bus: EventBus): () => void {
    const offs = [
      bus.on('sale', (e) => {
        // summed per store and flushed by render() at most every FLOAT_FLUSH_MS
        const p = this.pendingSales.get(e.buildingId);
        if (p) p.revenue += e.revenue;
        else this.pendingSales.set(e.buildingId, { revenue: e.revenue, ownerId: e.ownerId });
      }),
      bus.on('buildingPlaced', (e) => {
        const b = e.building;
        const def = BUILDINGS[b.typeId];
        const { w, h } = def.size;
        for (const [fx, fy] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]]) {
          this.particles.emitSparks((b.pos.x + fx) * TILE, (b.pos.y + fy) * TILE);
        }
        this.invalidate([b.pos, { x: b.pos.x + w - 1, y: b.pos.y + h - 1 }]);
      }),
      bus.on('buildingRemoved', () => this.invalidate()),
      bus.on('roadChanged', (e) => this.invalidate(e.tiles)),
      bus.on('railChanged', (e) => this.invalidate(e.tiles)),
      bus.on('monthEnd', () => this.invalidate()),
    ];
    return () => offs.forEach((f) => f());
  }

  render(state: GameState, cam: Camera, alpha: number, nowMs: number): void {
    if (state.map !== this.state.map) {
      this.terrain = new TerrainRenderer(state.map, state.seed);
      this.chunkCols = Math.ceil(state.map.width / CHUNK);
      this.chunks.clear();
      this.surfaceCount = 0;
      this.vehicleDir.clear();
      this.trainTrails.clear();
      this.pendingSales.clear();
      this.lastFloat.clear();
      this.light = null;
    }
    this.state = state;
    this.frame++;
    if (this.frame % VEHICLE_DIR_SWEEP === 0) {
      for (const id of this.vehicleDir.keys()) if (!state.vehicles[id]) this.vehicleDir.delete(id);
      for (const id of this.trainTrails.keys()) if (!state.vehicles[id]) this.trainTrails.delete(id);
    }
    const dt = this.lastNow === null ? 16 : Math.min(100, Math.max(0, nowMs - this.lastNow));
    this.lastNow = nowMs;
    const { date } = state;
    const filter = cssFilterFor(date.year);
    if (filter !== this.lastFilter) {
      this.canvas.style.filter = filter;
      this.lastFilter = filter;
    }

    const ctx = this.ctx;
    const z = cam.zoom;
    this.light = easeLight(this.light, date.hour, dt, state.speed);
    const light = this.light;
    const nightK = Math.min(1, Math.max(0, (0.8 - light) / 0.55));
    const lit = light < 0.8;

    ctx.save();
    ctx.fillStyle = '#1d1a16';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    this.terrain.draw(ctx, cam, nowMs, { oilVisible: state.flags.oilRevealed === true || date.year >= 1910, month: date.month });

    const r = visibleTileRange(cam, state.map);
    // static cached layer: roads, bridges, lamps, gardens, houses
    this.drawChunks(ctx, cam, r, lit);

    // world-space layers
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    const visBuildings = this.collectBuildings(state, r);
    this.drawBuildings(ctx, visBuildings);
    this.emitSmoke(state, cam, dt);
    this.drawVehicles(ctx, state, r, alpha, dt);
    ctx.restore();

    this.particles.update(dt);
    this.particles.draw(ctx, cam);
    this.flushFloaters(state, nowMs);
    this.floaters.update(dt);

    // with an overlay canvas these go on top, unfiltered, after the atmosphere (see below)
    if (!this.overlay) this.drawUi(ctx, state, cam, alpha, nowMs);

    for (const o of OVERLAYS) {
      if (!o.enabled) continue;
      ctx.save();
      o.draw(ctx, state, cam);
      ctx.restore();
    }

    applyAtmosphere(ctx, cam.viewW, cam.viewH, date, light);
    if (nightK > 0) this.drawNightLights(ctx, cam, r, visBuildings, state, alpha, nightK);
    ctx.restore();

    if (this.overlay) {
      const o = this.overlay.ctx;
      // the caller sets the same (DPR) transform on both canvases
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, this.overlay.canvas.width, this.overlay.canvas.height);
      o.restore();
      this.drawUi(o, state, cam, alpha, nowMs);
    }
  }

  /** Selection, ghost, ghost label and sale floaters. */
  private drawUi(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, alpha: number, nowMs: number): void {
    const z = cam.zoom;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    this.drawSelection(ctx, state, alpha, nowMs, z);
    this.drawGhost(ctx, z);
    ctx.restore();
    this.drawGhostLabel(ctx, cam);
    this.floaters.draw(ctx, cam);
  }

  /** Emits one summed floater per building whose last one is at least FLOAT_FLUSH_MS old. */
  private flushFloaters(state: GameState, nowMs: number): void {
    for (const [id, p] of this.pendingSales) {
      const last = this.lastFloat.get(id);
      if (last !== undefined && nowMs - last < FLOAT_FLUSH_MS && nowMs >= last) continue;
      this.pendingSales.delete(id);
      const b = state.buildings[id];
      if (!b) continue;
      this.lastFloat.set(id, nowMs);
      const def = BUILDINGS[b.typeId];
      const wx = (b.pos.x + def.size.w / 2) * TILE + (Math.random() - 0.5) * 2 * FLOAT_JITTER_PX;
      const wy = b.pos.y * TILE - 4;
      this.floaters.emitFloatText(wx, wy, `+${MONEY(p.revenue)}`, p.ownerId === 'player' ? PLAYER_FLOAT : RIVAL_FLOAT);
    }
    if (this.lastFloat.size > 256) {
      for (const [id, t] of this.lastFloat) if (nowMs - t > FLOAT_FLUSH_MS) this.lastFloat.delete(id);
    }
  }

  // -------------------------------------------------------------- chunks

  private chunkSig(): string {
    const { year, month } = this.state.date;
    return `${roadEra(year)}|${houseStyle(year)}|${isWinter(month) ? 1 : 0}`;
  }

  private chunkAt(key: number): ChunkCache {
    let c = this.chunks.get(key);
    if (!c) {
      c = { dirty: true, version: 0, meta: null, surf: [null, null], surfVersion: [-1, -1], surfSig: ['', ''], lastUsed: [0, 0] };
      this.chunks.set(key, c);
    }
    return c;
  }

  private drawChunks(ctx: CanvasRenderingContext2D, cam: Camera, r: { x0: number; y0: number; x1: number; y1: number }, lit: boolean): void {
    if (r.x1 < r.x0 || r.y1 < r.y0) return;
    const sig = this.chunkSig();
    const v = lit ? 1 : 0;
    let budget = RENDERS_PER_FRAME;
    const z = cam.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = z < 1;
    const cx0 = Math.floor(Math.max(0, r.x0 - 1) / CHUNK);
    const cy0 = Math.floor(Math.max(0, r.y0 - 1) / CHUNK);
    const cx1 = Math.floor(Math.min(this.state.map.width - 1, r.x1 + 1) / CHUNK);
    const cy1 = Math.floor(Math.min(this.state.map.height - 1, r.y1 + 1) / CHUNK);
    this.curSig = sig;
    this.surfaceCap = Math.max(MIN_SURFACE_CAP, 2 * (cx1 - cx0 + 1) * (cy1 - cy0 + 1) + 8);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunkAt(cy * this.chunkCols + cx);
        if (c.dirty || !c.meta) {
          c.meta = this.computeMeta(cx, cy);
          c.dirty = false;
          c.version++;
        }
        if (c.meta.empty) continue;
        const fresh = c.surfVersion[v] === c.version && c.surfSig[v] === sig;
        if (!fresh && budget > 0) {
          budget--;
          this.renderChunk(c, cx, cy, v, sig);
        }
        const slot = c.surf[v] ? v : 1 - v;
        const surf = c.surf[slot];
        if (!surf) continue;
        c.lastUsed[slot] = this.frame;
        const sx = Math.floor((cx * CHUNK_PX - PAD - cam.x) * z);
        const sy = Math.floor((cy * CHUNK_PX - PAD - cam.y) * z);
        const ex = Math.floor(((cx + 1) * CHUNK_PX + PAD - cam.x) * z);
        const ey = Math.floor(((cy + 1) * CHUNK_PX + PAD - cam.y) * z);
        ctx.drawImage(surf as CanvasImageSource, sx, sy, ex - sx, ey - sy);
      }
    }
    ctx.restore();
  }

  /** Decides which tiles of a chunk carry houses and lamps (cheap; no drawing). */
  private computeMeta(cx: number, cy: number): ChunkMeta {
    const { map, cities, seed } = this.state;
    const houses: number[] = [];
    const lamps: number[] = [];
    let empty = true;
    const x1 = Math.min(map.width, (cx + 1) * CHUNK);
    const y1 = Math.min(map.height, (cy + 1) * CHUNK);
    for (let y = cy * CHUNK; y < y1; y++) {
      for (let x = cx * CHUNK; x < x1; x++) {
        const t = map.tiles[y * map.width + x];
        if (t.road || t.rail) empty = false;
        if (t.road && hasLamp(t, x, y)) lamps.push(x * TILE + 5, y * TILE - 2);
        if (t.cityId === null) continue;
        empty = false;
        if (t.road || t.rail || t.buildingId !== null || t.terrain === 'water' || t.terrain === 'mountain') continue;
        const city = cities.find((c) => c.id === t.cityId);
        if (!city) continue;
        const d = Math.hypot(x - city.center.x, y - city.center.y) / Math.max(1, city.urbanRadius);
        let p = 1.02 - 0.45 * d * d;
        if (d > 0.85) p *= 0.75; // ragged outskirts
        if (h01(x, y, seed, 31) >= p) continue;
        const variant = hash(x, y, seed, 37) % HOUSE_VARIANTS;
        const litHouse = h01(x, y, seed, 41) < 0.72 ? 1 : 0;
        houses.push(x, y, variant, litHouse);
      }
    }
    return { houses, lamps, empty };
  }

  private renderChunk(c: ChunkCache, cx: number, cy: number, v: number, sig: string): void {
    let s = c.surf[v];
    if (!s) {
      if (this.surfaceCount >= this.surfaceCap) this.evictOne(); // may allocate past the cap if nothing is evictable
      s = makeSurface(SURF_PX, SURF_PX);
      c.surf[v] = s;
      this.surfaceCount++;
    }
    const g = (s as HTMLCanvasElement).getContext('2d') as Ctx | null;
    c.surfVersion[v] = c.version;
    c.surfSig[v] = sig;
    if (!g) return;
    const { map, seed, date } = this.state;
    const era = roadEra(date.year);
    const winter = isWinter(date.month);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SURF_PX, SURF_PX);
    const ox = cx * CHUNK_PX - PAD;
    const oy = cy * CHUNK_PX - PAD;
    const x1 = Math.min(map.width, (cx + 1) * CHUNK);
    const y1 = Math.min(map.height, (cy + 1) * CHUNK);
    // roads and garden trees
    for (let y = cy * CHUNK; y < y1; y++) {
      for (let x = cx * CHUNK; x < x1; x++) {
        const t = map.tiles[y * map.width + x];
        g.setTransform(1, 0, 0, 1, x * TILE - ox, y * TILE - oy);
        if (t.road) {
          const mask = roadMask(map, x, y, 'road');
          if (t.terrain === 'water') paintBridgeTile(g, mask, era);
          else paintRoadTile(g, mask, era, t.cityId !== null, winter, x, y, seed, hasLamp(t, x, y));
        }
        if (t.rail) paintRailTile(g, roadMask(map, x, y, 'rail'), t.road, winter, x, y, seed);
      }
    }
    // gardens on empty urban tiles, then houses (row order → lower houses overlap upper ones)
    const meta = c.meta!;
    let hi = 0;
    for (let y = cy * CHUNK; y < y1; y++) {
      for (let x = cx * CHUNK; x < x1; x++) {
        const isHouse = hi < meta.houses.length && meta.houses[hi] === x && meta.houses[hi + 1] === y;
        if (isHouse) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          drawHouse(g as CanvasRenderingContext2D, x * TILE - ox, y * TILE - oy, meta.houses[hi + 2], date.year, v === 1 && meta.houses[hi + 3] === 1);
          hi += 4;
          continue;
        }
        const t = map.tiles[y * map.width + x];
        if (t.cityId === null || t.road || t.rail || t.buildingId !== null || t.terrain === 'water' || t.terrain === 'mountain') continue;
        if (h01(x, y, seed, 51) < 0.55) {
          g.setTransform(1, 0, 0, 1, x * TILE - ox, y * TILE - oy);
          const n = 1 + (hash(x, y, seed, 52) % 2);
          for (let i = 0; i < n; i++) {
            paintGardenTree(g, 8 + h01(x, y, seed, 53 + i) * 16, 8 + h01(x, y, seed, 55 + i) * 14, 4 + h01(x, y, seed, 57 + i) * 2.5, winter);
          }
        }
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private evictOne(): void {
    let worst: ChunkCache | null = null;
    let slot = 0;
    const recent = this.frame - 1;
    for (const c of this.chunks.values()) {
      for (let i = 0; i < 2; i++) {
        if (!c.surf[i]) continue;
        // never evict a surface drawn this or last frame
        if (c.lastUsed[i] >= recent) continue;
        // never evict a chunk's only usable surface while its other variant is stale
        // (a chunk with a single surface that is off-screen may go; it re-renders on demand)
        const o = 1 - i;
        const fresh = (k: number) => c.surfVersion[k] === c.version && c.surfSig[k] === this.curSig;
        if (c.surf[o] && !fresh(o) && fresh(i)) continue;
        if (!worst || c.lastUsed[i] < worst.lastUsed[slot]) {
          worst = c;
          slot = i;
        }
      }
    }
    if (!worst) return;
    worst.surf[slot] = null;
    worst.surfVersion[slot] = -1;
    this.surfaceCount--;
  }

  // -------------------------------------------------------------- buildings

  private collectBuildings(state: GameState, r: { x0: number; y0: number; x1: number; y1: number }): Building[] {
    const out = this.sortBuf;
    out.length = 0;
    const x0 = r.x0 - SPRITE_MARGIN;
    const y0 = r.y0 - SPRITE_MARGIN;
    const x1 = r.x1 + SPRITE_MARGIN;
    const y1 = r.y1 + SPRITE_MARGIN;
    for (const id in state.buildings) {
      const b = state.buildings[id];
      const def = BUILDINGS[b.typeId];
      if (!def) continue;
      if (b.pos.x + def.size.w - 1 < x0 || b.pos.x > x1 || b.pos.y + def.size.h - 1 < y0 || b.pos.y > y1) continue;
      out.push(b);
    }
    out.sort((a, b) => a.pos.y + BUILDINGS[a.typeId].size.h - (b.pos.y + BUILDINGS[b.typeId].size.h) || a.pos.x - b.pos.x);
    return out;
  }

  private drawBuildings(ctx: CanvasRenderingContext2D, list: Building[]): void {
    for (const b of list) {
      const variant = b.typeId === 'farm' && b.recipeId ? b.recipeId.replace(/^r_/, '') : '';
      const sprite = getBuildingSprite(b.typeId, b.ownerId, variant);
      ctx.drawImage(sprite, b.pos.x * TILE, b.pos.y * TILE - HEADROOM);
      if (b.status === 'halted') {
        // boarded-up hint: a diagonal hazard band
        const def = BUILDINGS[b.typeId];
        ctx.fillStyle = 'rgba(40,30,20,0.35)';
        ctx.fillRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE - 4, def.size.h * TILE - 4);
      }
    }
  }

  private emitSmoke(state: GameState, cam: Camera, dt: number): void {
    const margin = 6 * TILE;
    const vx0 = cam.x - margin;
    const vy0 = cam.y - margin;
    const vx1 = cam.x + cam.viewW / cam.zoom + margin;
    const vy1 = cam.y + cam.viewH / cam.zoom + margin * 2;
    for (const id in state.buildings) {
      const b = state.buildings[id];
      const density = b.status === 'ok' ? 1 : b.status === 'no_input' ? 0.15 : 0;
      if (density === 0) continue;
      const bx = b.pos.x * TILE;
      const by = b.pos.y * TILE - HEADROOM;
      if (bx < vx0 || bx > vx1 || by < vy0 || by > vy1) continue;
      for (const o of chimneysOf(b.typeId)) this.particles.emitSmoke(bx + o.x, by + o.y, density, dt);
    }
  }

  // -------------------------------------------------------------- vehicles

  private vehiclePose(v: Vehicle, alpha: number): { x: number; y: number; dir: Dir } {
    const a = Math.min(1, Math.max(0, alpha));
    const tx = v.prevPos.x + (v.pos.x - v.prevPos.x) * a;
    const ty = v.prevPos.y + (v.pos.y - v.prevPos.y) * a;
    const dx = v.pos.x - v.prevPos.x;
    const dy = v.pos.y - v.prevPos.y;
    let dir = this.vehicleDir.get(v.id) ?? 'E';
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
      this.vehicleDir.set(v.id, dir);
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

  private drawVehicles(ctx: CanvasRenderingContext2D, state: GameState, r: { x0: number; y0: number; x1: number; y1: number }, alpha: number, dt: number): void {
    for (const id in state.vehicles) {
      const v = state.vehicles[id];
      if (v.pos.x < r.x0 - SPRITE_MARGIN || v.pos.x > r.x1 + SPRITE_MARGIN || v.pos.y < r.y0 - SPRITE_MARGIN || v.pos.y > r.y1 + SPRITE_MARGIN) continue;
      const p = this.vehiclePose(v, alpha);
      if (v.kind === 'train') {
        this.drawTrainConsist(ctx, state, v, p, dt);
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

  // -------------------------------------------------------------- trains

  /** Records the locomotive's position; a reversal (terminus) restarts the trail. Returns the polyline, loco first. */
  private trainPolyline(id: number, cur: Vec2): Vec2[] {
    let t = this.trainTrails.get(id);
    if (!t) {
      t = { pts: [cur], hx: 0, hy: 0 };
      this.trainTrails.set(id, t);
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
  private sampleBack(state: GameState, pl: Vec2[], s: number, back: Vec2): { x: number; y: number; onTrack: boolean } {
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
  private drawTrainConsist(ctx: CanvasRenderingContext2D, state: GameState, v: Vehicle, p: { x: number; y: number; dir: Dir }, dt: number): void {
    const cur = { x: p.x / TILE - 0.5, y: p.y / TILE - 0.5 };
    const pl = this.trainPolyline(v.id, cur);
    const ang = DIR_ANGLE[p.dir];
    const back = { x: -Math.cos(ang), y: -Math.sin(ang) };
    // loco heading: from a point half a tile back, else its cardinal direction
    const behind = this.sampleBack(state, pl, 0.5, back);
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
      const c = this.sampleBack(state, pl, s, back);
      if (!c.onTrack) continue;
      const f = this.sampleBack(state, pl, s - 0.25, back);
      const b = this.sampleBack(state, pl, s + 0.25, back);
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
    if (density > 0) this.particles.emitSmoke(sx, sy - 3, density, dt);
  }


  // -------------------------------------------------------------- selection & ghost

  private buildingCentre(b: Building): Vec2 {
    const def = BUILDINGS[b.typeId];
    return { x: (b.pos.x + def.size.w / 2) * TILE, y: (b.pos.y + def.size.h / 2) * TILE };
  }

  private drawSelection(ctx: CanvasRenderingContext2D, state: GameState, alpha: number, nowMs: number, z: number): void {
    const sel = this.selection;
    if (!sel) return;
    const px = 1 / z;
    if (sel.routeId !== undefined || sel.draftRoute) {
      const route = sel.draftRoute ?? state.routes[sel.routeId!];
      if (route) {
        const pts: Vec2[] = [];
        for (const s of route.stops) {
          const b = state.buildings[s.buildingId];
          if (b) pts.push(this.buildingCentre(b));
        }
        if (pts.length >= 2) {
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.strokeStyle = 'rgba(20,14,6,0.7)';
          ctx.lineWidth = 7 * px;
          ctx.stroke();
          ctx.strokeStyle = route.color;
          ctx.lineWidth = 4 * px;
          ctx.setLineDash([12 * px, 6 * px]);
          ctx.lineDashOffset = -nowMs / 40 * px;
          ctx.stroke();
          // return leg
          ctx.beginPath();
          ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.lineTo(pts[0].x, pts[0].y);
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([4 * px, 8 * px]);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
        route.stops.forEach((s, i) => {
          const b = state.buildings[s.buildingId];
          if (!b) return;
          const c = this.buildingCentre(b);
          ctx.beginPath();
          ctx.arc(c.x, c.y, 10 * px, 0, Math.PI * 2);
          ctx.fillStyle = route.color;
          ctx.fill();
          ctx.lineWidth = 2 * px;
          ctx.strokeStyle = '#f5ecd2';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${12 * px}px Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), c.x, c.y + px);
        });
      }
    }
    if (sel.buildingId !== undefined) {
      const b = state.buildings[sel.buildingId];
      if (b) {
        const def = BUILDINGS[b.typeId];
        const pulse = 0.65 + 0.35 * Math.sin(nowMs / 250);
        ctx.strokeStyle = 'rgba(20,14,6,0.6)';
        ctx.lineWidth = 4 * px;
        ctx.strokeRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE, def.size.h * TILE);
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = BRASS;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE, def.size.h * TILE);
        ctx.globalAlpha = 1;
        // access tiles hint
        ctx.fillStyle = 'rgba(201,161,58,0.25)';
        for (const a of accessTiles(state, b)) ctx.fillRect(a.x * TILE + 2, a.y * TILE + 2, TILE - 4, TILE - 4);
        if (b.typeId === STATION_TYPE) for (const a of stationAccess(state, b)) ctx.fillRect(a.x * TILE + 2, a.y * TILE + 2, TILE - 4, TILE - 4);
      }
    }
    if (sel.vehicleId !== undefined) {
      const v = state.vehicles[sel.vehicleId];
      if (v) {
        const p = this.vehiclePose(v, alpha);
        const rr = (14 + Math.sin(nowMs / 200) * 1.5) * px * Math.max(1, z * 0.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20,14,6,0.6)';
        ctx.lineWidth = 4 * px;
        ctx.stroke();
        ctx.strokeStyle = BRASS;
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
    }
  }

  private ghostBounds(): { x: number; y: number; w: number; h: number } | null {
    const g = this.ghost;
    if (!g) return null;
    if (g.kind === 'building') {
      const def = BUILDINGS[g.typeId];
      if (!def) return null;
      return { x: g.pos.x * TILE, y: g.pos.y * TILE, w: def.size.w * TILE, h: def.size.h * TILE };
    }
    if (g.tiles.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of g.tiles) {
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x);
      y1 = Math.max(y1, t.y);
    }
    return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
  }

  private drawGhost(ctx: CanvasRenderingContext2D, z: number): void {
    const g = this.ghost;
    if (!g) return;
    const fill = g.valid ? 'rgba(80,200,90,0.35)' : 'rgba(220,60,50,0.38)';
    const line = g.valid ? 'rgba(120,240,130,0.95)' : 'rgba(255,90,80,0.95)';
    ctx.lineWidth = 2 / z;
    if (g.kind === 'building') {
      const def = BUILDINGS[g.typeId];
      if (!def) return;
      const x = g.pos.x * TILE;
      const y = g.pos.y * TILE;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(getBuildingSprite(g.typeId, 'player'), x, y - HEADROOM);
      ctx.globalAlpha = 1;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, def.size.w * TILE, def.size.h * TILE);
      ctx.strokeStyle = line;
      ctx.strokeRect(x, y, def.size.w * TILE, def.size.h * TILE);
    } else {
      ctx.fillStyle = fill;
      ctx.strokeStyle = line;
      for (const t of g.tiles) {
        ctx.fillRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
        ctx.strokeRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }

  /** Label box in screen space so text stays crisp at any zoom. */
  private drawGhostLabel(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const g = this.ghost;
    const b = this.ghostBounds();
    if (!g || !b || !g.label) return;
    const sx = (b.x + b.w / 2 - cam.x) * cam.zoom;
    const sy = (b.y - cam.y) * cam.zoom - (g.kind === 'building' ? HEADROOM * cam.zoom : 0) - 10;
    ctx.save();
    ctx.font = 'bold 13px Georgia, "Times New Roman", serif';
    const tw = ctx.measureText(g.label).width;
    const w = tw + 16;
    const h = 22;
    const x = Math.round(Math.min(Math.max(4, sx - w / 2), cam.viewW - w - 4));
    const y = Math.round(Math.max(4, sy - h));
    ctx.fillStyle = 'rgba(26,18,8,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = g.valid ? BRASS : '#d9534f';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = g.valid ? '#f5ecd2' : '#ffb3ab';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(g.label, x + 8, y + h / 2 + 1);
    ctx.restore();
  }

  // -------------------------------------------------------------- night

  private drawNightLights(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    r: { x0: number; y0: number; x1: number; y1: number },
    buildings: Building[],
    state: GameState,
    alpha: number,
    k: number,
  ): void {
    const z = cam.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    const toSX = (wx: number): number => (wx - cam.x) * z;
    const toSY = (wy: number): number => (wy - cam.y) * z;
    const style = houseStyle(state.date.year);
    const lamp = getLampGlow();

    const cx0 = Math.floor(Math.max(0, r.x0 - 1) / CHUNK);
    const cy0 = Math.floor(Math.max(0, r.y0 - 1) / CHUNK);
    const cx1 = Math.floor(Math.min(state.map.width - 1, r.x1 + 1) / CHUNK);
    const cy1 = Math.floor(Math.min(state.map.height - 1, r.y1 + 1) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunks.get(cy * this.chunkCols + cx);
        const m = c?.meta;
        if (!m || m.empty) continue;
        // lit house windows
        ctx.globalAlpha = k * 0.9;
        const hs = m.houses;
        for (let i = 0; i < hs.length; i += 4) {
          if (!hs[i + 3]) continue;
          const x = hs[i];
          const y = hs[i + 1];
          if (x < r.x0 - 1 || x > r.x1 + 1 || y < r.y0 - 1 || y > r.y1 + 1) continue;
          // a building directly south is drawn over this house, so its windows must not glow through
          if (y + 1 < state.map.height && state.map.tiles[(y + 1) * state.map.width + x].buildingId !== null) continue;
          const glow = getHouseGlow(style, hs[i + 2], state.date.year);
          ctx.drawImage(glow as CanvasImageSource, toSX(x * TILE - 6), toSY(y * TILE - 6), (TILE + 12) * z, (TILE + 12) * z);
        }
        // street lamps
        ctx.globalAlpha = k;
        const ls = m.lamps;
        const R = 22 * z;
        for (let i = 0; i < ls.length; i += 2) {
          const sx = toSX(ls[i]);
          const sy = toSY(ls[i + 1]);
          if (sx < -R || sy < -R || sx > cam.viewW + R || sy > cam.viewH + R) continue;
          ctx.drawImage(lamp as CanvasImageSource, sx - R, sy - R, R * 2, R * 2);
        }
      }
    }

    // factory windows
    ctx.globalAlpha = k;
    for (const b of buildings) {
      const glow = getWindowGlow(b.typeId);
      if (!glow) continue;
      const working = b.status === 'ok' || b.status === 'no_input' || b.status === 'output_full';
      ctx.globalAlpha = k * (working ? 1 : 0.35);
      const gx = b.pos.x * TILE + glow.ox;
      const gy = b.pos.y * TILE - HEADROOM + glow.oy;
      ctx.drawImage(glow.surf as CanvasImageSource, toSX(gx), toSY(gy), glow.surf.width * z, glow.surf.height * z);
    }

    // truck headlights
    ctx.globalAlpha = k * 0.8;
    const HR = 9 * z;
    for (const id in state.vehicles) {
      const v = state.vehicles[id];
      if (v.pos.x < r.x0 - 1 || v.pos.x > r.x1 + 1 || v.pos.y < r.y0 - 1 || v.pos.y > r.y1 + 1) continue;
      const p = this.vehiclePose(v, alpha);
      const f = v.kind === 'train' ? 14 : 11;
      const fx = p.dir === 'E' ? f : p.dir === 'W' ? -f : 0;
      const fy = p.dir === 'S' ? f : p.dir === 'N' ? -f : 0;
      ctx.drawImage(lamp as CanvasImageSource, toSX(p.x + fx) - HR, toSY(p.y + fy) - HR, HR * 2, HR * 2);
    }
    ctx.restore();
  }
}
