/**
 * World renderer: composes everything the player sees on the map canvas.
 *
 * Layer order: terrain → roads → houses → sun shadows → vehicles → buildings (y-sorted) → particles →
 * smog haze (diorama only, render/smogHaze.ts) → selection / route polyline → ghost → overlays →
 * atmosphere → night lights (additive) → tilt-shift (diorama only, render/tiltShift.ts).
 * Vehicles go under buildings: they never drive on a footprint, so the only overlap is a raised roof
 * or chimney in front of a road behind it, which must hide the vehicle.
 * Sun shadows (render/shadows.ts) are one path per frame, filled once: every house, landmark and
 * building in reach is traced from its casters for the eased sun vector. Houses and landmarks are
 * already painted (chunk cache), so their own silhouettes are cut out of their shadows; buildings are
 * drawn after the shadows and simply cover theirs.
 * Zoomed out (render/regime.ts) the diorama gives way to the engraved survey map: cached survey
 * chunks plus ink symbols (world/survey.ts) are drawn over it at alpha 1 − blend, and only the
 * regime(s) with non-zero weight are drawn at all. City names go on the overlay canvas.
 * With `attachOverlay`, selection, ghost, ghost label and sale floaters move to a second, unfiltered
 * canvas drawn last, so the era sepia does not wash out their colours. The rendered light level is
 * eased in real time (`easeLight`) so fast speeds never strobe between day and night.
 *
 * Roads, bridges, street lamps, garden trees and houses are static between invalidations, so they
 * are painted into per-chunk cached surfaces (one day and one night variant per chunk, lazily, with a
 * small render budget per frame). Night glows (lit house windows, factory windows, street lamps,
 * headlights) are drawn after the atmosphere with 'lighter' compositing so they shine through it.
 */
import type { EventBus } from '../../core/events';
import { BUILDINGS } from '../../data/buildings';
import { LANDMARK_LAYER } from '../../sim/landmarkTiles';
import { layerAt } from '../../sim/layers';
import type { Building, City, GameState, Vec2 } from '../../sim/types';
import { applyAtmosphere, cssFilterFor, easeLight, isLit } from '../atmosphere';
import { TILE, type Camera, visibleTileRange } from '../camera';
import { OVERLAYS } from '../overlays';
import { regimeBlend } from '../regime';
import { ParticleSystem } from '../particles';
import { SmogHaze } from '../smogHaze';
import { BUILD_MS, drawConstruction, constructionStage } from '../construction';
import { drawLandmark, LANDMARK_CASTERS, LANDMARK_HEADROOM, LANDMARK_PX } from '../landmarks';
import { TiltShiftBudget, applyTiltShift, insetsFromRects, type ViewInsets } from '../tiltShift';
import { MAX_CASTER_Z, MAX_SHADOW_LENGTH, SHADOW_COLOR, type SunVector, easeSun, shadowAlpha, targetSun, traceShadow } from '../shadows';
import { BUILDING_HEIGHT, HEADROOM, HOUSE_TIERS, buildingCasters, drawHouse, getBuildingSprite, houseCaster, houseStyle, houseTier } from '../sprites';
import { CHUNK, TerrainRenderer, hash, isWinter } from '../terrain';
import { chimneysOf, paintGardenTree } from './glows';
import { drawNightLights } from './night';
import { paintRailTile } from './rails';
import { hasLamp, paintBridgeTile, paintRoadTile, roadEra, roadMask } from './roads';
import { drawGhost, drawGhostLabel, drawSelection } from './selection';
import { CityLabelCache, type ScreenRect, UrbanWatch, applySurveyNight, drawCityLabels, drawSurveySymbols, hudRects } from './survey';
import { type ChunkMeta, type Ctx, HOUSE_STRIDE, type Dir, SPRITE_MARGIN, type Surface, type TileRange, h01, makeSurface } from './shared';
import { type TrainTrail, drawVehicles } from './vehicles';

export { hasLamp, roadEra, roadMask } from './roads';
export { DIESEL_YEAR } from './vehicles';

// ---------------------------------------------------------------- public types

export type Ghost =
  | { kind: 'building'; typeId: string; pos: Vec2; valid: boolean; label: string }
  | { kind: 'tiles'; tiles: Vec2[]; valid: boolean; label: string };

export interface Selection {
  buildingId?: number;
  routeId?: number;
  /** A route still being drafted in the route editor (not in `state.routes` yet). */
  draftRoute?: { color: string; stops: { buildingId: number }[] };
  vehicleId?: number;
  /** Pick mode: buildings to outline green (valid) or grey (unavailable). */
  pick?: { valid: number[]; blocked: number[] };
}

// ---------------------------------------------------------------- constants

