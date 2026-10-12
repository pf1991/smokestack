/**
 * Procedural sprite painter. All art is drawn with Canvas 2D primitives.
 *
 * Viewpoint: ¾ diorama. Each building is a little prism: its roof is raised BUILDING_HEIGHT px above
 * where a flat top-down sprite would put it, and the gap is filled by a south facade (brick, windows,
 * cornice). Sun shadows are cast by render/shadows.ts from the casters below; the soft south-east
 * drop shadow baked into the sprite stays as contact shading.
 *
 * Painters work in a "flat" layout: canvas (size.w*TILE) x (size.h*TILE + HR0) with the footprint
 * starting at y = HR0 (16) and chimneys / derricks in the rows above it. Within the footprint the body
 * box occupies x 1..W-4, y HR0..H-4; the last 4 px right/bottom hold the shadow and the bottom WALL
 * (7) px of the body is the south wall strip. The final sprite is (size.w*TILE) x (size.h*TILE +
 * HEADROOM), footprint at y = HEADROOM: box buildings are split at the top of their facade, the part
 * above is lifted by their height and the facade is grown to fill the gap; extractors paint their
 * raised sheds, barns and silos directly (see `raised`).
 *
 * Nothing here touches `document` at import time; canvases are created lazily.
 */
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import type { BuildingTypeId, OwnerId, Vec2 } from '../sim/types';
import { TILE } from './constants';
import { drawIcon } from './icons';
import type { ShadowCaster } from './shadows';

/** Extra height (px) a building rises above the flat top-down sprite: roofs and chimneys move up by it. */
export const BUILDING_HEIGHT: Record<BuildingTypeId, number> = {
  lumber_camp: 8,
  farm: 6,
  dairy_farm: 8,
  mine: 10,
  sand_pit: 6,
  oil_well: 10,
  sawmill: 14,
  flour_mill: 16,
  steel_mill: 22,
  textile_mill: 18,
  glassworks: 16,
  refinery: 14,
  furniture_factory: 16,
  bakery: 14,
  toolworks: 16,
  clothing_factory: 18,
  creamery: 14,
  juice_plant: 14,
  toy_factory: 14,
  car_plant: 20,
  electronics_plant: 22,
  store: 10,
  warehouse: 14,
  train_station: 12,
  company_housing: 10,
};

/** Chimney room above the footprint in the flat layout the painters draw in. */
const HR0 = 16;
/** Rows above the footprint in a final sprite: the flat chimney room plus the tallest building. */
export const HEADROOM = HR0 + Math.max(...Object.values(BUILDING_HEIGHT));
/** Final-sprite y of flat-layout y 0. */
const LIFT_ROOM = HEADROOM - HR0;
const WALL = 7;
const SHADOW = 4;

const OWNER_COLOR: Record<string, string> = { player: '#2f6fb5', rival: '#b5302f' };
export const REGIONAL_COLORS = ['#3f8f5a', '#8a5aa8', '#c07a2a'];

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function ownerColor(id: OwnerId): string {
  return OWNER_COLOR[id] ?? REGIONAL_COLORS[strHash(id) % REGIONAL_COLORS.length];
}

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

/** Flat painting layout: footprint at y = HR0. */
function dims(def: BuildingDef): { W: number; H: number } {
  return { W: def.size.w * TILE, H: def.size.h * TILE + HR0 };
}

/** Final sprite size: footprint + HEADROOM rows above it. */
export function spriteSize(typeId: string): { w: number; h: number } {
  const def = BUILDINGS[typeId];
  return { w: def.size.w * TILE, h: def.size.h * TILE + HEADROOM };
}

/** Box buildings (factories, shops, depots) are lifted whole above their facade; extractors paint raised parts themselves. */
function isBox(def: BuildingDef): boolean {
  return def.category !== 'extractor';
}

/** Flat-layout row where a box building's facade starts; everything above it is lifted. */
function splitRow(def: BuildingDef): number {
  const seam = dims(def).H - SHADOW - WALL - apronOf(def.id);
  // the shop sign, awning and glazed front are all facade
  return def.id === 'store' ? seam - 21 : seam;
}

/** Final-sprite gap a box building's facade grows into: [top, top + lift). */
function facadeGap(def: BuildingDef): { top: number; lift: number } {
  const lift = BUILDING_HEIGHT[def.id] ?? 0;
  return { top: LIFT_ROOM + splitRow(def) - lift, lift };
}

