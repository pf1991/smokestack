import './ui/theme.css';
import { EventBus } from './core/events';
import { BUILDINGS } from './data/buildings';
import { App } from './game/app';
import { runAutoplay } from './game/autoplay';
import { runDays, stepTick } from './sim/simulation';
import { createGame } from './sim/state';
import type { Speed } from './sim/types';

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
 *  - `news=1`          demo newspaper (handled by the newspaper panel)
 *  - `scenario=<id>`   start a scenario
 *  - `menuscreen=new|load|achievements|settings` (dev) open a menu sub-screen
 *  - `pause=1` (dev, with a debug start) open the pause menu
 *  - `tutorial=1`      show the tutorial card (even if it was skipped or finished before)
 *  - `menu=1`          force the menu even when other parameters are present
 */
const canvas = document.getElementById('world') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);
const app = new App(canvas, ui);

const DEBUG_KEYS = ['seed', 'autoplay', 'hour', 'speed', 'panel', 'news', 'scenario', 'contracts', 'tutorial'];
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
      g.camera.zoom = 1.25;
      g.centerOn(focus);
    }
    if (params.has('panel')) g.openPanel(params.get('panel') ?? '');
    if (import.meta.env.DEV && params.get('openroute') === '1') {
      const r = Object.values(g.ctx.state.routes).find((x) => x.ownerId === 'player');
      if (r) g.openPanel('routes', r.id);
    }
    if (import.meta.env.DEV && params.get('send') === '1') {
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-act="send-goods"]')?.click(), 5500);
    }
    if (params.get('tutorial') === '1') app.showTutorial(g);
    if (notice) g.ctx.bus.emit({ type: 'toast', ...notice });
    if (import.meta.env.DEV && params.get('pause') === '1') g.onPause?.();
  });
} else {
  const menu = app.showMenu();
  const screen = params.get('menuscreen');
  if (import.meta.env.DEV && (screen === 'new' || screen === 'load' || screen === 'achievements' || screen === 'settings')) menu.show(screen);
}

if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
