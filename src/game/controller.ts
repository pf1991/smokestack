import { Sfx } from '../audio/sfx';
import { EventBus } from '../core/events';
import { DEFAULT_ZOOM, clampCamera, TILE } from '../render/camera';
import type { Camera } from '../render/constants';
import { WorldRenderer } from '../render/world';
import { stepTick } from '../sim/simulation';
import { createGame } from '../sim/state';
import type { GameMap, GameState, SimContext, Speed, Vec2 } from '../sim/types';
import { Hud } from '../ui/hud';
import { PANELS } from '../ui/panels/index';
import { Toasts } from '../ui/toasts';
import { Toolbar } from '../ui/toolbar';
import type { ToolSpec } from '../ui/tools';
import { attachAchievements } from './achievements';
import { attachMilestoneStamps, attachStuckToasts } from './feedback';
import { attachAutosave } from './saves';
import { loadSettings } from './settings';
import { enterPhotoMode } from './photoMode';
import { closeAllWindows } from '../ui/window';
import { clearStamps } from '../ui/juice';
import { Input } from './input';
import { ToolController } from './toolController';
import { biggestCity } from './autoplay';

/** Real milliseconds per game day at speed 1. */
const MS_PER_DAY = 2000;
const TICKS_PER_DAY = 24;
/** Backlog beyond this many ticks in one frame is dropped (e.g. after a background tab). */
export const MAX_TICKS_PER_FRAME = 200;
const HUD_INTERVAL_MS = 250;
/** Clamp for one frame's real time so a long stall does not jump the sim. */
const MAX_FRAME_MS = 1000;
/** Fallback timer period used when animation frames stop arriving. */
const WATCHDOG_MS = 50;

export function msPerTick(speed: Speed): number {
  return MS_PER_DAY / TICKS_PER_DAY / speed;
}

const PANEL_LABELS: Record<string, string> = {
  routes: 'Routes window',
  finance: 'Finance ledger',
  newspaper: 'The Daily Smokestack',
  contracts: "Mayor's contracts",
  fleet: 'Fleet manager',
};

export interface NewGameOpts {
  seed: number;
  companyName?: string;
  scenarioId?: string;
  rival?: boolean;
}

/**
 * Owns the running game: sim context, camera, world renderer, HUD/toolbar/toasts, audio, input and
 * the fixed-timestep loop (msPerTick = 2000 / 24 / speed, at most 200 ticks per frame).
 */
