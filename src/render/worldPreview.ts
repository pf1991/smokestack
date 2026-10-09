// Dev-only preview: open /world-preview.html under `npm run dev`.
// Query params: ?hour=22&month=1&year=1960&zoom=1.5&sel=route|building|vehicle&ghost=1&seed=1
import { EventBus } from '../core/events';
import { BUILDINGS } from '../data/buildings';
import { findPath, roadBuildable, roadPassable } from '../sim/pathfinding';
import { accessTiles, buildRoad, createGame, findPlacement, layCityStreets, placeBuilding, refreshUrbanTiles, unlockedAt } from '../sim/state';
import type { Building, BuildingTypeId, OwnerId, SimContext, Vec2, Vehicle } from '../sim/types';
import { TILE, clampCamera, zoomAt, type Camera } from './camera';
import { WorldRenderer } from './world';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);

const state = createGame({ seed: num('seed', 1), rival: false });
state.date = { year: num('year', 1905), month: num('month', 6), day: 10, hour: num('hour', 12) };
state.unlocked = unlockedAt(state.date.year);
state.companies.player.money = 10_000_000;
state.companies.rival.money = 10_000_000;
const bus = new EventBus();
const ctx: SimContext = { state, bus };

const city = [...state.cities].sort((a, b) => b.population - a.population)[0];
if (q.has('pop')) {
  // grow the city (e.g. ?pop=12000) to preview a full-size town
  city.population = num('pop', city.population);
  layCityStreets(state.map, city);
  refreshUrbanTiles(state);
}
const c = city.center;
const R = city.urbanRadius;

function connect(b: Building): void {
  // road from a tile beside the footprint to the nearest city road
  const def = BUILDINGS[b.typeId];
  const starts: Vec2[] = [
    { x: b.pos.x + Math.floor(def.size.w / 2), y: b.pos.y + def.size.h },
    { x: b.pos.x + Math.floor(def.size.w / 2), y: b.pos.y - 1 },
    { x: b.pos.x - 1, y: b.pos.y + Math.floor(def.size.h / 2) },
    { x: b.pos.x + def.size.w, y: b.pos.y + Math.floor(def.size.h / 2) },
  ];
  for (const s of starts) {
    const t = state.map.tiles[s.y * state.map.width + s.x];
    if (!t || !roadBuildable(t, s.x, s.y)) continue;
    const path = findPath(state.map, s, [c], roadBuildable, (tile) => (tile.road ? 0.3 : tile.terrain === 'water' ? 8 : 1));
    if (path && buildRoad(ctx, b.ownerId, path).ok) return;
  }
}

function place(typeId: BuildingTypeId, near: Vec2, owner: OwnerId = 'player'): Building | null {
  const pos = findPlacement(state, owner, typeId, near, 24);
  if (!pos) {
    console.warn('no placement for', typeId);
    return null;
  }
  const r = placeBuilding(ctx, owner, typeId, pos);
  if (!r.ok) return null;
  if (!BUILDINGS[typeId].requiresCity) connect(r.value);
  return r.value;
}

const camp = place('lumber_camp', { x: c.x - R - 4, y: c.y - 2 });
const mill = place('sawmill', { x: c.x - R - 3, y: c.y + 3 });
const furn = place('furniture_factory', { x: c.x + R + 3, y: c.y - 2 });
const steel = place('steel_mill', { x: c.x + R + 3, y: c.y + 4 });
const store = place('store', { x: c.x + 1, y: c.y + 1 });
const rivalStore = place('store', { x: c.x - 2, y: c.y - 3 }, 'rival');
const built = [camp, mill, furn, steel, store, rivalStore].filter((b): b is Building => !!b);
for (const b of built) if (BUILDINGS[b.typeId].category === 'factory' || b.typeId === 'lumber_camp') b.status = 'ok';
if (steel) steel.status = 'ok';
if (furn) furn.status = 'no_input';

