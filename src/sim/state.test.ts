import { describe, it, expect } from 'vitest';
import type { GameEvent } from '../core/events';
import { BUILDINGS } from '../data/buildings';
import { findPath, roadPassable } from './pathfinding';
import {
  accessTiles,
  assetValue,
  buildingsInCity,
  buildRoad,
  canPlaceBuilding,
  createGame,
  demolishBuilding,
  findPlacement,
  footprint,
  layCityStreets,
  lPath,
  nextId,
  placeBuilding,
  refreshUrbanTiles,
  removeRoad,
} from './state';
import { testCtx, testState } from './testkit';
import type { GameState, Route, Terrain, Vec2, Vehicle } from './types';

const tile = (s: GameState, x: number, y: number) => s.map.tiles[y * s.map.width + x];
const setTerrain = (s: GameState, x0: number, y0: number, w: number, h: number, t: Terrain) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tile(s, x, y).terrain = t;
};
const snapshot = (s: GameState) => JSON.parse(JSON.stringify(s));

/** 40×30 grass world with one 1,500-pop city (urban radius 5) centred at (30,15). */
const cityWorld = (money?: number) => testState({ cities: [{ x: 30, y: 15, population: 1500 }], money });

function addVehicle(s: GameState, routeId: number | null, pos: Vec2): Vehicle {
  const v: Vehicle = {
    id: nextId(s),
    kind: 'truck',
    ownerId: 'player',
    routeId,
    pos: { ...pos },
    prevPos: { ...pos },
    path: [],
    pathIndex: 0,
    stopIndex: 0,
    cargo: {},
    capacity: 20,
    state: 'moving',
    waitTicks: 0,
    stuckNotified: false, builtYear: 1900,
  };
  s.vehicles[v.id] = v;
  return v;
}

