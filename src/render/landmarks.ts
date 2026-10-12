/**
 * Landmark painters: one procedural 2×2-tile civic building per landmark id, in the sprites.ts
 * style (top-down with a slight 3/4 tilt: roofs plus a south wall strip, soft south-east shadow).
 *
 * Coordinates: the footprint is LANDMARK_PX square with its top-left at (0, 0); towers, spires and
 * floodlights may rise up to LANDMARK_HEADROOM px above it. The last 4 px right/bottom are left for
 * shadow. Drawn into the world's cached chunk layer (render/world/index.ts), lit at night.
 * Drawn flat for now; Task 10 adds building heights.
 */
import type { LandmarkId } from '../data/landmarks';
import { TILE } from './constants';
import type { ShadowCaster } from './shadows';
import { circle, poly, rect, shade, softShadow } from './sprites';

type Ctx = CanvasRenderingContext2D;
export type LandmarkPainter = (g: Ctx, lit: boolean) => void;

/** Footprint side in px (2 tiles). */
export const LANDMARK_PX = 2 * TILE;
/** Px a landmark may rise above its footprint (spires, towers, floodlights, the skyscraper's crown). */
export const LANDMARK_HEADROOM = 48;

/** Height (px) of each landmark's tallest mass: spire, clock tower, dome, floodlights, the skyscraper's slab. */
export const LANDMARK_HEIGHT: Record<LandmarkId, number> = {
  church: 32,
  town_hall: 28,
  grand_station: 14,
  library: 24,
  stadium: 18,
  skyscraper: 40,
  park: 12,
  hospital: 22,
};

const WALL = 7;
const WARM = '#ffd27a';
const DARK_WIN = '#34465a';
/** Unlit glass for panes that light up: dark enough that lit − unlit stays warm in the night glow mask. */
const NIGHT_GLASS = '#4f6f86';
const STONE = '#e4dcc8';
const PAVING = '#cbc1a6';
const LAWN = '#6f9a4a';
const COPPER = '#5fa38a';
const GOLD = '#c9a227';

/** Deterministic 0..1 noise for window patterns. */
function h(n: number): number {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

const win = (lit: boolean, n: number, share = 0.7): string => (lit && h(n) < share ? WARM : DARK_WIN);

function outline(g: Ctx, x: number, y: number, w: number, hh: number): void {
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
}

/** Paved square over the whole footprint, with joints and a kerb. */
function plaza(g: Ctx, base = PAVING): void {
  rect(g, 0, 0, LANDMARK_PX, LANDMARK_PX, base);
  for (let i = 8; i < LANDMARK_PX; i += 8) {
    rect(g, i, 0, 1, LANDMARK_PX, 'rgba(0,0,0,0.05)');
    rect(g, 0, i, LANDMARK_PX, 1, 'rgba(0,0,0,0.05)');
  }
  g.strokeStyle = shade(base, -0.3);
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, LANDMARK_PX - 1, LANDMARK_PX - 1);
}

/** A box seen from above: shadow, roof, south wall strip; returns the y of the wall seam. */
function box(g: Ctx, x: number, y: number, w: number, hh: number, roof: string, wall: string, wallH = WALL): number {
  softShadow(g, x, y, w, hh);
  const seam = y + hh - wallH;
  rect(g, x, y, w, hh - wallH, roof);
  rect(g, x, seam, w, wallH, wall);
  rect(g, x, seam, w, 1, shade(wall, -0.35));
  outline(g, x, y, w, hh);
  return seam;
}

function tree(g: Ctx, x: number, y: number, r: number, c = '#3f6b2c'): void {
  circle(g, x + 2, y + 2, r, 'rgba(0,0,0,0.18)');
  circle(g, x, y, r, c);
  circle(g, x - r * 0.35, y - r * 0.35, r * 0.45, shade(c, 0.25));
}

function columns(g: Ctx, x0: number, x1: number, y: number, n: number, hh: number): void {
  const step = (x1 - x0) / (n - 1);
  for (let i = 0; i < n; i++) {
    const cx = Math.round(x0 + i * step);
    rect(g, cx - 1, y, 2, hh, '#f6f1e4');
    rect(g, cx + 1, y, 1, hh, 'rgba(0,0,0,0.25)');
  }
}

// ---------------------------------------------------------------- painters