// a short bridge over the nearest narrow stretch of water, to show bridge decks
(function bridge(): void {
  const { map } = state;
  const ok = (x: number, y: number): boolean => {
    const t = map.tiles[y * map.width + x];
    return !!t && t.terrain !== 'water' && t.terrain !== 'mountain' && t.buildingId === null;
  };
  for (let d = 0; d < 14; d++) {
    for (const y of [c.y - d, c.y + d]) {
      for (let x = Math.max(1, c.x - 16); x < Math.min(map.width - 10, c.x + 16); x++) {
        if (!ok(x, y) || map.tiles[y * map.width + x + 1].terrain !== 'water') continue;
        let n = 1;
        while (n < 8 && map.tiles[y * map.width + x + n].terrain === 'water') n++;
        if (n < 3 || n >= 8 || !ok(x + n, y)) continue;
        const tiles: Vec2[] = [];
        for (let i = -1; i <= n + 1; i++) if (ok(x + i, y) || map.tiles[y * map.width + x + i].terrain === 'water') tiles.push({ x: x + i, y });
        if (buildRoad(ctx, 'player', tiles).ok) return;
      }
    }
  }
})();

const routeStops =[camp, mill, furn, store].filter((b): b is Building => !!b);
state.routes[900] = {
  id: 900,
  ownerId: 'player',
  name: 'Furniture line',
  color: '#e0a030',
  kind: 'truck',
  stops: routeStops.map((b) => ({ buildingId: b.id, load: [], unload: [] })),
};

// ---- hand-crafted vehicles shuttling along road paths between buildings
interface Mover {
  v: Vehicle;
  path: Vec2[];
  t: number;
  dirn: 1 | -1;
  speed: number;
}
const movers: Mover[] = [];
const cargoGoods = ['wood', 'lumber', 'furniture', 'steel', 'iron_ore', ''];
const pairs: [Building | null, Building | null][] = [[camp, mill], [mill, furn], [furn, store], [steel, store], [camp, store], [mill, steel]];
pairs.forEach(([a, b], i) => {
  if (!a || !b) return;
  const from = accessTiles(state, a)[0];
  const to = accessTiles(state, b);
  if (!from || !to.length) return;
  const path = findPath(state.map, from, to, roadPassable);
  if (!path || path.length < 2) return;
  const t = (i * 7) % path.length;
  const v: Vehicle = {
    id: 1000 + i,
    kind: 'truck',
    ownerId: i === 5 ? 'rival' : 'player',
    routeId: 900,
    pos: { ...path[t] },
    prevPos: { ...path[t] },
    path: [],
    pathIndex: 0,
    stopIndex: 0,
    cargo: cargoGoods[i] ? { [cargoGoods[i]]: 10 } : {},
    capacity: 20,
    state: 'moving',
    waitTicks: 0,
    stuckNotified: false,
  };
  state.vehicles[v.id] = v;
  movers.push({ v, path, t, dirn: 1, speed: 0.5 });
});

// ?stress=1: ~60 buildings and ~40 trucks for the performance budget check
if (q.get('stress') === '1') {
  const types = ['sawmill', 'steel_mill', 'furniture_factory', 'toolworks', 'glassworks', 'bakery', 'textile_mill', 'flour_mill'];
  let k = 0;
  for (let ring = R + 2; ring < R + 30 && Object.keys(state.buildings).length < 60; ring += 3) {
    for (let a = 0; a < 16 && Object.keys(state.buildings).length < 60; a++) {
      const ang = (a / 16) * Math.PI * 2 + ring;
      const near = { x: Math.round(c.x + Math.cos(ang) * ring), y: Math.round(c.y + Math.sin(ang) * ring) };
      const typeId = types[k++ % types.length];
      const pos = findPlacement(state, 'player', typeId, near, 3);
      if (!pos) continue;
      const r = placeBuilding(ctx, k % 4 === 0 ? 'rival' : 'player', typeId, pos);
      if (r.ok) r.value.status = 'ok';
    }
  }
  const base = movers.slice();
  for (let i = 0; movers.length < 40 && base.length; i++) {
    const m = base[i % base.length];
    const t = (i * 5 + 3) % m.path.length;
    const v: Vehicle = { ...m.v, id: 2000 + i, pos: { ...m.path[t] }, prevPos: { ...m.path[t] }, ownerId: i % 3 ? 'player' : 'rival' };
    state.vehicles[v.id] = v;
    movers.push({ v, path: m.path, t, dirn: i % 2 ? 1 : -1, speed: 0.5 });
  }
}

