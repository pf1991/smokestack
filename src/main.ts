import './ui/theme.css';
import { EventBus } from './core/events';
import { BUILDINGS } from './data/buildings';
import { App } from './game/app';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from './render/camera';
import { runAutoplay } from './game/autoplay';
import { runDays, stepTick } from './sim/simulation';
import { canPlaceBuilding, createGame, placeBuilding } from './sim/state';
import { buyUpgrade } from './sim/society/upgrades';
import type { SmogTier, Speed } from './sim/types';
import { SMOG_TIER_THRESHOLDS } from './sim/society/tiers';
import { autoResolve, forceCard } from './sim/politics/cards';
import { workCity } from './sim/politics/workforce';
import { startStrike } from './sim/society/strikes';

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
 *  - `inspect2=1` (dev) open inspectors for the first two buildings (use with `panel=routes` to exercise the side-panel tabs)
 *  - `news=1`          demo newspaper (handled by the newspaper panel)
 *  - `scenario=<id>`   start a scenario
 *  - `menuscreen=new|load|achievements|settings` (dev) open a menu sub-screen
 *  - `pause=1` (dev, with a debug start) open the pause menu
 *  - `tutorial=1`      show the tutorial card (even if it was skipped or finished before)
 *  - `skipYears=<n>` (dev) after autoplay, simulate n*360 more days before first paint
 *  - `cards=0` (dev) answer every pending event card with its default choice before first paint
 *    (screenshots of the world; a skipYears start otherwise opens that spring's card)
 *  - `classes=<cityId>:<working>,<middle>,<upper>` (dev) set a town's class mix (normalised), e.g. to
 *    show villas and semis in a screenshot
 *  - `strike=<buildingId>` (dev) start a strike at that building and centre the view on it
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
  // `strike=<buildingId>` starts a strike at that building today (its card opens; `cards=0` answers it
  // "Wait it out", so the strike stays on) and centres the view on it, for screenshots
  const strikeParam = Number(params.get('strike'));
  if (import.meta.env.DEV && params.has('strike') && Number.isInteger(strikeParam)) {
    const b = state.buildings[strikeParam];
    const city = b ? (workCity(state, b) ?? state.cities[0]) : undefined;
    if (b && city) {
      startStrike(setup, b, city);
      const size = BUILDINGS[b.typeId].size;
      focus = { x: Math.round(b.pos.x + size.w / 2), y: Math.round(b.pos.y + size.h / 2) };
    }
  }
  // `upgrades=1` builds two steel mills side by side near the first town, the east one with a
  // tier 2 scrubber and a tall chimney (needs a year ≥ 1948: add skipYears=50), and centres on them
  let upgradedId: number | null = null;
  if (import.meta.env.DEV && params.get('upgrades') === '1' && state.cities[0]) {
    const player = state.companies.player;
    player.money += 1e6;
    const c = state.cities[0].center;
    const near = { x: c.x + state.cities[0].urbanRadius + 6, y: c.y };
    // the first spot (spiral out from `near`) with room for both mills a tile apart
    const w = BUILDINGS.steel_mill.size.w;
    let a: { x: number; y: number } | null = null;
    for (let r = 0; r < 40 && !a; r++) {
      for (let dy = -r; dy <= r && !a; dy++) {
        for (let dx = -r; dx <= r && !a; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = { x: near.x + dx, y: near.y + dy };
          if (canPlaceBuilding(state, 'player', 'steel_mill', p).ok && canPlaceBuilding(state, 'player', 'steel_mill', { x: p.x + w + 1, y: p.y }).ok) a = p;
        }
      }
    }
    const pa = a ? placeBuilding(setup, 'player', 'steel_mill', a) : null;
    const pb = a ? placeBuilding(setup, 'player', 'steel_mill', { x: a.x + w + 1, y: a.y }) : null;
    if (pa?.ok && pb?.ok) {
      buyUpgrade(setup, pb.value.id, 'scrubber');
      buyUpgrade(setup, pb.value.id, 'scrubber');
      buyUpgrade(setup, pb.value.id, 'tallChimney');
      pa.value.status = 'ok';
      pb.value.status = 'ok';
      upgradedId = pb.value.id;
      focus = { x: pb.value.pos.x, y: pa.value.pos.y + 1 };
    }
  }
  const cardParam = params.get('card');
  // `cards=0` clears the pending cards; `card=<id>` does too, so the forced card is the one on screen
  if (import.meta.env.DEV && (params.get('cards') === '0' || cardParam)) {
    for (const p of [...state.politics.cards.pending]) autoResolve(setup, p.uid);
  }
  if (import.meta.env.DEV && cardParam) forceCard(setup, cardParam);

  const hourParam = params.get('hour');
  if (hourParam !== null) {
    const hour = Math.floor(Number(hourParam));
    if (hour >= 0 && hour < 24) {
      for (let i = 0; i < 24 && state.date.hour !== hour; i++) stepTick(setup);
      if (!params.has('speed')) state.speed = 0;
    }
  }

  // `rain=1` makes today a rain day (until the next day's weather roll), for screenshots
  if (import.meta.env.DEV && params.get('rain') === '1') {
    state.weather.rain = true;
    state.weather.rainDays = Math.max(1, state.weather.rainDays);
  }

  // `smogtier=<cityId>:<tier>` forces a town's smog tier (level just over its threshold), for screenshots
  const smogTier = params.get('smogtier')?.split(':').map(Number);
  if (import.meta.env.DEV && smogTier?.length === 2 && smogTier.every(Number.isInteger)) {
    const city = state.cities.find((c) => c.id === smogTier[0]);
    const tier = Math.min(4, Math.max(0, smogTier[1])) as SmogTier;
    if (city) city.smog = { ...city.smog, tier, months: 0, level: Math.max(city.smog.level, SMOG_TIER_THRESHOLDS[tier] + 0.01) };
  }

  // `classes=<cityId>:<w>,<m>,<u>` sets a town's class mix (normalised), for screenshots of the class houses
  const classParam = params.get('classes')?.split(':');
  if (import.meta.env.DEV && classParam?.length === 2) {
    const city = state.cities.find((c) => c.id === Number(classParam[0]));
    const [w, m, u] = classParam[1].split(',').map(Number);
    const sum = w + m + u;
    if (city && [w, m, u].every((x) => Number.isFinite(x) && x > 0)) city.classes = { working: w / sum, middle: m / sum, upper: u / sum };
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
    // `at=x,y` centres the view on a tile (screenshots of a given district)
    const at = params.get('at')?.split(',').map(Number);
    if (import.meta.env.DEV && at?.length === 2 && at.every(Number.isFinite)) g.centerOn({ x: at[0], y: at[1] });
    if (import.meta.env.DEV && params.get('tiltshift') === '1') g.renderer.forceTiltShift = true;
    if (params.has('panel')) g.openPanel(params.get('panel') ?? '');
    if (import.meta.env.DEV && params.get('openroute') === '1') {
      const r = Object.values(g.ctx.state.routes).find((x) => x.ownerId === 'player');
      if (r) g.openPanel('routes', r.id);
    }
    if (import.meta.env.DEV && upgradedId !== null && params.get('inspectup') === '1') g.openPanel('building', upgradedId);
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
