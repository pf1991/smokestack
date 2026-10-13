import './ui/theme.css';
import { EventBus } from './core/events';
import { BUILDINGS } from './data/buildings';
import { App } from './game/app';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from './render/camera';
import { runAutoplay } from './game/autoplay';
import { runDays, stepTick } from './sim/simulation';
import { createGame } from './sim/state';
import type { Speed } from './sim/types';
import { autoResolve, forceCard } from './sim/politics/cards';

/**
 * Bootstrap: the game starts at the main menu. Debug URL parameters skip the menu and start a game
 * directly:
 *  - `seed=<n>`      map seed (default: random)
 *  - `autoplay=1`    script a furniture chain by the biggest city, then fast-forward 20 days at speed 8
 *  - `hour=<0-23>`   advance the clock to that hour on load (pauses unless `speed` is also given)
 *  - `speed=<0|1|2|4|8>` starting speed
 *  - `panel=<id>`      open a panel (e.g. `routes`) on load
 *  - `openroute=1` (dev) open the routes window on the first player route
 *  - `send=1` (dev) press Send goods in an open building inspector (use with `inspect=building`)
 *  - `inspect2=1` (dev) open inspectors for the first two buildings (use with `panel=routes` to exercise the dock)
 *  - `news=1`          demo newspaper (handled by the newspaper panel)
 *  - `scenario=<id>`   start a scenario
 *  - `menuscreen=new|load|achievements|settings` (dev) open a menu sub-screen
 *  - `pause=1` (dev, with a debug start) open the pause menu
 *  - `tutorial=1`      show the tutorial card (even if it was skipped or finished before)
 *  - `skipYears=<n>` (dev) after autoplay, simulate n*360 more days before first paint
 *  - `cards=0` (dev) answer every pending event card with its default choice before first paint
 *    (screenshots of the world; a skipYears start otherwise opens that spring's card)
 *  - `card=<id>` (dev) open event card `<id>` on load (data/cards/), whatever its era or trigger
 *  - `zoom=<0.5..3>` (dev) camera zoom, applied after the autoplay framing
 *  - `fps=1` (dev) after a 3 s warm-up, average the requestAnimationFrame rate over 5 s and put it
 *    in the document title as `FPS <avg> (<frames> frames, worst <ms> ms)` (read it via CDP)
 *  - `tiltshift=1` (dev) keep the diorama tilt-shift on even when frames are slow (headless shots)
 *  - `coldopen=1` (dev, with a debug start) play the New Game cold open (game/coldOpen.ts)
 *  - `menu=1`          force the menu even when other parameters are present
 */
const canvas = document.getElementById('world') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);
const app = new App(canvas, ui);

// inspect2 does nothing outside DEV, so only there does it start a debug game
const DEBUG_KEYS = ['seed', 'autoplay', 'hour', 'speed', 'panel', 'news', 'scenario', 'contracts', 'tutorial', 'skipYears', 'zoom', ...(import.meta.env.DEV ? ['inspect2', 'card'] : [])];
const debugStart = !params.has('menu') && DEBUG_KEYS.some((k) => params.has(k));

