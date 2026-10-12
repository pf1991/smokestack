// Dev-only sprite sheet: run `npm run dev` and open /sprites-preview.html (add ?debug for chimney markers)
import { BUILDINGS } from '../data/buildings';
import { LANDMARK_IDS } from '../data/landmarks';
import { drawLandmark, LANDMARK_HEADROOM, LANDMARK_PX } from './landmarks';
import { chimneyOffsets, drawHouse, drawTrain, drawTruck, getBuildingSprite, windowRects } from './sprites';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ZOOM = 2;
const WIDTH = 1400;
const debug = location.search.includes('debug');
const logicalW = WIDTH / ZOOM;

type Item = { x: number; y: number; draw: (g: CanvasRenderingContext2D) => void };
const items: Item[] = [];

// layout pass
let y = 4;
for (const owner of ['player', 'rival']) {
  let x = 4, rowH = 0;
  for (const def of Object.values(BUILDINGS)) {
    const variants = def.id === 'farm' ? ['grain', 'cotton', 'fruit'] : [''];
    for (const v of variants) {
      const s = getBuildingSprite(def.id, owner, v);
      if (x + s.width > logicalW - 4) { x = 4; y += rowH + 6; rowH = 0; }
      const ix = x, iy = y;
      items.push({
        x: ix, y: iy,
        draw: g => {
          g.drawImage(s, ix, iy);
          if (debug) for (const c of chimneyOffsets(def.id)) { g.fillStyle = 'rgba(255,0,255,0.8)'; g.fillRect(ix + c.x - 1, iy + c.y - 1, 2, 2); }
          if (owner === 'rival') for (const r of windowRects(def.id)) { g.fillStyle = '#ffd27a'; g.fillRect(ix + r.x, iy + r.y, r.w, r.h); }
        },
      });
      x += s.width + 6;
      rowH = Math.max(rowH, s.height);
    }
  }
  y += rowH + 10;
}
for (const year of [1905, 1930, 1950, 1990]) {
  let x = 4;
  const iy = y;
  for (let v = 0; v < 8; v++) {
    const ix = x, lit = v >= 4;
    items.push({ x: ix, y: iy, draw: g => drawHouse(g, ix, iy, v, year, lit) });
    x += 34;
  }
  y += 34;
}
{
  const iy = y;
  let x = 20;
  for (const dir of ['N', 'E', 'S', 'W'] as const) {
    const ix = x;
    items.push({ x: ix, y: iy, draw: g => { drawTruck(g, ix, iy + 12, dir, 'player', '#8b5a2b'); drawTruck(g, ix + 30, iy + 12, dir, 'rival', null); } });
    x += 70;
  }
  items.push({ x: 400, y: iy, draw: g => { drawTrain(g, 400, iy + 12, 'E', 'player', 3); drawTrain(g, 560, iy + 12, 'W', 'rival', 2); } });
  y += 30;
}
// landmarks: day row, then night row
for (const lit of [false, true]) {
  const iy = y + LANDMARK_HEADROOM;
  let x = 4;
  for (const id of LANDMARK_IDS) {
    const ix = x;
    items.push({ x: ix, y: iy, draw: g => drawLandmark(g, id, ix, iy, lit) });
    x += LANDMARK_PX + 10;
  }
  y += LANDMARK_PX + LANDMARK_HEADROOM + 8;
}

// size first (resets transform), then scale, fill, draw
canvas.width = WIDTH;
canvas.height = Math.ceil(y * ZOOM);
const g = canvas.getContext('2d')!;
g.scale(ZOOM, ZOOM);
g.imageSmoothingEnabled = false;
g.fillStyle = '#6f8a45';
g.fillRect(0, 0, logicalW, y);
for (const it of items) it.draw(g);