describe('createGame', () => {
  it('createGame deterministic & cities connected', () => {
    const a = createGame({ seed: 42 });
    const b = createGame({ seed: 42 });
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.cities).toHaveLength(5);
    for (const c of a.cities) {
      let nearest = a.cities[0];
      let best = Infinity;
      for (const o of a.cities) {
        if (o === c) continue;
        const d = Math.hypot(o.center.x - c.center.x, o.center.y - c.center.y);
        if (d < best) {
          best = d;
          nearest = o;
        }
      }
      expect(findPath(a.map, c.center, [nearest.center], roadPassable), `${c.name} → ${nearest.name}`).not.toBeNull();
    }
  });

  it('starting road network joins every reachable city', () => {
    let full = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame({ seed });
      let connected = true;
      for (const a of g.cities) {
        for (const b of g.cities) {
          if (b.id <= a.id) continue;
          if (findPath(g.map, a.center, [b.center], roadPassable)) continue;
          connected = false;
          // allowed only when no road could ever join them (ignoring buildings/city land)
          const buildable = (t: { terrain: string }) => t.terrain !== 'mountain';
          expect(findPath(g.map, a.center, [b.center], buildable), `seed ${seed}: ${a.id}-${b.id}`).toBeNull();
        }
      }
      if (connected) full++;
      expect(g.map.tiles.some((t) => t.roadOwner !== null || t.railOwner !== null)).toBe(false);
    }
    expect(full).toBeGreaterThanOrEqual(18);
  });

  it('sets up companies, unlocks and urban tiles', () => {
    const g = createGame({ seed: 7, companyName: 'Acme', rival: false });
    expect(g.companies.player.name).toBe('Acme');
    expect(g.companies.player.money).toBe(300000);
    expect(g.companies.player.roadTiles).toBe(0);
    expect(g.companies.rival.active).toBe(false);
    expect(createGame({ seed: 7 }).companies.rival.active).toBe(true);
    expect(g.unlocked).toContain('wood');
    expect(g.unlocked).toContain('sawmill');
    expect(g.unlocked).toContain('r_furniture');
    expect(g.unlocked).not.toContain('cars');
    expect(g.unlocked).not.toContain('car_plant');
    expect(g.unlocked).not.toContain('r_fuel');
    expect(g.date).toEqual({ year: 1900, month: 4, day: 1, hour: 8 });
    for (const c of g.cities) {
      expect(tile(g, c.center.x, c.center.y).cityId).toBe(c.id);
      expect(tile(g, c.center.x, c.center.y).road).toBe(true);
    }
  });

  it('runs fast enough', () => {
    const t0 = Date.now();
    createGame({ seed: 123 });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('placement', () => {
  it('placement rejection matrix', () => {
    const s = cityWorld();
    const msg = (typeId: string, pos: Vec2) => {
      const r = canPlaceBuilding(s, 'player', typeId, pos);
      return r.ok ? 'ok' : r.error;
    };
    // edges
    expect(msg('sawmill', { x: 38, y: 0 })).toBe('Out of bounds');
    expect(msg('sawmill', { x: -1, y: 5 })).toBe('Out of bounds');
    expect(msg('sawmill', { x: 0, y: 28 })).toBe('Out of bounds');
    // era
    expect(msg('car_plant', { x: 2, y: 2 })).toBe('Not invented yet');
    // terrain: water and wrong land type
    setTerrain(s, 0, 20, 4, 4, 'water');
    expect(msg('sawmill', { x: 0, y: 20 })).toBe("Can't build on water");
    expect(msg('sawmill', { x: 3, y: 22 })).toBe("Can't build on water"); // partly on water
    expect(msg('lumber_camp', { x: 2, y: 2 })).toBe('Wrong terrain');
    // other buildings and roads
    const placed = placeBuilding(testCtx(s), 'player', 'sawmill', { x: 2, y: 2 });
    expect(placed.ok).toBe(true);
    expect(msg('bakery', { x: 4, y: 4 })).toBe('Tile occupied');
    tile(s, 11, 11).road = true;
    expect(msg('bakery', { x: 10, y: 10 })).toBe('Tile occupied');
    tile(s, 16, 11).rail = true;
    expect(msg('bakery', { x: 15, y: 10 })).toBe('Tile occupied');
    // cities
    expect(msg('store', { x: 5, y: 15 })).toBe('Must be inside a city');
    expect(msg('store', { x: 34, y: 15 })).toBe('Must be inside a city'); // straddles the urban edge
    expect(msg('sawmill', { x: 29, y: 14 })).toBe('Cannot build on city land');
    expect(msg('sawmill', { x: 23, y: 14 })).toBe('Cannot build on city land'); // partly urban
    // deposits
    setTerrain(s, 10, 20, 2, 2, 'hills');
    expect(msg('mine', { x: 10, y: 20 })).toBe('Needs a resource deposit');
    tile(s, 11, 21).deposit = 'oil';
    expect(msg('mine', { x: 10, y: 20 })).toBe('Needs a resource deposit');
    tile(s, 11, 21).deposit = 'coal';
    expect(msg('mine', { x: 10, y: 20 })).toBe('ok');
    // money
    s.companies.player.money = 100;
    expect(msg('bakery', { x: 15, y: 2 })).toBe('Not enough money');
    s.companies.player.money = 15000;
    expect(canPlaceBuilding(s, 'player', 'bakery', { x: 15, y: 2 })).toEqual({ ok: true, value: { cost: 15000, permit: 0 } });
    expect(msg('store', { x: 30, y: 15 })).toBe('ok');
  });

  it('refuses when unaffordable', () => {
    const s = cityWorld(100);
    const before = snapshot(s);
    const ctx = testCtx(s);
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    expect(placeBuilding(ctx, 'player', 'sawmill', { x: 2, y: 2 })).toEqual({ ok: false, error: 'Not enough money' });
    expect(buildRoad(ctx, 'player', lPath({ x: 0, y: 0 }, { x: 5, y: 0 }))).toEqual({
      ok: false,
      error: 'Not enough money',
    });
    expect(s).toEqual(before);
    expect(events).toHaveLength(0);
  });

  it('place charges cost and marks tiles', () => {
    const s = cityWorld();
    const ctx = testCtx(s);
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    const r = placeBuilding(ctx, 'player', 'sawmill', { x: 2, y: 3 });
    if (!r.ok) throw new Error(r.error);
    const b = r.value;
    expect(s.companies.player.money).toBe(300000 - 20000);
    expect(s.companies.player.ledger[0].expense.construction).toBe(20000);
    expect(b).toMatchObject({
      typeId: 'sawmill',
      ownerId: 'player',
      pos: { x: 2, y: 3 },
      recipeId: 'r_lumber',
      input: {},
      output: {},
      progress: 0,
      status: 'idle',
      cityId: null,
      haltedUntil: null,
      producedThisMonth: {},
      staffing: 1,
    });
    expect(s.buildings[b.id]).toBe(b);
    expect(footprint(b)).toHaveLength(9);
    for (const p of footprint(b)) expect(tile(s, p.x, p.y).buildingId).toBe(b.id);
    expect(tile(s, 5, 3).buildingId).toBeNull();
    expect(events).toEqual([{ type: 'buildingPlaced', building: b }]);

    const store = placeBuilding(ctx, 'player', 'store', { x: 30, y: 15 });
    if (!store.ok) throw new Error(store.error);
    expect(store.value.cityId).toBe(0);
    expect(store.value.recipeId).toBeNull();
    expect(buildingsInCity(s, 0).map((x) => x.id)).toEqual([store.value.id]);
    expect(buildingsInCity(s, 0, 'sawmill')).toEqual([]);
    expect(assetValue(s, 'player')).toBe((20000 + 15000) * 0.5);
  });

  it('picks recipes: deposit match, explicit, default', () => {
    const s = cityWorld();
    const ctx = testCtx(s);
    setTerrain(s, 10, 20, 2, 2, 'hills');
    tile(s, 10, 20).deposit = 'iron_ore';
    const mine = placeBuilding(ctx, 'player', 'mine', { x: 10, y: 20 });
    expect(mine.ok && mine.value.recipeId).toBe('r_iron');
    const farm = placeBuilding(ctx, 'player', 'farm', { x: 2, y: 2 }, 'r_fruit');
    expect(farm.ok && farm.value.recipeId).toBe('r_fruit');
    expect(placeBuilding(ctx, 'player', 'farm', { x: 6, y: 2 }, 'r_lumber')).toEqual({ ok: false, error: 'Unknown recipe' });
    const toys = placeBuilding(ctx, 'player', 'toy_factory', { x: 6, y: 2 });
    expect(toys.ok && toys.value.recipeId).toBe('r_toys_wood'); // r_toys_plastic is 1935
  });

  it('findPlacement finds a legal store spot in a city', () => {
    const s = testState({ cities: [{ x: 30, y: 15, population: 6000 }], streets: true });
    // the centre tile is a street, so the search has to walk outwards to a 2×2 gap
    const pos = findPlacement(s, 'player', 'store', { x: 30, y: 15 });
    expect(pos).not.toBeNull();
    expect(canPlaceBuilding(s, 'player', 'store', pos!).ok).toBe(true);
    expect(findPlacement(s, 'player', 'store', { x: 30, y: 15 })).toEqual(pos);
    const r = placeBuilding(testCtx(s), 'player', 'store', pos!);
    expect(r.ok).toBe(true);
    if (r.ok) expect(accessTiles(s, r.value).length).toBeGreaterThan(0);
    const next = findPlacement(s, 'player', 'store', { x: 30, y: 15 });
    expect(next).not.toBeNull();
    expect(next).not.toEqual(pos);
    // no city anywhere near → null
    expect(findPlacement(s, 'player', 'store', { x: 3, y: 3 }, 5)).toBeNull();
  });

  it('findPlacement on real maps: every city fits a store with road access', () => {
    // seeds 5 and 13 have towns ringed by forest/hills (cleared to grass by createGame)
    for (const seed of [42, 5, 13]) {
      const g = createGame({ seed });
      for (const c of g.cities) {
        const p = findPlacement(g, 'player', 'store', c.center);
        expect(p, `${seed} ${c.name}`).not.toBeNull();
        const b = placeBuilding(testCtx(g), 'player', 'store', p!);
        expect(b.ok && accessTiles(g, b.value).length > 0, `${seed} ${c.name}`).toBe(true);
      }
      expect(findPlacement(g, 'player', 'sawmill', g.cities[0].center)).not.toBeNull();
    }
  });
});

describe('demolition', () => {
  it('demolish removes route stops and refunds 25%', () => {
    const s = cityWorld();
    const ctx = testCtx(s);
    const a = placeBuilding(ctx, 'player', 'sawmill', { x: 2, y: 2 });
    const b = placeBuilding(ctx, 'player', 'furniture_factory', { x: 8, y: 2 });
    const c = placeBuilding(ctx, 'player', 'bakery', { x: 14, y: 2 });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup');
    const mk = (id: number, stops: number[]): Route => ({
      id,
      ownerId: 'player',
      name: `R${id}`,
      color: '#fff',
      kind: 'truck',
      stops: stops.map((buildingId) => ({ buildingId, load: [], unload: [] })),
    });
    const r1 = mk(nextId(s), [a.value.id, b.value.id]);
    const r2 = mk(nextId(s), [a.value.id, b.value.id, c.value.id]);
    s.routes[r1.id] = r1;
    s.routes[r2.id] = r2;
    const v1 = addVehicle(s, r1.id, { x: 5, y: 6 });
    v1.stopIndex = 1;
    const v2 = addVehicle(s, r2.id, { x: 5, y: 6 });
    v2.stopIndex = 2; // heading to C
    v2.path = [{ x: 5, y: 6 }, { x: 6, y: 6 }];
    v2.pathIndex = 1;
    const v3 = addVehicle(s, r2.id, { x: 5, y: 6 });
    v3.stopIndex = 1; // heading to B, which is demolished → takes C's place
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    const money = s.companies.player.money;

    const r = demolishBuilding(ctx, b.value.id);
    expect(r.ok).toBe(true);
    expect(s.buildings[b.value.id]).toBeUndefined();
    expect(s.companies.player.money).toBe(money + 30000 * 0.25);
    expect(s.companies.player.ledger[0].income.demolition).toBe(7500);
    expect(s.routes[r1.id].stops.map((x) => x.buildingId)).toEqual([a.value.id]);
    expect(s.routes[r2.id].stops.map((x) => x.buildingId)).toEqual([a.value.id, c.value.id]);
    expect(v1.state).toBe('idle');
    expect(v2.state).toBe('moving');
    expect(v2.stopIndex).toBe(1); // still C
    expect(v2.path).toEqual([]);
    expect(v2.pathIndex).toBe(0);
    expect(v3.stopIndex).toBe(1);
    expect(v3.path).toEqual([]);
    for (let y = 2; y < 5; y++) for (let x = 8; x < 11; x++) expect(tile(s, x, y).buildingId).toBeNull();
    expect(events).toEqual([{ type: 'buildingRemoved', buildingId: b.value.id }]);
    expect(demolishBuilding(ctx, b.value.id).ok).toBe(false);
    expect(canPlaceBuilding(s, 'player', 'sawmill', { x: 8, y: 2 }).ok).toBe(true);
  });

  it('removed target stop at the end wraps to the first stop', () => {
    const s = cityWorld();
    const ctx = testCtx(s);
    const ids = [2, 8, 14].map((x) => {
      const r = placeBuilding(ctx, 'player', 'bakery', { x, y: 2 });
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    });
    const route: Route = {
      id: nextId(s),
      ownerId: 'player',
      name: 'R',
      color: '#fff',
      kind: 'truck',
      stops: ids.map((buildingId) => ({ buildingId, load: [], unload: [] })),
    };
    s.routes[route.id] = route;
    const v = addVehicle(s, route.id, { x: 0, y: 0 });
    v.stopIndex = 2;
    expect(demolishBuilding(ctx, ids[2]).ok).toBe(true);
    expect(v.stopIndex).toBe(0);
    expect(v.state).toBe('moving');
  });

  it('demolish with an owner refuses other companies buildings', () => {
    const s = cityWorld();
    const ctx = testCtx(s);
    const b = placeBuilding(ctx, 'rival', 'bakery', { x: 2, y: 2 });
    if (!b.ok) throw new Error(b.error);
    const before = snapshot(s);
    expect(demolishBuilding(ctx, b.value.id, 'player')).toEqual({ ok: false, error: 'Not your building' });
    expect(s).toEqual(before);
    expect(demolishBuilding(ctx, b.value.id, 'rival').ok).toBe(true);
    expect(s.companies.rival.money).toBe(300000 - 15000 + 3750);
  });
});

describe('roads', () => {
  it('lPath goes horizontal then vertical, inclusive', () => {
    expect(lPath({ x: 1, y: 1 }, { x: 3, y: 3 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(lPath({ x: 3, y: 2 }, { x: 1, y: 0 })).toEqual([
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(lPath({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });

  it('builds roads, skips existing ones and counts tiles', () => {
    const s = testState();
    const ctx = testCtx(s);
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    tile(s, 2, 0).road = true;
    const r = buildRoad(ctx, 'player', lPath({ x: 0, y: 0 }, { x: 4, y: 0 }));
    expect(r).toEqual({ ok: true, value: { built: 4, cost: 2000 } });
    expect(s.companies.player.money).toBe(298000);
    expect(s.companies.player.roadTiles).toBe(4);
    expect(tile(s, 1, 0).roadOwner).toBe('player');
    expect(tile(s, 2, 0).roadOwner).toBeNull(); // pre-existing tile was skipped
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('roadChanged');
    expect(buildRoad(ctx, 'player', [{ x: 0, y: 0 }])).toEqual({ ok: true, value: { built: 0, cost: 0 } });
  });

  it('buildRoad atomic', () => {
    const s = testState();
    const ctx = testCtx(s);
    setTerrain(s, 5, 0, 1, 30, 'mountain');
    const before = snapshot(s);
    expect(buildRoad(ctx, 'player', lPath({ x: 0, y: 3 }, { x: 10, y: 3 }))).toEqual({
      ok: false,
      error: 'Cannot build road there',
    });
    expect(s).toEqual(before);
    expect(buildRoad(ctx, 'player', [{ x: -1, y: 0 }]).ok).toBe(false);
    placeBuilding(ctx, 'player', 'bakery', { x: 0, y: 10 });
    expect(buildRoad(ctx, 'player', [{ x: 1, y: 11 }])).toEqual({ ok: false, error: 'Cannot build road there' });
  });

  it('bridge costs 3000 on water', () => {
    const s = testState();
    const ctx = testCtx(s);
    setTerrain(s, 3, 0, 2, 30, 'water');
    const r = buildRoad(ctx, 'player', lPath({ x: 1, y: 5 }, { x: 6, y: 5 }));
    expect(r).toEqual({ ok: true, value: { built: 6, cost: 4 * 500 + 2 * 3000 } });
    expect(s.companies.player.money).toBe(300000 - 8000);
  });

  it('accessTiles finds adjacent roads', () => {
    const s = testState();
    const ctx = testCtx(s);
    const b = placeBuilding(ctx, 'player', 'bakery', { x: 5, y: 5 });
    if (!b.ok) throw new Error(b.error);
    expect(accessTiles(s, b.value)).toEqual([]);
    buildRoad(ctx, 'player', lPath({ x: 3, y: 4 }, { x: 8, y: 4 })); // row above, incl. diagonal corners
    buildRoad(ctx, 'player', [{ x: 7, y: 6 }]); // east side
    const acc = accessTiles(s, b.value);
    expect(acc).toHaveLength(3);
    expect(acc).toEqual(expect.arrayContaining([{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 6 }]));
  });

  it('removeRoad skips buildings, refuses vehicles and decrements count', () => {
    const s = testState();
    const ctx = testCtx(s);
    buildRoad(ctx, 'player', lPath({ x: 0, y: 0 }, { x: 9, y: 0 }));
    expect(s.companies.player.roadTiles).toBe(10);
    addVehicle(s, null, { x: 3.2, y: 0 });
    const before = snapshot(s);
    expect(removeRoad(ctx, 'player', [{ x: 2, y: 0 }, { x: 3, y: 0 }])).toEqual({
      ok: false,
      error: 'A vehicle is on that road',
    });
    expect(s).toEqual(before);
    const events: GameEvent[] = [];
    ctx.bus.onAny((e) => events.push(e));
    expect(removeRoad(ctx, 'player', [{ x: 7, y: 0 }, { x: 8, y: 0 }, { x: 20, y: 20 }]).ok).toBe(true);
    expect(tile(s, 7, 0).road).toBe(false);
    expect(tile(s, 8, 0).road).toBe(false);
    expect(s.companies.player.roadTiles).toBe(8);
    expect(tile(s, 7, 0).roadOwner).toBeNull();
    expect(events).toEqual([{ type: 'roadChanged', tiles: [{ x: 7, y: 0 }, { x: 8, y: 0 }] }]);
  });

  it('removeRoad only reduces the builder upkeep and protects other companies roads', () => {
    const s = testState();
    const ctx = testCtx(s);
    buildRoad(ctx, 'player', lPath({ x: 0, y: 0 }, { x: 4, y: 0 }));
    buildRoad(ctx, 'rival', lPath({ x: 0, y: 2 }, { x: 4, y: 2 }));
    tile(s, 0, 4).road = true; // pre-built, unowned
    tile(s, 1, 4).road = true;
    expect(s.companies.player.roadTiles).toBe(5);
    expect(s.companies.rival.roadTiles).toBe(5);

    // unowned road: removable, nobody's counter changes
    expect(removeRoad(ctx, 'player', [{ x: 0, y: 4 }]).ok).toBe(true);
    expect(tile(s, 0, 4).road).toBe(false);
    expect(s.companies.player.roadTiles).toBe(5);

    // another company's road: refused atomically, even mixed with own road
    const before = snapshot(s);
    expect(removeRoad(ctx, 'player', [{ x: 1, y: 0 }, { x: 1, y: 2 }])).toEqual({ ok: false, error: 'Not your road' });
    expect(s).toEqual(before);

    // rival removes its own
    expect(removeRoad(ctx, 'rival', [{ x: 1, y: 2 }, { x: 1, y: 4 }]).ok).toBe(true);
    expect(s.companies.rival.roadTiles).toBe(4);
    expect(s.companies.player.roadTiles).toBe(5);
    // rebuilding a removed pre-built tile makes it owned (and charged upkeep)
    expect(buildRoad(ctx, 'player', [{ x: 0, y: 4 }]).ok).toBe(true);
    expect(tile(s, 0, 4).roadOwner).toBe('player');
    expect(s.companies.player.roadTiles).toBe(6);
  });

  it('removeRoad refuses pre-built city streets but not rural links or own urban road', () => {
    const s = testState({ cities: [{ x: 10, y: 10, population: 6000 }], streets: true });
    const ctx = testCtx(s);
    const street = { x: 10, y: 10 };
    expect(tile(s, 10, 10).road).toBe(true);
    expect(tile(s, 10, 10).cityId).toBe(0);
    tile(s, 30, 25).road = true; // pre-built rural link
    const before = snapshot(s);
    expect(removeRoad(ctx, 'player', [{ x: 30, y: 25 }, street])).toEqual({
      ok: false,
      error: 'City streets belong to the town',
    });
    expect(s).toEqual(before);
    expect(removeRoad(ctx, 'player', [{ x: 30, y: 25 }]).ok).toBe(true);
    // a street the player rebuilt is the player's to remove
    tile(s, 10, 10).road = false;
    expect(buildRoad(ctx, 'player', [street]).ok).toBe(true);
    expect(removeRoad(ctx, 'player', [street]).ok).toBe(true);
  });
});

describe('urban tiles', () => {
  it('layCityStreets keeps to its own land where two discs overlap', () => {
    // radius 9 each, centres 10 apart: A's disc reaches x=29, B's land starts at x=26
    const s = testState({ width: 60, height: 40, cities: [{ x: 20, y: 20, population: 9000 }, { x: 30, y: 20, population: 9000 }] });
    expect(s.cities.map((c) => c.urbanRadius)).toEqual([9, 9]);
    const a = layCityStreets(s.map, s.cities[0]);
    const b = layCityStreets(s.map, s.cities[1]);
    for (const p of a) expect(tile(s, p.x, p.y).cityId).toBe(0);
    for (const p of b) expect(tile(s, p.x, p.y).cityId).toBe(1);
    expect(tile(s, 23, 21).road).toBe(true); // A's column on A's land
    expect(tile(s, 26, 21).cityId).toBe(1);
    expect(tile(s, 26, 21).road).toBe(false); // A's column on B's land: no second grid
    expect(tile(s, 27, 21).road).toBe(true); // B's column
  });

  it('refreshUrbanTiles follows population', () => {
    const s = cityWorld();
    expect(s.cities[0].urbanRadius).toBe(5);
    expect(tile(s, 35, 15).cityId).toBe(0);
    expect(tile(s, 36, 15).cityId).toBeNull();
    s.cities[0].population = 500;
    refreshUrbanTiles(s);
    expect(s.cities[0].urbanRadius).toBe(4);
    expect(tile(s, 35, 15).cityId).toBeNull();
    expect(tile(s, 34, 15).cityId).toBe(0);
  });

  it('every catalog building has a footprint matching its size', () => {
    for (const def of Object.values(BUILDINGS)) {
      expect(footprint({ typeId: def.id, pos: { x: 0, y: 0 } })).toHaveLength(def.size.w * def.size.h);
    }
  });
});