if (debugStart) {
  const seedParam = params.get('seed');
  // Math.random is fine here: only src/sim must stay deterministic.
  const seed = seedParam !== null && Number.isFinite(Number(seedParam))
    ? Number(seedParam) >>> 0
    : Math.floor(Math.random() * 2 ** 32) >>> 0;

  const state = createGame({ seed, scenarioId: params.get('scenario') ?? undefined });
  // setup work happens on a throwaway bus so its events (sales, sparks) do not all replay at once
  const setup = { state, bus: new EventBus() };
  let notice: { message: string; tone: 'info' | 'good' | 'bad' } | null = null;
  let focus: { x: number; y: number } | null = null;

  if (params.get('autoplay') === '1') {
    const r = runAutoplay(setup);
    if (r.ok) {
      runDays(setup, 20);
      state.speed = 8;
      const xs = r.value.map((b) => b.pos.x + BUILDINGS[b.typeId].size.w / 2);
      const ys = r.value.map((b) => b.pos.y + BUILDINGS[b.typeId].size.h / 2);
      focus = {
        x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
      };
      notice = { message: 'Autoplay: furniture chain built and fast-forwarded 20 days', tone: 'info' };
    } else {
      notice = { message: `Autoplay failed: ${r.error}`, tone: 'bad' };
    }
  }

  const skipYears = Number(params.get('skipYears'));
  if (import.meta.env.DEV && params.has('skipYears') && Number.isFinite(skipYears) && skipYears > 0) {
    runDays(setup, Math.floor(skipYears) * 360);
  }
  if (import.meta.env.DEV && params.get('cards') === '0') {
    for (const p of [...state.politics.cards.pending]) autoResolve(setup, p.uid);
  }
  const cardParam = params.get('card');
  if (import.meta.env.DEV && cardParam) forceCard(setup, cardParam);

  const hourParam = params.get('hour');
  if (hourParam !== null) {
    const hour = Math.floor(Number(hourParam));
    if (hour >= 0 && hour < 24) {
      for (let i = 0; i < 24 && state.date.hour !== hour; i++) stepTick(setup);
      if (!params.has('speed')) state.speed = 0;
    }
  }

  const speedParam = Number(params.get('speed'));
  if (params.has('speed') && [0, 1, 2, 4, 8].includes(speedParam)) state.speed = speedParam as Speed;

  app.start(state, (g) => {
    if (focus) {
      g.camera.zoom = DEFAULT_ZOOM;
      g.centerOn(focus);
    }
    const zoomParam = Number(params.get('zoom'));
    if (import.meta.env.DEV && params.has('zoom') && Number.isFinite(zoomParam) && zoomParam > 0) {
      g.camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomParam));
      if (focus) g.centerOn(focus);
    }
    if (import.meta.env.DEV && params.get('tiltshift') === '1') g.renderer.forceTiltShift = true;
    if (params.has('panel')) g.openPanel(params.get('panel') ?? '');
    if (import.meta.env.DEV && params.get('openroute') === '1') {
      const r = Object.values(g.ctx.state.routes).find((x) => x.ownerId === 'player');
      if (r) g.openPanel('routes', r.id);
    }
    if (import.meta.env.DEV && params.get('inspect2') === '1') {
      for (const b of Object.values(g.ctx.state.buildings).slice(0, 2)) g.openPanel('building', b.id);
    }
    if (import.meta.env.DEV && params.get('send') === '1') {
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-act="send-goods"]')?.click(), 5500);
    }
    const tutorial = params.get('tutorial') === '1';
    if (import.meta.env.DEV && params.get('coldopen') === '1') app.playIntro(g, () => tutorial && app.showTutorial(g));
    else if (tutorial) app.showTutorial(g);
    if (notice) g.ctx.bus.emit({ type: 'toast', ...notice });
    if (import.meta.env.DEV && params.get('pause') === '1') g.onPause?.();
  });
} else {
  const menu = app.showMenu();
  const screen = params.get('menuscreen');
  if (import.meta.env.DEV && (screen === 'new' || screen === 'load' || screen === 'achievements' || screen === 'settings')) menu.show(screen);
}

if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;

if (import.meta.env.DEV && params.get('fps') === '1') {
  // performance.now() frame deltas: 3 s warm-up, then 5 s of samples
  const t0 = performance.now();
  let start = -1;
  let last = -1;
  let frames = 0;
  let worst = 0;
  const tick = (now: number): void => {
    if (now - t0 < 3000) return void requestAnimationFrame(tick);
    if (start < 0) start = last = now;
    else {
      worst = Math.max(worst, now - last);
      last = now;
      frames++;
    }
    if (now - start < 5000) return void requestAnimationFrame(tick);
    const fps = (frames * 1000) / (now - start);
    document.title = `FPS ${fps.toFixed(1)} (${frames} frames, worst ${worst.toFixed(1)} ms)`;
    console.info(document.title);
  };
  requestAnimationFrame(tick);
}