function church(g: Ctx, lit: boolean): void {
  plaza(g, LAWN);
  // churchyard path and gravestones
  rect(g, 28, 52, 8, 12, '#b9ae92');
  for (const [x, y] of [[5, 40], [10, 44], [5, 50], [11, 52], [50, 42], [55, 47], [49, 53]]) {
    rect(g, x + 1, y + 1, 3, 4, 'rgba(0,0,0,0.25)');
    rect(g, x, y, 3, 4, '#a9a69c');
    rect(g, x, y, 3, 1, '#d0cdc4');
  }
  tree(g, 7, 9, 5, '#2f5a2a');
  tree(g, 55, 10, 5, '#2f5a2a');
  // transept (east-west), then the nave (north-south) over it
  const slate = '#5f6874';
  const stone = '#cfc3a6';
  const tSeam = box(g, 10, 18, 44, 18, slate, stone);
  rect(g, 10, 18, 44, (tSeam - 18) / 2, shade(slate, 0.18));
  rect(g, 10, 18 + Math.round((tSeam - 18) / 2), 44, 1, shade(slate, -0.35));
  const nSeam = box(g, 21, 6, 22, 44, slate, stone);
  rect(g, 21, 6, 11, nSeam - 6, shade(slate, 0.18)); // lit roof half
  rect(g, 32, 6, 1, nSeam - 6, shade(slate, -0.4)); // ridge
  rect(g, 30, 2, 5, 5, slate); // apse cap
  // lancet windows on the transept and nave walls
  for (const x of [13, 18, 47, 52]) rect(g, x, tSeam + 2, 2, 4, win(lit, x));
  // west tower with a spire rising over the nave
  const tw = 14, tx = 25;
  const towerSeam = box(g, tx, 42, tw, 14, '#8a8f96', stone);
  poly(g, [[tx, 46], [tx + tw / 2, 18], [tx + tw, 46]], '#4a525c');
  poly(g, [[tx, 46], [tx + tw / 2, 18], [tx + tw / 2, 46]], '#646d78');
  rect(g, tx + tw / 2 - 0.5, 12, 1, 7, GOLD);
  rect(g, tx + tw / 2 - 2.5, 14, 5, 1, GOLD);
  // rose window and door
  circle(g, tx + tw / 2, towerSeam + 2.5, 2.2, lit ? WARM : '#7a4a8a');
  rect(g, tx + tw / 2 - 1.5, towerSeam + 4, 3, 3, '#4a2f1e');
}

function townHall(g: Ctx, lit: boolean): void {
  plaza(g);
  // lawns either side of the front path
  rect(g, 3, 54, 22, 8, LAWN);
  rect(g, 39, 54, 22, 8, LAWN);
  tree(g, 8, 57, 3.5);
  tree(g, 56, 57, 3.5);
  // red-brick range with a slate hipped roof and white stone trim
  const brick = '#a9553e';
  const roof = '#4f5659';
  const seam = box(g, 3, 16, 56, 34, roof, brick, 10);
  rect(g, 6, 19, 50, seam - 22, shade(roof, 0.15));
  rect(g, 3, seam, 56, 2, '#efe7d4'); // cornice
  for (let i = 0; i < 9; i++) {
    const x = 6 + i * 6;
    if (x > 24 && x < 36) continue;
    rect(g, x, seam + 3, 3, 4, win(lit, 11 + i));
  }
  // portico with pediment and columns
  rect(g, 23, seam - 4, 16, 14, '#efe7d4');
  poly(g, [[22, seam - 3], [31, seam - 9], [40, seam - 3]], '#e2d8c0');
  poly(g, [[25, seam - 4], [31, seam - 7.5], [37, seam - 4]], shade('#e2d8c0', -0.12));
  columns(g, 25, 37, seam - 1, 4, 10);
  rect(g, 29, seam + 5, 4, 5, '#5b3a1e');
  // clock tower with a pyramid cap and flag
  const tx = 25, tw = 12;
  softShadow(g, tx, 4, tw, 22);
  rect(g, tx, 4, tw, 22, '#b5634a');
  rect(g, tx + tw - 2, 4, 2, 22, 'rgba(0,0,0,0.2)');
  outline(g, tx, 4, tw, 22);
  circle(g, tx + tw / 2, 13, 4, '#f5f0e0');
  g.strokeStyle = '#222';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(tx + tw / 2, 13, 4, 0, Math.PI * 2);
  g.stroke();
  rect(g, tx + tw / 2, 10, 1, 3, '#222');
  rect(g, tx + tw / 2, 13, 3, 1, '#222');
  poly(g, [[tx - 1, 5], [tx + tw / 2, -6], [tx + tw + 1, 5]], '#3d4447');
  poly(g, [[tx - 1, 5], [tx + tw / 2, -6], [tx + tw / 2, 5]], '#566064');
  rect(g, tx + tw / 2, -14, 1, 9, '#222');
  poly(g, [[tx + tw / 2 + 1, -14], [tx + tw / 2 + 8, -12], [tx + tw / 2 + 1, -10]], '#2f6fb5');
}

