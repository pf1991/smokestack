/**
 * Procedural sprite painter. All art is drawn with Canvas 2D primitives.
 *
 * Viewpoint: top-down with a slight 3/4 tilt. Each building shows its roof plus a
 * visible south wall strip, and casts a soft drop shadow to the south-east.
 *
 * Building sprite layout: canvas = (size.w*TILE) x (size.h*TILE + HEADROOM).
 * The top HEADROOM (16) px are free space for chimneys / derricks, so the tile
 * footprint starts at y = 16 in the sprite. Within the footprint the body box
 * occupies x 1..W-4, y 16..H-4; the last 4 px right/bottom hold the shadow, and
 * the bottom WALL (7) px of the body is the south wall strip.
 *
 * Nothing here touches `document` at import time; canvases are created lazily.
 */
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { GOODS } from '../data/goods';
import type { OwnerId, Vec2 } from '../sim/types';
import { TILE } from './constants';

export const HEADROOM = 16;
const WALL = 7;
const SHADOW = 4;

export const OWNER_COLOR: Record<OwnerId, string> = { player: '#2f6fb5', rival: '#b5302f' };

type Ctx = CanvasRenderingContext2D;
type Dir = 'N' | 'E' | 'S' | 'W';
export type HouseStyle = 'cottage' | 'brick' | 'deco' | 'modern';

// ---------------------------------------------------------------- pure helpers

export function spriteKey(typeId: string, ownerId: OwnerId, variant: string | number = ''): string {
  return `${typeId}|${ownerId}|${variant}`;
}

export function houseStyle(year: number): HouseStyle {
  if (year < 1920) return 'cottage';
  if (year < 1945) return 'brick';
  if (year < 1970) return 'deco';
  return 'modern';
}

function dims(def: BuildingDef): { W: number; H: number } {
  return { W: def.size.w * TILE, H: def.size.h * TILE + HEADROOM };
}

/** Chimney tops, in sprite coordinates (y inside the headroom). Smoke emits here. */
export function chimneyOffsets(typeId: string): Vec2[] {
  const def = BUILDINGS[typeId];
  if (!def) return [];
  const { W } = dims(def);
  if (typeId === 'mine') return [{ x: Math.round(W * 0.78), y: 8 }];
  if (typeId === 'oil_well') return [{ x: Math.round(W / 2), y: 3 }];
  if (def.category !== 'factory') return [];
  const table: Record<string, [number, number][]> = {
    car_plant: [[0.2, 4], [0.5, 2], [0.8, 4]],
    steel_mill: [[0.2, 2], [0.45, 5]],
    refinery: [[0.15, 3], [0.85, 6]],
    textile_mill: [[0.15, 7], [0.3, 4], [0.45, 7]],
    bakery: [[0.25, 10]],
    glassworks: [[0.2, 6]],
    sawmill: [[0.2, 6]],
    flour_mill: [[0.2, 5], [0.4, 9]],
    toolworks: [[0.2, 4], [0.38, 7]],
    furniture_factory: [[0.2, 7], [0.4, 5]],
    clothing_factory: [[0.2, 6]],
    creamery: [[0.25, 7]],
    juice_plant: [[0.2, 8]],
    toy_factory: [[0.25, 8]],
    electronics_plant: [[0.15, 9]],
  };
  const t = table[typeId] ?? [[0.25, 6]];
  return t.map(([f, y]) => ({ x: Math.round(W * f), y }));
}

/** Rects (sprite coords) where lit windows are drawn at night. */
export function windowRects(typeId: string): { x: number; y: number; w: number; h: number }[] {
  const def = BUILDINGS[typeId];
  if (!def) return [];
  if (['farm', 'sand_pit', 'oil_well', 'lumber_camp', 'warehouse'].includes(typeId)) return [];
  if (typeId === 'dairy_farm') {
    return [10, 16, 38, 44].map(x => ({ x, y: HEADROOM + 17, w: 4, h: 3 }));
  }
  if (typeId === 'mine') return [{ x: 43, y: HEADROOM + 15, w: 4, h: 3 }];
  const { W, H } = dims(def);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const y = H - SHADOW - WALL + 2;
  const step = typeId === 'car_plant' ? 8 : 10;
  for (let x = 5; x + 4 <= W - SHADOW - 3; x += step) out.push({ x, y, w: 4, h: 3 });
  return out;
}

