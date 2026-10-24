import { loadSettings, saveSettings, UI_SCALES } from './game/settings';
import { startUpgrade } from './sim/logistics/levels';
import { buyHubTruck } from './sim/logistics/hubs';
import { startUiScale } from './ui/scale';
import { openHelp } from './ui/help';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-700.css';
import './ui/theme.css';
import './ui/kit.css';
import { EventBus } from './core/events';
import { BUILDINGS } from './data/buildings';
import { App } from './game/app';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from './render/camera';
import { autoplayDefend, autoplayLogistics, autoplayNameHeir, runAutoplay } from './game/autoplay';
import { addGrudge, FURIOUS_AT, grudgeTotal } from './sim/nemesis/grudges';
import { bidOpen, startBid } from './sim/nemesis/bid';
import { moveShares } from './sim/exchange/shares';
import { CONTROL_SHARES } from './sim/exchange/types';
import { runDays, stepTick } from './sim/simulation';
import { accessTiles, canPlaceBuilding, createGame, placeBuilding } from './sim/state';
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
 *  - `inspectcity=1` / `inspectvehicle=1` (dev) open the first city / vehicle inspector
 *  - `inspectstore=1` (dev) opens the player's first store inspector
 *  - `inspecthub=1` (dev) opens a hub on the player's first warehouse (placing one by their first works when
 *    there is none), selects it and opens its inspector
 *  - `news=1`          demo newspaper (handled by the newspaper panel)
 *  - `hudmenu=<id>` (dev) open a top-bar dropdown: company, operations, world, more
 *  - `scenario=<id>`   start a scenario
 *  - `buildtab=<extract|refine|manufacture|retail|transport>` (dev) open a build bar flyout; `ticker=scroll|headline|off` (dev) set the news strip
 *  - `menuscreen=new|load|achievements|settings` (dev) open a menu sub-screen
 *  - `pause=1` (dev, with a debug start) open the pause menu
 *  - `tutorial=1`      show the tutorial card (even if it was skipped or finished before)
 *  - `skipYears=<n>` (dev) after autoplay, simulate n*360 more days before first paint; with
 *    `autoplay=1` the years run as the soak runs them (scripts/soak.ts): the heir named each year and
 *    the Baron's hostile bid answered and autoplayLogistics run at each 30-day month end, so the company is still the player's
 *  - `baron=furious` (dev) give the Baron grudges up to FURIOUS_AT and forget his last strike, so his
 *    portrait (rival panel) is furious rather than gloating
 *  - `bid=1` (dev) hand the Baron a majority of the player's shares and open his hostile bid (the
 *    exchange panel's bid banner; add `panel=exchange`)
 *  - `end=1` (dev) show the victory end screen, with its Legacy table, on load
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
// `uiscale=0.8|0.9|1|1.15|1.3` (dev) sets the interface scale (screenshots)
const uiScaleParam = Number(params.get('uiscale'));
if (import.meta.env.DEV && UI_SCALES.includes(uiScaleParam)) saveSettings({ ...loadSettings(), uiScale: uiScaleParam as 0.8 });
startUiScale();
const app = new App(canvas, ui);