function grandStation(g: Ctx, lit: boolean): void {
  plaza(g);
  // tracks running into the shed from the north
  for (const x of [12, 22, 40, 50]) {
    rect(g, x, 0, 6, 8, '#6f6658');
    rect(g, x + 1, 0, 1, 8, '#3a3a3a');
    rect(g, x + 4, 0, 1, 8, '#3a3a3a');
  }
  // barrel-vaulted glass train shed: iron ribs over glazing, lighter at the crown
  const sx = 4, sy = 4, sw = 56, sh = 30;
  softShadow(g, sx, sy, sw, sh);
  rect(g, sx, sy, sw, sh, '#4f5b66');
  const bands = ['#7fa6b0', '#9cc3c9', '#bfe0e2', '#d8f0f0', '#bfe0e2', '#9cc3c9', '#7fa6b0'];
  const bw = (sw - 4) / bands.length;
  bands.forEach((c, i) => rect(g, sx + 2 + i * bw, sy + 2, Math.ceil(bw), sh - 4, c));
  for (let y = sy + 4; y < sy + sh - 2; y += 4) rect(g, sx + 2, y, sw - 4, 1, '#3e4a55');
  rect(g, sx + sw / 2 - 0.5, sy + 1, 1, sh - 2, '#3e4a55');
  outline(g, sx, sy, sw, sh);
  // head building: terracotta roof, sandstone front with a great arched window
  const seam = box(g, 2, 30, 58, 28, '#7a3d2c', '#d8c9a4', 11);
  rect(g, 2, 30, 58, 2, '#a85a45');
  for (let i = 0; i < 8; i++) {
    const x = 5 + i * 7;
    if (x > 21 && x < 39) continue;
    rect(g, x, seam + 3, 3, 5, win(lit, 21 + i));
  }
  // arched window
  g.fillStyle = '#3a5568';
  g.beginPath();
  g.moveTo(23, seam + 11);
  g.lineTo(23, seam + 2);
  g.arc(31, seam + 2, 8, Math.PI, 0);
  g.lineTo(39, seam + 11);
  g.closePath();
  g.fill();
  g.fillStyle = lit ? WARM : NIGHT_GLASS;
  g.beginPath();
  g.moveTo(24.5, seam + 10);
  g.lineTo(24.5, seam + 2);
  g.arc(31, seam + 2, 6.5, Math.PI, 0);
  g.lineTo(37.5, seam + 10);
  g.closePath();
  g.fill();
  rect(g, 31, seam - 5, 1, 15, '#3a5568');
  rect(g, 24, seam + 4, 14, 1, '#3a5568');
  // corner towers with copper caps, and a clock over the arch
  for (const tx of [4, 50]) {
    softShadow(g, tx, 22, 9, 16);
    rect(g, tx, 22, 9, 16, '#c9b88f');
    rect(g, tx + 7, 22, 2, 16, 'rgba(0,0,0,0.18)');
    outline(g, tx, 22, 9, 16);
    poly(g, [[tx - 1, 23], [tx + 4.5, 15], [tx + 10, 23]], COPPER);
    poly(g, [[tx - 1, 23], [tx + 4.5, 15], [tx + 4.5, 23]], shade(COPPER, 0.2));
  }
  circle(g, 31, seam - 10, 4, '#f5f0e0');
  rect(g, 31, seam - 13, 1, 3, '#222');
  rect(g, 31, seam - 10, 2, 1, '#222');
}