const CHUNK_PX = CHUNK * TILE;
/** Chunk surfaces have a transparent border so chimneys and lamp heads may cross chunk seams. */
const PAD = 8;
const SURF_PX = CHUNK_PX + PAD * 2;
const RENDERS_PER_FRAME = 3;
/** Minimum surface cap (~1.1 MB each); raised per frame to 2 × visible chunks + 8 so the visible set always fits. */
const MIN_SURFACE_CAP = 48;
/** Frames between sweeps of per-vehicle render state (direction, trail, exhaust) for vehicles that no longer exist. */
const VEHICLE_DIR_SWEEP = 600;
const HOUSE_VARIANTS = 16;
const HUD_RECTS_FRAMES = 30;
/** Tiles beyond the view whose casters may still throw a shadow into it. */
const SHADOW_REACH = Math.ceil((MAX_CASTER_Z * MAX_SHADOW_LENGTH) / TILE) + 1;

const PLAYER_FLOAT = '#7ee07e';
const RIVAL_FLOAT = '#b5302f';


const MONEY = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
/** Sales per building are summed and shown as at most one floater per this many real ms. */
export const FLOAT_FLUSH_MS = 800;
const FLOAT_JITTER_PX = 14;


// ---------------------------------------------------------------- chunk cache

interface ChunkCache {
  dirty: boolean;
  version: number;
  meta: ChunkMeta | null;
  surf: [Surface | null, Surface | null];
  surfVersion: [number, number];
  surfSig: [string, string];
  /** frame number each variant surface was last drawn (for LRU eviction) */
  lastUsed: [number, number];
}

// ---------------------------------------------------------------- renderer

export class WorldRenderer {
  readonly particles = new ParticleSystem();
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private terrain: TerrainRenderer;
  private chunks = new Map<number, ChunkCache>();
  private chunkCols: number;
  private surfaceCount = 0;
  /** 1×1 target for prewarm(): chunk surfaces render into their caches, the blits are clipped away */
  private scratch: CanvasRenderingContext2D | null = null;
  private surfaceCap = MIN_SURFACE_CAP;
  private curSig = '';
  private frame = 0;
  private lastNow: number | null = null;
  private lastFilter = '';
  private ghost: Ghost | null = null;
  private selection: Selection | null = null;
  private uiHidden = false;
  readonly vehicleDir = new Map<number, Dir>();
  /** Recent locomotive positions (tile coords, newest first) so wagons follow the track. */
  readonly trainTrails = new Map<number, TrainTrail>();
  /** performance.now() of each truck's last exhaust puff (real time, render-only). */
  readonly lastPuff = new Map<number, number>();
  private sortBuf: Building[] = [];
  /** Buildings placed live (buildingPlaced) and still animating; real-time start, render-only. */
  private readonly constructing = new Map<number, { start: number; burst: boolean }>();
  /** sale floaters live apart from smoke/sparks so they can be drawn on the unfiltered overlay */
  private readonly floaters = new ParticleSystem();
  private pendingSales = new Map<number, { revenue: number; ownerId: Building['ownerId'] }>();
  private lastFloat = new Map<number, number>();
  private light: number | null = null;
  /** Rendered sun: eased toward the golden-hour sun while running, the clock's while paused (see targetSun). */
  private sun: SunVector | null = null;
  private overlay: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  /** HUD chrome rects city labels avoid; re-measured every HUD_RECTS_FRAMES frames */
  private hud: ScreenRect[] = [];
  private hudMeasured = false;
  /** visible world area for the tilt-shift, from `hud`; `insetsH` is the view height it was measured at */
  private insets: ViewInsets = { top: 0, bottom: 0 };
  private insetsH = -1;
  private readonly tiltBudget = new TiltShiftBudget();
  /** per-chunk smog haze, rebuilt once per game day for chunks in view */
  private readonly haze = new SmogHaze();
  /** keep the tilt-shift on even when frames are slow (DEV `tiltshift=1`, for screenshots) */
  forceTiltShift = false;
  private readonly labels = new CityLabelCache();
  /** city urban discs, so month end only redraws survey chunks whose town tint changed */
  private urban: UrbanWatch;

  constructor(
    private canvas: HTMLCanvasElement,
    state: GameState,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.state = state;
    this.terrain = new TerrainRenderer(state.map, state.seed);
    this.chunkCols = Math.ceil(state.map.width / CHUNK);
    this.urban = new UrbanWatch(state.cities);
  }

  /**
   * Draws selection, ghost, ghost label and sale floaters on a separate canvas stacked above the
   * world canvas (same size and transform), so the era CSS filter does not wash their colours out.
   */
  attachOverlay(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.overlay = { canvas, ctx };
  }

