import type { GameMap, Tile } from '../../sim/types';
import { TILE } from '../camera';
import { type Ctx, E, N, S, W, bitCount, h01 } from './shared';

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

// ---------------------------------------------------------------- road painter

/** Paints one road tile (dirt or asphalt, with optional sidewalks and lamp post) at (0,0). */
export function paintRoadTile(g: Ctx, mask: number, era: 'dirt' | 'asphalt' | 'lanes', urban: boolean, winter: boolean, x: number, y: number, seed: number, lamp: boolean): void {
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
export function paintBridgeTile(g: Ctx, mask: number, era: 'dirt' | 'asphalt' | 'lanes'): void {
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