function library(g: Ctx, lit: boolean): void {
  plaza(g);
  rect(g, 2, 2, 12, 46, LAWN);
  rect(g, 50, 2, 12, 46, LAWN);
  tree(g, 7, 10, 4);
  tree(g, 57, 10, 4);
  tree(g, 7, 36, 4);
  tree(g, 57, 36, 4);
  // pale stone hall with a flat leaded roof
  const seam = box(g, 8, 14, 48, 34, '#b9b4a8', STONE, 9);
  rect(g, 10, 16, 44, 2, shade('#b9b4a8', 0.2));
  for (let i = 0; i < 6; i++) {
    const x = 11 + i * 7.5;
    if (x > 22 && x < 40) continue;
    rect(g, x, seam + 2, 3, 5, win(lit, 41 + i));
  }
  // drum and copper dome (the library's mark)
  const dx = 32, dy = 24;
  rect(g, dx - 11, dy, 22, 9, '#d7cfbb');
  for (let x = dx - 9; x <= dx + 9; x += 4) rect(g, x, dy + 2, 1, 6, 'rgba(0,0,0,0.25)');
  circle(g, dx + 2, dy + 2, 11, 'rgba(0,0,0,0.2)');
  circle(g, dx, dy, 11, COPPER);
  circle(g, dx - 3, dy - 3, 6, shade(COPPER, 0.22));
  g.strokeStyle = shade(COPPER, -0.35);
  g.lineWidth = 1;
  for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
    g.beginPath();
    g.ellipse(dx, dy, Math.abs(Math.sin(a)) * 11 + 0.5, 11, 0, -Math.PI / 2, Math.PI / 2, a < 0);
    g.stroke();
  }
  circle(g, dx, dy - 11, 2.5, '#e8e0cc'); // lantern
  rect(g, dx - 0.5, dy - 17, 1, 5, GOLD);
  // portico: pediment, six columns and wide steps
  const px0 = 22, px1 = 42;
  rect(g, px0, seam - 3, px1 - px0, 12, '#f1ebdc');
  poly(g, [[px0 - 2, seam - 2], [dx, seam - 8], [px1 + 2, seam - 2]], '#e2d8c0');
  columns(g, px0 + 2, px1 - 2, seam - 1, 6, 10);
  for (let i = 0; i < 3; i++) rect(g, px0 - 2 - i * 2, seam + 9 + i * 2, px1 - px0 + 4 + i * 4, 2, i % 2 ? '#d8d0bc' : '#e9e2d0');
}

function stadium(g: Ctx, lit: boolean): void {
  plaza(g);
  const cx = 31, cy = 31;
  // outer concrete bowl, then tiers of red seating
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.ellipse(cx + 3, cy + 3, 29, 28, 0, 0, Math.PI * 2);
  g.fill();
  const ring = (rx: number, ry: number, c: string): void => {
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  ring(29, 28, '#b7b0a3');
  ring(27, 26, '#8a2f2a');
  ring(24, 23, '#b0403a');
  ring(21, 20, '#8a2f2a');
  // gangways cut through the stands
  g.strokeStyle = '#d8d0c0';
  g.lineWidth = 1.2;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 + Math.PI / 12;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 19, cy + Math.sin(a) * 18);
    g.lineTo(cx + Math.cos(a) * 28, cy + Math.sin(a) * 27);
    g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(cx, cy, 29, 28, 0, 0, Math.PI * 2);
  g.stroke();
  // pitch with mowing stripes and white markings
  const px = 18, py = 15, pw = 26, ph = 32;
  rect(g, px - 2, py - 2, pw + 4, ph + 4, '#3f7f33');
  for (let i = 0; i < ph; i += 4) rect(g, px, py + i, pw, 2, '#5aa847');
  for (let i = 2; i < ph; i += 4) rect(g, px, py + i, pw, 2, '#4f9a3e');
  g.strokeStyle = '#f4f4ec';
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  g.beginPath();
  g.moveTo(px, py + ph / 2);
  g.lineTo(px + pw, py + ph / 2);
  g.stroke();
  g.beginPath();
  g.arc(px + pw / 2, py + ph / 2, 4, 0, Math.PI * 2);
  g.stroke();
  g.strokeRect(px + pw / 2 - 6.5, py + 0.5, 13, 5);
  g.strokeRect(px + pw / 2 - 6.5, py + ph - 5.5, 13, 5);
  // floodlight pylons at the corners, lamps raised above the footprint
  for (const [fx, fy] of [[4, 6], [58, 6], [4, 58], [58, 58]]) {
    rect(g, fx + 1, fy - 13, 2, 14, 'rgba(0,0,0,0.25)');
    rect(g, fx, fy - 14, 2, 15, '#5a5f66');
    rect(g, fx - 3, fy - 18, 8, 5, '#3a3f46');
    rect(g, fx - 2, fy - 17, 6, 3, lit ? '#fff6c8' : '#d9dccf');
  }
}

