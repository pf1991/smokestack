# SMOKESTACK II Phase 1: The First Five Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game look and feel good from the first second, so it is worth showing to friends. That means:
- a spring start and a softer 1900 grade;
- a canvas icon set instead of emoji;
- treasury juice;
- a window manager;
- bigger vehicles and construction animation;
- cities that visibly spread and gain landmarks;
- the engraved survey map and the ¾ diorama;
- a cold open;
- a photo mode.

**Architecture:**
- Rendering work stays in `src/render`, behind pure helper functions that are unit-tested.
- Visual results are checked with the Phase 0 screenshot matrix (`scripts/shots.sh`).
- Only two tasks touch the simulation: city spread (Task 7) and landmarks (Task 8). Both stay deterministic and add a save migration.

**Tech Stack:** TypeScript 5.6 strict, Canvas 2D, Vitest + jsdom, headless Chrome screenshots.

**Spec:** `docs/superpowers/specs/2026-10-11-smokestack-v2-design.md`. Sections 4 and 9, and section 11 Phase 1. This plan depends on Phase 0 (`docs/superpowers/plans/2026-10-11-v2-phase0-foundations.md`) being merged.

## Global Constraints

- No runtime dependencies. No asset files: all art is procedural Canvas 2D. No WebGL.
- `src/sim` stays deterministic. Purely visual animation (construction, camera pan, counter roll) lives in `src/render` and `src/ui`, keyed on real time, and never writes `GameState`.
- `GameState` stays plain JSON. Any new state field gets a migration in `src/sim/migrations.ts` with `from: 2`.
- Performance budget: 60 fps at 1366×768 with 300 vehicles. New layers are cached per chunk, like the existing chunk cache.
- Keep the v1 invariant funnels and the Phase 0 funnel guard test green.
- The registries stay append-only.
- Use `docker compose`.
- Run `chown -R freire:freire /home/freire/projects/industry` after merging and after `npm install`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Era printing styles and weather are Phase 5. In this phase, only soften the existing grade.

## Review Focus

1. **Speed 8 at noon:** buildings must not show lit windows in daylight. This is the v1 bug where `FAST_MIN_LIGHT` 0.7 sits below the 0.8 lit threshold. Pinned in Task 1.
2. **Many windows on a 1366×768 screen:**
   - Opening a fifth window must never cover the HUD top bar or the toolbar.
   - Every window must stay reachable from the dock.
   - Closing a docked window removes its tab.

   Pinned in Task 4.
3. **Saves from Phase 0 (`phase0.save.json`)** load after the city-growth and landmark migrations. Their cities gain streets and landmarks on the next month without crashing. Pinned in Tasks 7 and 8.
4. **Landmarks never block play:**
   - A landmark never lands on a road, rail, building, deposit or water tile.
   - The player cannot place a building over one.
   - A city with no free 2×2 block skips that landmark instead of looping.

   Pinned in Task 8.
5. **The cold open and photo mode always give control back:**
   - Esc or a click skips the cold open.
   - Loading a save never plays it.
   - P/Esc leaves photo mode even if export fails.

   Pinned in Tasks 11 and 12.

---

### Task 1: April start, softer 1900 grade, speed-8 lights fix

**Files:**
- Modify: `src/sim/clock.ts:6`. `START_DATE` becomes `{ year: 1900, month: 4, day: 1, hour: 0 }`.
- Modify: `src/render/atmosphere.ts`.
  - `eraGrade` changes from sepia 0.8→0 and saturate 0.6→1.15 to **sepia 0.45→0** and **saturate 0.85→1.15**, still over 1900–1965.
  - Add `isLit(hour)`.
- Modify: `src/render/world/index.ts`. `lit` comes from `isLit(date.hour)` instead of `light < 0.8`.
- Test: `src/render/atmosphere.test.ts`, `src/sim/clock.test.ts`

**Interfaces:**
- Produces: `export function isLit(hour: number): boolean` in atmosphere.ts. It returns `lightLevel(hour) < 0.8`. It is independent of speed and easing.

- [ ] **Step 1: Write the failing tests:**
  - `eraGrade(1900)` equals `{ sepia: 0.45, saturate: 0.85 }`.
  - `eraGrade(1965).sepia` equals `0`.
  - `isLit(12) === false` and `isLit(22) === true`.
  - `createGame({seed:7}).date` equals `{ year: 1900, month: 4, day: 1, hour: 0 }`.