export class GameController {
  ctx!: SimContext;
  readonly camera: Camera = { x: 0, y: 0, zoom: DEFAULT_ZOOM, viewW: 0, viewH: 0 };
  renderer!: WorldRenderer;
  readonly tools: ToolController;
  readonly hud: Hud;
  readonly toolbar: Toolbar;
  readonly sfx = new Sfx();
  /** Called when Esc is pressed with no tool or drawer to cancel (the pause menu hooks in here). */
  onPause: (() => void) | null = null;
  private readonly input: Input;
  private readonly g2d: CanvasRenderingContext2D;
  /** unfiltered canvas above the world for ghost, selection and floaters */
  readonly overlay: HTMLCanvasElement;
  private readonly o2d: CanvasRenderingContext2D;
  private dpr = 1;
  private busOffs: (() => void)[] = [];
  /** extra teardown run by destroy() (e.g. the tutorial card and its timer) */
  private disposers: (() => void)[] = [];
  private toolListeners: ((t: ToolSpec) => void)[] = [];
  /** run at the start of every frame, before the sim step and render (e.g. the cold-open camera) */
  private frameHooks = new Set<(now: number) => void>();
  /** vehicle the camera is following, if any */
  followId: number | null = null;
  private raf = 0;
  private watchdog = 0;
  private running = false;
  private lastFrame: number | null = null;
  private acc = 0;
  private alpha = 0;
  private lastHud = -Infinity;
  private resumeSpeed: Speed = 1;
  private ended = false;
  private audioOn = false;
  private readonly onResize = () => this.resize();
  private dprQuery: MediaQueryList | null = null;
  private hudObserver: ResizeObserver | null = null;
  private readonly onDprChange = () => {
    this.resize();
    this.watchDpr();
  };
  private readonly onGesture = () => this.enableAudio();

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly uiRoot: HTMLElement,
  ) {
    const g = canvas.getContext('2d');
    if (!g) throw new Error('2D canvas not supported');
    this.g2d = g;
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'world-overlay';
    Object.assign(this.overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', display: 'block' });
    canvas.insertAdjacentElement('afterend', this.overlay);
    const o = this.overlay.getContext('2d');
    if (!o) throw new Error('2D canvas not supported');
    this.o2d = o;
    const settings = loadSettings();
    this.sfx.setVolume(settings.volume);
    this.sfx.setMuted(settings.muted);
    this.tools = new ToolController(this);
    this.hud = new Hud(uiRoot, {
      onSpeed: (s) => this.setSpeed(s),
      onOpenPanel: (id) => this.openPanel(id),
      onPhoto: () => this.togglePhotoMode(),
    });
    this.toolbar = new Toolbar(uiRoot, (t) => this.applyTool(t));
    this.input = new Input(canvas, this);
    this.trackHudHeight();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointerdown', this.onGesture, true);
    window.addEventListener('keydown', this.onGesture, true);
    this.resize();
    this.watchDpr();
  }

  get activeToolKind(): string {
    return this.tools.activeTool.kind;
  }

  /** Camera follows a vehicle until the player pans (or `null` stops following). */
  follow(id: number | null): void {
    this.followId = id;
  }

  onManualPan(): void {
    this.followId = null;
  }

  get map(): GameMap {
    return this.ctx.state.map;
  }

  get state(): GameState {
    return this.ctx.state;
  }

  newGame(opts: NewGameOpts): void {
    this.load(createGame(opts));
  }

  /** Starts playing `state` with a fresh event bus (renderer, toasts and audio re-attach to it). */
  load(state: GameState): void {
    for (const off of this.busOffs) off();
    const bus = new EventBus();
    this.ctx = { state, bus };
    this.hud.reset();
    if (!this.renderer) {
      this.renderer = new WorldRenderer(this.canvas, state);
      this.renderer.attachOverlay(this.overlay);
    }
    this.renderer.setSelection(null);
    this.followId = null;
    this.busOffs = [
      this.renderer.attachEffects(bus),
      Toasts.attach(this.uiRoot, bus),
      attachStuckToasts(this.ctx),
      attachMilestoneStamps(this.ctx),
      this.hud.attach(bus),
      attachAutosave(this.ctx),
      attachAchievements(this.ctx),
      bus.on('unlock', () => this.toolbar.update(this.state)),
      bus.on('monthEnd', () => this.toolbar.update(this.state)),
      bus.on('gameOver', (e) => this.end(`Game over — ${e.reason}`, 'bad')),
      bus.on('victory', (e) => this.end(`Victory! ${e.reason}`, 'good')),
    ];
    if (this.audioOn) this.busOffs.push(this.sfx.attach(bus));
    this.ended = false;
    this.acc = 0;
    this.alpha = 0;
    if (state.speed > 0) this.resumeSpeed = state.speed;
    const city = biggestCity(state.cities);
    if (city) this.centerOn(city.center);
    this.setTool({ kind: 'inspect' });
    this.hud.update(state);
    this.toolbar.update(state);
    this.start();
  }

  /** Centres the view on a tile. */
  centerOn(tile: Vec2): void {
    const cam = this.camera;
    cam.x = (tile.x + 0.5) * TILE - cam.viewW / cam.zoom / 2;
    cam.y = (tile.y + 0.5) * TILE - cam.viewH / cam.zoom / 2;
    if (this.ctx) clampCamera(cam, this.map);
  }

  // ------------------------------------------------------------------ speed

  setSpeed(s: Speed): void {
    if (!this.ctx) return;
    if (s > 0 && this.ended) {
      this.ctx.bus.emit({ type: 'toast', message: 'The game has ended', tone: 'bad' });
      return;
    }
    if (s > 0) this.resumeSpeed = s;
    this.state.speed = s;
    this.hud.update(this.state);
  }

  /** Space: pause, or resume at the speed used before pausing. */
  togglePause(): void {
    this.setSpeed(this.state.speed === 0 ? this.resumeSpeed : 0);
  }

  private end(message: string, tone: 'good' | 'bad'): void {
    this.ended = true;
    this.state.speed = 0;
    this.ctx.bus.emit({ type: 'toast', message, tone });
    this.hud.update(this.state);
  }

  // ------------------------------------------------------------------ tools & panels

  /** Selects a tool (highlighting it in the toolbar). */
  setTool(t: ToolSpec): void {
    this.toolbar.select(t); // calls back into applyTool
  }

  private applyTool(t: ToolSpec): void {
    this.tools.setTool(t);
    if (this.audioOn) this.sfx.play('click');
    for (const fn of this.toolListeners) fn(t);
  }

  /** Subscribes to tool changes; returns an unsubscribe. */
  onToolChange(fn: (t: ToolSpec) => void): () => void {
    this.toolListeners.push(fn);
    return () => {
      this.toolListeners = this.toolListeners.filter((f) => f !== fn);
    };
  }

  /** Esc: cancels the active tool or open drawer; with nothing to cancel it asks for the pause menu. */
  escape(): void {
    if (this.tools.activeTool.kind !== 'inspect' || this.toolbar.drawerOpen || this.renderer.hasSelection()) {
      this.tools.cancel();
      this.closeDrawer();
      return;
    }
    this.onPause?.();
  }

  private exitPhoto: (() => void) | null = null;

  /** True while photo mode is on (Input stops sending the left button and keys to the tools). */
  get photoActive(): boolean {
    return this.exitPhoto !== null && document.body.classList.contains('photo-mode');
  }

  /** P / HUD camera button: enters photo mode, or leaves it when already in. */
  togglePhotoMode(): void {
    if (this.exitPhoto && this.photoActive) {
      this.exitPhoto();
      return;
    }
    if (!this.ctx || this.ended) return;
    const exit = enterPhotoMode(this);
    this.exitPhoto = exit;
  }

  toggleToolbar(): void {
    this.toolbar.toggle();
  }

  closeDrawer(): void {
    this.toolbar.closeDrawer();
  }

  /** Opens a registered panel; unregistered ids show a "coming soon" toast. */
  openPanel(id: string, arg?: unknown): void {
    if (this.tryOpenPanel(id, arg)) return;
    const label = PANEL_LABELS[id] ?? 'That window';
    this.ctx.bus.emit({ type: 'toast', message: `${label} is still at the printers — coming soon`, tone: 'info' });
  }

  tryOpenPanel(id: string, arg?: unknown): boolean {
    const panel = PANELS[id];
    if (!panel) return false;
    panel.open(this, arg);
    return true;
  }

  // ------------------------------------------------------------------ audio

  private enableAudio(): void {
    window.removeEventListener('pointerdown', this.onGesture, true);
    window.removeEventListener('keydown', this.onGesture, true);
    if (this.audioOn) return;
    this.audioOn = true;
    if (this.ctx) this.busOffs.push(this.sfx.attach(this.ctx.bus));
    this.sfx.startAmbience();
  }

  // ------------------------------------------------------------------ loop

  /** Publishes the HUD bar's height as --hud-height so toasts and corner widgets sit below it. */
  private trackHudHeight(): void {
    const bar = this.uiRoot.querySelector<HTMLElement>('.hud-bar');
    if (!bar) return;
    const publish = () => document.documentElement.style.setProperty('--hud-height', `${bar.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'function') {
      this.hudObserver = new ResizeObserver(publish);
      this.hudObserver.observe(bar);
    }
  }

  /** Re-runs resize() when the device pixel ratio changes (zoom, moving between monitors). */
  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    if (typeof window.matchMedia !== 'function') return;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private resize(): void {
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    // keep the centre of the view fixed
    const cam = this.camera;
    const cx = cam.x + cam.viewW / cam.zoom / 2;
    const cy = cam.y + cam.viewH / cam.zoom / 2;
    cam.viewW = w;
    cam.viewH = h;
    cam.x = cx - w / cam.zoom / 2;
    cam.y = cy - h / cam.zoom / 2;
    if (this.ctx) clampCamera(cam, this.map);
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = null;
    this.raf = requestAnimationFrame(this.frame);
    this.watchdog = window.setInterval(this.kick, WATCHDOG_MS);
  }

  /**
   * Some environments (headless capture, embedded webviews) stop delivering animation frames while
   * the page is visible; keep the game running from a timer then. Hidden tabs stay paused.
   */
  private readonly kick = (): void => {
    if (!this.running || document.visibilityState !== 'visible') return;
    const now = performance.now();
    if (this.lastFrame === null || now - this.lastFrame > WATCHDOG_MS * 2) this.frame(now);
  };

  /** Advances the sim by the real time elapsed, honouring the fixed timestep. Returns ticks run. */
  advance(dtMs: number): number {
    const state = this.state;
    const speed = state.speed;
    if (speed === 0) return 0;
    const step = msPerTick(speed);
    this.acc += Math.min(dtMs, MAX_FRAME_MS);
    let n = Math.floor(this.acc / step);
    if (n > MAX_TICKS_PER_FRAME) {
      n = MAX_TICKS_PER_FRAME;
      this.acc = 0;
    } else {
      this.acc -= n * step;
    }
    let ran = 0;
    for (; ran < n && state.speed !== 0; ran++) stepTick(this.ctx);
    if (state.speed === 0) this.acc = 0;
    this.alpha = state.speed === 0 ? 1 : Math.min(1, this.acc / step);
    return ran;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = this.lastFrame === null ? 0 : Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    for (const fn of this.frameHooks) fn(now);
    this.input.update(Math.min(dt, 100));
    if (this.followId !== null) {
      const v = this.state.vehicles[this.followId];
      if (v) this.centerOn(v.pos);
      else this.followId = null;
    }
    if (this.advance(dt) > 0) this.tools.refreshGhost();
    clampCamera(this.camera, this.map);
    this.g2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.o2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderer.render(this.state, this.camera, this.alpha, now);
    if (now - this.lastHud >= HUD_INTERVAL_MS) {
      this.lastHud = now;
      this.hud.update(this.state, now);
    }
    this.hud.tick(now);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Runs `fn(now)` at the start of every frame until the returned function is called. */
  addFrameHook(fn: (now: number) => void): () => void {
    this.frameHooks.add(fn);
    return () => {
      this.frameHooks.delete(fn);
    };
  }

  /** Registers cleanup that must run when this game is destroyed (quit, load, new game). */
  addDisposer(fn: () => void): void {
    this.disposers.push(fn);
  }

  destroy(): void {
    for (const fn of this.disposers.splice(0)) fn();
    this.running = false;
    this.frameHooks.clear();
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    for (const off of this.busOffs) off();
    this.busOffs = [];
    this.input.destroy();
    window.removeEventListener('resize', this.onResize);
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.hudObserver?.disconnect();
    window.removeEventListener('pointerdown', this.onGesture, true);
    window.removeEventListener('keydown', this.onGesture, true);
    closeAllWindows();
    clearStamps();
    this.sfx.dispose();
    this.onPause = null;
    this.uiRoot.replaceChildren();
    this.overlay.remove();
    this.uiRoot.classList.remove('tb-root');
  }
}