  /** Photo mode: the overlay keeps city labels but draws no selection, ghost, ghost label or floaters. */
  setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
  }

  setGhost(g: Ghost | null): void {
    this.ghost = g;
  }

  hasSelection(): boolean {
    return this.selection !== null;
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
  }

  /** Marks cached road/house chunks stale: all of them, or only those touching `tiles`. */
  invalidate(tiles?: Vec2[]): void {
    if (!tiles) {
      for (const c of this.chunks.values()) c.dirty = true;
      return;
    }
    for (const t of tiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = t.x + dx;
          const ty = t.y + dy;
          if (tx < 0 || ty < 0) continue;
          const c = this.chunks.get(Math.floor(ty / CHUNK) * this.chunkCols + Math.floor(tx / CHUNK));
          if (c) c.dirty = true;
        }
      }
    }
  }

  /** Subscribes to sim events for float texts, sparks and cache invalidation. Returns an unsubscribe. */
  attachEffects(bus: EventBus): () => void {
    const offs = [
      bus.on('sale', (e) => {
        // summed per store and flushed by render() at most every FLOAT_FLUSH_MS
        const p = this.pendingSales.get(e.buildingId);
        if (p) p.revenue += e.revenue;
        else this.pendingSales.set(e.buildingId, { revenue: e.revenue, ownerId: e.ownerId });
      }),
      bus.on('buildingPlaced', (e) => {
        const b = e.building;
        const def = BUILDINGS[b.typeId];
        const { w, h } = def.size;
        // only live placements animate; sparks fire when the reveal completes (see drawBuildings)
        this.constructing.set(b.id, { start: performance.now(), burst: false });
        this.invalidate([b.pos, { x: b.pos.x + w - 1, y: b.pos.y + h - 1 }]);
      }),
      bus.on('buildingRemoved', (e) => {
        this.constructing.delete(e.buildingId);
        this.invalidate();
      }),
      bus.on('roadChanged', (e) => {
        this.invalidate(e.tiles);
        // a spreading city also clears forest/hills between its new streets (see layCityStreets):
        // redraw terrain (both the diorama and survey surfaces) over the streets' bounding box + 1
        this.terrain.invalidateAround(e.tiles);
      }),
      bus.on('railChanged', (e) => {
        this.invalidate(e.tiles);
        this.terrain.invalidateAround(e.tiles); // survey chunks draw the rails
      }),
      bus.on('landmarkBuilt', (e) => {
        const l = this.state.cities.find((c) => c.id === e.cityId)?.landmarks.find((x) => x.id === e.id);
        if (!l) return this.invalidate();
        // the 2×2 block plus the rows its spires, floodlights and the skyscraper's crown rise into
        const { x, y } = l.pos;
        const block: Vec2[] = [];
        for (let dy = -Math.ceil(LANDMARK_HEADROOM / TILE); dy <= 1; dy++) block.push({ x, y: y + dy }, { x: x + 1, y: y + dy });
        this.invalidate(block);
        this.terrain.invalidateAround(block);
      }),
      // survey symbols are drawn per frame, so ownership needs no survey redraw
      bus.on('ownershipChanged', () => this.invalidate()),
      bus.on('monthEnd', () => {
        this.invalidate();
        this.labels.invalidate();
        // the survey town tint follows city tiles: redraw only around discs that changed
        this.urban.update(this.state.cities, (x0, y0, x1, y1) => this.terrain.invalidateRect(x0 - 1, y0 - 1, x1 + 1, y1 + 1));
      }),
    ];
    return () => offs.forEach((f) => f());
  }

  render(state: GameState, cam: Camera, alpha: number, nowMs: number): void {
    if (state.map !== this.state.map) {
      this.terrain = new TerrainRenderer(state.map, state.seed);
      this.chunkCols = Math.ceil(state.map.width / CHUNK);
      this.chunks.clear();
      this.surfaceCount = 0;
      this.urban.reset(state.cities);
      this.labels.invalidate();
      this.vehicleDir.clear();
      this.trainTrails.clear();
      this.lastPuff.clear();
      this.constructing.clear();
      this.tiltBudget.reset();
      this.pendingSales.clear();
      this.lastFloat.clear();
      this.light = null;
      this.sun = null;
    }
    this.state = state;
    this.frame++;
    if (this.frame % VEHICLE_DIR_SWEEP === 0) {
      for (const id of this.vehicleDir.keys()) if (!state.vehicles[id]) this.vehicleDir.delete(id);
      for (const [id, cs] of this.constructing) if (!state.buildings[id] || nowMs - cs.start >= BUILD_MS) this.constructing.delete(id);
      for (const id of this.trainTrails.keys()) if (!state.vehicles[id]) this.trainTrails.delete(id);
      for (const id of this.lastPuff.keys()) if (!state.vehicles[id]) this.lastPuff.delete(id);
    }
    const dt = this.lastNow === null ? 16 : Math.min(100, Math.max(0, nowMs - this.lastNow));
    this.lastNow = nowMs;
    const { date } = state;
    const filter = cssFilterFor(date.year);
    if (filter !== this.lastFilter) {
      this.canvas.style.filter = filter;
      this.lastFilter = filter;
    }

    const ctx = this.ctx;
    const z = cam.zoom;
    this.light = easeLight(this.light, date.hour, dt, state.speed);
    const light = this.light;
    this.sun = easeSun(this.sun, targetSun(date.hour, state.speed), dt);
    const nightK = Math.min(1, Math.max(0, (0.8 - light) / 0.55));
    const lit = isLit(date.hour);

    // 0 = survey map, 1 = diorama; each regime is drawn only when it has weight
    const blend = regimeBlend(z);
    const diorama = blend > 0;
    const survey = blend < 1;

    ctx.save();
    ctx.fillStyle = '#1d1a16';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    const r = visibleTileRange(cam, state.map);
    if (diorama) {
      this.terrain.draw(ctx, cam, nowMs, { oilVisible: state.flags.oilRevealed === true || date.year >= 1910, month: date.month });
      // static cached layer: roads, bridges, lamps, gardens, houses
      this.drawChunks(ctx, cam, r, lit);
    }

    // world-space layers
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    const visBuildings = this.collectBuildings(state, r);
    if (diorama) {
      this.drawShadows(ctx, state, r, light, blend);
      drawVehicles(ctx, this, state, r, alpha, dt, lit);
      this.drawBuildings(ctx, visBuildings);
    }
    // smoke (and sparks, puffs) are hidden on the map side of the blend
    const smoke = blend >= 0.5;
    if (smoke) this.emitSmoke(state, cam, dt);
    ctx.restore();

    this.particles.update(dt);
    if (smoke) this.particles.draw(ctx, cam);
    // smog veils the diorama (faded by the blend); the atmosphere grade below darkens it at night
    if (diorama) this.haze.draw(ctx, state, cam, blend, nowMs);

    if (survey) {
      this.terrain.drawSurvey(ctx, cam, 1 - blend);
      ctx.save();
      ctx.globalAlpha = 1 - blend;
      ctx.scale(z, z);
      ctx.translate(-cam.x, -cam.y);
      drawSurveySymbols(ctx, state, visBuildings, r, this.vehicleDir, alpha, z);
      ctx.restore();
    }
    this.flushFloaters(state, nowMs);
    this.floaters.update(dt);

    // with an overlay canvas these go on top, unfiltered, after the atmosphere (see below)
    if (!this.overlay) this.drawUi(ctx, state, cam, alpha, nowMs);

    for (const o of OVERLAYS) {
      if (!o.enabled) continue;
      ctx.save();
      o.draw(ctx, state, cam);
      ctx.restore();
    }

    // the diorama's blue night and season tint fade out with it; the paper map gets a faint warm grade
    if (diorama) {
      ctx.save();
      ctx.globalAlpha = blend;
      applyAtmosphere(ctx, cam.viewW, cam.viewH, date, light);
      ctx.restore();
      if (nightK > 0) drawNightLights(ctx, cam, r, this.constructing.size === 0 ? visBuildings : visBuildings.filter((b) => !this.isScaffolding(b.id)), state, this.chunks, this.chunkCols, this.vehicleDir, alpha, nightK * blend);
    }
    if (survey) {
      ctx.save();
      ctx.globalAlpha = 1 - blend;
      applySurveyNight(ctx, cam.viewW, cam.viewH, light);
      ctx.restore();
    }
    ctx.restore();
    // HUD rects (city labels avoid them; the tilt-shift bands start below and above them), re-measured
    // every HUD_RECTS_FRAMES frames rather than per frame
    if (!this.hudMeasured || this.frame % HUD_RECTS_FRAMES === 0 || this.insetsH !== cam.viewH) {
      this.hud = hudRects();
      this.hudMeasured = true;
      this.insets = insetsFromRects(this.hud, cam.viewH);
      this.insetsH = cam.viewH;
    }
    // miniature look on the world canvas only (UI goes on the overlay canvas and the DOM HUD)
    // (the budget sees every frame, so it notices slow frames whichever regime is on screen)
    if ((this.tiltBudget.allow(nowMs, dt) || this.forceTiltShift) && diorama) applyTiltShift(ctx, cam.viewW, cam.viewH, blend, this.insets);

    if (this.overlay) {
      const o = this.overlay.ctx;
      // the caller sets the same (DPR) transform on both canvases
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, this.overlay.canvas.width, this.overlay.canvas.height);
      o.restore();
      this.drawUi(o, state, cam, alpha, nowMs);
    }
    if (survey) drawCityLabels(this.overlay?.ctx ?? ctx, state, cam, 1 - blend, this.hud, this.labels);
  }

  /**
   * Fills the diorama caches (terrain and the roads/houses layer) for `cam` without drawing to the
   * screen, at the usual per-frame budgets. Returns true while it still rendered something, so the
   * caller can repeat it on later frames. The cold open warms its final shot this way, so the swoop
   * into the diorama does not stall on first-time chunk renders.
   */
  prewarm(state: GameState, cam: Camera): boolean {
    if (state.map !== this.state.map) return false;
    if (!this.scratch) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      this.scratch = c.getContext('2d');
    }
    const g = this.scratch;
    if (!g) return false;
    const r = visibleTileRange(cam, state.map);
    const date = state.date;
    const n = this.terrain.draw(g, cam, 0, { oilVisible: state.flags.oilRevealed === true || date.year >= 1910, month: date.month });
    return n + this.drawChunks(g, cam, r, isLit(date.hour)) > 0;
  }

  /** Selection, ghost, ghost label and sale floaters. */
  private drawUi(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, alpha: number, nowMs: number): void {
    if (this.uiHidden) return;
    const z = cam.zoom;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    drawSelection(ctx, state, this.selection, this.vehicleDir, alpha, nowMs, z);
    drawGhost(ctx, this.ghost, z);
    ctx.restore();
    drawGhostLabel(ctx, this.ghost, cam);
    this.floaters.draw(ctx, cam);
  }

  /** Emits one summed floater per building whose last one is at least FLOAT_FLUSH_MS old. */
  private flushFloaters(state: GameState, nowMs: number): void {
    for (const [id, p] of this.pendingSales) {
      const last = this.lastFloat.get(id);
      if (last !== undefined && nowMs - last < FLOAT_FLUSH_MS && nowMs >= last) continue;
      this.pendingSales.delete(id);
      const b = state.buildings[id];
      if (!b) continue;
      this.lastFloat.set(id, nowMs);
      const def = BUILDINGS[b.typeId];
      const wx = (b.pos.x + def.size.w / 2) * TILE + (Math.random() - 0.5) * 2 * FLOAT_JITTER_PX;
      const wy = b.pos.y * TILE - 4;
      this.floaters.emitFloatText(wx, wy, `+${MONEY(p.revenue)}`, p.ownerId === 'player' ? PLAYER_FLOAT : RIVAL_FLOAT);
    }
    if (this.lastFloat.size > 256) {
      for (const [id, t] of this.lastFloat) if (nowMs - t > FLOAT_FLUSH_MS) this.lastFloat.delete(id);
    }
  }

  // -------------------------------------------------------------- chunks

  private chunkSig(): string {
    const { year, month } = this.state.date;
    // landmarkBuilt also invalidates the chunks it touches; the count makes any missed one redraw too
    return `${roadEra(year)}|${houseStyle(year)}|${isWinter(month) ? 1 : 0}|${this.landmarkCount()}`;
  }

  private landmarkCount(): number {
    let n = 0;
    for (const c of this.state.cities) n += c.landmarks.length;
    return n;
  }

  private chunkAt(key: number): ChunkCache {
    let c = this.chunks.get(key);
    if (!c) {
      c = { dirty: true, version: 0, meta: null, surf: [null, null], surfVersion: [-1, -1], surfSig: ['', ''], lastUsed: [0, 0] };
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Draws the cached roads/houses layer; returns how many stale chunk surfaces it re-rendered. */
  private drawChunks(ctx: CanvasRenderingContext2D, cam: Camera, r: TileRange, lit: boolean): number {
    if (r.x1 < r.x0 || r.y1 < r.y0) return 0;
    const sig = this.chunkSig();
    const v = lit ? 1 : 0;
    let budget = RENDERS_PER_FRAME;
    const z = cam.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = z < 1;
    const cx0 = Math.floor(Math.max(0, r.x0 - 1) / CHUNK);
    const cy0 = Math.floor(Math.max(0, r.y0 - 1) / CHUNK);
    const cx1 = Math.floor(Math.min(this.state.map.width - 1, r.x1 + 1) / CHUNK);
    const cy1 = Math.floor(Math.min(this.state.map.height - 1, r.y1 + 1) / CHUNK);
    this.curSig = sig;
    this.surfaceCap = Math.max(MIN_SURFACE_CAP, 2 * (cx1 - cx0 + 1) * (cy1 - cy0 + 1) + 8);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunkAt(cy * this.chunkCols + cx);
        if (this.metaOf(c, cx, cy).empty) continue;
        const fresh = c.surfVersion[v] === c.version && c.surfSig[v] === sig;
        if (!fresh && budget > 0) {
          budget--;
          this.renderChunk(c, cx, cy, v, sig);
        }
        const slot = c.surf[v] ? v : 1 - v;
        const surf = c.surf[slot];
        if (!surf) continue;
        c.lastUsed[slot] = this.frame;
        const sx = Math.floor((cx * CHUNK_PX - PAD - cam.x) * z);
        const sy = Math.floor((cy * CHUNK_PX - PAD - cam.y) * z);
        const ex = Math.floor(((cx + 1) * CHUNK_PX + PAD - cam.x) * z);
        const ey = Math.floor(((cy + 1) * CHUNK_PX + PAD - cam.y) * z);
        ctx.drawImage(surf as CanvasImageSource, sx, sy, ex - sx, ey - sy);
      }
    }
    ctx.restore();
    return RENDERS_PER_FRAME - budget;
  }

  /** Decides which tiles of a chunk carry houses and lamps (cheap; no drawing). */
  private computeMeta(cx: number, cy: number): ChunkMeta {
    const { map } = this.state;
    const houses: number[] = [];
    const lamps: number[] = [];
    let empty = true;
    const x1 = Math.min(map.width, (cx + 1) * CHUNK);
    const y1 = Math.min(map.height, (cy + 1) * CHUNK);
    for (let y = cy * CHUNK; y < y1; y++) {
      for (let x = cx * CHUNK; x < x1; x++) {
        const t = map.tiles[y * map.width + x];
        if (t.road || t.rail) empty = false;
        if (t.road && hasLamp(t, x, y)) lamps.push(x * TILE + 5, y * TILE - 2);
        if (t.cityId === null) continue;
        empty = false;
        const h = this.houseAt(x, y);
        if (h) houses.push(x, y, h[0], h[1], h[2]);
      }
    }
    return { houses, lamps, empty };
  }

  /** [variant, lit, tier index] of the house on tile (x, y), or null if it has none. */
  private houseAt(x: number, y: number): [number, number, number] | null {
    const { map, cities, seed } = this.state;
    const t = map.tiles[y * map.width + x];
    if (t.cityId === null || t.road || t.rail || t.buildingId !== null || t.terrain === 'water' || t.terrain === 'mountain') return null;
    if (layerAt(this.state, LANDMARK_LAYER, x, y) > 0) return null; // the landmark painter covers it
    const city = cities.find((c) => c.id === t.cityId);
    if (!city) return null;
    const d = Math.hypot(x - city.center.x, y - city.center.y) / Math.max(1, city.urbanRadius);
    let p = 1.02 - 0.45 * d * d;
    if (d > 0.85) p *= 0.75; // ragged outskirts
    if (h01(x, y, seed, 31) >= p) return null;
    const variant = hash(x, y, seed, 37) % HOUSE_VARIANTS;
    const litHouse = h01(x, y, seed, 41) < 0.72 ? 1 : 0;
    // tier inputs (population, year) change only at month end, which invalidates every chunk
    return [variant, litHouse, HOUSE_TIERS.indexOf(houseTier(city.population, this.state.date.year, d))];
  }

  /** The chunk's meta, recomputed if it was invalidated. */
  private metaOf(c: ChunkCache, cx: number, cy: number): ChunkMeta {
    if (c.dirty || !c.meta) {
      c.meta = this.computeMeta(cx, cy);
      c.dirty = false;
      c.version++;
    }
    return c.meta;
  }

  private renderChunk(c: ChunkCache, cx: number, cy: number, v: number, sig: string): void {
    let s = c.surf[v];
    if (!s) {
      if (this.surfaceCount >= this.surfaceCap) this.evictOne(); // may allocate past the cap if nothing is evictable
      s = makeSurface(SURF_PX, SURF_PX);
      c.surf[v] = s;
      this.surfaceCount++;
    }
    const g = (s as HTMLCanvasElement).getContext('2d') as Ctx | null;
    c.surfVersion[v] = c.version;
    c.surfSig[v] = sig;
    if (!g) return;
    const { map, seed, date } = this.state;
    const era = roadEra(date.year);
    const winter = isWinter(date.month);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SURF_PX, SURF_PX);
    const ox = cx * CHUNK_PX - PAD;
    const oy = cy * CHUNK_PX - PAD;
    const x1 = Math.min(map.width, (cx + 1) * CHUNK);
    const y1 = Math.min(map.height, (cy + 1) * CHUNK);
    // roads and garden trees
    for (let y = cy * CHUNK; y < y1; y++) {
      for (let x = cx * CHUNK; x < x1; x++) {
        const t = map.tiles[y * map.width + x];
        g.setTransform(1, 0, 0, 1, x * TILE - ox, y * TILE - oy);
        if (t.road) {
          const mask = roadMask(map, x, y, 'road');
          if (t.terrain === 'water') paintBridgeTile(g, mask, era);
          else paintRoadTile(g, mask, era, t.cityId !== null, winter, x, y, seed, hasLamp(t, x, y));
        }
        if (t.rail) paintRailTile(g, roadMask(map, x, y, 'rail'), t.road, winter, x, y, seed, t.road ? roadMask(map, x, y, 'road') : 0);
      }
    }
    // gardens on empty urban tiles, then houses (row order → lower houses overlap upper ones);
    // each landmark goes in once the row of its bottom tiles is done
    const meta = c.meta!;
    const marks = this.landmarksOver(ox, oy);
    let li = 0;
    const flushMarks = (beforeRow: number): void => {
      for (; li < marks.length && marks[li].pos.y + 1 < beforeRow; li++) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        drawLandmark(g as CanvasRenderingContext2D, marks[li].id, marks[li].pos.x * TILE - ox, marks[li].pos.y * TILE - oy, v === 1);
      }
    };
    let hi = 0;
    for (let y = cy * CHUNK; y < y1; y++) {
      flushMarks(y);
      for (let x = cx * CHUNK; x < x1; x++) {
        const isHouse = hi < meta.houses.length && meta.houses[hi] === x && meta.houses[hi + 1] === y;
        if (isHouse) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          drawHouse(g as CanvasRenderingContext2D, x * TILE - ox, y * TILE - oy, meta.houses[hi + 2], date.year, v === 1 && meta.houses[hi + 3] === 1, HOUSE_TIERS[meta.houses[hi + 4]]);
          hi += HOUSE_STRIDE;
          continue;
        }
        const t = map.tiles[y * map.width + x];
        if (t.cityId === null || t.road || t.rail || t.buildingId !== null || t.terrain === 'water' || t.terrain === 'mountain') continue;
        if (layerAt(this.state, LANDMARK_LAYER, x, y) > 0) continue;
        if (h01(x, y, seed, 51) < 0.55) {
          g.setTransform(1, 0, 0, 1, x * TILE - ox, y * TILE - oy);
          const n = 1 + (hash(x, y, seed, 52) % 2);
          for (let i = 0; i < n; i++) {
            paintGardenTree(g, 8 + h01(x, y, seed, 53 + i) * 16, 8 + h01(x, y, seed, 55 + i) * 14, 4 + h01(x, y, seed, 57 + i) * 2.5, winter);
          }
        }
      }
    }
    // towers in the first row of the chunk below rise past the padding into this one: paint them
    // here too, after everything behind them
    const yb = (cy + 1) * CHUNK;
    if (yb < map.height) {
      flushMarks(yb);
      g.setTransform(1, 0, 0, 1, 0, 0);
      for (let x = Math.max(0, cx * CHUNK - 1); x <= Math.min(map.width - 1, x1); x++) {
        const h = this.houseAt(x, yb);
        if (h && HOUSE_TIERS[h[2]] === 'tower') drawHouse(g as CanvasRenderingContext2D, x * TILE - ox, yb * TILE - oy, h[0], date.year, v === 1 && h[1] === 1, 'tower');
      }
    }
    flushMarks(Infinity);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Landmarks whose painting (footprint plus headroom) overlaps the chunk surface at world px (ox, oy), top rows first. */
  private landmarksOver(ox: number, oy: number): City['landmarks'] {
    const out: City['landmarks'] = [];
    for (const city of this.state.cities) {
      for (const l of city.landmarks) {
        const lx = l.pos.x * TILE;
        const ly = l.pos.y * TILE;
        if (lx + LANDMARK_PX <= ox || lx >= ox + SURF_PX || ly + LANDMARK_PX <= oy || ly - LANDMARK_HEADROOM >= oy + SURF_PX) continue;
        out.push(l);
      }
    }
    return out.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  }

  private evictOne(): void {
    let worst: ChunkCache | null = null;
    let slot = 0;
    const recent = this.frame - 1;
    for (const c of this.chunks.values()) {
      for (let i = 0; i < 2; i++) {
        if (!c.surf[i]) continue;
        // never evict a surface drawn this or last frame
        if (c.lastUsed[i] >= recent) continue;
        // never evict a chunk's only usable surface while its other variant is stale
        // (a chunk with a single surface that is off-screen may go; it re-renders on demand)
        const o = 1 - i;
        const fresh = (k: number) => c.surfVersion[k] === c.version && c.surfSig[k] === this.curSig;
        if (c.surf[o] && !fresh(o) && fresh(i)) continue;
        if (!worst || c.lastUsed[i] < worst.lastUsed[slot]) {
          worst = c;
          slot = i;
        }
      }
    }
    if (!worst) return;
    worst.surf[slot] = null;
    worst.surfVersion[slot] = -1;
    this.surfaceCount--;
  }

  // -------------------------------------------------------------- buildings

  private collectBuildings(state: GameState, r: TileRange): Building[] {
    const out = this.sortBuf;
    out.length = 0;
    const x0 = r.x0 - SPRITE_MARGIN;
    const y0 = r.y0 - SPRITE_MARGIN;
    const x1 = r.x1 + SPRITE_MARGIN;
    const y1 = r.y1 + SPRITE_MARGIN;
    for (const id in state.buildings) {
      const b = state.buildings[id];
      const def = BUILDINGS[b.typeId];
      if (!def) continue;
      if (b.pos.x + def.size.w - 1 < x0 || b.pos.x > x1 || b.pos.y + def.size.h - 1 < y0 || b.pos.y > y1) continue;
      out.push(b);
    }
    out.sort((a, b) => a.pos.y + BUILDINGS[a.typeId].size.h - (b.pos.y + BUILDINGS[b.typeId].size.h) || a.pos.x - b.pos.x);
    return out;
  }

  /**
   * Sun shadows of every house, landmark and building within SHADOW_REACH of the view, traced into one
   * path and filled once (nonzero), so overlaps never darken twice. Faded by the regime blend and by
   * daylight; nothing at night.
   */
  private drawShadows(ctx: CanvasRenderingContext2D, state: GameState, r: TileRange, light: number, blend: number): void {
    const sun = this.sun;
    const k = sun ? shadowAlpha(light, blend, sun) : 0;
    if (!sun || k < 0.01 || Math.abs(sun.vx) + Math.abs(sun.vy) < 0.02) return;
    const { vx, vy } = sun;
    const R = SHADOW_REACH;
    // shadows point west, north or east (never south): casters above the view cannot reach into it
    const x0 = r.x0 - R, x1 = r.x1 + R, y0 = r.y0 - 1, y1 = r.y1 + R;
    ctx.beginPath();
    const { map } = state;
    const cx0 = Math.floor(Math.max(0, x0) / CHUNK);
    const cy0 = Math.floor(Math.max(0, y0) / CHUNK);
    const cx1 = Math.floor(Math.min(map.width - 1, x1) / CHUNK);
    const cy1 = Math.floor(Math.min(map.height - 1, y1) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const m = this.metaOf(this.chunkAt(cy * this.chunkCols + cx), cx, cy);
        if (m.empty) continue;
        const hs = m.houses;
        for (let i = 0; i < hs.length; i += HOUSE_STRIDE) {
          const x = hs[i];
          const y = hs[i + 1];
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          traceShadow(ctx, houseCaster(HOUSE_TIERS[hs[i + 4]]), x * TILE, y * TILE, vx, vy, true);
        }
      }
    }
    for (const city of state.cities) {
      for (const l of city.landmarks) {
        if (l.pos.x + 1 < x0 || l.pos.x > x1 || l.pos.y + 1 < y0 || l.pos.y > y1) continue;
        for (const c of LANDMARK_CASTERS[l.id]) traceShadow(ctx, c, l.pos.x * TILE, l.pos.y * TILE, vx, vy, true);
      }
    }
    for (const id in state.buildings) {
      const b = state.buildings[id];
      const def = BUILDINGS[b.typeId];
      if (!def || b.pos.x + def.size.w - 1 < x0 || b.pos.x > x1 || b.pos.y + def.size.h - 1 < y0 || b.pos.y > y1) continue;
      // a building still rising casts a shadow that grows with its reveal
      const zk = this.revealOf(b.id);
      if (zk <= 0) continue;
      for (const c of buildingCasters(b.typeId)) traceShadow(ctx, c, b.pos.x * TILE, b.pos.y * TILE, vx, vy, false, zk);
    }
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = SHADOW_COLOR;
    ctx.fill('nonzero');
    ctx.restore();
  }

  private drawBuildings(ctx: CanvasRenderingContext2D, list: Building[]): void {
    for (const b of list) {
      const variant = b.typeId === 'farm' && b.recipeId ? b.recipeId.replace(/^r_/, '') : '';
      const sprite = getBuildingSprite(b.typeId, b.ownerId, variant);
      const x = b.pos.x * TILE;
      const y = b.pos.y * TILE - HEADROOM;
      const cs = this.constructing.get(b.id);
      if (cs) {
        const stage = constructionStage(performance.now() - cs.start);
        if (stage.done) this.constructing.delete(b.id);
        else {
          if (stage.reveal >= 1 && !cs.burst) {
            cs.burst = true;
            const { w, h } = BUILDINGS[b.typeId].size;
            for (const [fx, fy] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]]) {
              this.particles.emitSparks((b.pos.x + fx) * TILE, (b.pos.y + fy) * TILE);
            }
          }
          // the scaffold rises to the raised roof, not to the top of the chimney headroom
          const scaffoldH = sprite.height - HEADROOM + (BUILDING_HEIGHT[b.typeId] ?? 0) + 4;
          drawConstruction(ctx, sprite, x, y, sprite.width, sprite.height, stage, scaffoldH);
          continue;
        }
      }
      ctx.drawImage(sprite, x, y);
      if (b.status === 'halted') {
        // boarded-up hint: a diagonal hazard band
        const def = BUILDINGS[b.typeId];
        ctx.fillStyle = 'rgba(40,30,20,0.35)';
        ctx.fillRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE - 4, def.size.h * TILE - 4);
      }
    }
  }

  /** 0..1 how much of a live-placed building has been revealed (1 when not animating). */
  private revealOf(id: number): number {
    const cs = this.constructing.get(id);
    return cs ? constructionStage(performance.now() - cs.start).reveal : 1;
  }

  /** True while a live-placed building is still under scaffold (reveal < 1): no smoke or glow yet. */
  private isScaffolding(id: number): boolean {
    const cs = this.constructing.get(id);
    return !!cs && constructionStage(performance.now() - cs.start).reveal < 1;
  }

  private emitSmoke(state: GameState, cam: Camera, dt: number): void {
    const margin = 6 * TILE;
    const vx0 = cam.x - margin;
    const vy0 = cam.y - margin;
    const vx1 = cam.x + cam.viewW / cam.zoom + margin;
    const vy1 = cam.y + cam.viewH / cam.zoom + margin * 2;
    for (const id in state.buildings) {
      const b = state.buildings[id];
      const density = b.status === 'ok' ? 1 : b.status === 'no_input' ? 0.15 : 0;
      if (density === 0 || this.isScaffolding(b.id)) continue;
      const bx = b.pos.x * TILE;
      const by = b.pos.y * TILE - HEADROOM;
      if (bx < vx0 || bx > vx1 || by < vy0 || by > vy1) continue;
      for (const o of chimneysOf(b.typeId)) this.particles.emitSmoke(bx + o.x, by + o.y, density, dt);
    }
  }
}