function hash(n: number): number {
  let h = (n | 0) * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------- tiny paint kit

function rect(g: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}
function circle(g: Ctx, x: number, y: number, r: number, c: string): void {
  g.fillStyle = c;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
function poly(g: Ctx, pts: number[][], c: string): void {
  g.fillStyle = c;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * (amt < 0 ? v : 255 - v))));
  const r = f((n >> 16) & 255), gg = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${gg},${b})`;
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
function softShadow(g: Ctx, x: number, y: number, w: number, h: number): void {
  rect(g, x + 4, y + 4, w, h, 'rgba(0,0,0,0.14)');
  rect(g, x + 3, y + 3, w, h, 'rgba(0,0,0,0.14)');
  rect(g, x + 2, y + 2, w, h, 'rgba(0,0,0,0.12)');
}

interface Box { x: number; y: number; w: number; h: number; roofH: number }
function bodyBox(W: number, H: number): Box {
  const x = 1, y = HEADROOM, w = W - SHADOW - 1, h = H - HEADROOM - SHADOW;
  return { x, y, w, h, roofH: h - WALL };
}
/** Draws shadow, roof base and south wall strip; returns the box. */
function building(g: Ctx, W: number, H: number, roof: string, wall: string): Box {
  const b = bodyBox(W, H);
  softShadow(g, b.x, b.y, b.w, b.h);
  rect(g, b.x, b.y, b.w, b.roofH, roof);
  rect(g, b.x, b.y + b.roofH, b.w, WALL, wall);
  rect(g, b.x, b.y + b.roofH, b.w, 1, shade(wall, -0.35));
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 1;
  g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  return b;
}
function brickTexture(g: Ctx, b: Box, seed: number): void {
  const y0 = b.y + b.roofH;
  for (let x = b.x + 1; x < b.x + b.w - 1; x += 4) {
    for (let r = 0; r < WALL; r += 2) {
      if (hash(seed + x * 7 + r) > 0.5) rect(g, x + (r % 4 ? 2 : 0), y0 + 1 + r, 2, 1, 'rgba(0,0,0,0.18)');
    }
  }
}
function windows(g: Ctx, typeId: string, c = '#2b3a4a'): void {
  for (const r of windowRects(typeId)) rect(g, r.x, r.y, r.w, r.h, c);
}
function pennant(g: Ctx, W: number, owner: OwnerId): void {
  const x = W - 9, y = HEADROOM;
  rect(g, x, y - 9, 1, 11, '#222');
  poly(g, [[x + 1, y - 9], [x + 8, y - 6.5], [x + 1, y - 4]], OWNER_COLOR[owner]);
}
function sawtooth(g: Ctx, b: Box, tint: string, teeth: number): void {
  const th = b.roofH / teeth;
  for (let i = 0; i < teeth; i++) {
    const y = b.y + i * th;
    rect(g, b.x + 1, y, b.w - 2, th, tint);
    rect(g, b.x + 1, y, b.w - 2, th * 0.4, shade(tint, 0.25)); // sloped light face
    rect(g, b.x + 1, y + th * 0.4, b.w - 2, 1, '#9fd4e0'); // skylight glass
    rect(g, b.x + 1, y + th - 1, b.w - 2, 1, 'rgba(0,0,0,0.3)');
  }
}
function stack(g: Ctx, x: number, top: number, base: number, tint: string, w = 6): void {
  rect(g, x - w / 2 + 2, top + 2, w, base - top, 'rgba(0,0,0,0.18)');
  rect(g, x - w / 2, top, w, base - top, '#8c4a38');
  rect(g, x - w / 2, top, w, 2, '#3a2a25');
  rect(g, x - w / 2, top + 4, w, 2, tint);
  rect(g, x - w / 2, top + 9, w, 1, tint);
  rect(g, x - w / 2 + w - 2, top, 2, base - top, 'rgba(0,0,0,0.2)');
}
function stacks(g: Ctx, typeId: string, tint: string, base: number): void {
  const w = typeId === 'textile_mill' ? 3 : 6;
  for (const c of chimneyOffsets(typeId)) stack(g, c.x, c.y, base, tint, w);
}

// ---------------------------------------------------------------- building painters

function paintLumber(g: Ctx, _def: BuildingDef, W: number, H: number): void {
  rect(g, 0, HEADROOM, W - SHADOW, H - HEADROOM - SHADOW, '#6f8a45'); // trampled clearing
  rect(g, 2, HEADROOM + 2, W - 8, H - HEADROOM - 8, '#8a7048');
  softShadow(g, 4, HEADROOM + 4, 24, 14);
  // saw shed
  rect(g, 4, HEADROOM + 4, 24, 12, '#7a4f2a');
  rect(g, 4, HEADROOM + 16, 24, 6, '#5b3a1e');
  for (let x = 6; x < 28; x += 4) rect(g, x, HEADROOM + 17, 1, 5, 'rgba(0,0,0,0.3)');
  rect(g, 4, HEADROOM + 10, 24, 1, 'rgba(0,0,0,0.3)');
  // log piles
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const x = 8 + i * 6 + row * 3, y = H - 22 + row * -4 + 20;
      circle(g, x, y - row * 4 + 2, 3, '#a8763f');
      circle(g, x, y - row * 4 + 2, 1.3, '#d9b377');
    }
  }
  // standing felled logs
  for (let i = 0; i < 3; i++) rect(g, 36 + i, HEADROOM + 6 + i * 5, 18, 3, i % 2 ? '#8b5a2b' : '#6b4423');
}

function paintFarm(g: Ctx, _def: BuildingDef, W: number, H: number, variant: string): void {
  const pal: Record<string, [string, string, string]> = {
    grain: ['#d8bd4e', '#b89a2e', '#e9d77a'],
    cotton: ['#e9e6dc', '#7f9a55', '#ffffff'],
    fruit: ['#5f8f3a', '#437228', '#d9463b'],
  };
  const [a, b, dot] = pal[variant] ?? pal.grain;
  const fx = 0, fy = HEADROOM, fw = W - SHADOW, fh = H - HEADROOM - SHADOW;
  rect(g, fx, fy, fw, fh, '#7a5a38');
  for (let i = 0; i < fh - 2; i += 4) {
    rect(g, fx + 1, fy + 1 + i, fw - 2, 3, i % 8 ? a : b);
    if (variant === 'fruit') for (let x = 5; x < fw - 4; x += 7) circle(g, fx + x, fy + 2 + i, 1.6, hash(x + i) > 0.5 ? dot : '#3f6b25');
    if (variant === 'cotton') for (let x = 4; x < fw - 3; x += 5) circle(g, fx + x, fy + 2 + i, 1.3, dot);
  }
  // farmhouse in the SE... small, owner-neutral
  softShadow(g, fx + 3, fy + 3, 16, 12);
  rect(g, fx + 3, fy + 3, 16, 8, '#a8442f');
  rect(g, fx + 3, fy + 11, 16, 4, '#e8dcc0');
  rect(g, fx + 5, fy + 12, 3, 2, '#2b3a4a');
  rect(g, fx + 3, fy + 3, 16, 1, '#d56a50');
  // silo
  circle(g, fx + 25, fy + 8, 4, '#b8bcc4');
  circle(g, fx + 24, fy + 7, 1.5, '#e4e7ec');
}

function paintDairy(g: Ctx, _def: BuildingDef, W: number, H: number): void {
  rect(g, 0, HEADROOM, W - SHADOW, H - HEADROOM - SHADOW, '#8ec36a');
  for (let i = 0; i < 12; i++) rect(g, 2 + hash(i) * (W - 10), HEADROOM + 24 + hash(i + 40) * 40, 2, 1, '#6fa34c');
  // fenced paddock
  g.strokeStyle = '#8b6b43';
  g.strokeRect(4.5, HEADROOM + 26.5, W - 16, H - HEADROOM - 36);
  // barn
  softShadow(g, 6, HEADROOM + 3, 44, 18);
  rect(g, 6, HEADROOM + 3, 44, 12, '#b0392b');
  poly(g, [[6, HEADROOM + 3], [28, HEADROOM - 1], [50, HEADROOM + 3]], '#7d2a20');
  rect(g, 6, HEADROOM + 15, 44, 6, '#8a2a20');
  rect(g, 24, HEADROOM + 15, 8, 6, '#f1e6d0'); // door
  g.strokeStyle = '#f1e6d0';
  g.strokeRect(24.5, HEADROOM + 15.5, 7, 5);
  circle(g, W - 14, HEADROOM + 8, 4, '#c3c7cf'); // silo
  // cows
  for (let i = 0; i < 6; i++) {
    const cx = 12 + (i % 3) * 20 + hash(i) * 6, cy = HEADROOM + 34 + Math.floor(i / 3) * 16;
    rect(g, cx, cy, 6, 4, '#f4f4f0');
    rect(g, cx + 1, cy + 1, 2, 2, '#2a2a2a');
    rect(g, cx + 5, cy, 2, 2, '#e0b8a0');
  }
}

function paintMine(g: Ctx, def: BuildingDef, W: number, H: number): void {
  rect(g, 0, HEADROOM, W - SHADOW, H - HEADROOM - SHADOW, '#7b746a');
  for (let i = 0; i < 14; i++) circle(g, 3 + hash(i) * (W - 10), HEADROOM + 4 + hash(i + 9) * (H - HEADROOM - 12), 1.4, i % 2 ? '#4a4540' : '#a09a90');
  // headframe: A-frame with winding wheel
  softShadow(g, 14, HEADROOM + 2, 20, 18);
  g.strokeStyle = '#4a3322';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(14, HEADROOM + 22); g.lineTo(24, 4); g.lineTo(34, HEADROOM + 22);
  g.moveTo(18, HEADROOM + 14); g.lineTo(30, HEADROOM + 14);
  g.stroke();
  g.lineWidth = 1;
  circle(g, 24, 7, 5, '#2d2d30');
  circle(g, 24, 7, 3.5, '#8b8f96');
  circle(g, 24, 7, 1, '#2d2d30');
  // engine house + chimney
  rect(g, 40, HEADROOM + 4, 18, 9, '#5d4a3a');
  rect(g, 40, HEADROOM + 13, 18, 6, '#3f3126');
  rect(g, 43, HEADROOM + 15, 4, 3, '#2b3a4a');
  stack(g, chimneyOffsets('mine')[0].x, 8, HEADROOM + 6, def.color);
  // ore cart on rails
  rect(g, 4, H - 16, W - 12, 1, '#3a3a3a');
  rect(g, 4, H - 12, W - 12, 1, '#3a3a3a');
  rect(g, 10, H - 18, 12, 8, '#6b3f2a');
  rect(g, 11, H - 20, 10, 3, '#222');
  circle(g, 12, H - 10, 2, '#111'); circle(g, 20, H - 10, 2, '#111');
}

function paintSandPit(g: Ctx, _def: BuildingDef, W: number, H: number): void {
  const h = H - HEADROOM - SHADOW;
  rect(g, 0, HEADROOM, W - SHADOW, h, '#e4cf94');
  const cols = ['#d8bf85', '#c7a96c', '#b3935a', '#9c7c46'];
  for (let i = 0; i < 4; i++) {
    const inset = 3 + i * 5;
    rect(g, inset, HEADROOM + inset, W - SHADOW - inset * 2, h - inset * 2, cols[i]);
    rect(g, inset, HEADROOM + inset, W - SHADOW - inset * 2, 1, 'rgba(255,255,255,0.35)');
    rect(g, inset, HEADROOM + h - inset - 1, W - SHADOW - inset * 2, 1, 'rgba(0,0,0,0.25)');
  }
  rect(g, W - 22, H - 18, 10, 6, '#c9a35a'); // sand heap + truck bed
  poly(g, [[W - 22, H - 12], [W - 17, H - 20], [W - 12, H - 12]], '#e9d6a0');
  rect(g, 8, HEADROOM + 4, 8, 4, '#a8442f');
}

function paintOil(g: Ctx, _def: BuildingDef, W: number, H: number): void {
  rect(g, 0, HEADROOM, W - SHADOW, H - HEADROOM - SHADOW, '#7d6e55');
  circle(g, 12, H - 14, 7, '#26231f'); // oil pool
  circle(g, 10, H - 16, 2, '#4a4540');
  const cx = Math.round(W / 2), base = H - 14;
  softShadow(g, cx - 10, base - 4, 20, 4);
  g.strokeStyle = '#2f2a24';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx - 10, base); g.lineTo(cx - 1, 6);
  g.moveTo(cx + 10, base); g.lineTo(cx + 1, 6);
  for (let y = 12; y < base; y += 8) {
    const t = (y - 6) / (base - 6), hw = 1 + 9 * t;
    g.moveTo(cx - hw, y); g.lineTo(cx + hw, y);
    g.moveTo(cx - hw, y); g.lineTo(cx + hw * 0.4, y + 8);
  }
  g.stroke();
  g.lineWidth = 1;
  rect(g, cx - 2, 3, 4, 3, '#2f2a24');
  // pumpjack beam
  rect(g, W - 24, base - 8, 14, 3, '#3a3a40');
  circle(g, W - 10, base - 6, 3, '#3a3a40');
  rect(g, W - 17, base - 6, 3, 8, '#56565e');
  // tank
  rect(g, 4, HEADROOM + 4, 10, 8, '#5b6670');
  rect(g, 4, HEADROOM + 4, 10, 2, '#8c97a0');
}

function paintFactory(g: Ctx, def: BuildingDef, W: number, H: number, owner: OwnerId): void {
  const id = def.id;
  const brick = id === 'sawmill' ? '#9b6e3f' : id === 'flour_mill' ? '#c9b99a' : id === 'creamery' ? '#e8dcc0' : '#a2513b';
  let roofTint = mix(def.color, '#6e7b84', 0.6);
  if (id === 'creamery') roofTint = '#efe6cf';
  if (id === 'toy_factory') roofTint = '#e88ab0';
  const b = building(g, W, H, roofTint, brick);
  brickTexture(g, b, id.length * 31);
  rect(g, b.x, b.y + b.roofH + 1, b.w, 1, def.color); // identity band along the wall
  const teeth = id === 'textile_mill' ? 6 : def.size.h >= 4 ? 6 : def.size.h === 3 ? 4 : 3;
  if (id !== 'refinery' && id !== 'bakery') sawtooth(g, b, roofTint, teeth);
  windows(g, id, '#2b3a4a');
  rect(g, b.x + b.w - 14, b.y + b.roofH + 1, 8, WALL - 1, '#3b2c22'); // loading door
  const ry = b.y + b.roofH; // roof/wall seam

  switch (id) {
    case 'sawmill': {
      const cx = Math.round(W * 0.7), cy = b.y + 16;
      circle(g, cx, cy, 10, '#d5dade');
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        poly(g, [[cx + Math.cos(a - 0.14) * 9, cy + Math.sin(a - 0.14) * 9], [cx + Math.cos(a) * 13, cy + Math.sin(a) * 13], [cx + Math.cos(a + 0.14) * 9, cy + Math.sin(a + 0.14) * 9]], '#d5dade');
      }
      circle(g, cx, cy, 4, '#8a5a2f'); circle(g, cx, cy, 1.2, '#222');
      for (let i = 0; i < 3; i++) rect(g, 6, b.y + 4 + i * 4, 18, 3, '#c8a16e');
      break;
    }
    case 'steel_mill': {
      const fx = Math.round(W * 0.68);
      rect(g, fx - 8, 8, 20, 42, 'rgba(0,0,0,0.2)');
      rect(g, fx - 10, 8, 18, 40, '#3c3f46');
      rect(g, fx - 10, 8, 5, 40, '#5a5e66');
      rect(g, fx - 10, 20, 18, 2, '#222'); rect(g, fx - 10, 32, 18, 2, '#222');
      rect(g, fx - 8, 5, 14, 4, '#ff7a2a');
      rect(g, fx - 5, 3, 8, 3, '#ffd27a');
      break;
    }
    case 'refinery': {
      rect(g, b.x + 1, b.y + 1, b.w - 2, b.roofH - 1, '#9a9a92');
      const tanks: [number, number, number][] = [[24, b.y + 14, 12], [58, b.y + 14, 11], [40, b.y + 40, 10]];
      for (const [tx, ty, r] of tanks) {
        circle(g, tx + 2, ty + 2, r, 'rgba(0,0,0,0.25)');
        circle(g, tx, ty, r, '#d7d9d8');
        circle(g, tx - r * 0.3, ty - r * 0.3, r * 0.45, '#f4f5f4');
        g.strokeStyle = def.color; g.lineWidth = 2;
        g.beginPath(); g.arc(tx, ty, r - 1, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
      }
      g.strokeStyle = '#555'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(24, b.y + 26); g.lineTo(24, b.y + 52); g.lineTo(40, b.y + 52); g.moveTo(58, b.y + 25); g.lineTo(58, b.y + 40); g.lineTo(50, b.y + 40); g.stroke();
      g.lineWidth = 1;
      circle(g, chimneyOffsets(id)[1].x, 4, 2.5, '#ff9a3c');
      break;
    }
    case 'car_plant': {
      for (let x = 8; x < b.w - 4; x += 12) rect(g, x, b.y + 2, 1, ry - b.y - 20, 'rgba(0,0,0,0.2)');
      rect(g, 8, ry - 24, 40, 8, def.color);
      rect(g, 10, ry - 22, 36, 4, '#f4e6d0');
      // forecourt strip with finished cars
      rect(g, b.x + 2, ry - 13, b.w - 4, 11, '#5d6166');
      rect(g, b.x + 2, ry - 8, b.w - 4, 1, '#d9d36a');
      ['#b8322c', '#2f6fb5', '#e6e0d0'].forEach((c, i) => {
        const cx = b.x + 8 + i * 22;
        rect(g, cx, ry - 11, 14, 6, 'rgba(0,0,0,0.3)');
        rect(g, cx, ry - 12, 14, 6, c);
        rect(g, cx + 4, ry - 11, 6, 4, 'rgba(255,255,255,0.45)');
      });
      break;
    }
    case 'textile_mill':
      for (let x = 8; x < b.w - 6; x += 8) rect(g, x, ry - 10, 4, 6, '#d9c7e6');
      break;
    case 'glassworks': {
      const kx = Math.round(W * 0.68), ky = b.y + 6;
      poly(g, [[kx - 12, ky + 30], [kx - 5, ky], [kx + 5, ky], [kx + 12, ky + 30]], '#7a5a48');
      poly(g, [[kx - 12, ky + 30], [kx - 5, ky], [kx - 2, ky], [kx - 6, ky + 30]], '#9a7a64');
      rect(g, kx - 6, ky - 1, 12, 3, '#3a2c25');
      circle(g, kx, ky + 22, 5, '#ff8a2a'); circle(g, kx, ky + 22, 3, '#ffe08a');
      break;
    }
    case 'creamery':
      circle(g, 40, b.y + 14, 8, 'rgba(0,0,0,0.2)');
      circle(g, 38, b.y + 12, 8, '#f4f6f8'); circle(g, 35, b.y + 9, 3, '#ffffff');
      g.strokeStyle = '#b8c0c8'; g.beginPath(); g.arc(38, b.y + 12, 7.5, 0, Math.PI * 2); g.stroke();
      rect(g, 6, b.y + 6, 14, 6, '#f2c94c');
      break;
    case 'juice_plant':
      for (let i = 0; i < 3; i++) {
        const vx = 12 + i * 15, vy = b.y + 22;
        circle(g, vx + 1, vy + 2, 6, 'rgba(0,0,0,0.25)');
        circle(g, vx, vy, 6, '#f39a2e'); circle(g, vx - 2, vy - 2, 2.2, '#ffd08a');
        g.strokeStyle = '#a8591a'; g.beginPath(); g.arc(vx, vy, 5.5, 0, Math.PI * 2); g.stroke();
      }
      break;
    case 'toy_factory':
      rect(g, 10, b.y + 6, 7, 7, '#e74c3c'); rect(g, 19, b.y + 6, 7, 7, '#3498db'); rect(g, 14, b.y + 14, 7, 7, '#f1c40f');
      break;
    case 'bakery': {
      rect(g, b.x + 1, b.y + 1, b.w - 2, b.roofH - 1, '#a67a52');
      const dx = Math.round(W * 0.62), dy = b.y + 28;
      circle(g, dx + 2, dy + 2, 9, 'rgba(0,0,0,0.25)');
      circle(g, dx, dy, 8, '#8a5a3a'); circle(g, dx - 2, dy - 2, 3, '#b88458');
      circle(g, dx, dy + 5, 3.5, '#ff8a2a'); circle(g, dx, dy + 5, 2, '#ffd27a');
      rect(g, 8, b.y + 8, 14, 6, '#f1d9a8');
      break;
    }
    case 'toolworks': {
      rect(g, b.x + 3, b.y + 6, b.w - 6, 2, '#3a3f46');
      rect(g, b.x + 3, b.y + 24, b.w - 6, 2, '#3a3f46');
      rect(g, b.x + 3, b.y + 6, 2, 20, '#3a3f46'); rect(g, b.x + b.w - 5, b.y + 6, 2, 20, '#3a3f46');
      rect(g, 30, b.y + 14, 2, 8, '#222'); rect(g, 28, b.y + 22, 6, 2, '#e0a82e');
      poly(g, [[8, ry - 18], [24, ry - 18], [20, ry - 13], [18, ry - 10], [22, ry - 6], [8, ry - 6], [12, ry - 10], [12, ry - 13]], '#2b2f36');
      break;
    }
    case 'clothing_factory': {
      rect(g, b.x + 4, b.y + 12, b.w - 8, 1, '#3a3a3a');
      ['#d9463b', '#f2c94c', '#3f9a5f'].forEach((c, i) => {
        const sx = 12 + i * 16;
        poly(g, [[sx, b.y + 13], [sx + 10, b.y + 13], [sx + 12, b.y + 17], [sx + 9, b.y + 18], [sx + 9, b.y + 26], [sx + 1, b.y + 26], [sx + 1, b.y + 18], [sx - 2, b.y + 17]], c);
      });
      break;
    }
    case 'electronics_plant': {
      const mx = Math.round(W * 0.7);
      rect(g, mx, 1, 1, ry - 2, '#d5dade');
      for (let i = 0; i < 3; i++) rect(g, mx - 4 + i, 3 + i * 4, 9 - i * 2, 1, '#d5dade');
      circle(g, mx, 1, 1.5, '#ff4a4a');
      for (let i = 0; i < 3; i++) { rect(g, 10 + i * 14, b.y + 8, 11, 14, '#1f8f86'); rect(g, 11 + i * 14, b.y + 9, 9, 5, '#5fd0c6'); }
      break;
    }
    case 'furniture_factory': {
      rect(g, b.x + b.w - 26, b.y + 2, 24, 22, '#b89c68'); // yard notch
      rect(g, b.x + b.w - 26, b.y + 2, 24, 1, 'rgba(0,0,0,0.25)');
      for (let i = 0; i < 3; i++) rect(g, b.x + b.w - 24, b.y + 5 + i * 6, 20, 4, i % 2 ? '#c8a16e' : '#a8793d');
      break;
    }
    case 'flour_mill': {
      const mx = Math.round(W * 0.7), my = b.y + 18;
      rect(g, mx - 7, my - 7, 14, 14, '#e9dfc7');
      g.strokeStyle = '#6b4a2a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx - 14, my - 14); g.lineTo(mx + 14, my + 14); g.moveTo(mx + 14, my - 14); g.lineTo(mx - 14, my + 14); g.stroke();
      g.lineWidth = 1;
      break;
    }
    default:
      rect(g, 8, ry - 14, 12, 6, def.color);
  }
  stacks(g, id, def.color, b.y + 6);
  pennant(g, W, owner);
}

function paintStore(g: Ctx, def: BuildingDef, W: number, H: number, owner: OwnerId): void {
  const ownerC = OWNER_COLOR[owner];
  const b = building(g, W, H, shade(def.color, -0.2), '#e8dcc0');
  const yw = b.y + b.roofH; // seam; body bottom is yw + WALL
  // parapet
  rect(g, b.x, b.y, b.w, 3, shade(def.color, 0.15));
  rect(g, b.x, b.y, 3, b.roofH, shade(def.color, 0.15));
  rect(g, b.x + b.w - 3, b.y, 3, b.roofH, shade(def.color, 0.15));
  rect(g, b.x + 3, b.y + 3, b.w - 6, 1, 'rgba(0,0,0,0.25)');
  rect(g, b.x + 8, b.y + 8, 12, 8, 'rgba(0,0,0,0.2)'); // roof vent
  // owner-colour sign board with white bar
  rect(g, b.x + 4, yw - 21, b.w - 8, 9, ownerC);
  rect(g, b.x + 4, yw - 21, b.w - 8, 1, 'rgba(255,255,255,0.35)');
  rect(g, b.x + 10, yw - 18, b.w - 20, 3, '#ffffff');
  // scalloped awning, full width, 8 px deep
  const ay = yw - 11;
  for (let x = b.x, i = 0; x < b.x + b.w; x += 6, i++) {
    const cw = Math.min(6, b.x + b.w - x), col = i % 2 ? '#f6f1e6' : ownerC;
    rect(g, x, ay, cw, 6, col);
    circle(g, x + cw / 2, ay + 6, cw / 2, col);
  }
  rect(g, b.x, ay, b.w, 1, 'rgba(0,0,0,0.25)');
  // glazed shopfront, goods, door, pavement
  const fy = yw - 2, fh = 7;
  rect(g, b.x, fy, b.w, WALL + 2, '#cbbfa3');
  rect(g, b.x + 3, fy, b.w - 6, fh, '#3a5568');
  rect(g, b.x + 4, fy + 1, b.w - 8, fh - 2, '#a9dcee');
  rect(g, b.x + 4, fy + 1, b.w - 8, 1, '#e8f6fb');
  ['#d9463b', '#f2c94c', '#3f9a5f', '#8e5bb5'].forEach((c, i) => {
    const gx = b.x + 7 + i * 8 + (i >= 2 ? 10 : 0);
    rect(g, gx, fy + 3, 3, 3, c);
  });
  const dx = Math.round(b.x + b.w / 2) - 3;
  rect(g, dx, fy, 7, fh, '#5b3a1e'); rect(g, dx + 1, fy + 1, 5, 4, '#9fd4e8'); rect(g, dx + 5, fy + 4, 1, 1, '#f2c94c');
  rect(g, b.x, yw + WALL - 2, b.w, 2, '#d9d4c8');
  pennant(g, W, owner);
}

function paintWarehouse(g: Ctx, _def: BuildingDef, W: number, H: number, owner: OwnerId): void {
  const b = building(g, W, H, '#8a8f99', '#b8b2a2');
  for (let x = b.x + 3; x < b.x + b.w - 2; x += 4) rect(g, x, b.y + 1, 1, b.roofH - 2, 'rgba(0,0,0,0.18)'); // corrugated roof
  rect(g, b.x, b.y + b.roofH / 2, b.w, 1, 'rgba(255,255,255,0.25)');
  // two big doors
  const dw = 22, y = b.y + b.roofH;
  for (const dx of [b.x + 12, b.x + b.w - 12 - dw]) {
    rect(g, dx, y + 1, dw, WALL - 1, '#4a5a6a');
    rect(g, dx + dw / 2, y + 1, 1, WALL - 1, '#1d2630');
    rect(g, dx, y + 1, dw, 1, '#c7a13a');
  }
  pennant(g, W, owner);
}

function paintStation(g: Ctx, _def: BuildingDef, W: number, H: number, owner: OwnerId): void {
  const b = building(g, W, H, '#6a4a3a', '#c9bb9c');
  // platform with canopy
  rect(g, b.x + 2, b.y + b.roofH - 14, b.w - 4, 12, '#a49a88');
  rect(g, b.x + 2, b.y + 2, b.w - 4, b.roofH - 16, '#7a3d2c'); // main hall roof
  rect(g, b.x + 2, b.y + 2, b.w - 4, 2, '#a85a45');
  for (let x = b.x + 4; x < b.x + b.w - 4; x += 6) rect(g, x, b.y + b.roofH - 14, 3, 6, '#2f6f5f'); // canopy stripes
  for (let x = b.x + 4; x < b.x + b.w - 4; x += 6) rect(g, x + 3, b.y + b.roofH - 14, 3, 6, '#e6dfcb');
  rect(g, b.x + 4, b.y + b.roofH - 8, b.w - 8, 1, 'rgba(0,0,0,0.25)');
  windows(g, 'train_station', '#2b3a4a');
  // clock tower
  rect(g, 8, 6, 10, HEADROOM + 4, '#9a7a5c');
  poly(g, [[7, 7], [13, 1], [19, 7]], '#4a2f25');
  circle(g, 13, 12, 3, '#f5f0e0');
  rect(g, 13, 10, 1, 2, '#222'); rect(g, 13, 12, 2, 1, '#222');
  pennant(g, W, owner);
}

function paintBuilding(g: Ctx, def: BuildingDef, owner: OwnerId, variant: string): void {
  const { W, H } = dims(def);
  switch (def.id) {
    case 'lumber_camp': paintLumber(g, def, W, H); break;
    case 'farm': paintFarm(g, def, W, H, variant || 'grain'); break;
    case 'dairy_farm': paintDairy(g, def, W, H); break;
    case 'mine': paintMine(g, def, W, H); break;
    case 'sand_pit': paintSandPit(g, def, W, H); break;
    case 'oil_well': paintOil(g, def, W, H); break;
    case 'store': paintStore(g, def, W, H, owner); return;
    case 'warehouse': paintWarehouse(g, def, W, H, owner); return;
    case 'train_station': paintStation(g, def, W, H, owner); return;
    default:
      if (def.category === 'factory') { paintFactory(g, def, W, H, owner); return; }
      paintWarehouse(g, def, W, H, owner); return;
  }
  pennant(g, W, owner);
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Cached building sprite, W = size.w*TILE, H = size.h*TILE + 16 (footprint starts at y = 16).
 * `variant` only matters for farms: 'grain' | 'cotton' | 'fruit'.
 */
export function getBuildingSprite(typeId: string, ownerId: OwnerId, variant = ''): HTMLCanvasElement {
  const def = BUILDINGS[typeId];
  if (!def) throw new Error(`Unknown building: ${typeId}`);
  const v = def.id === 'farm' ? variant || 'grain' : '';
  const key = spriteKey(typeId, ownerId, v);
  let c = cache.get(key);
  if (c) return c;
  const { W, H } = dims(def);
  c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (g) paintBuilding(g, def, ownerId, v);
  cache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- houses

const ROOFS = ['#a8442f', '#6b4a3a', '#4f5d6b', '#7a6a2e'];
const WARM = '#ffd27a';
const DARK_WIN = '#34465a';

/** Draw a one-tile house with its top-left corner at (px, py). */
export function drawHouse(g: Ctx, px: number, py: number, variant: number, year: number, lit: boolean): void {
  const style = houseStyle(year);
  const v = Math.abs(Math.floor(variant));
  const win = lit ? WARM : DARK_WIN;
  g.save();
  g.translate(px, py);
  switch (style) {
    case 'cottage': {
      const roof = ROOFS[v % ROOFS.length], wide = v % 2 === 0;
      const x = wide ? 3 : 6, w = wide ? 22 : 16, y = 7, h = 16;
      softShadow(g, x, y, w, h);
      rect(g, x, y + h - 7, w, 7, '#e6dcc2');
      rect(g, x, y, w, h - 7, roof);
      if (wide) { rect(g, x, y + (h - 7) / 2, w, 1, shade(roof, -0.3)); rect(g, x, y, w, 2, shade(roof, 0.25)); }
      else { rect(g, x + w / 2, y, 1, h - 7, shade(roof, -0.3)); rect(g, x, y, w / 2, h - 7, shade(roof, 0.12)); }
      rect(g, x + 3, y + h - 5, 4, 3, win);
      rect(g, x + w - 7, y + h - 5, 4, 3, win);
      rect(g, x + w / 2 - 1, y + h - 6, 3, 6, '#5b3a1e');
      rect(g, x + w - 5, y - 2, 3, 4, '#7a4a3a');
      break;
    }
    case 'brick': {
      const x = 3, y = 4, w = 24, h = 24;
      softShadow(g, x, y, w, h);
      rect(g, x, y, w, 12, v % 2 ? '#4f5659' : '#5c4a44');
      rect(g, x, y + 12, w, 12, v % 2 ? '#b0563d' : '#9c4a35');
      for (let i = 0; i < 3; i++) rect(g, x + 2 + i * 8, y + 15, 5, 5, win);
      for (let i = 0; i < 3; i++) rect(g, x + 7 + i * 8, y + 2 + (v % 2), 1, 8, 'rgba(0,0,0,0.25)');
      rect(g, x + 3 + (v % 3) * 6, y - 3, 3, 5, '#7a3a2c');
      break;
    }
    case 'deco': {
      const x = 4, y = 3, w = 22, h = 25;
      softShadow(g, x, y, w, h);
      const wall = v % 2 ? '#e8dcc0' : '#dcd2c2';
      rect(g, x, y + 8, w, h - 8, wall);
      rect(g, x + 4, y + 3, w - 8, 6, shade(wall, -0.08));
      rect(g, x + 8, y, w - 16, 4, shade(wall, -0.15));
      rect(g, x, y + 8, w, 2, v % 2 ? '#2a9d8f' : '#c0852b');
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) rect(g, x + 2 + i * 5, y + 12 + r * 6, 3, 4, win);
      rect(g, x + 9, y + h - 4, 4, 4, '#3b2c22');
      break;
    }
    default: {
      const x = 5, y = 2, w = 20, h = 27;
      softShadow(g, x, y, w, h);
      rect(g, x, y, w, h, v % 2 ? '#7f93a6' : '#9aa8b5');
      rect(g, x, y, w, 3, '#d9dee2');
      for (let r = 0; r < 5; r++) for (let i = 0; i < 4; i++) rect(g, x + 2 + i * 4.5, y + 5 + r * 4.6, 3, 3, lit && hash(v * 31 + r * 5 + i) > 0.3 ? WARM : '#3f5870');
      rect(g, x + 8, y - 3, 1, 5, '#555');
      break;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- vehicles

const ANGLE: Record<Dir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

/** Truck centred on (px, py). Drawn facing east, then rotated. */
export function drawTruck(g: Ctx, px: number, py: number, dir: Dir, ownerId: OwnerId, cargoColor: string | null): void {
  g.save();
  g.translate(px, py);
  g.rotate(ANGLE[dir]);
  rect(g, -7, -3, 16, 9, 'rgba(0,0,0,0.22)'); // shadow
  rect(g, -9, -4, 11, 8, cargoColor ? shade(cargoColor, -0.2) : '#8d8a84'); // cargo box
  rect(g, -8, -3, 9, 6, cargoColor ?? '#b9b5ac');
  rect(g, 3, -4, 6, 8, OWNER_COLOR[ownerId]); // cab
  rect(g, 6, -3, 2, 6, '#bfe3f2'); // windscreen
  rect(g, 8, -3, 1, 1, '#fff6c0'); rect(g, 8, 2, 1, 1, '#fff6c0');
  g.restore();
}

/** Steam locomotive centred on (px, py), `wagons` cars trailing behind it. */
export function drawTrain(g: Ctx, px: number, py: number, dir: Dir, ownerId: OwnerId, wagons: number): void {
  g.save();
  g.translate(px, py);
  g.rotate(ANGLE[dir]);
  // wagons trail to the west in local space
  for (let i = 0; i < wagons; i++) {
    const x = -22 - i * 17;
    rect(g, x - 8, -3, 17, 9, 'rgba(0,0,0,0.2)');
    rect(g, x - 8, -4, 16, 8, hash(i * 7 + 1) > 0.5 ? '#7a4a2b' : '#5b6b4a');
    rect(g, x - 8, -4, 16, 1, 'rgba(255,255,255,0.2)');
    rect(g, x - 8, 0, 16, 1, 'rgba(0,0,0,0.25)');
    rect(g, x + 8, -1, 1, 2, '#222'); // coupler
  }
  rect(g, -10, -3, 24, 9, 'rgba(0,0,0,0.22)');
  rect(g, -10, -4, 22, 8, '#1f1f24'); // boiler
  rect(g, -10, -4, 8, 8, OWNER_COLOR[ownerId]); // cab
  rect(g, -9, -3, 6, 6, shade(OWNER_COLOR[ownerId], 0.2));
  rect(g, -2, -1, 12, 2, '#3a3a42');
  circle(g, 6, 0, 2.2, '#111'); // chimney seen from above
  circle(g, 6, 0, 1, '#555');
  rect(g, 10, -3, 3, 6, '#c9a13a'); // buffer beam / lamp
  g.restore();
}

// ---------------------------------------------------------------- icons

/** Emoji good icon centred in a `size` box at (px, py) (top-left); coloured dot backs it as fallback. */
export function drawGoodIcon(g: Ctx, goodId: string, px: number, py: number, size: number): void {
  const good = GOODS[goodId];
  const color = good?.color ?? '#999';
  circle(g, px + size / 2, py + size / 2, size * 0.32, color);
  if (!good?.icon) return;
  g.save();
  g.font = `${Math.round(size * 0.85)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(good.icon, px + size / 2, py + size / 2 + 1);
  g.restore();
}
