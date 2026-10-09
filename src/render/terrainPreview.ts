// Dev-only preview: open /terrain-preview.html under `npm run dev`.
import { generateMap } from '../sim/mapgen';
import { TerrainRenderer } from './terrain';
import { clampCamera, zoomAt, type Camera } from './camera';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const monthEl = document.getElementById('month') as HTMLInputElement;
const monthVal = document.getElementById('mv') as HTMLElement;
const oilEl = document.getElementById('oil') as HTMLInputElement;
const seedEl = document.getElementById('seed') as HTMLInputElement;

let { map } = generateMap(Number(seedEl.value));
let renderer = new TerrainRenderer(map, Number(seedEl.value));
const cam: Camera = { x: 0, y: 0, zoom: 1, viewW: 0, viewH: 0 };

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  cam.viewW = canvas.width;
  cam.viewH = canvas.height;
}
window.addEventListener('resize', resize);
resize();

seedEl.addEventListener('change', () => {
  const seed = Number(seedEl.value);
  map = generateMap(seed).map;
  renderer = new TerrainRenderer(map, seed);
});
monthEl.addEventListener('input', () => (monthVal.textContent = monthEl.value));

let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dpr = window.devicePixelRatio || 1;
  cam.x -= ((e.clientX - drag.x) * dpr) / cam.zoom;
  cam.y -= ((e.clientY - drag.y) * dpr) / cam.zoom;
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    zoomAt(cam, e.clientX * dpr, e.clientY * dpr, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

function frame(t: number): void {
  clampCamera(cam, map);
  ctx.fillStyle = '#1d1a16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderer.draw(ctx, cam, t, { oilVisible: oilEl.checked, month: Number(monthEl.value) });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