// inspect2 does nothing outside DEV, so only there does it start a debug game
const DEBUG_KEYS = ['seed', 'autoplay', 'hour', 'speed', 'panel', 'news', 'scenario', 'contracts', 'tutorial', 'skipYears', 'zoom', ...(import.meta.env.DEV ? ['inspect2', 'card', 'upgrading'] : [])];
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

  let autoplayed = false;
  if (params.get('autoplay') === '1') {
    const r = runAutoplay(setup);
    if (r.ok) {
      autoplayed = true;
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
    const days = Math.floor(skipYears) * 360;
    if (!autoplayed) runDays(setup, days);
    else {
      for (let d = 0; d < days; d += 30) {
        if (d % 360 === 0) autoplayNameHeir(setup);
        runDays(setup, 30);
        autoplayDefend(setup);
        autoplayLogistics(setup);
      }
    }
  }
  // `baron=furious`: enough grudges for FURIOUS_AT and no recent strike to gloat over
  if (import.meta.env.DEV && params.get('baron') === 'furious') {
    for (let i = 0; i < 40 && grudgeTotal(state) < FURIOUS_AT; i++) addGrudge(state, 'rivalry', null);
    state.nemesis.lastAction = null;
  }
  // `bid=1`: the Baron takes a majority of the player's shares (from the player, then the public) and bids
  const playerListing = state.exchange.listings.player;
  if (import.meta.env.DEV && params.get('bid') === '1' && playerListing && !bidOpen(state)) {
    for (const from of ['player', 'public']) {
      const want = CONTROL_SHARES - (playerListing.holders.rival ?? 0);
      const n = Math.min(Math.max(0, want), playerListing.holders[from] ?? 0);
      if (n > 0) moveShares(state, 'player', from, 'rival', n);
    }
    if ((playerListing.holders.rival ?? 0) >= CONTROL_SHARES) startBid(setup);
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
  // `upgrading=1` (dev) starts a level-2 upgrade on the first player works (a sawmill when there is one; use with `autoplay=1`)
  let upgradingId: number | null = null;
  if (import.meta.env.DEV && params.get('upgrading') === '1') {
    const works = Object.values(state.buildings).filter((b) => b.ownerId === 'player' && ['extractor', 'factory'].includes(BUILDINGS[b.typeId].category));
    const mill = works.find((b) => b.typeId === 'sawmill') ?? works.find((b) => BUILDINGS[b.typeId].category === 'factory') ?? works[0];
    if (mill && startUpgrade(setup, mill.id, 'player').ok) {
      upgradingId = mill.id;
      const size = BUILDINGS[mill.typeId].size;
      focus = { x: Math.round(mill.pos.x + size.w / 2), y: Math.round(mill.pos.y + size.h / 2) };
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
    // `hudmenu=<group id|more|factions>` opens a top-bar dropdown (screenshots of the menus)
    const hudMenu = params.get('hudmenu');
    if (import.meta.env.DEV && hudMenu) {
      const sel = hudMenu === 'more' ? '.hud-more-btn' : hudMenu === 'factions' ? '.hud-factions-mode-btn' : `.hud-group-btn[data-group="${CSS.escape(hudMenu)}"]`;
      document.querySelector<HTMLElement>(sel)?.click();
    }
    // `buildtab=<category id>` opens a build bar flyout; `ticker=scroll|headline|off` sets the news strip (screenshots)
    const buildTab = params.get('buildtab');
    if (import.meta.env.DEV && buildTab) document.querySelector<HTMLElement>(`.toolbar [data-tab="${CSS.escape(buildTab)}"]`)?.click();
    const tickerParam = params.get('ticker');
    if (import.meta.env.DEV && (tickerParam === 'scroll' || tickerParam === 'headline' || tickerParam === 'off')) saveSettings({ ...loadSettings(), ticker: tickerParam });
    if (import.meta.env.DEV && params.get('openroute') === '1') {
      const r = Object.values(g.ctx.state.routes).find((x) => x.ownerId === 'player');
      if (r) g.openPanel('routes', r.id);
    }
    if (import.meta.env.DEV && upgradedId !== null && params.get('inspectup') === '1') g.openPanel('building', upgradedId);
    if (import.meta.env.DEV && params.get('inspect2') === '1') {
      for (const b of Object.values(g.ctx.state.buildings).slice(0, 2)) g.openPanel('building', b.id);
    }
    // after inspect2, so the upgrading works is the building panel on screen (its scaffold is centred)
    if (import.meta.env.DEV && upgradingId !== null) g.openPanel('building', upgradingId);
    if (import.meta.env.DEV && params.get('inspectcity') === '1') g.openPanel('city', 0);
    // `inspectstore=1` (dev) opens the player's first store (screenshots of the store inspector)
    if (import.meta.env.DEV && params.get('inspectstore') === '1') {
      const st = Object.values(g.ctx.state.buildings).find((b) => b.ownerId === 'player' && b.typeId === 'store');
      if (st) g.openPanel('building', st.id);
    }
    // `inspecthub=1` opens a hub (one truck) on the player's first warehouse, if any, and selects it
    if (import.meta.env.DEV && params.get('inspecthub') === '1') {
      const st = g.ctx.state;
      let wh = Object.values(st.buildings).find((b) => b.ownerId === 'player' && b.typeId === 'warehouse');
      // none yet: put one on the road nearest the player's first works, so the shot has a hub to show
      const works = Object.values(st.buildings).find((b) => b.ownerId === 'player' && BUILDINGS[b.typeId].category !== 'retail');
      for (let r = 1; !wh && works && r <= 12; r++) {
        for (let dy = -r; dy <= r && !wh; dy++) {
          for (let dx = -r; dx <= r && !wh; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const p = { x: works.pos.x + dx, y: works.pos.y + dy };
            if (!canPlaceBuilding(st, 'player', 'warehouse', p).ok || accessTiles(st, { typeId: 'warehouse', pos: p }).length === 0) continue;
            const placed = placeBuilding(g.ctx, 'player', 'warehouse', p);
            if (placed.ok) wh = placed.value;
          }
        }
      }
      if (wh) {
        if (!wh.hub) buyHubTruck(g.ctx, 'player', wh.id);
        const size = BUILDINGS[wh.typeId].size;
        g.centerOn({ x: wh.pos.x + size.w / 2, y: wh.pos.y + size.h / 2 });
        g.renderer.setSelection({ buildingId: wh.id });
        g.openPanel('building', wh.id);
      }
    }
    if (import.meta.env.DEV && params.get('inspectvehicle') === '1') {
      const v = Object.values(g.ctx.state.vehicles)[0];
      if (v) g.openPanel('vehicle', v.id);
    }
    if (import.meta.env.DEV && params.get('send') === '1') {
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-act="send-goods"]')?.click(), 5500);
    }
    const tutorial = params.get('tutorial') === '1';
    if (import.meta.env.DEV && params.get('coldopen') === '1') app.playIntro(g, () => tutorial && app.showTutorial(g));
    else if (tutorial) app.showTutorial(g);
    if (notice) g.ctx.bus.emit({ type: 'toast', ...notice });
    if (import.meta.env.DEV && params.get('pause') === '1') g.onPause?.();
    // `help=1` opens the help overlay, `settings=1` the pause menu's Settings screen (dev, screenshots)
    if (import.meta.env.DEV && params.get('help') === '1') openHelp();
    if (import.meta.env.DEV && params.get('settings') === '1') g.onPause?.('settings');
    if (import.meta.env.DEV && params.get('end') === '1') g.ctx.bus.emit({ type: 'victory', reason: 'The century is over' });
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
