import { EventBus } from '../core/events';
import { biggestCity, runAutoplay } from '../game/autoplay';
import { clampCamera, TILE } from '../render/camera';
import type { Camera } from '../render/constants';
import { WorldRenderer } from '../render/world';
import { runDays, stepTick } from '../sim/simulation';
import { createGame } from '../sim/state';
import type { SimContext } from '../sim/types';

const NIGHT_HOUR = 20;
const SLOW_TICK_MS = 120;

/**
 * The title screen's live background: a generated map with a furniture chain, held at night so the
 * windows glow and the chimneys smoke, while the camera drifts slowly across it.
 */
export class MenuBackdrop {
  private readonly renderer: WorldRenderer;
  private readonly ctx: SimContext;
  private readonly cam: Camera = { x: 0, y: 0, zoom: 1.2, viewW: 0, viewH: 0 };
  private readonly centre: { x: number; y: number };
  private raf = 0;
  private watchdog = 0;
  private running = true;
  private tickAcc = 0;
  private last: number | null = null;
  private readonly onResize = () => this.resize();
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement, seed: number = Math.floor(Math.random() * 2 ** 32) >>> 0) {
    const state = createGame({ seed, rival: false });
    this.ctx = { state, bus: new EventBus() };
    const built = runAutoplay(this.ctx);
    if (built.ok) runDays(this.ctx, 25);
    state.date.hour = NIGHT_HOUR;
    state.date.month = 11;
    state.speed = 1;
    // pan around the middle of the chain (factories smoke) rather than the empty countryside
    const city = biggestCity(state.cities);
    const pts = built.ok ? built.value.map((b) => ({ x: b.pos.x + 1.5, y: b.pos.y + 1.5 })) : [];
    if (city) pts.push(city.center);
    const n = pts.length || 1;
    this.centre = pts.length
      ? { x: (pts.reduce((a, p) => a + p.x, 0) / n + 0.5) * TILE, y: (pts.reduce((a, p) => a + p.y, 0) / n + 0.5) * TILE }
      : { x: 64 * TILE, y: 48 * TILE };
    this.renderer = new WorldRenderer(canvas, state);
    this.renderer.attachEffects(this.ctx.bus);
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
    // some headless/embedded browsers stop delivering animation frames; keep drawing from a timer then
    this.watchdog = window.setInterval(() => {
      const now = performance.now();
      if (this.last === null || now - this.last > 120) this.frame(now);
    }, 60);
  }

  private resize(): void {
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.cam.viewW = w;
    this.cam.viewH = h;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = this.last === null ? 0 : Math.min(100, now - this.last);
    this.last = now;
    const { state } = this.ctx;
    // keep the trucks rolling but never let the clock leave the night hour
    this.tickAcc += dt;
    while (this.tickAcc >= SLOW_TICK_MS) {
      this.tickAcc -= SLOW_TICK_MS;
      stepTick(this.ctx);
      state.date = { ...state.date, hour: NIGHT_HOUR, day: 15, month: 11 };
    }
    const t = now / 1000;
    const cam = this.cam;
    const cx = this.centre.x + Math.sin(t * 0.05) * 9 * TILE;
    const cy = this.centre.y + Math.cos(t * 0.037) * 5 * TILE;
    cam.x = cx - cam.viewW / cam.zoom / 2;
    cam.y = cy - cam.viewH / cam.zoom / 2;
    clampCamera(cam, state.map);
    this.canvas.getContext('2d')?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderer.render(state, cam, 1, now);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  };

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    window.removeEventListener('resize', this.onResize);
  }
}
