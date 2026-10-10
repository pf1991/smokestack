import './ui/theme.css';
import { EventBus } from './core/events';
import { BUILDINGS } from './data/buildings';
import { runAutoplay } from './game/autoplay';
import { GameController } from './game/controller';
import { QuickRoute } from './game/quickRoute';
import { runDays, stepTick } from './sim/simulation';
import { attachNewspaper } from './ui/panels/newspaper';
import { Ticker } from './ui/ticker';
import { createGame } from './sim/state';
import type { Speed } from './sim/types';

/**
 * Bootstrap. Debug URL parameters:
 *  - `seed=<n>`      map seed (default: random)
 *  - `autoplay=1`    script a furniture chain by the biggest city, then fast-forward 20 days at speed 8
 *  - `hour=<0-23>`   advance the clock to that hour on load (pauses unless `speed` is also given)
 *  - `speed=<0|1|2|4|8>` starting speed
 */
const canvas = document.getElementById('world') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

const seedParam = params.get('seed');
// Math.random is fine here: only src/sim must stay deterministic.
const seed = seedParam !== null && Number.isFinite(Number(seedParam))
  ? Number(seedParam) >>> 0
  : Math.floor(Math.random() * 2 ** 32) >>> 0;

const state = createGame({ seed });
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

const game = new GameController(canvas, ui);
game.load(state);
new QuickRoute(game, ui);
Ticker.attach(document.getElementById('ticker')!, game.ctx.bus, game.state.news); attachNewspaper(game);
if (focus) {
  game.camera.zoom = 1.25;
  game.centerOn(focus);
}
if (notice) game.ctx.bus.emit({ type: 'toast', ...notice });

if (import.meta.env.DEV) (window as unknown as { game: GameController }).game = game;