/** Chimney tops in the flat layout (y inside the HR0 rows). */
function flatChimneys(typeId: string): Vec2[] {
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

/** How far a type's chimneys rise with it: box roofs and the mine's engine house are lifted, the derrick is not. */
function chimneyLift(def: BuildingDef): number {
  if (isBox(def) || def.id === 'mine') return BUILDING_HEIGHT[def.id] ?? 0;
  return 0;
}

/** Chimney tops, in sprite coordinates (y inside the headroom). Smoke emits here. */
export function chimneyOffsets(typeId: string): Vec2[] {
  const def = BUILDINGS[typeId];
  if (!def) return [];
  const dy = LIFT_ROOM - chimneyLift(def);
  return flatChimneys(typeId).map((c) => ({ x: c.x, y: c.y + dy }));
}

type WinRect = { x: number; y: number; w: number; h: number };

/** Window rects in the flat layout: one row along the south wall strip. */
function flatWindowRects(typeId: string): WinRect[] {
  const def = BUILDINGS[typeId];
  if (!def) return [];
  if (['farm', 'sand_pit', 'oil_well', 'lumber_camp', 'warehouse'].includes(typeId)) return [];
  if (typeId === 'dairy_farm') {
    return [10, 16, 38, 44].map(x => ({ x, y: HR0 + 17, w: 4, h: 3 }));
  }
  if (typeId === 'mine') return [{ x: 43, y: HR0 + 15, w: 4, h: 3 }, { x: 51, y: HR0 + 15, w: 4, h: 3 }, { x: 43, y: HR0 + 9, w: 4, h: 3 }];
  const { W, H } = dims(def);
  const out: WinRect[] = [];
  const y = H - SHADOW - WALL + 2 - apronOf(typeId);
  const step = typeId === 'car_plant' ? 8 : 10;
  for (let x = 5; x + 4 <= W - SHADOW - 3; x += step) out.push({ x, y, w: 4, h: 3 });
  return out;
}

/** Upper-storey window rows (final sprite coords) on a box building's grown facade. */
function facadeWindowRects(typeId: string): WinRect[] {
  const def = BUILDINGS[typeId];
  if (!def || !isBox(def)) return [];
  const { top, lift } = facadeGap(def);
  const out: WinRect[] = [];
  if (typeId === 'store') {
    const { W } = dims(def);
    for (let y = top + 3; y + 3 <= top + lift - 2; y += 6) {
      for (let x = 6; x + 4 <= W - SHADOW - 5; x += 8) out.push({ x, y, w: 4, h: 3 });
    }
    return out;
  }
  const base = flatWindowRects(typeId);
  if (!base.length) return out;
  const y0 = base[0].y + LIFT_ROOM;
  for (let y = y0 - 6; y >= top + 3; y -= 6) for (const r of base) out.push({ x: r.x, y, w: r.w, h: r.h });
  return out;
}

/** Rects (sprite coords) where lit windows are drawn at night. */
export function windowRects(typeId: string): WinRect[] {
  return [...flatWindowRects(typeId).map((r) => ({ ...r, y: r.y + LIFT_ROOM })), ...facadeWindowRects(typeId)];
}

function hash(n: number): number {
  let h = (n | 0) * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------- tiny paint kit (shared with landmarks.ts)

export function rect(g: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}
export function circle(g: Ctx, x: number, y: number, r: number, c: string): void {
  g.fillStyle = c;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
export function poly(g: Ctx, pts: number[][], c: string): void {
  g.fillStyle = c;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}
export function shade(hex: string, amt: number): string {
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
export function softShadow(g: Ctx, x: number, y: number, w: number, h: number): void {
  rect(g, x + 4, y + 4, w, h, 'rgba(0,0,0,0.14)');
  rect(g, x + 3, y + 3, w, h, 'rgba(0,0,0,0.14)');
  rect(g, x + 2, y + 2, w, h, 'rgba(0,0,0,0.12)');
}

interface Box { x: number; y: number; w: number; h: number; roofH: number }
/** Ground rows (px) some box buildings keep in front of their body: the car plant's forecourt. */
const APRON: Record<string, number> = { car_plant: 14 };
function apronOf(typeId: string): number {
  return APRON[typeId] ?? 0;
}
function bodyBox(W: number, H: number, apron = 0): Box {
  const x = 1, y = HR0, w = W - SHADOW - 1, h = H - HR0 - SHADOW - apron;
  return { x, y, w, h, roofH: h - WALL };
}
/** Draws shadow, roof base and south wall strip; returns the box. */
function building(g: Ctx, W: number, H: number, roof: string, wall: string, apron = 0): Box {
  const b = bodyBox(W, H, apron);
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
  for (const r of flatWindowRects(typeId)) rect(g, r.x, r.y, r.w, r.h, c);
}
function pennant(g: Ctx, W: number, owner: OwnerId): void {
  const x = W - 9, y = HR0;
  rect(g, x, y - 9, 1, 11, '#222');
  poly(g, [[x + 1, y - 9], [x + 8, y - 6.5], [x + 1, y - 4]], ownerColor(owner));
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
  for (const c of flatChimneys(typeId)) stack(g, c.x, c.y, base, tint, w);
}

// ---------------------------------------------------------------- building painters

/**
 * A ¾ block drawn from its flat layout (roof at y, roofH deep, a wallH south wall) raised by `lift`:
 * the roof moves up and the wall grows to meet the ground. Returns the new roof top and wall seam.
 */
function raised(g: Ctx, x: number, y: number, w: number, roofH: number, wallH: number, lift: number, roof: string, wall: string): { top: number; seam: number } {
  const top = y - lift;
  const seam = y + roofH - lift;
  softShadow(g, x, top, w, roofH + wallH + lift);
  rect(g, x, top, w, roofH, roof);
  rect(g, x, top, w, 1, shade(roof, 0.25));
  rect(g, x, seam, w, wallH + lift, wall);
  rect(g, x, seam, w, 1, shade(wall, -0.4));
  rect(g, x + w - 2, seam + 1, 2, wallH + lift - 1, 'rgba(0,0,0,0.18)');
  return { top, seam };
}
/** Shadow caster (footprint-local px) for a `raised` block. */
function raisedCaster(x: number, y: number, w: number, roofH: number, wallH: number, lift: number): ShadowCaster {
  return { x, y: y - HR0 + wallH, w, d: roofH, z: wallH + lift };
}

/** A silo or tank `hgt` px tall standing on the ground circle (cx, gy) of radius r. */
function silo(g: Ctx, cx: number, gy: number, r: number, hgt: number, color: string): void {
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath();
  g.ellipse(cx + 2, gy + 1, r + 1, r * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  circle(g, cx, gy, r, shade(color, -0.2));
  rect(g, cx - r, gy - hgt, r * 2, hgt, color);
  rect(g, cx - r, gy - hgt, Math.max(1, r * 0.6), hgt, shade(color, 0.18));
  rect(g, cx + r * 0.45, gy - hgt, r * 0.55, hgt, shade(color, -0.18));
  circle(g, cx, gy - hgt, r, shade(color, 0.3));
  circle(g, cx - r * 0.3, gy - hgt - r * 0.3, r * 0.35, shade(color, 0.5));
}
function siloCaster(cx: number, gy: number, r: number, hgt: number): ShadowCaster {
  return { x: cx - r, y: gy - HR0 - r, w: r * 2, d: r * 2, z: hgt };
}

function paintLumber(g: Ctx, def: BuildingDef, W: number, H: number): void {
  const L = BUILDING_HEIGHT[def.id];
  rect(g, 0, HR0, W - SHADOW, H - HR0 - SHADOW, '#6f8a45'); // trampled clearing
  rect(g, 2, HR0 + 2, W - 8, H - HR0 - 8, '#8a7048');
  // log piles
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const x = 8 + i * 6 + row * 3, y = H - 22 + row * -4 + 20;
      circle(g, x, y - row * 4 + 2, 3, '#a8763f');
      circle(g, x, y - row * 4 + 2, 1.3, '#d9b377');
    }
  }
  // standing felled logs
  for (let i = 0; i < 3; i++) rect(g, 36 + i, HR0 + 6 + i * 5, 18, 3, i % 2 ? '#8b5a2b' : '#6b4423');
  // saw shed: plank walls, an open bay, ridged roof
  const b = raised(g, 4, HR0 + 4, 24, 12, 6, L, '#7a4f2a', '#5b3a1e');
  for (let x = 6; x < 28; x += 4) rect(g, x, b.seam + 1, 1, 5 + L, 'rgba(0,0,0,0.3)');
  rect(g, 4, b.top + 6, 24, 1, 'rgba(0,0,0,0.3)');
  rect(g, 11, HR0 + 22 - 9, 10, 9, '#2a1c10');
  rect(g, 12, HR0 + 22 - 3, 8, 2, '#c8a16e');
}

function paintFarm(g: Ctx, def: BuildingDef, W: number, H: number, variant: string): void {
  const L = BUILDING_HEIGHT[def.id];
  const pal: Record<string, [string, string, string]> = {
    grain: ['#d8bd4e', '#b89a2e', '#e9d77a'],
    cotton: ['#e9e6dc', '#7f9a55', '#ffffff'],
    fruit: ['#5f8f3a', '#437228', '#d9463b'],
  };
  const [a, b, dot] = pal[variant] ?? pal.grain;
  const fx = 0, fy = HR0, fw = W - SHADOW, fh = H - HR0 - SHADOW;
  rect(g, fx, fy, fw, fh, '#7a5a38');
  for (let i = 0; i < fh - 2; i += 4) {
    rect(g, fx + 1, fy + 1 + i, fw - 2, 3, i % 8 ? a : b);
    if (variant === 'fruit') for (let x = 5; x < fw - 4; x += 7) circle(g, fx + x, fy + 2 + i, 1.6, hash(x + i) > 0.5 ? dot : '#3f6b25');
    if (variant === 'cotton') for (let x = 4; x < fw - 3; x += 5) circle(g, fx + x, fy + 2 + i, 1.3, dot);
  }
  // farmyard, farmhouse and silo in the NW corner, owner-neutral
  rect(g, fx + 1, fy + 1, 32, 18, '#9a8456');
  const h = raised(g, fx + 3, fy + 3, 16, 8, 4, L, '#a8442f', '#e8dcc0');
  rect(g, fx + 3, h.top + 4, 16, 1, shade('#a8442f', -0.3));
  rect(g, fx + 5, h.seam + 2, 3, 2, '#2b3a4a');
  rect(g, fx + 13, h.seam + 2, 3, 2, '#2b3a4a');
  rect(g, fx + 5, fy + 12, 3, 2, '#2b3a4a');
  rect(g, fx + 10, fy + 11, 3, 4, '#5b3a1e');
  silo(g, fx + 26, fy + 12, 4, L + 10, '#b8bcc4');
}

function paintDairy(g: Ctx, def: BuildingDef, W: number, H: number): void {
  const L = BUILDING_HEIGHT[def.id];
  rect(g, 0, HR0, W - SHADOW, H - HR0 - SHADOW, '#8ec36a');
  for (let i = 0; i < 12; i++) rect(g, 2 + hash(i) * (W - 10), HR0 + 24 + hash(i + 40) * 40, 2, 1, '#6fa34c');
  // fenced paddock
  g.strokeStyle = '#8b6b43';
  g.strokeRect(4.5, HR0 + 26.5, W - 16, H - HR0 - 36);
  // cows
  for (let i = 0; i < 6; i++) {
    const cx = 12 + (i % 3) * 20 + hash(i) * 6, cy = HR0 + 34 + Math.floor(i / 3) * 16;
    rect(g, cx, cy, 6, 4, '#f4f4f0');
    rect(g, cx + 1, cy + 1, 2, 2, '#2a2a2a');
    rect(g, cx + 5, cy, 2, 2, '#e0b8a0');
  }
  // barn with a gabled roof, a tall door and a hayloft
  const b = raised(g, 6, HR0 + 3, 44, 12, 6, L, '#b0392b', '#8a2a20');
  poly(g, [[6, b.top], [28, b.top - 4], [50, b.top]], '#7d2a20');
  rect(g, 6, b.top + 6, 44, 1, 'rgba(0,0,0,0.3)');
  for (const r of flatWindowRects('dairy_farm')) rect(g, r.x, r.y, r.w, r.h, '#2b2320');
  rect(g, 24, HR0 + 21 - 10, 8, 10, '#f1e6d0'); // door
  g.strokeStyle = '#f1e6d0';
  g.strokeRect(24.5, HR0 + 21 - 9.5, 7, 9);
  rect(g, 25, HR0 + 21 - 9, 6, 8, '#6a2a20');
  g.strokeStyle = '#f1e6d0';
  g.beginPath(); g.moveTo(25, HR0 + 12); g.lineTo(31, HR0 + 20); g.moveTo(31, HR0 + 12); g.lineTo(25, HR0 + 20); g.stroke();
  rect(g, 26, b.seam + 2, 4, 3, '#2b2320'); // hayloft
  silo(g, W - 14, HR0 + 12, 4, L + 12, '#c3c7cf');
}

function paintMine(g: Ctx, def: BuildingDef, W: number, H: number): void {
  const L = BUILDING_HEIGHT[def.id];
  rect(g, 0, HR0, W - SHADOW, H - HR0 - SHADOW, '#7b746a');
  for (let i = 0; i < 14; i++) circle(g, 3 + hash(i) * (W - 10), HR0 + 4 + hash(i + 9) * (H - HR0 - 12), 1.4, i % 2 ? '#4a4540' : '#a09a90');
  // headframe: A-frame with winding wheel
  softShadow(g, 14, HR0 + 2, 20, 18);
  g.strokeStyle = '#4a3322';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(14, HR0 + 22); g.lineTo(24, 4); g.lineTo(34, HR0 + 22);
  g.moveTo(18, HR0 + 14); g.lineTo(30, HR0 + 14);
  g.stroke();
  g.lineWidth = 1;
  circle(g, 24, 7, 5, '#2d2d30');
  circle(g, 24, 7, 3.5, '#8b8f96');
  circle(g, 24, 7, 1, '#2d2d30');
  // engine house + chimney
  raised(g, 40, HR0 + 4, 18, 9, 6, L, '#5d4a3a', '#3f3126');
  for (const r of flatWindowRects('mine')) rect(g, r.x, r.y, r.w, r.h, '#2b3a4a');
  stack(g, flatChimneys('mine')[0].x, 8 - L, HR0 + 6 - L, def.color);
  // ore cart on rails
  rect(g, 4, H - 16, W - 12, 1, '#3a3a3a');
  rect(g, 4, H - 12, W - 12, 1, '#3a3a3a');
  rect(g, 10, H - 18, 12, 8, '#6b3f2a');
  rect(g, 11, H - 20, 10, 3, '#222');
  circle(g, 12, H - 10, 2, '#111'); circle(g, 20, H - 10, 2, '#111');
}

function paintSandPit(g: Ctx, def: BuildingDef, W: number, H: number): void {
  const L = BUILDING_HEIGHT[def.id];
  const h = H - HR0 - SHADOW;
  rect(g, 0, HR0, W - SHADOW, h, '#e4cf94');
  const cols = ['#d8bf85', '#c7a96c', '#b3935a', '#9c7c46'];
  for (let i = 0; i < 4; i++) {
    const inset = 3 + i * 5;
    rect(g, inset, HR0 + inset, W - SHADOW - inset * 2, h - inset * 2, cols[i]);
    rect(g, inset, HR0 + inset, W - SHADOW - inset * 2, 1, 'rgba(255,255,255,0.35)');
    rect(g, inset, HR0 + h - inset - 1, W - SHADOW - inset * 2, 1, 'rgba(0,0,0,0.25)');
  }
  rect(g, W - 22, H - 18, 10, 6, '#c9a35a'); // sand heap + truck bed
  poly(g, [[W - 22, H - 12], [W - 17, H - 20], [W - 12, H - 12]], '#e9d6a0');
  const hut = raised(g, 6, HR0 + 2, 12, 5, 4, L, '#a8442f', '#d9cfb8'); // weigh hut
  rect(g, 9, hut.seam + 3, 3, 2, '#2b3a4a');
}

function paintOil(g: Ctx, def: BuildingDef, W: number, H: number): void {
  const L = BUILDING_HEIGHT[def.id];
  rect(g, 0, HR0, W - SHADOW, H - HR0 - SHADOW, '#7d6e55');
  circle(g, 12, H - 14, 7, '#26231f'); // oil pool
  circle(g, 10, H - 16, 2, '#4a4540');
  silo(g, 10, HR0 + 12, 5, L + 6, '#5b6670'); // storage tank
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
}

/** Shadow casters per extractor, matching the painters above (footprint-local px). */
function extractorCasters(def: BuildingDef): ShadowCaster[] {
  const L = BUILDING_HEIGHT[def.id];
  const { W, H } = dims(def);
  switch (def.id) {
    case 'lumber_camp': return [raisedCaster(4, HR0 + 4, 24, 12, 6, L)];
    case 'farm': return [raisedCaster(3, HR0 + 3, 16, 8, 4, L), siloCaster(26, HR0 + 12, 4, L + 10)];
    case 'dairy_farm': return [raisedCaster(6, HR0 + 3, 44, 12, 6, L), siloCaster(W - 14, HR0 + 12, 4, L + 12)];
    case 'mine': {
      const c = flatChimneys('mine')[0];
      return [
        raisedCaster(40, HR0 + 4, 18, 9, 6, L),
        { x: c.x - 3, y: 11, w: 6, d: 3, z: 6 + L + (HR0 + 6 - c.y) },
        { x: 14, y: 20, w: 20, d: 3, z: HR0 + 22 - 4, taper: true },
      ];
    }
    case 'sand_pit': return [raisedCaster(6, HR0 + 2, 12, 5, 4, L), { x: W - 22, y: H - HR0 - 14, w: 10, d: 2, z: 8, taper: true }];
    case 'oil_well': return [siloCaster(10, HR0 + 12, 5, L + 6), { x: W / 2 - 10, y: H - HR0 - 17, w: 20, d: 3, z: H - 14 - 3, taper: true }];
    default: return [];
  }
}

function factoryBrick(id: string): string {
  return id === 'sawmill' ? '#9b6e3f' : id === 'flour_mill' ? '#c9b99a' : id === 'creamery' ? '#e8dcc0' : '#a2513b';
}

function paintFactory(g: Ctx, def: BuildingDef, W: number, H: number, owner: OwnerId): void {
  const id = def.id;
  const brick = factoryBrick(id);
  let roofTint = mix(def.color, '#6e7b84', 0.6);
  if (id === 'creamery') roofTint = '#efe6cf';
  if (id === 'toy_factory') roofTint = '#e88ab0';
  const b = building(g, W, H, roofTint, brick, apronOf(id));
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
      circle(g, flatChimneys(id)[1].x, 4, 2.5, '#ff9a3c');
      break;
    }
    case 'car_plant': {
      for (let x = 8; x < b.w - 4; x += 12) rect(g, x, b.y + 2, 1, ry - b.y - 20, 'rgba(0,0,0,0.2)');
      rect(g, 8, ry - 24, 40, 8, def.color);
      rect(g, 10, ry - 22, 36, 4, '#f4e6d0');
      // forecourt on the ground in front of the plant, with finished cars
      const ay = b.y + b.h;
      rect(g, b.x, ay, b.w, apronOf(id) - 1, '#5d6166');
      rect(g, b.x, ay, b.w, 2, 'rgba(0,0,0,0.3)');
      rect(g, b.x + 2, ay + 8, b.w - 4, 1, '#d9d36a');
      ['#b8322c', '#2f6fb5', '#e6e0d0', '#2f7a4a'].forEach((c, i) => {
        const cx = b.x + 8 + i * 30;
        rect(g, cx, ay + 4, 14, 6, 'rgba(0,0,0,0.3)');
        rect(g, cx, ay + 3, 14, 6, c);
        rect(g, cx + 4, ay + 4, 6, 4, 'rgba(255,255,255,0.45)');
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
  const ownerC = ownerColor(owner);
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
  rect(g, 8, 6, 10, HR0 + 4, '#9a7a5c');
  poly(g, [[7, 7], [13, 1], [19, 7]], '#4a2f25');
  circle(g, 13, 12, 3, '#f5f0e0');
  rect(g, 13, 10, 1, 2, '#222'); rect(g, 13, 12, 2, 1, '#222');
  pennant(g, W, owner);
}

/** Company housing: a brick terrace of three homes under a pitched slate roof, chimneys on the party walls. */
function paintHousing(g: Ctx, _def: BuildingDef, W: number, H: number, owner: OwnerId): void {
  const brick = '#a9553e';
  const b = building(g, W, H, '#5c4a44', brick);
  brickTexture(g, b, 77);
  const units = 3;
  const uw = b.w / units;
  const ridge = b.y + Math.round(b.roofH / 2);
  for (let i = 0; i < units; i++) {
    const x = b.x + Math.round(i * uw);
    const w = Math.round((i + 1) * uw) - Math.round(i * uw);
    const roof = ['#6b4a3a', '#5c4a44', '#7a5446'][i];
    rect(g, x, b.y, w, ridge - b.y, shade(roof, 0.18)); // sunlit back slope
    rect(g, x, ridge, w, b.y + b.roofH - ridge, roof);
    for (let y = b.y + 3; y < b.y + b.roofH - 1; y += 4) rect(g, x + 1, y, w - 2, 1, 'rgba(0,0,0,0.12)'); // slate courses
  }
  rect(g, b.x, ridge, b.w, 1, 'rgba(0,0,0,0.35)');
  for (let i = 1; i < units; i++) {
    const x = b.x + Math.round(i * uw);
    rect(g, x, b.y, 1, b.roofH, 'rgba(0,0,0,0.4)'); // party wall
    rect(g, x - 3, ridge - 5, 6, 5, '#8c4a38'); // chimney stack
    rect(g, x - 3, ridge - 5, 6, 1, '#3a2a25');
    rect(g, x - 2, ridge - 7, 2, 2, '#b06a4a');
    rect(g, x + 1, ridge - 7, 2, 2, '#b06a4a');
  }
  // dormer windows on the front slope
  for (let i = 0; i < units; i++) {
    const cx = b.x + Math.round((i + 0.5) * uw);
    rect(g, cx - 3, ridge + 8, 6, 6, '#e8dcc0');
    rect(g, cx - 2, ridge + 9, 4, 3, '#2b3a4a');
  }
  windows(g, 'company_housing', '#2b3a4a');
  const y = b.y + b.roofH;
  for (let i = 0; i < units; i++) {
    const dx = b.x + Math.round((i + 0.5) * uw) + 3;
    rect(g, dx, y + 2, 3, WALL - 2, '#3b5a7a'); // front doors in the company colour scheme
    rect(g, dx, y + 2, 3, 1, '#efe7d4');
  }
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
    case 'company_housing': paintHousing(g, def, W, H, owner); return;
    default:
      if (def.category === 'factory') { paintFactory(g, def, W, H, owner); return; }
      paintWarehouse(g, def, W, H, owner); return;
  }
  pennant(g, W, owner);
}

// ---------------------------------------------------------------- ¾ facades and casters

/** Wall colour of a box building's facade (matches its painter's south wall). */
function facadeWall(def: BuildingDef): string {
  if (def.id === 'store') return '#e8dcc0';
  if (def.id === 'train_station') return '#c9bb9c';
  if (def.id === 'company_housing') return '#a9553e';
  if (def.category === 'factory') return factoryBrick(def.id);
  return '#b8b2a2';
}

/** Fills a box building's grown facade: wall, texture, cornice under the eave, pilasters, upper windows. */
function paintFacade(g: Ctx, def: BuildingDef, W: number, top: number, lift: number): void {
  if (lift <= 0) return;
  const bx = 1, bw = W - SHADOW - 1;
  const wall = facadeWall(def);
  const brick = def.category === 'factory' || def.id === 'company_housing';
  rect(g, bx, top, bw, lift, wall);
  if (brick) {
    for (let x = bx + 1; x < bx + bw - 1; x += 4) {
      for (let r = 0; r < lift; r += 2) if (hash(def.id.length * 31 + x * 7 + r * 13) > 0.55) rect(g, x + (r % 4 ? 2 : 0), top + r, 2, 1, 'rgba(0,0,0,0.16)');
    }
  } else if (def.id !== 'store' && def.id !== 'train_station') {
    for (let x = bx + 2; x < bx + bw - 1; x += 3) rect(g, x, top, 1, lift, 'rgba(0,0,0,0.12)'); // corrugated
  }
  if (def.id !== 'store' && def.id !== 'company_housing') for (let x = bx + 12; x < bx + bw - 8; x += 24) rect(g, x, top, 2, lift, shade(wall, -0.16)); // pilasters
  for (const r of facadeWindowRects(def.id)) {
    rect(g, r.x, r.y, r.w, r.h, '#2b3a4a');
    rect(g, r.x, r.y + r.h, r.w, 1, shade(wall, 0.3));
  }
  // light from the sky above, ambient occlusion toward the street
  const grd = g.createLinearGradient(0, top, 0, top + lift);
  grd.addColorStop(0, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grd;
  g.fillRect(bx, top, bw, lift);
  rect(g, bx, top, bw, 2, shade(wall, -0.5)); // eave shadow
  rect(g, bx, top + 2, bw, 1, shade(wall, 0.18));
  if (def.category === 'factory') rect(g, bx, top + 3, bw, 1, def.color);
  rect(g, bx + bw - 3, top, 2, lift, 'rgba(0,0,0,0.12)');
  rect(g, bx, top, 1, lift, 'rgba(0,0,0,0.45)');
  rect(g, bx + bw - 1, top, 1, lift, 'rgba(0,0,0,0.45)');
}

/** Lifts a box building's flat painting: facade base stays on the ground, roof and chimneys rise by its height. */
function composeBox(out: Ctx, flat: CanvasImageSource, def: BuildingDef): void {
  const { W, H } = dims(def);
  const s = splitRow(def);
  const { top, lift } = facadeGap(def);
  out.drawImage(flat, 0, s, W, H - s, 0, LIFT_ROOM + s, W, H - s);
  if (lift > 0) out.drawImage(flat, W - SHADOW, s + 1, SHADOW, 1, W - SHADOW, top, SHADOW, lift); // contact shadow down the east side
  paintFacade(out, def, W, top, lift);
  out.drawImage(flat, 0, 0, W, s, 0, top - s, W, s);
}

const casterCache = new Map<string, ShadowCaster[]>();
/**
 * Sun-shadow casters of a building type in footprint-local px (footprint top-left at 0, 0): its
 * raised body plus chimneys, towers and masts, matching the sprite.
 */
export function buildingCasters(typeId: string): ShadowCaster[] {
  const hit = casterCache.get(typeId);
  if (hit) return hit;
  const def = BUILDINGS[typeId];
  let out: ShadowCaster[] = [];
  if (def && !isBox(def)) out = extractorCasters(def);
  else if (def) {
    const { W, H } = dims(def);
    const s = splitRow(def);
    const lift = BUILDING_HEIGHT[def.id] ?? 0;
    const bodyBottom = H - SHADOW - apronOf(typeId);
    const z = bodyBottom - s + lift;
    const y0 = bodyBottom - s;
    out.push({ x: 1, y: y0, w: W - SHADOW - 1, d: s - HR0, z });
    // things standing on the roof: their foot is on the roof at flat y = foot, so on the ground at foot - HR0 - lift + z
    const ground = (foot: number): number => foot - HR0 - lift + z;
    const cw = typeId === 'textile_mill' ? 3 : 6;
    for (const c of flatChimneys(typeId)) out.push({ x: c.x - cw / 2, y: ground(HR0 + 6) - 2, w: cw, d: 4, z: z + HR0 + 6 - c.y });
    if (typeId === 'steel_mill') { const fx = Math.round(W * 0.68); out.push({ x: fx - 10, y: ground(48) - 6, w: 18, d: 6, z: z + 40 }); }
    // the radio mast is drawn lying along the roof; its shadow is a modest mast's, not a 100 px one
    if (typeId === 'electronics_plant') { const mx = Math.round(W * 0.7); out.push({ x: mx - 1, y: ground(HR0 + 30) - 2, w: 3, d: 2, z: z + 34, taper: true }); }
    if (typeId === 'glassworks') { const kx = Math.round(W * 0.68); out.push({ x: kx - 12, y: ground(HR0 + 36) - 8, w: 24, d: 8, z: z + 30, taper: true }); }
    if (typeId === 'train_station') out.push({ x: 8, y: ground(HR0 + 10) - 6, w: 10, d: 6, z: z + 20 });
  }
  casterCache.set(typeId, out);
  return out;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Cached building sprite, W = size.w*TILE, H = size.h*TILE + HEADROOM (footprint starts at y = HEADROOM).
 * `variant` only matters for farms: 'grain' | 'cotton' | 'fruit'.
 */
export function getBuildingSprite(typeId: string, ownerId: OwnerId, variant = ''): HTMLCanvasElement {
  const def = BUILDINGS[typeId];
  if (!def) throw new Error(`Unknown building: ${typeId}`);
  const v = def.id === 'farm' ? variant || 'grain' : '';
  const key = spriteKey(typeId, ownerId, v);
  let c = cache.get(key);
  if (c) return c;
  const { w, h } = spriteSize(typeId);
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g && isBox(def)) {
    const { W, H } = dims(def);
    const flat = document.createElement('canvas');
    flat.width = W;
    flat.height = H;
    const fg = flat.getContext('2d');
    if (fg) {
      paintBuilding(fg, def, ownerId, v);
      composeBox(g, flat, def);
    }
  } else if (g) {
    // extractors paint their raised sheds and silos themselves, in the flat layout shifted down
    g.translate(0, LIFT_ROOM);
    paintBuilding(g, def, ownerId, v);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  cache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- houses

const ROOFS = ['#a8442f', '#6b4a3a', '#4f5d6b', '#7a6a2e'];
const WARM = '#ffd27a';
const DARK_WIN = '#34465a';

/** Density of a city house: big cities build denser cores as the decades pass. */
export type HouseTier = 'house' | 'terrace' | 'block' | 'tower';
/** Index order of HouseTier in packed chunk data. */
export const HOUSE_TIERS: readonly HouseTier[] = ['house', 'terrace', 'block', 'tower'];
/** Wall height (px) of each house tier: the ¾ facade and its sun shadow. Towers rise 28 px. */
export const HOUSE_TIER_HEIGHT: Record<HouseTier, number> = { house: 6, terrace: 8, block: 16, tower: 28 };
/** Px a house may rise above its tile (the tower's roof deck reaches into the tile above). */
export const HOUSE_HEADROOM = HOUSE_TIER_HEIGHT.tower - 6 + 2;
/** Fraction of the urban radius that counts as the city core. */
export const CORE_FRAC = 0.35;

/**
 * Tier of a house `distFrac` (distance / urban radius) from the centre of a city of `population`
 * in `year`. Outside the core it is always 'house'.
 */
export function houseTier(population: number, year: number, distFrac: number): HouseTier {
  if (distFrac >= CORE_FRAC) return 'house';
  if (population > 60_000 && year >= 1955) return 'tower';
  if (population > 40_000 && year >= 1930) return 'block';
  if (population > 15_000) return 'terrace';
  return 'house';
}

/** Two houses joined under one roof line, filling the tile width. */
function drawTerrace(g: Ctx, style: HouseStyle, v: number, win: string): void {
  const x = 2, y = 6, w = 28, h = 19;
  softShadow(g, x, y, w, h);
  const wall = style === 'cottage' ? '#e6dcc2' : style === 'brick' ? '#a9553e' : style === 'deco' ? '#e2d6bc' : '#c9c4ba';
  for (let i = 0; i < 2; i++) {
    const hx = x + i * 14;
    const roof = ROOFS[(v + i) % ROOFS.length];
    rect(g, hx, y + h - 8, 14, 8, i ? shade(wall, -0.06) : wall);
    rect(g, hx, y, 14, h - 8, roof);
    rect(g, hx, y, 14, 2, shade(roof, 0.25));
    rect(g, hx, y + (h - 8) / 2, 14, 1, shade(roof, -0.3));
    rect(g, hx + 2, y + h - 6, 4, 3, win);
    rect(g, hx + 9, y + h - 7, 3, 7, '#5b3a1e');
    rect(g, hx + 10, y - 2, 3, 4, '#7a4a3a');
  }
  rect(g, x + 14, y, 1, h, 'rgba(0,0,0,0.3)'); // party wall
}

/** A 3-storey apartment block; its roof rises into the tile above. */
function drawBlock(g: Ctx, style: HouseStyle, v: number, win: string): void {
  const x = 3, y = -3, w = 26, h = 31;
  softShadow(g, x, y, w, h);
  const brick = style === 'cottage' || style === 'brick';
  const wall = brick ? (v % 2 ? '#9c4a35' : '#a85a3c') : v % 2 ? '#d8cdb5' : '#c4c0b4';
  const roof = brick ? '#5c4a44' : '#7d7f80';
  rect(g, x, y, w, 8, roof);
  rect(g, x, y, w, 2, shade(roof, 0.2));
  rect(g, x + 4 + (v % 3) * 6, y + 2, 4, 4, shade(roof, -0.25)); // stair head
  rect(g, x, y + 8, w, h - 8, wall);
  rect(g, x, y + 8, w, 1, shade(wall, -0.3));
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) rect(g, x + 2 + i * 6, y + 11 + r * 6, 4, 4, win);
  rect(g, x + 11, y + h - 4, 4, 4, '#3b2c22');
}

/**
 * A tall tower in ¾: the 26 × 22 px plot at the back of the tile carries a HOUSE_TIER_HEIGHT.tower px
 * high slab, so the roof deck rises into the tile above. Glass curtain wall with a window grid, a
 * lobby at street level and plant on the roof.
 */
function drawTower(g: Ctx, v: number, lit: boolean): void {
  const Z = HOUSE_TIER_HEIGHT.tower;
  const x = 3, w = 26, gy = 6, d = 22; // ground plot
  const top = gy - Z, face = gy + d - Z, base = gy + d;
  const wall = v % 2 ? '#8796a6' : '#a3adb6';
  const deck = v % 2 ? '#6d7680' : '#7d858c';
  softShadow(g, x, face, w, base - face);
  // roof deck with parapet, plant room and water tank
  rect(g, x, top, w, d, deck);
  rect(g, x, top, w, 1, '#d9dee2');
  rect(g, x, top, 1, d, shade(deck, 0.2));
  rect(g, x + w - 1, top, 1, d, shade(deck, -0.3));
  rect(g, x + 2, top + 2, w - 4, d - 4, shade(deck, 0.08));
  const px = x + 4 + (v % 3) * 4;
  rect(g, px, top + 6, 9, 5, '#b8bec4'); // plant room (roof + a face)
  rect(g, px, top + 11, 9, 3, '#8d949b');
  rect(g, x + w - 8, top + 4, 4, 3, '#555c63'); // water tank
  rect(g, x + w - 8, top + 7, 4, 2, '#3f454b');
  rect(g, x + w - 7, top + 9, 1, 2, '#2c3136');
  rect(g, x + w - 5, top + 9, 1, 2, '#2c3136');
  // curtain wall: a parapet band, then five storeys of windows between piers
  rect(g, x, face, w, base - face, wall);
  rect(g, x, face, w, 2, '#d9dee2');
  rect(g, x, face + 2, w, 1, shade(wall, -0.35));
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < 6; i++) {
      rect(g, x + 2 + i * 4, face + 4 + r * 4.4, 3, 3, lit && hash(v * 17 + r * 7 + i) > 0.25 ? WARM : '#3f5870');
    }
  }
  rect(g, x, base - 5, w, 1, shade(wall, -0.3)); // lobby
  rect(g, x, base - 4, w, 4, shade(wall, -0.15));
  rect(g, x + 10, base - 4, 6, 4, lit ? '#e8c27a' : '#2c3440');
  rect(g, x + w - 2, face + 2, 2, base - face - 2, 'rgba(0,0,0,0.18)'); // corner shade
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, top + 0.5, w - 1, base - top - 1);
}

/**
 * Sun-shadow caster of a one-tile house of `tier`, in tile-local px (tile top-left at 0, 0), roughly
 * matching drawHouse's silhouette: ground plot plus HOUSE_TIER_HEIGHT.
 */
export function houseCaster(tier: HouseTier): ShadowCaster {
  return HOUSE_CASTERS[tier];
}
const HOUSE_CASTERS: Record<HouseTier, ShadowCaster> = {
  house: { x: 4, y: 12, w: 22, d: 14, z: HOUSE_TIER_HEIGHT.house },
  terrace: { x: 2, y: 14, w: 28, d: 11, z: HOUSE_TIER_HEIGHT.terrace },
  block: { x: 3, y: 12, w: 26, d: 16, z: HOUSE_TIER_HEIGHT.block },
  tower: { x: 3, y: 6, w: 26, d: 22, z: HOUSE_TIER_HEIGHT.tower },
};

/** Draw a one-tile house of `tier` with its top-left corner at (px, py). */
export function drawHouse(g: Ctx, px: number, py: number, variant: number, year: number, lit: boolean, tier: HouseTier = 'house'): void {
  const style = houseStyle(year);
  const v = Math.abs(Math.floor(variant));
  const win = lit ? WARM : DARK_WIN;
  g.save();
  g.translate(px, py);
  if (tier !== 'house') {
    if (tier === 'terrace') drawTerrace(g, style, v, win);
    else if (tier === 'block') drawBlock(g, style, v, win);
    else drawTower(g, v, lit);
    g.restore();
    return;
  }
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

/** Everything vehicle-sized is drawn at this multiple of the original geometry. */
export const VEHICLE_SCALE = 1.8;
/** Nose x (px, local frame facing +x) where the headlights sit. */
export const TRUCK_NOSE = 9 * VEHICLE_SCALE;
export const LOCO_NOSE = 15 * VEHICLE_SCALE;
const HEADLIGHT = 'rgba(255,236,170,0.35)';

/** Scaled rect / circle: coordinates are in unscaled vehicle units (facing +x). */
function vrect(g: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  rect(g, x * VEHICLE_SCALE, y * VEHICLE_SCALE, w * VEHICLE_SCALE, h * VEHICLE_SCALE, c);
}
function vcircle(g: Ctx, x: number, y: number, r: number, c: string): void {
  circle(g, x * VEHICLE_SCALE, y * VEHICLE_SCALE, r * VEHICLE_SCALE, c);
}
/** Two warm light cones ahead of the nose at x (px, already scaled), lamps at y1 and y2. Call inside the vehicle's local frame. */
function headlights(g: Ctx, x: number, y1: number, y2: number): void {
  const S = VEHICLE_SCALE;
  const len = 10 * S;
  for (const y of [y1, y2]) {
    poly(g, [[x, y * S], [x + len, (y - 2) * S], [x + len, (y + 2) * S]], HEADLIGHT);
  }
}

const ANGLE: Record<Dir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

/** Truck centred on (px, py). Drawn facing east, then rotated. */
export function drawTruck(g: Ctx, px: number, py: number, dir: Dir, ownerId: OwnerId, cargoColor: string | null, lit = false): void {
  g.save();
  g.translate(px, py);
  g.rotate(ANGLE[dir]);
  vrect(g, -7, -3, 16, 9, 'rgba(0,0,0,0.22)'); // shadow
  vrect(g, -9, -4, 11, 8, cargoColor ? shade(cargoColor, -0.2) : '#8d8a84'); // cargo box
  vrect(g, -8, -3, 9, 6, cargoColor ?? '#b9b5ac');
  vrect(g, 3, -4, 6, 8, ownerColor(ownerId)); // cab
  vrect(g, 6, -3, 2, 6, '#bfe3f2'); // windscreen
  vrect(g, 8, -3, 1, 1, '#fff6c0'); vrect(g, 8, 2, 1, 1, '#fff6c0');
  if (lit) headlights(g, TRUCK_NOSE, -2.5, 2.5);
  g.restore();
}

/** Half the length of a locomotive and of a wagon, in px (used to space a consist along the track). */
export const LOCO_HALF = Math.round(13 * VEHICLE_SCALE);
export const WAGON_HALF = Math.round(8 * VEHICLE_SCALE);
/** Chimney (steam) or exhaust (diesel) position in the locomotive's local frame (facing +x). */
export const LOCO_STACK = {
  steam: { x: 8 * VEHICLE_SCALE, y: 0 },
  diesel: { x: -3 * VEHICLE_SCALE, y: 2.5 * VEHICLE_SCALE },
} as const;

/**
 * Locomotive centred on (px, py), facing `angle` radians (0 = east). Steam: black engine with coal
 * tender, owner-coloured cab and brass dome. Diesel: a streamlined hood unit in owner colours.
 */
export function drawLocomotive(g: Ctx, px: number, py: number, angle: number, ownerId: OwnerId, diesel: boolean, lit = false): void {
  const oc = ownerColor(ownerId);
  g.save();
  g.translate(px, py);
  g.rotate(angle);
  vrect(g, -12, -4, 27, 11, 'rgba(0,0,0,0.25)'); // shadow
  if (!diesel) {
    // tender with a coal heap
    vrect(g, -13, -5, 8, 10, '#2a2620');
    vrect(g, -12, -4, 6, 8, '#14120f');
    vrect(g, -11, -3, 3, 2, '#3b3631');
    vrect(g, -10, 0, 2, 2, '#47413a');
    // cab
    vrect(g, -5, -5.5, 7, 11, shade(oc, -0.25));
    vrect(g, -4.5, -5, 6, 10, oc);
    vrect(g, -4.5, -5, 6, 2, shade(oc, 0.3));
    // boiler with brass bands
    vrect(g, 2, -4, 10, 8, '#26262c');
    vrect(g, 2, -4, 10, 2, '#45454e');
    vrect(g, 2, 2.5, 10, 1.5, '#121216');
    vrect(g, 5, -4, 1, 8, '#b08a35');
    vrect(g, 10, -4, 1, 8, '#b08a35');
    vcircle(g, 4, 0, 1.8, '#c9a13a'); // steam dome
    vcircle(g, 3.6, -0.5, 0.7, '#f0d78a');
    vcircle(g, 8, 0, 2.1, '#0d0d0f'); // chimney
    vcircle(g, 8, 0, 1.1, '#3e3a36');
    vrect(g, 12, -4.5, 1.5, 9, '#191919'); // smokebox door
    vrect(g, 13.5, -5, 1.5, 10, '#a3322a'); // buffer beam
    vrect(g, 13, -1, 2, 2, '#f6e7a6'); // lamp
    if (lit) headlights(g, LOCO_NOSE, -3.5, 3.5);
  } else {
    const hood = (inset: number, color: string): void => {
      const S = VEHICLE_SCALE;
      const t = (-5.5 + inset) * S;
      const b = (5.5 - inset) * S;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo((-13 + inset) * S, t);
      g.lineTo(11 * S, t);
      g.quadraticCurveTo((15 - inset) * S, t, (15 - inset) * S, 0);
      g.quadraticCurveTo((15 - inset) * S, b, 11 * S, b);
      g.lineTo((-13 + inset) * S, b);
      g.closePath();
      g.fill();
    };
    hood(0, shade(oc, -0.35));
    hood(1, oc);
    vrect(g, -12, -1, 22, 2, '#e8dcb0'); // roof stripe
    vrect(g, -12, -4.5, 22, 1, shade(oc, 0.3));
    for (let i = 0; i < 4; i++) vrect(g, -10 + i * 3, -3.5, 2, 2, 'rgba(0,0,0,0.35)'); // radiator grilles
    vcircle(g, -8, 2.5, 1.3, '#2c2c30'); // roof fan
    vcircle(g, -3, 2.5, 1.1, '#1d1d20'); // exhaust
    vrect(g, 9, -3.5, 2.5, 7, '#bfe3f2'); // cab windscreen
    vrect(g, 9, -3.5, 2.5, 1, '#ffffff');
    vrect(g, 14, -1, 1.5, 2, '#fff6c0'); // headlight
    if (lit) headlights(g, LOCO_NOSE, -3, 3);
  }
  g.restore();
}

/** One wagon centred on (px, py) at `angle`: an open hopper heaped with cargo, or an empty boxcar. */
export function drawWagon(g: Ctx, px: number, py: number, angle: number, cargoColor: string | null, variant: number): void {
  g.save();
  g.translate(px, py);
  g.rotate(angle);
  vrect(g, -7, -4, 16, 10, 'rgba(0,0,0,0.22)');
  vrect(g, -8, -4.5, 16, 9, '#2b2723'); // chassis
  if (cargoColor) {
    vrect(g, -7.5, -4, 15, 8, '#5a4a3a'); // hopper walls
    vrect(g, -6.5, -3, 13, 6, shade(cargoColor, -0.25));
    vrect(g, -5, -2, 10, 4, cargoColor); // heap
    vrect(g, -3, -1.5, 5, 1.5, shade(cargoColor, 0.3));
  } else {
    const body = variant % 3 === 0 ? '#7a4a2b' : variant % 3 === 1 ? '#5b6b4a' : '#6d5a4a';
    vrect(g, -7.5, -4, 15, 8, body);
    vrect(g, -7.5, -4, 15, 1, shade(body, 0.3));
    vrect(g, -7.5, -0.5, 15, 1, shade(body, -0.35)); // roof ridge
    vrect(g, -7.5, 3, 15, 1, shade(body, -0.25));
  }
  vrect(g, -9, -0.5, 1, 1, '#111'); // couplers
  vrect(g, 8, -0.5, 1, 1, '#111');
  g.restore();
}

/** Locomotive plus `wagons` cars trailing straight behind it (sprite sheet previews). */
export function drawTrain(g: Ctx, px: number, py: number, dir: Dir, ownerId: OwnerId, wagons: number, diesel = false, lit = false): void {
  const a = ANGLE[dir];
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  for (let i = 0; i < wagons; i++) {
    const d = LOCO_HALF + 1 + WAGON_HALF + i * (2 * WAGON_HALF + 1);
    drawWagon(g, px - ux * d, py - uy * d, a, i === 1 ? '#3a3a3a' : null, i);
  }
  drawLocomotive(g, px, py, a, ownerId, diesel, lit);
}

// ---------------------------------------------------------------- icons

/** Atlas icon for a good, filling the `size` box at (px, py) (top-left). */
export function drawGoodIcon(g: Ctx, goodId: string, px: number, py: number, size: number): void {
  drawIcon(g, goodId, px, py, size);
}