/** A ¾ block: ground rect (x, y, w, d) standing z0..z1 px above the ground; returns its roof top, facade top and base y. */
function slab(g: Ctx, x: number, y: number, w: number, d: number, z0: number, z1: number, roof: string, face: string): { top: number; face: number; base: number } {
  const top = y - z1;
  const fTop = y + d - z1;
  const base = y + d - z0;
  rect(g, x, top, w, d, roof);
  rect(g, x, top, w, 1, shade(roof, 0.3));
  rect(g, x, fTop, w, base - fTop, face);
  outline(g, x, top, w, base - top);
  return { top, face: fTop, base };
}

function skyscraper(g: Ctx, lit: boolean): void {
  plaza(g);
  tree(g, 5, 60, 3);
  tree(g, 59, 60, 3);
  const facade = '#cfc6b2';
  const roof = '#8f8a80';
  const Z = LANDMARK_HEIGHT.skyscraper;
  /** A storeyed facade: gold band at the top, piers, a window grid. */
  const storeys = (x: number, fy: number, w: number, h: number, seed: number): void => {
    rect(g, x, fy, w, 1, GOLD);
    for (let px = x + 2; px < x + w - 2; px += 4) rect(g, px + 3, fy + 1, 1, h - 1, shade(facade, -0.2)); // piers
    let n = seed;
    for (let ry = fy + 3; ry + 2 <= fy + h - 1; ry += 3) {
      for (let px = x + 2; px + 2 <= x + w - 2; px += 4) rect(g, px, ry, 2, 2, win(lit, n++, 0.55));
    }
    rect(g, x + w - 2, fy + 1, 2, h - 1, 'rgba(0,0,0,0.16)'); // corner shade
  };
  // the slab: a 36 × 24 plot at the back of the block, Z px tall
  softShadow(g, 14, 12 + 24 - Z, 36, Z);
  const shaft = slab(g, 14, 12, 36, 24, 0, Z, roof, facade);
  rect(g, 16, shaft.top + 2, 32, 20, shade(roof, 0.12));
  storeys(14, shaft.face, 36, shaft.base - shaft.face, 100);
  // stepped deco crown on the slab's roof, then the spire
  const crown = slab(g, 20, 16, 24, 14, Z, Z + 10, '#d9d2bf', '#e1d9c4');
  storeys(20, crown.face, 24, crown.base - crown.face, 300);
  rect(g, 27, crown.top + 4, 10, 6, '#e8e0cc');
  rect(g, 27, crown.top + 10, 10, 2, shade('#e8e0cc', -0.25));
  poly(g, [[29, crown.top + 5], [32, crown.top - 4], [35, crown.top + 5]], '#c8ccd0');
  rect(g, 31.5, crown.top - 8, 1, 5, '#9aa4ae');
  circle(g, 32, crown.top - 8, 1, lit ? '#ff6a5a' : '#b04a40');
  // podium in front: a two-storey base along the plaza
  softShadow(g, 6, 48, 52, 10);
  const pod = slab(g, 6, 36, 52, 22, 0, 10, roof, facade);
  rect(g, 8, pod.top + 2, 48, 18, shade(roof, 0.18));
  for (let px = 12; px < 54; px += 10) rect(g, px, pod.top + 6, 6, 4, shade(roof, -0.15)); // roof lights
  storeys(6, pod.face, 52, pod.base - pod.face, 500);
  // entrance canopy
  rect(g, 24, 56, 14, 3, '#2b2f36');
  rect(g, 28, 56, 6, 2, lit ? WARM : NIGHT_GLASS);
}

