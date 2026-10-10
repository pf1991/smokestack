// Dev-only preview: open /rail-preview.html under `npm run dev`.
// Query params: ?year=1960 (diesel) &hour=22 &month=1 &zoom=1.5 &ticks=30 (sim ticks before the first frame)
import { buildRail, buyTrain } from '../sim/rail';
import { buildRoad, lPath, placeBuilding } from '../sim/state';
import { must, testCtx, testState } from '../sim/testkit';
import type { Vec2 } from '../sim/types';
import { buyTruck, createRoute, vehiclesTick } from '../sim/vehicles';
import { TILE, type Camera } from './camera';
import { WorldRenderer } from './world';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);

const year = num('year', 1905);
const state = testState({ width: 36, height: 22, year, money: 10_000_000 });
state.date = { year, month: num('month', 6), day: 10, hour: num('hour', 12) };
const ctx = testCtx(state);
const setT = (x0: number, y0: number, w: number, h: number, t: 'water' | 'forest' | 'sand') => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) state.map.tiles[y * state.map.width + x].terrain = t;
};
setT(5, 10, 5, 4, 'water');
setT(24, 2, 6, 4, 'forest');
setT(1, 16, 8, 5, 'sand');
setT(14, 1, 3, 3, 'forest');

const a = must(placeBuilding(ctx, 'player', 'train_station', { x: 3, y: 4 }));
const b = must(placeBuilding(ctx, 'player', 'train_station', { x: 28, y: 12 }));
const mine = must(placeBuilding(ctx, 'player', 'lumber_camp', { x: 24, y: 2 }));
const rail = (p: Vec2, q2: Vec2) => must(buildRail(ctx, 'player', lPath(p, q2)));
rail({ x: 3, y: 6 }, { x: 20, y: 14 }); // east along y=6, then south on x=20
rail({ x: 20, y: 14 }, { x: 30, y: 14 });
rail({ x: 16, y: 6 }, { x: 16, y: 9 }); // siding (T junction)
// roads: a north-south road crossing the line on x=12, and an east-west one on y=10 crossing x=20
must(buildRoad(ctx, 'player', lPath({ x: 12, y: 0 }, { x: 12, y: 21 })));
must(buildRoad(ctx, 'player', lPath({ x: 12, y: 10 }, { x: 26, y: 10 })));
must(buildRoad(ctx, 'player', lPath({ x: 26, y: 10 }, { x: 26, y: 3 })));
must(buildRoad(ctx, 'player', lPath({ x: 26, y: 10 }, { x: 31, y: 10 })));
must(buildRoad(ctx, 'player', lPath({ x: 31, y: 10 }, { x: 31, y: 12 })));

a.input.coal = 400;
b.input.steel = 400;
const line = must(createRoute(ctx, 'player', 'Coal line', [
  { buildingId: a.id, load: ['coal'], unload: ['steel'] },
  { buildingId: b.id, load: ['steel'], unload: ['coal'] },
], 'train'));
must(buyTrain(ctx, 'player', line.id));
const feeder = must(createRoute(ctx, 'player', 'Feeder', [
  { buildingId: mine.id, load: ['wood'], unload: [] },
  { buildingId: b.id, load: [], unload: ['wood'] },
]));
mine.output.wood = 100;
must(buyTruck(ctx, 'player', feeder.id));

const tick = () => {
  state.tick++;
  vehiclesTick(ctx);
};
const ticks = num('ticks', 30);
const second = num('second', 1);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const cam: Camera = { x: 0, y: 0, zoom: num('zoom', 1.5), viewW: 0, viewH: 0 };
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
cam.viewW = canvas.width;
cam.viewH = canvas.height;
cam.x = num('cx', 17) * TILE - cam.viewW / cam.zoom / 2;
cam.y = num('cy', 10) * TILE - cam.viewH / cam.zoom / 2;

const world = new WorldRenderer(canvas, state);
const MS_PER_TICK = 2000 / 24;
let acc = 0;
let last = performance.now();
// run the sim with 5 rendered frames per tick so wagon trails and smoke build up as in play
let f = 0;
for (let i = 0; i < ticks; i++) {
  if (second && i === 22) must(buyTrain(ctx, 'player', line.id)); // a second train, out of phase
  tick();
  for (let k = 1; k <= 5; k++) world.render(state, cam, k / 5, f++ * 17);
}
const freeze = q.get('freeze') === '1';
function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  acc += dt;
  while (!freeze && acc >= MS_PER_TICK) {
    tick();
    acc -= MS_PER_TICK;
  }
  if (freeze) acc = MS_PER_TICK;
  world.render(state, cam, acc / MS_PER_TICK, now);
  const trains = Object.values(state.vehicles).filter((v) => v.kind === 'train');
  hud.textContent = `${state.date.year} · ${trains.map((t) => `${t.state} ${JSON.stringify(t.cargo)}`).join(' | ')}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
