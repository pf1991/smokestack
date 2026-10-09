// Dev-only sprite sheet: run `npm run dev` and open /sprites-preview.html
import { BUILDINGS } from '../data/buildings';
import { chimneyOffsets, drawHouse, drawTrain, drawTruck, getBuildingSprite, windowRects } from './sprites';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ZOOM = 2;
canvas.width = 1500;
canvas.height = 1500;
const g = canvas.getContext('2d')!;
g.imageSmoothingEnabled = false;
g.scale(ZOOM, ZOOM);
g.fillStyle = '#6f8a45';
g.fillRect(0, 0, canvas.width, canvas.height);

let y = 4;
for (const owner of ['player', 'rival'] as const) {
  let x = 4, rowH = 0;
  for (const def of Object.values(BUILDINGS)) {
    const variants = def.id === 'farm' ? ['grain', 'cotton', 'fruit'] : [''];
    for (const v of variants) {
      const s = getBuildingSprite(def.id, owner, v);
      if (x + s.width > canvas.width / ZOOM - 4) { x = 4; y += rowH + 6; rowH = 0; }
      g.drawImage(s, x, y);
      for (const c of chimneyOffsets(def.id)) { g.fillStyle = 'rgba(255,0,255,0.8)'; g.fillRect(x + c.x - 1, y + c.y - 1, 2, 2); }
      if (owner === 'rival') for (const r of windowRects(def.id)) { g.fillStyle = '#ffd27a'; g.fillRect(x + r.x, y + r.y, r.w, r.h); }
      x += s.width + 6;
      rowH = Math.max(rowH, s.height);
    }
  }
  y += rowH + 10;
}

for (const year of [1905, 1930, 1950, 1990]) {
  let x = 4;
  for (let v = 0; v < 4; v++) { drawHouse(g, x, y, v, year, false); x += 34; }
  for (let v = 0; v < 4; v++) { drawHouse(g, x, y, v, year, true); x += 34; }
  y += 34;
}

let x = 20;
for (const dir of ['N', 'E', 'S', 'W'] as const) {
  drawTruck(g, x, y + 12, dir, 'player', '#8b5a2b');
  drawTruck(g, x + 30, y + 12, dir, 'rival', null);
  x += 70;
}
drawTrain(g, 400, y + 12, 'E', 'player', 3);
drawTrain(g, 480, y + 12, 'W', 'rival', 2);