function tickMovers(): void {
  for (const m of movers) {
    m.v.prevPos = { ...m.v.pos };
    m.t += m.speed * m.dirn;
    if (m.t >= m.path.length - 1) { m.t = m.path.length - 1; m.dirn = -1; }
    if (m.t <= 0) { m.t = 0; m.dirn = 1; }
    const i = Math.floor(m.t);
    const f = m.t - i;
    const a = m.path[i];
    const b = m.path[Math.min(m.path.length - 1, i + 1)];
    m.v.pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

// ---- canvas & camera
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const cam: Camera = { x: 0, y: 0, zoom: num('zoom', 1), viewW: 0, viewH: 0 };
function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  cam.viewW = canvas.width;
  cam.viewH = canvas.height;
}
window.addEventListener('resize', resize);
resize();
cam.x = (c.x + 0.5) * TILE - cam.viewW / cam.zoom / 2;
cam.y = (c.y + 0.5) * TILE - cam.viewH / cam.zoom / 2;

const world = new WorldRenderer(canvas, state);
world.attachEffects(bus);
const sel = q.get('sel');
if (sel === 'route') world.setSelection({ routeId: 900 });
else if (sel === 'building' && furn) world.setSelection({ buildingId: furn.id });
else if (sel === 'vehicle') world.setSelection({ vehicleId: 1000 });
if (q.get('ghost') === '1') {
  world.setGhost({ kind: 'building', typeId: 'bakery', pos: { x: c.x + R + 2, y: c.y - 7 }, valid: true, label: 'Bakery  $15,000' });
}

let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.x -= (e.clientX - drag.x) / cam.zoom;
  cam.y -= (e.clientY - drag.y) / cam.zoom;
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(cam, e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

const MS_PER_TICK = 2000 / 24;
let acc = 0;
let last = performance.now();
let saleT = 0;
let avg = 0;
let worst = 0;
let frames = 0;
function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  acc += dt;
  while (acc >= MS_PER_TICK) { tickMovers(); acc -= MS_PER_TICK; }
  saleT += dt;
  if (saleT > 900 && store) {
    saleT = 0;
    const s = Math.random() < 0.7 || !rivalStore ? store : rivalStore;
    bus.emit({ type: 'sale', cityId: city.id, goodId: 'furniture', qty: 2, revenue: 96 + Math.round(Math.random() * 40), ownerId: s.ownerId, buildingId: s.id });
  }
  clampCamera(cam, state.map);
  const t0 = performance.now();
  world.render(state, cam, acc / MS_PER_TICK, now);
  const ms = performance.now() - t0;
  frames++;
  if (frames > 30) { avg = avg * 0.95 + ms * 0.05; worst = Math.max(worst, ms); }
  else avg = ms;
  (window as unknown as { __frameMs: number }).__frameMs = avg;
  if (frames % 10 === 1) {
    hud.textContent = `${city.name} · ${state.date.year}-${state.date.month} ${state.date.hour}:00 · render ${avg.toFixed(2)} ms (worst ${worst.toFixed(1)}) · ${Object.keys(state.buildings).length} bldgs · ${movers.length} trucks · particles ${world.particles.count()}`;
  }
  requestAnimationFrame(frame);
}
// warm up particles and chunk caches so headless screenshots show a steady state (?warm=0 disables)
const warm = num('warm', 180);
for (let i = 0; i < warm; i++) {
  if (i % 5 === 0) tickMovers();
  world.render(state, cam, 0, i * 16);
}
// ?bench=N: time N steady-state renders synchronously and show the mean in the HUD title
const bench = num('bench', 0);
if (bench > 0) {
  // interleave day and night rounds so machine load affects both alike
  const hour = state.date.hour;
  const tot = { day: 0, night: 0 };
  let f = 0;
  for (let round = 0; round < 6; round++) {
    const key = round % 2 ? 'night' : 'day';
    state.date.hour = key === 'day' ? 12 : 22;
    const t0 = performance.now();
    for (let i = 0; i < bench / 6; i++, f++) {
      if (f % 5 === 0) tickMovers();
      world.render(state, cam, (f % 5) / 5, warm * 16 + f * 16);
    }
    tot[key] += performance.now() - t0;
  }
  state.date.hour = hour;
  document.title = `bench day ${(tot.day / (bench / 2)).toFixed(2)} night ${(tot.night / (bench / 2)).toFixed(2)} ms/frame`;
  console.log(document.title);
}
last = performance.now();
requestAnimationFrame(frame);