function park(g: Ctx, lit: boolean): void {
  // lawn with a gravel cross of paths and a hedge border
  rect(g, 0, 0, LANDMARK_PX, LANDMARK_PX, LAWN);
  for (let i = 0; i < 40; i++) rect(g, Math.floor(h(i) * 62), Math.floor(h(i + 99) * 62), 2, 1, shade(LAWN, h(i + 7) < 0.5 ? 0.12 : -0.12));
  g.strokeStyle = '#3f6b2c';
  g.lineWidth = 2;
  g.strokeRect(1, 1, LANDMARK_PX - 2, LANDMARK_PX - 2);
  const GRAVEL = '#d8cba8';
  rect(g, 29, 0, 6, LANDMARK_PX, GRAVEL);
  rect(g, 0, 29, LANDMARK_PX, 6, GRAVEL);
  rect(g, 29, 0, 1, LANDMARK_PX, shade(GRAVEL, -0.15));
  rect(g, 0, 29, LANDMARK_PX, 1, shade(GRAVEL, -0.15));
  // ornamental pond with a lily or two
  g.fillStyle = shade(GRAVEL, -0.2);
  g.beginPath();
  g.ellipse(48, 48, 11, 8, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4f86a8';
  g.beginPath();
  g.ellipse(48, 48, 9.5, 6.5, 0, 0, Math.PI * 2);
  g.fill();
  rect(g, 42, 45, 6, 1, '#8fc0d8');
  circle(g, 51, 50, 1.4, '#7fb257');
  circle(g, 45, 51, 1.1, '#7fb257');
  // flower bed
  for (let i = 0; i < 12; i++) circle(g, 8 + (i % 6) * 3, 46 + Math.floor(i / 6) * 4, 1.2, ['#d9463b', '#f2c94c', '#e88ab0'][i % 3]);
  // trees along the paths
  for (const [x, y] of [[8, 8], [20, 10], [10, 20], [44, 8], [56, 14], [52, 24], [6, 58]]) tree(g, x, y, 4.5);
  // bandstand at the crossing: an octagon of posts under a striped canopy, raised above the lawn
  const cx = 32, cy = 32;
  circle(g, cx + 2, cy + 2, 8, 'rgba(0,0,0,0.2)');
  circle(g, cx, cy, 8, '#e9e2d0');
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    rect(g, cx + Math.cos(a) * 6.5 - 0.5, cy + Math.sin(a) * 6.5 - 8, 1, 8, '#f6f1e4');
  }
  const top = cy - LANDMARK_HEIGHT.park + 2;
  for (let i = 0; i < 8; i++) {
    const a0 = (i * Math.PI) / 4, a1 = ((i + 1) * Math.PI) / 4;
    poly(g, [[cx, top - 4], [cx + Math.cos(a0) * 9, top + Math.sin(a0) * 9], [cx + Math.cos(a1) * 9, top + Math.sin(a1) * 9]], i % 2 ? '#f6f1e4' : '#2f6f5f');
  }
  rect(g, cx - 0.5, top - 8, 1, 4, GOLD);
  // lamps along the paths
  for (const [x, y] of [[26, 14], [38, 50], [14, 26], [50, 38]]) {
    rect(g, x, y - 5, 1, 5, '#2b2f36');
    circle(g, x + 0.5, y - 6, 1.5, lit ? WARM : '#c9c2a8');
  }
}