- [ ] **Step 2:** Run `npx vitest run src/render/atmosphere.test.ts src/sim/clock.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the change.
- [ ] **Step 4:** Run `npm test` and fix the tests that assumed a January start. Those are tests that count months from the start or expect `month: 1`. Change their expectations, not the date logic. Run `npm run soak -- --seeds 7 --years 10`. Expected: all pass, and the soak exits 0.
- [ ] **Step 5:** Run `bash scripts/shots.sh` and look at `shots/1366-y0-z1.png`. Expected: green spring map with no snow, and the HUD date reads Apr 1900.
- [ ] **Step 6: Commit** with `feat: spring 1900 start, softer early grade, daylight windows unlit at speed 8`.

### Task 2: Canvas icon atlas replaces emoji

**Files:**
- Create: `src/render/icons.ts`
- Create: `src/ui/icon.ts` (DOM helper)
- Modify: `src/data/goods.ts`. Remove the `icon` field. Icons are keyed by good id.
- Modify: `src/game/achievements.ts`. `icon` becomes an `IconId`.
- Modify: every emoji site. These are `src/ui/panels/{routeActions,building,routes,fleet,city,contracts,rival,vehicle}.ts`, `src/ui/{toolbar,menu,window,tutorial,ticker,hud}.ts`, `src/game/toolController.ts`, and `src/render/sprites.ts:783` (`drawGoodIcon` draws from the atlas).
- Create: `src/render/iconsPreview.ts` (dev page listing all icons, wired the same way as `spritesPreview.ts`)
- Test: `src/render/icons.test.ts`, `src/ui/noEmoji.test.ts`

**Interfaces:**
- Produces:
  - `export type IconId = string`. Valid ids are every good id, plus the UI glyphs `'close' | 'lock' | 'truck' | 'train' | 'money' | 'warning' | 'star' | 'route' | 'factory' | 'city' | 'news' | 'smog' | 'play' | 'pause' | 'fast'`, plus every achievement's icon id.
  - `export const ICON_IDS: readonly IconId[]`
  - `export function drawIcon(g: CanvasRenderingContext2D, id: IconId, x: number, y: number, size: number): void`. Each glyph is a small vector painter in a 16-unit grid scaled to `size`. It uses the brass/ink palette from `src/ui/theme.css` (copy the hex values into constants). An unknown id draws a brass `?` disc.
  - `export function iconDataUrl(id: IconId, size: number): string`. It is cached per `id@size`. In jsdom it returns `''`.
  - `export function iconEl(id: IconId, size = 16, label?: string): HTMLElement` (in `src/ui/icon.ts`). It returns `<img class="icon" width height alt=label src=iconDataUrl>`, with `role="img"`.
  - Text strings that mixed emoji and words (toasts, the ticker) use the plain name instead. For example, "Achievement unlocked: Iron Horse" has no glyph.

- [ ] **Step 1: Write the failing tests:**
  - Every id in `GOODS`, every achievement icon, and every UI glyph is in `ICON_IDS`.
  - For each id in `ICON_IDS`, `drawIcon` on a mock context makes at least one fill or stroke call and never calls `fillText`.
  - `iconEl('wood', 20, 'Wood')` has `alt="Wood"`, `width="20"` and `role="img"`.
  - `noEmoji.test.ts` reads every non-test `.ts` file under `src` and asserts that none matches `/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u`.
- [ ] **Step 2:** Run `npx vitest run src/render/icons.test.ts src/ui/noEmoji.test.ts`. Expected: FAIL. The emoji test lists the 13 files.
- [ ] **Step 3:** Implement the painters and replace every site.
- [ ] **Step 4:** Run `npx tsc --noEmit && npm test`. Expected: all pass.
- [ ] **Step 5:** Open the icons preview page in headless Chrome and look at the screenshot. Every glyph must be legible at 16 px and 24 px. Also look at `shots/1366-y25-z1.png`: toolbar and panels show no emoji tofu or colour emoji.
- [ ] **Step 6: Commit** with `feat(ui): procedural icon atlas replaces emoji`.

### Task 3: Treasury juice: rolling counter, HUD deltas, milestone stamps

**Files:**
- Create: `src/ui/juice.ts`
- Modify: `src/ui/hud.ts`. The treasury uses `RollingCounter`, and the monthly result pops a delta.
- Modify: `src/ui/theme.css` (styles for `.hud-delta` and `.stamp`)
- Modify: `src/game/feedback.ts`. It shows a stamp on milestone events and on `achievement`.
- Test: `src/ui/juice.test.ts`, `src/ui/hud.test.ts`

**Interfaces:**
- Produces:
  - `export function rollValue(from: number, to: number, t: number): number`, with `t` in 0..1 and ease-out cubic. It returns `to` exactly when `t >= 1`.
  - `export class RollingCounter { constructor(el: HTMLElement, format: (n: number) => string, durationMs = 600); set(value: number, nowMs: number): void; tick(nowMs: number): void }`. When `set` is called mid-roll, the counter re-targets from the currently shown value.
  - `export const MONEY_MILESTONES = [100_000, 1_000_000, 10_000_000, 100_000_000]`
  - `export function crossedMilestone(prev: number, next: number): number | null` returns the highest milestone crossed upward.
  - `export function showStamp(text: string, tone: 'good' | 'bad'): void` appends `.stamp` to `#ui`, animates it with CSS (scale 2→1 and rotation −8°), and removes it after 2200 ms.
  - HUD delta: on `monthEnd`, it shows `+$12,340` or `−$3,100` (the player's month net, from the ledger) in `.hud-delta.good` or `.hud-delta.bad`, which floats up and fades over 1500 ms.

- [ ] **Step 1: Write the failing tests:**
  - `rollValue(0,100,0) === 0`, `rollValue(0,100,1) === 100`, and `rollValue(0,100,0.5) > 50` (ease-out).
  - `crossedMilestone(90_000, 120_000) === 100_000`, `crossedMilestone(120_000, 90_000) === null`, and `crossedMilestone(50_000, 2_000_000) === 1_000_000`.
  - `RollingCounter`: `set(100, 0)`, then `tick(600)`, shows the formatted 100. Calling `set(200, 300)` then `tick(300)` shows a value between the shown value and 200.
  - HUD: emitting `monthEnd` adds exactly one `.hud-delta` element.
- [ ] **Step 2:** Run `npx vitest run src/ui/juice.test.ts src/ui/hud.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the module and hook the counter's `tick` into the existing frame loop in `src/game/controller.ts`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat(ui): rolling treasury, monthly delta and milestone stamps`.

### Task 4: Window manager with dock

**Files:**
- Modify: `src/ui/window.ts`
- Create: `src/ui/dock.ts`
- Modify: `src/ui/theme.css` (styles for `.dock` and `.dock-tab`)
- Test: `src/ui/window.test.ts`

**Interfaces:**
- Produces (in window.ts):
  - `export const MAX_FLOATING = 2`
  - `export const COMPACT_WIDTH = 1366`
  - `GameWindow` gains `dock(): void`, `undock(): void` and `readonly docked: boolean`.
  - Opening a window when `MAX_FLOATING` windows already float docks the least-recently-focused floating one.
  - Clicking a dock tab undocks that window, which may dock another.
  - `export function placeWindow(viewportW: number, viewportH: number, hudBottom: number, toolbarTop: number, index: number, width: number): { left: number; top: number }`. This is the pure placement function. Window `index` 0 sits at the right edge and index 1 to its left. `top` is always ≥ `hudBottom + 8`. When `viewportW ≤ COMPACT_WIDTH`, the width is capped at 420 and the window's bottom at `toolbarTop - 8`.
- Produces (in dock.ts): `export function dockTabs(): HTMLElement`. This is the right-side vertical tab strip, created lazily inside `#ui`. Each tab shows the window title and a close button.

- [ ] **Step 1: Write the failing tests** (jsdom):
  - Open 3 windows `a`, `b`, `c`. Exactly 2 are not docked, and `a` is docked with one `.dock-tab` titled after it.
  - Focusing `a` via its tab undocks `a` and docks `b` (the least recently focused).
  - Closing a docked window removes its tab.
  - `placeWindow(1366, 768, 64, 700, 0, 520)` returns `top >= 72` and `left + 420 <= 1366`.
  - `placeWindow(1920, 1080, 64, 1000, 1, 480)` places the window to the left of index 0, without overlap.
  - Reopening an already-open docked window by id undocks it and raises it.
- [ ] **Step 2:** Run `npx vitest run src/ui/window.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Dragging keeps working, and a dragged window keeps its position until it is docked.
- [ ] **Step 4:** Run `npm test`, then capture a 1366×768 screenshot with `panel=routes` plus two inspectors opened via the dev params. Expected: the HUD and toolbar are fully visible, and the third window appears as a dock tab.
- [ ] **Step 5: Commit** with `feat(ui): window manager with two floating windows and a dock`.

### Task 5: Bigger vehicles with headlights and exhaust

**Files:**
- Modify: `src/render/sprites.ts` (`drawTruck`, `drawLocomotive`, `drawWagon`, `drawTrain`, `LOCO_HALF`, `WAGON_HALF`, `LOCO_STACK`)
- Modify: `src/render/world/vehicles.ts` (lane offset, headlight glow at night, exhaust puffs)
- Test: `src/render/sprites.test.ts`

**Interfaces:**
- Produces:
  - `export const VEHICLE_SCALE = 1.8`. All vehicle geometry is multiplied by it.
  - `LOCO_HALF` becomes `Math.round(13 * VEHICLE_SCALE)` and `WAGON_HALF` becomes `Math.round(8 * VEHICLE_SCALE)`.
  - `LANE_OFFSET` becomes `6`.
  - The draw functions gain a trailing `lit: boolean` parameter. When it is true, they draw two headlight cones: warm `rgba(255,236,170,0.35)`, length `10 * VEHICLE_SCALE`.
  - Trucks from 1920 onward emit an exhaust puff every 900 ms of real time while moving, through the existing `ParticleSystem`.

- [ ] **Step 1: Write the failing tests:**
  - `LOCO_HALF === 23` and `WAGON_HALF === 14`.
  - `drawTruck` on a mock context with `lit=true` makes at least 2 more fill calls than with `lit=false`.
  - The mock context's recorded rect extents for a truck span at least 28 px horizontally.
- [ ] **Step 2:** Run `npx vitest run src/render/sprites.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Train spacing keeps working because the consist uses the new half-lengths.
- [ ] **Step 4:** Run `npm test`, then `bash scripts/shots.sh`. Check `shots/1920-y55-z2.png`: trucks are clearly readable, they stay inside their lanes, and wagons follow the curves.
- [ ] **Step 5: Commit** with `feat(render): larger vehicles with headlights and exhaust`.

### Task 6: Construction animation

**Files:**
- Create: `src/render/construction.ts`
- Modify: `src/render/world/index.ts`. Record the placement time on `buildingPlaced`, and draw the building through the construction painter while it is animating.
- Test: `src/render/construction.test.ts`

**Interfaces:**
- Produces:
  - `export const BUILD_MS = 1400`
  - `export function constructionStage(elapsedMs: number): { scaffold: number; reveal: number; done: boolean }`:
    - 0–600 ms: `scaffold` 0→1, `reveal` 0.
    - 600–1200 ms: `scaffold` 1, `reveal` 0→1, bottom-up.
    - 1200–1400 ms: `scaffold` 1→0.
    - From 1400 ms: `done: true`.
  - `export function drawConstruction(g: CanvasRenderingContext2D, sprite: CanvasImageSource, x: number, y: number, w: number, h: number, stage: ReturnType<typeof constructionStage>): void`. The scaffold is brown poles and planks. The reveal clips the sprite from the bottom up. Sparks are emitted once at `reveal === 1`.
  - The renderer keeps `Map<buildingId, startMs>` and deletes an entry once `done`. Buildings present at load are never animated.

- [ ] **Step 1: Write the failing tests:**
  - `constructionStage(0)` equals `{scaffold:0, reveal:0, done:false}`.
  - `constructionStage(900).reveal` equals `0.5`.
  - `constructionStage(1400).done === true`.
  - Stages are monotonic. For t from 0 to 1400 in steps of 50, `reveal` never decreases.
- [ ] **Step 2:** Run `npx vitest run src/render/construction.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it in. The current spark burst on `buildingPlaced` moves to the reveal end.
- [ ] **Step 4: Commit** with `feat(render): scaffold and reveal construction animation`.

### Task 7: Cities spread, extend streets and densify

**Files:**
- Modify: `src/sim/market.ts:133`. `MAX_URBAN_RADIUS` becomes `16`, and `urbanRadius(pop)` becomes `Math.min(MAX_URBAN_RADIUS, 3 + Math.floor(Math.sqrt(pop / 250)))`.
- Modify: `src/sim/production.ts:150-166`. When a city's radius grows, `growthMonth` calls `layCityStreets` for that city before `refreshUrbanTiles`, and emits `roadChanged` with the new street tiles.
- Modify: `src/sim/state.ts:142`. `layCityStreets` returns `Vec2[]` (the tiles it newly turned into road), and it never lays road over a building or a rail tile.
- Modify: `src/sim/migrations.ts`. Add migration `from: 2`, which re-runs `layCityStreets` and `refreshUrbanTiles` for every city. Bump `SAVE_VERSION` to 3.
- Modify: `src/render/sprites.ts` and `src/render/world/index.ts`. Add house density tiers by distance and population:
  - `'terrace'`: the core of a city above 15k. Two houses joined.
  - `'block'`: the core of a city above 40k from 1930. A 3-storey apartment.
  - `'tower'`: the core of a city above 60k from 1955. A tall sprite using the Task 10 height rules; draw it flat until Task 10 lands.
- Test: `src/sim/market.test.ts`, `src/sim/production.test.ts`, `src/sim/migrations.test.ts`, `src/render/sprites.test.ts`

**Interfaces:**
- Produces:
  - `export function layCityStreets(map: GameMap, city: City): Vec2[]`
  - `export type HouseTier = 'house' | 'terrace' | 'block' | 'tower'`
  - `export function houseTier(population: number, year: number, distFrac: number): HouseTier`. `distFrac` is the distance divided by the urban radius. The core is `distFrac < 0.35`. Outside the core it is always `'house'`.

- [ ] **Step 1: Write the failing tests:**
  - `urbanRadius(1000) === 5`, `urbanRadius(20000) === 11` and `urbanRadius(80000) === 16`.
  - A city grown from 5k to 30k by repeated `growthMonth` with full satisfaction has strictly more road tiles inside its disc than before. No building tile became road.
  - `houseTier(70000, 1960, 0.2) === 'tower'`, `houseTier(70000, 1960, 0.5) === 'house'`, `houseTier(45000, 1925, 0.2) === 'terrace'` and `houseTier(10000, 1990, 0.1) === 'house'`.
  - The migration from v2 adds streets to a fixture city whose population exceeds its initial radius.
  - `src/sim/__fixtures__/phase0.save.json` still loads (through the migration) and passes `checkInvariants`.
- [ ] **Step 2:** Run the affected tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Update the balance expectations in `src/sim/balance.test.ts` only if they fail because of the larger urban area. Record the old and new values in the commit body.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42 --years 100`. Expected: pass. Then look at `shots/1366-y85-z1.png` against the v1 review's `36-1985-city-z1.png`. The city must be visibly larger and denser.
- [ ] **Step 5: Commit** with `feat: cities spread with new streets and density tiers`.

### Task 8: Landmarks

**Files:**
- Create: `src/data/landmarks.ts`
- Create: `src/sim/landmarks.ts` (a system appended to `SYSTEMS`)
- Modify: `src/sim/types.ts`. `City` gains `landmarks: { id: LandmarkId; pos: Vec2 }[]`.
- Modify: `src/sim/state.ts`. `canPlaceBuilding` rejects tiles in the `'landmark'` layer with `'A landmark stands here'`. `createGame` gives every city `landmarks: []`.
- Modify: `src/sim/migrations.ts`. Migration `from: 3` adds `landmarks: []`. `SAVE_VERSION` becomes 4.
- Create: `src/render/landmarks.ts` (one procedural painter per landmark, drawn in the chunk layer)
- Modify: `src/ui/panels/city.ts` (a landmark list with icons)
- Test: `src/sim/landmarks.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- Consumes: `layer`, `layerAt` (Phase 0 Task 6), `citiesNear` (Phase 0 Task 7).
- Produces:
  - `export type LandmarkId = 'church' | 'town_hall' | 'grand_station' | 'library' | 'stadium' | 'skyscraper'`
  - `export const LANDMARKS: Record<LandmarkId, { id: LandmarkId; name: string; minPop: number; minYear: number; size: 2; news: string }>`. Values:

    | Landmark | Population | Year |
    |---|---|---|
    | church | 1,500 | 1900 |
    | town_hall | 5,000 | 1900 |
    | grand_station | 9,000 | 1900 |
    | library | 14,000 | 1905 |
    | stadium | 25,000 | 1920 |
    | skyscraper | 45,000 | 1930 |

    Each `news` is a one-line headline template with `{city}`.
  - `export function landmarksMonth(ctx: SimContext): void`. For each city in id order, it builds the first landmark (in table order) that the city qualifies for and does not have, at most one per city per month. It then calls `publishNews(ctx, 'historic', ...)` and emits `{ type: 'landmarkBuilt'; cityId: number; id: LandmarkId }`.
  - `export function findLandmarkSite(state: GameState, city: City): Vec2 | null`. It returns the free 2×2 block nearest the city centre (ties broken by lowest y, then x) within `city.urbanRadius`. All 4 tiles must be land, not road, rail, building, deposit or landmark, and must belong to `city.id`. It returns null when there is none.
  - Landmark tiles get value `index + 1` in layer `'landmark'`, where `index` is the landmark's position in the city's `landmarks` array.

- [ ] **Step 1: Write the failing tests:**
  - A city of 6,000 in 1900 gets `church` in month 1 and `town_hall` in month 2, and nothing more until it grows.
  - The site found is never on road, rail, building or deposit tiles (property test across seeds 1–20 at population 30k).
  - `canPlaceBuilding` over a landmark tile returns an error containing `landmark`.
  - A city whose disc is fully built returns a `null` site, and `landmarksMonth` returns without adding.
  - The migration adds `landmarks: []`. The catalog test checks that every landmark has a painter and an icon id.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The render chunk signature includes landmarks, so chunks redraw on `landmarkBuilt`.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7 --years 100`. Expected: pass. In `shots/1920-y85-z2.png`, the biggest city shows a skyscraper and a stadium.
- [ ] **Step 5: Commit** with `feat: city landmarks unlocked by population and era`.

### Task 9: Survey-map regime (zoom < 1.5)

**Files:**
- Create: `src/render/regime.ts`
- Create: `src/render/survey.ts` (the survey chunk painter)
- Modify: `src/render/terrain.ts`. It keeps two chunk surfaces per chunk (`'survey'` and `'diorama'`), each rendered lazily.
- Modify: `src/render/world/index.ts`. It draws both regimes, blended by `regimeBlend`, and draws city labels on the overlay canvas when `blend < 1`.
- Test: `src/render/regime.test.ts`, `src/render/survey.test.ts`

**Interfaces:**
- Produces:
  - `export function regimeBlend(zoom: number): number`. It is 0 at `zoom ≤ 1.3`, 1 at `zoom ≥ 1.7`, and smoothstep in between (0 = survey, 1 = diorama).
  - `export function paintSurveyChunk(g: CanvasRenderingContext2D, map: GameMap, cx: number, cy: number, seed: number): void`. It paints:
    - a paper base `#efe4c8` with 2% noise grain;
    - a watercolour wash per terrain: grass `#cfd9a8`, forest `#a9bf8a`, hills `#d8c39a`, mountain `#c2b39b`, sand `#ecdcab`, water `#a9c6cf`;
    - parallel 45° hatching on hills at 4 px spacing, and cross-hatching on mountains;
    - stippled tree dots in forests (deterministic `hash`);
    - a 1 px ink coastline `#4a3d2c` where water meets land;
    - dashed ink roads and double-line rails.
  - `export function cityLabelFont(population: number): string`. The font is an italic serif stack (`"Georgia, 'Times New Roman', serif"`) sized 12/15/19/24 px at population thresholds 0, 5k, 20k and 50k. Labels are drawn at the city centre with a paper-coloured halo.

- [ ] **Step 1: Write the failing tests:**
  - `regimeBlend(1) === 0`, `regimeBlend(1.5) === 0.5`, `regimeBlend(2) === 1`, and the function is monotonic.
  - `paintSurveyChunk` on a mock context for a chunk containing hills issues at least 10 `lineTo` calls (hatching) and never calls `drawImage`.
  - `cityLabelFont(60000)` contains `24px`.
- [ ] **Step 2:** Run `npx vitest run src/render/regime.test.ts src/render/survey.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Buildings and vehicles in survey mode draw as small ink symbols: a filled owner-coloured square per building and a dot per vehicle. Smoke particles are hidden when `blend < 0.5`.
- [ ] **Step 4:** Run `bash scripts/shots.sh`. Check `shots/1920-y25-z0.5.png`: it reads as a hand-tinted engraved map with readable city names. Check `-z1`: a mid-blend that looks intentional, not muddy. Then run the perf check: open `?seed=7&autoplay=1&skipYears=55&zoom=1.5` and record the fps from the dev overlay or `performance.now` frame deltas over 5 s. Expected: ≥ 55 fps.
- [ ] **Step 5: Commit** with `feat(render): engraved survey-map regime with city labels`.

### Task 10: Diorama regime: building height, roofs, long shadows

**Files:**
- Modify: `src/render/sprites.ts`. Every building sprite gets a ¾ front face. Sprite height = footprint + `heightPx`.
- Create: `src/render/shadows.ts`
- Modify: `src/render/world/index.ts`. Draw shadows under buildings, then buildings sorted by footprint bottom y.
- Test: `src/render/sprites.test.ts`, `src/render/shadows.test.ts`

**Interfaces:**
- Produces:
  - `export const BUILDING_HEIGHT: Record<BuildingTypeId, number>`. This is the extra height in px. Extractors are 6–10, factories 14–22, retail 8–12, `'tower'` houses 28 and skyscraper landmarks 40. Every building type id in `BUILDINGS` has an entry.
  - `export function sunDirection(hour: number): { dx: number; dy: number; length: number }`. It returns the **shadow** direction, a unit vector pointing away from the sun. The sun rises in the east at 6 and sets in the west at 18. `length` is shadow length per px of height: 2.5 at hours 6 and 18, 0.4 at hour 12, and 0 at night.
  - `export function shadowPolygon(x: number, y: number, w: number, h: number, height: number, sun: ReturnType<typeof sunDirection>): Vec2[]`. This is the footprint extruded along the sun vector.
  - `HEADROOM` in sprites.ts is raised to fit the tallest sprite.

- [ ] **Step 1: Write the failing tests:**
  - Every `BUILDINGS` id has a `BUILDING_HEIGHT`.
  - `sunDirection(12).length === 0.4`, `sunDirection(6).dx < 0` (sun in the east at 6, so the returned shadow vector points west) and `sunDirection(0).length === 0`.
  - `shadowPolygon` with height 0 returns the footprint rectangle.
  - Sprite canvases for `steel_mill` are taller than wide.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Shadows render into the chunk cache keyed on hour bucket (`Math.floor(hour / 2)`), so they are not recomputed per frame.
- [ ] **Step 4:** Check `shots/1920-y55-z2.png`: factories read as 3D silhouettes with long shadows, and the shadow direction changes between `hour=8` and `hour=16` screenshots. Run the fps check as in Task 9 at zoom 2. Expected: ≥ 55 fps.
- [ ] **Step 5: Commit** with `feat(render): diorama buildings with height, roofs and sun shadows`.

### Task 11: Diorama terrain walls and tilt-shift; cold open

**Files:**
- Modify: `src/render/terrain.ts`. For hills, mountains and coast tiles, draw a south wall face (a 6 px darker band) when `blend > 0`.
- Create: `src/render/tiltShift.ts`
- Create: `src/game/coldOpen.ts`
- Modify: `src/game/app.ts`. Play the cold open after `createGame` on New Game only, never on load or debug start.
- Modify: `src/ui/menu.ts`. Add a settings toggle "Skip intro", stored with the other settings in `src/game/settings.ts`.
- Test: `src/render/tiltShift.test.ts`, `src/game/coldOpen.test.ts`

**Interfaces:**
- Produces:
  - `export function tiltShiftBands(viewH: number, blend: number): { top: number; bottom: number; maxBlurPx: number }`. The bands are 18% of the viewport height each, and `maxBlurPx = 3 * blend`.
  - `export function applyTiltShift(ctx: CanvasRenderingContext2D, w: number, h: number, blend: number): void`. It copies the top and bottom bands into an offscreen canvas at half resolution, draws them back with `ctx.filter = 'blur(Npx)'` and a gradient alpha mask, and does nothing when `blend === 0`.
  - `export interface ColdOpenStep { atMs: number; camera?: { x: number; y: number; zoom: number }; card?: 'baron' | 'family'; text?: string }`
  - `export function coldOpenScript(state: GameState): ColdOpenStep[]`:
    - 0 ms: zoom 0.6 over the farthest city from the player's starting area.
    - 2500 ms: pan to the Baron's first city with the `'baron'` card and text `"Smogsworth: 'This valley is mine, upstart.'"`.
    - 5000 ms: zoom 1.6 onto the player's start, with the `'family'` card showing the company name.
    - 7500 ms: the end.
  - `export function playColdOpen(game: GameController, onDone: () => void): () => void`. It interpolates the camera with ease-in-out and shows the cards using `drawBaronPortrait` and a family-crest painter. Esc, a click or a key skips it immediately. It restores speed and calls `onDone`. The return value cancels it.

- [ ] **Step 1: Write the failing tests:**
  - `tiltShiftBands(1000, 1)` equals `{ top: 180, bottom: 820, maxBlurPx: 3 }`.
  - `coldOpenScript(createGame({seed:7}))` has 4 steps with increasing `atMs`, the last at 7500.
  - jsdom: `playColdOpen` followed by a dispatched `keydown` Escape calls `onDone` exactly once, and leaves `game.ctx.state.speed` as it was before.
  - `App` loading a save does not call `playColdOpen` (spy).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then record 8 screenshots of the cold open at 1000 ms intervals using the Phase 0 CDP approach, or by adding `coldopen=1` as a dev param. Check that the pan is smooth and the cards are legible.
- [ ] **Step 5: Commit** with `feat: diorama terrain walls, tilt-shift and cold-open intro`.

### Task 12: Photo mode

**Files:**
- Create: `src/game/photoMode.ts`
- Modify: `src/game/input.ts` (key `P` toggles photo mode; Esc exits it)
- Modify: `src/ui/hud.ts` (a camera button that toggles it)
- Test: `src/game/photoMode.test.ts`

**Interfaces:**
- Consumes: `eraName` (`src/sim/eras.ts`), `citiesNear` (Phase 0).
- Produces:
  - `export function photoCaption(state: GameState, center: Vec2): string`. The format is `"<City>, <Season> <Year> — <Era name>"`. City is the nearest city within 25 tiles of `center`, otherwise `"The Valley"`. Seasons by month: Mar–May Spring, Jun–Aug Summer, Sep–Nov Autumn, Dec–Feb Winter.
  - `export function enterPhotoMode(game: GameController): () => void`:
    - It adds `body.photo-mode`, which hides `#ui` children except `.photo-bar`.
    - It pauses the game and remembers the speed.
    - It draws a vignette and caption overlay.
    - The `.photo-bar` has Export and Exit buttons.
    - Export composites the world canvas, the overlay canvas, the vignette and the caption into an offscreen canvas, and downloads it via `toBlob` as `smokestack-<year>-<city>.png`.
    - The returned function exits photo mode and restores the speed.
    - If `toBlob` yields null, a toast "Export failed" appears and the game stays in photo mode, so the user can still exit.

- [ ] **Step 1: Write the failing tests:**
  - `photoCaption` for a state in June 1925 centred on a city named Ashford returns `"Ashford, Summer 1925 — Roaring Age"`. Far from any city it starts with `"The Valley"`.
  - jsdom: entering adds `photo-mode` and sets speed 0. Exiting removes the class and restores the speed. Exiting twice is a no-op.
  - A mocked `toBlob` returning null emits a toast, and the body still has `photo-mode`.
- [ ] **Step 2:** Run `npx vitest run src/game/photoMode.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Commit** with `feat: photo mode with captioned PNG export`.

### Task 13: Phase 1 gate

**Files:**
- Create: `src/sim/__fixtures__/phase1.save.json` (via `npm run fixture -- --name phase1`)
- Modify: `README.md`. Add a short "What's new in SMOKESTACK II (Phase 1)" section with photo-mode and intro controls.

- [ ] **Step 1:** Run `npm run fixture -- --name phase1`, then `npm test`. Expected: all pass, including both fixtures.
- [ ] **Step 2:** Run `npm run soak -- --seeds 7,42,1234 --years 100`. Expected: exit 0. Compare the timings with the Phase 0 ones in the commit log; a regression above 25% must be explained.
- [ ] **Step 3:** Run `bash scripts/shots.sh` and review all 24 screenshots against the spec section 4 checklist:
  - spring start;
  - no emoji;
  - engraved survey at z0.5;
  - diorama with shadows at z2;
  - visibly grown cities with landmarks by y55/y85;
  - HUD never covered at 1366.
- [ ] **Step 4:** Run `npm run build && docker compose up -d --build`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/`. Expected: `200`.
- [ ] **Step 5: Commit** with `test: phase 1 fixture and gate`, then run `chown -R freire:freire /home/freire/projects/industry`.
- [ ] **Step 6:** Report to the owner with 4 showcase screenshots, and ask for the Phase 1 playtest before Phase 2 is specified.