function hospital(g: Ctx, lit: boolean): void {
  plaza(g);
  rect(g, 2, 2, 60, 8, LAWN);
  tree(g, 8, 6, 3.5);
  tree(g, 56, 6, 3.5);
  // carriage drive and ambulance bay at the front
  rect(g, 18, 54, 28, 10, '#b9ae92');
  rect(g, 40, 56, 8, 5, '#f4f1ea');
  rect(g, 40, 56, 2, 5, '#c23a2f');
  // two pavilion wings either side of a taller central block, white render with slate roofs
  const RENDER = '#f1ece0';
  const SLATE = '#6a7280';
  for (const x of [4, 44]) {
    const seam = box(g, x, 18, 16, 34, SLATE, RENDER, 8);
    rect(g, x + 1, 19, 7, seam - 20, shade(SLATE, 0.15));
    for (let i = 0; i < 3; i++) rect(g, x + 2 + i * 5, seam + 2, 3, 4, win(lit, 60 + x + i, 0.8));
  }
  const Z = LANDMARK_HEIGHT.hospital;
  softShadow(g, 18, 22 + 30 - Z, 28, Z);
  const main = slab(g, 18, 22, 28, 30, 0, Z, '#d9d4c6', RENDER);
  rect(g, 20, main.top + 2, 24, 26, shade('#d9d4c6', 0.1));
  // red cross on the roof
  rect(g, 29, main.top + 8, 6, 16, '#c23a2f');
  rect(g, 24, main.top + 13, 16, 6, '#c23a2f');
  rect(g, 29, main.top + 8, 6, 1, shade('#c23a2f', 0.3));
  // storeys of windows on the main front, a canopied entrance
  for (let ry = main.face + 3; ry + 3 <= main.base - 6; ry += 5) {
    for (let px = 21; px + 3 <= 43; px += 5) rect(g, px, ry, 3, 3, win(lit, px * 7 + ry, 0.75));
  }
  rect(g, 27, main.base - 5, 10, 5, lit ? WARM : NIGHT_GLASS);
  rect(g, 25, main.base - 6, 14, 2, '#c23a2f');
}

/** One painter per landmark; the catalog test checks every LandmarkId has one. */
export const LANDMARK_PAINTERS: Record<LandmarkId, LandmarkPainter> = {
  church,
  town_hall: townHall,
  grand_station: grandStation,
  library,
  stadium,
  skyscraper,
  park,
  hospital,
};

/** Sun-shadow casters per landmark, footprint-local px, roughly following each painter's masses. */
export const LANDMARK_CASTERS: Record<LandmarkId, ShadowCaster[]> = {
  church: [
    { x: 21, y: 18, w: 22, d: 32, z: 12 },
    { x: 10, y: 26, w: 44, d: 10, z: 8 },
    { x: 25, y: 46, w: 14, d: 10, z: LANDMARK_HEIGHT.church, taper: true },
  ],
  town_hall: [
    { x: 3, y: 26, w: 56, d: 24, z: 10 },
    { x: 25, y: 18, w: 12, d: 8, z: LANDMARK_HEIGHT.town_hall },
  ],
  grand_station: [
    { x: 4, y: 12, w: 56, d: 22, z: 8 },
    { x: 2, y: 42, w: 58, d: 16, z: LANDMARK_HEIGHT.grand_station },
  ],
  library: [
    { x: 8, y: 23, w: 48, d: 25, z: 9 },
    { x: 21, y: 26, w: 22, d: 12, z: LANDMARK_HEIGHT.library, taper: true },
  ],
  stadium: [
    { x: 3, y: 8, w: 56, d: 50, z: 4 },
    ...[[4, 6], [58, 6], [4, 58], [58, 58]].map(([x, y]) => ({ x: x - 1, y: y - 1, w: 3, d: 2, z: LANDMARK_HEIGHT.stadium })),
  ],
  skyscraper: [
    { x: 14, y: 12, w: 36, d: 24, z: LANDMARK_HEIGHT.skyscraper },
    { x: 20, y: 16, w: 24, d: 14, z: LANDMARK_HEIGHT.skyscraper + 10 },
    { x: 30, y: 21, w: 4, d: 4, z: LANDMARK_HEIGHT.skyscraper + 22, taper: true },
    { x: 6, y: 36, w: 52, d: 22, z: 10 },
  ],
  park: [
    { x: 24, y: 24, w: 16, d: 16, z: LANDMARK_HEIGHT.park, taper: true },
    ...[[8, 8], [20, 10], [10, 20], [44, 8], [56, 14], [52, 24], [6, 58]].map(([x, y]) => ({ x: x - 3, y: y - 3, w: 6, d: 6, z: 6 })),
  ],
  hospital: [
    { x: 4, y: 26, w: 16, d: 26, z: 8 },
    { x: 44, y: 26, w: 16, d: 26, z: 8 },
    { x: 18, y: 22, w: 28, d: 30, z: LANDMARK_HEIGHT.hospital },
  ],
};

/** Paints landmark `id` with its footprint's top-left corner at (px, py). */
export function drawLandmark(g: Ctx, id: LandmarkId, px: number, py: number, lit: boolean): void {
  const paint = LANDMARK_PAINTERS[id];
  if (!paint) return;
  g.save();
  g.translate(px, py);
  paint(g, lit);
  g.restore();
}
