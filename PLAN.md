# SMOKESTACK — A 2D Industry Tycoon · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read **Game Design**, **Global Constraints** and **Agent Orchestration** before touching your task — your task's requirements implicitly include them.

**Goal:** Build a 2D industry-tycoon game in the browser, inspired by *Industry Giant*. You extract raw materials, refine them in factory chains, haul goods by truck and train, and sell them in growing cities across a century of invention (1900–2000), while a scheming rival baron competes for the same markets.

**Architecture:** A pure, deterministic, tick-based simulation (`src/sim`) owns a single JSON-serializable `GameState`. A Canvas 2D renderer (`src/render`) draws that state with procedurally painted pixel art and never mutates it. A vanilla-TypeScript DOM UI (`src/ui`) issues commands through sim functions. `src/game` wires the loop, input and tools. Features plug in through append-only registries (sim systems, render overlays, UI panels), so parallel agents rarely edit the same file.

**Tech Stack:** TypeScript 5.6 (strict), Vite 5.4, Vitest 2.1 (+ jsdom 25 for DOM tests), Canvas 2D, WebAudio, nginx served via `docker compose`.

**Spec:** the **Game Design** section of this file. It is the spec, and each task argues from it.

---

## Game Design

### Pitch
It is 1900. You are a young industrialist with $300,000 and a map full of forests, hills rich in ore, and five small towns that want furniture, bread and, soon, automobiles. Build extraction → refining → manufacturing chains, connect them with roads and trucks (later railways), and sell finished goods in city stores. Prices fall when you flood a market and rise when a town is starved. Towns grow when they are well supplied and shrink when they choke on your smog. Inventions arrive by year: automobiles and oil in 1910, radios in 1925, plastic in 1935, television in 1950, computers in 1980. Old products go out of fashion. *The Daily Smokestack* reports booms, crashes, strikes and the taunts of your rival, **Baron Cornelius Smogsworth** (top hat, monocle, no scruples).

### Signature features (the "surprise me" list)
1. **Era colour grading:** the whole world renders in sepia in 1900 and gains saturation decade by decade until it reaches full technicolor in the 1960s.
2. **Living world:** day/night cycle with lit windows and street lamps, seasons (snowy winters, farms that are fallow in winter and bumper in summer), and chimney smoke whose density follows real production.
3. **Houses evolve by era:** wooden cottages, then brick rowhouses, then art-deco blocks, then modern towers.
4. **The Daily Smokestack:** a monthly newspaper modal plus a scrolling headline ticker. It covers historic events (the 1914 war boom, the 1929 crash, the 1969 moon landing toy craze, the 1973 oil crisis) and random ones (strikes, fires, festivals, gold rushes, visiting inventors).
5. **Rival AI:** Baron Smogsworth builds his own chains, undercuts your markets and taunts you in print. Reach 3× his net worth and you can launch a **Hostile Takeover**.
6. **Mayor's Contracts:** time-limited delivery contracts from cities, paid in cash and population growth.
7. **Product lifecycle:** radios fade after 1965, and the newspaper warns you before demand collapses.
8. **Procedural everything:** no image or audio files. Sprites are painted on canvas and sound is synthesized (cash-register "ka-ching", steam whistles, a factory hum).

### Core rules (values pinned here are used verbatim in tasks)
- **Time:** 1 tick = 1 game hour; 24 ticks/day; 30 days/month; 12 months/year. Start 1 Jan 1900, game end 31 Dec 2000. At speed 1, one day lasts 2 real seconds. Speeds: 0 (pause), 1, 2, 4, 8.
- **Map:** 128×96 tiles, 32 px/tile at zoom 1. Terrain: water, sand, grass, forest, hills, mountain. Deposits: iron_ore and coal on hills/mountain, oil on grass/sand (hidden until 1910).
- **Cities:** 5, population 2,000–12,000. Urban radius = `3 + floor(population / 3000)` tiles. Stores may only be built fully inside an urban radius; nothing else may be built on urban tiles.
- **Money:** start $300,000. Loans in $50,000 steps up to $500,000 total at 6%/year, charged monthly. Six consecutive month-ends with negative cash means bankruptcy (game over).
- **Roads:** $500/tile, $3,000/tile on water (bridge), not on mountains. Maintenance $5/tile/month for roads you built. Cities start with street grids, and each city is linked to its nearest neighbour by a pre-built road.
- **Trucks:** $8,000, capacity 20, speed 0.5 tiles/tick, maintenance $150/month, loading/unloading takes 6 ticks per stop. Sold for 50%.
- **Trains (Task 27):** $60,000, capacity 120, speed 1.0 tile/tick, maintenance $1,200/month. Rail costs $1,200/tile.
- **Demolition:** refunds 25% of the building's cost.
- **Production:** every building runs its current recipe; one cycle takes `days` days and requires all inputs present and output storage not full. Output per good is capped at the building's `storage`.
- **Farms:** grain, cotton and fruit produce ×0 in Dec–Feb and ×1.5 in Jul–Sep. Milk is unaffected.
- **Market:** monthly demand = `population / 1000 × DEMAND_PER_1000[good] × lifecycle(good, year) × modifiers`. Sale price = `basePrice × clamp(1.5 − 0.75 × supplyRatio, 0.5, 1.5)`, where supplyRatio = sold30 / demand30. Stores in the same city split daily demand equally among those holding stock.
- **Growth (monthly):** `pop × (1 + 0.02 × (avgSatisfaction − 0.4) − 0.01 × pollution)`, minimum 500. Pollution is in 0..1.
- **Lifecycle:** factor 0 before `era`, 1 from `era`, and after `fadeYear` it falls linearly to 0.2 over 10 years.
- **Eras:** Steam Age 1900–1919, Roaring Age 1920–1939, Atomic Age 1940–1959, Space Age 1960–1979, Silicon Age 1980–2000.

### Content catalog
**Goods** (`id · name · tier · basePrice · era · fadeYear · icon`)

| Raw (tier 0) | Intermediate (tier 1) | Consumer (tier 2) |
|---|---|---|
| wood · Wood · 4 · 1900 · 🪵 | lumber · Lumber · 10 · 1900 · 🪚 | furniture · Furniture · 48 · 1900 · 🪑 |
| grain · Grain · 3 · 1900 · 🌾 | flour · Flour · 8 · 1900 · 🥡 | bread · Bread · 14 · 1900 · 🍞 |
| cotton · Cotton · 4 · 1900 · ☁️ | steel · Steel · 22 · 1900 · 🔩 | tools · Tools · 42 · 1900 · 🔨 |
| fruit · Fruit · 3 · 1900 · 🍎 | fabric · Fabric · 12 · 1900 · 🧵 | clothes · Clothes · 40 · 1900 · 👔 |
| milk · Milk · 3 · 1900 · 🥛 | glass · Glass · 10 · 1900 · 🪟 | cheese · Cheese · 22 · 1900 · 🧀 |
| iron_ore · Iron Ore · 6 · 1900 · ⛏️ | fuel · Fuel · 18 · 1910 · ⛽ | juice · Juice · 26 · 1900 · 🧃 |
| coal · Coal · 5 · 1900 · ⚫ | plastic · Plastic · 20 · 1935 · 🧪 | toys · Toys · 30 · 1900 · 🧸 |
| sand · Sand · 2 · 1900 · ⏳ | | cars · Automobile · 420 · 1910 · 🚗 |
| oil · Crude Oil · 8 · 1910 · 🛢️ | | radios · Radio · 130 · 1925 · fade 1965 · 📻 |
| | | tvs · Television · 260 · 1950 · 📺 |
| | | computers · Computer · 600 · 1980 · 💻 |

**DEMAND_PER_1000 (units/month):** furniture 6, bread 30, tools 5, clothes 8, cheese 12, juice 12, toys 6, cars 0.5, radios 1.5, tvs 1, computers 0.6.

**Recipes** (`id: inputs → outputs, days`). A recipe's era is the max era of all its inputs and outputs.
- Extraction (no inputs, 1 day): r_wood → wood 4 · r_grain → grain 5 · r_cotton → cotton 4 · r_fruit → fruit 4 · r_milk → milk 4 · r_iron → iron_ore 4 · r_coal → coal 4 · r_sand → sand 6 · r_oil → oil 4
- Refining (1 day): r_lumber wood 4 → lumber 2 · r_flour grain 4 → flour 2 · r_steel iron_ore 3 + coal 2 → steel 2 · r_fabric cotton 4 → fabric 2 · r_glass sand 4 + coal 1 → glass 2 · r_fuel oil 4 → fuel 2 · r_plastic oil 4 → plastic 2
- Manufacturing: r_furniture lumber 2 → furniture 1 (1) · r_bread flour 2 + milk 1 → bread 3 (1) · r_tools steel 1 + lumber 1 → tools 1 (1) · r_clothes fabric 2 → clothes 1 (1) · r_cheese milk 3 → cheese 1 (1) · r_juice fruit 3 + glass 1 → juice 2 (1) · r_toys_wood lumber 1 → toys 1 (1) · r_toys_plastic plastic 1 → toys 2 (1) · r_cars steel 4 + glass 2 + fuel 1 → cars 1 (2) · r_radios steel 1 + glass 1 + lumber 1 → radios 1 (1) · r_tvs plastic 2 + glass 2 + steel 1 → tvs 1 (2) · r_computers plastic 2 + steel 1 + glass 1 → computers 1 (2)

**Buildings** (`id · category · size · cost · maint/month · terrain · recipes · storage · era · pollution`)
- lumber_camp · extractor · 2×2 · 12000 · 400 · forest · r_wood · 60 · 1900 · 0
- farm · extractor · 3×3 · 10000 · 300 · grass · r_grain, r_cotton, r_fruit · 60 · 1900 · 0
- dairy_farm · extractor · 3×3 · 12000 · 350 · grass · r_milk · 60 · 1900 · 0
- mine · extractor · 2×2 · 25000 · 800 · hills, mountain · r_iron, r_coal (requiresDeposit) · 80 · 1900 · 3
- sand_pit · extractor · 2×2 · 8000 · 250 · sand · r_sand · 80 · 1900 · 1
- oil_well · extractor · 2×2 · 30000 · 900 · grass, sand, hills · r_oil (requiresDeposit) · 80 · 1910 · 3
- sawmill · factory · 3×3 · 20000 · 600 · grass, sand · r_lumber · 60 · 1900 · 2
- flour_mill · factory · 3×3 · 18000 · 500 · grass, sand · r_flour · 60 · 1900 · 1
- steel_mill · factory · 3×3 · 60000 · 1500 · grass, sand, hills · r_steel · 60 · 1900 · 6
- textile_mill · factory · 3×3 · 30000 · 800 · grass, sand · r_fabric · 60 · 1900 · 2
- glassworks · factory · 3×3 · 35000 · 900 · grass, sand · r_glass · 60 · 1900 · 4
- refinery · factory · 3×3 · 70000 · 1800 · grass, sand · r_fuel, r_plastic · 60 · 1910 · 8
- furniture_factory · factory · 3×3 · 30000 · 700 · grass, sand · r_furniture · 40 · 1900 · 1
- bakery · factory · 2×2 · 15000 · 400 · grass, sand · r_bread · 60 · 1900 · 1
- toolworks · factory · 3×3 · 35000 · 900 · grass, sand · r_tools · 40 · 1900 · 3
- clothing_factory · factory · 3×3 · 30000 · 800 · grass, sand · r_clothes · 40 · 1900 · 1
- creamery · factory · 2×2 · 15000 · 400 · grass, sand · r_cheese · 40 · 1900 · 1
- juice_plant · factory · 2×2 · 20000 · 500 · grass, sand · r_juice · 40 · 1900 · 1
- toy_factory · factory · 2×2 · 22000 · 500 · grass, sand · r_toys_wood, r_toys_plastic · 40 · 1900 · 1
- car_plant · factory · 4×4 · 150000 · 4000 · grass, sand · r_cars · 30 · 1910 · 5
- electronics_plant · factory · 3×3 · 90000 · 2500 · grass, sand · r_radios, r_tvs, r_computers · 30 · 1925 · 2
- store · retail · 2×2 · 15000 · 400 · grass, sand (requiresCity) · — · 200 · 1900 · 0
- warehouse · logistics · 3×3 · 20000 · 300 · grass, sand, hills · — · 600 · 1900 · 0
- train_station · logistics · 3×2 · 40000 · 1000 · grass, sand, hills · — · 400 · 1900 · 0 (Task 27)

### Controls
Left click uses the current tool. Right-drag or middle-drag pans, as do WASD/arrow keys. The mouse wheel zooms (0.5×–3×). Space pauses; 1/2/3/4 set speeds 1/2/4/8. Esc cancels the tool. B opens the build menu, R the routes window, F finances, N the newspaper. Delete activates bulldoze.

---

## Global Constraints

- Node 18.19 compatible. Pinned dev dependencies: `typescript@5.6.3`, `vite@5.4.10`, `vitest@2.1.4`, `jsdom@25.0.1`. **No runtime dependencies.**
- Zero image and audio asset files: all art is drawn with Canvas 2D and all sound is synthesized with WebAudio.
- `src/sim/**` and `src/data/**` are pure. They never touch `window`, `document`, `Math.random`, `Date.now` or `performance`. All randomness goes through `src/sim/rng.ts` using `state.rngState`.
- `GameState` is plain JSON (no `Map`, `Set`, classes or functions), and `JSON.parse(JSON.stringify(state))` round-trips it exactly.
- Tile index = `y * map.width + x`; tile coordinates are integers; vehicle positions are float tile coordinates.
- Money is an integer number of dollars: round with `Math.round` at every earn/spend.
- Sim mutators take `ctx: SimContext` (`{ state, bus }`) as their first parameter and return `Result<T>` for anything that can fail. Pure queries take `state`.
- TypeScript `strict: true`. Every task leaves `npm test` and `npx tsc --noEmit` green.
- Tests sit next to the code as `*.test.ts`. DOM tests start with `// @vitest-environment jsdom`.
- Use `docker compose` (v2 syntax), never `docker-compose`.
- Registries are append-only: `src/sim/systems.ts` (`SYSTEMS`), `src/render/overlays.ts` (`OVERLAYS`) and `src/ui/panels/index.ts` (`PANELS`). On merge conflicts in these files, keep both sides.
- Player colour `#2f6fb5` (blue); rival colour `#b5302f` (crimson).

## Review Focus

1. **Demolishing a building that a route stops at:** the stop is removed from every route; a route left with fewer than 2 stops sets its vehicles to `idle`; nothing throws. Test is in Task 9 (`demolish removes route stops`) and Task 14 (`vehicle idles when route drops below two stops`).
2. **A road removed under a moving truck, or no path existing at all:** the truck enters `stuck`, emits `vehicleStuck` once, and retries pathing every 24 ticks; when the road comes back it resumes. Test is in Task 14 (`stuck truck recovers when road restored`).
3. **Building with too little money:** construction is refused with `error: 'Not enough money'` and the state is unchanged. Maintenance may push cash negative; six consecutive red month-ends emit `gameOver`. Tests are in Task 9 (`refuses when unaffordable`) and Task 5 (`bankrupt after six red months`).
4. **Corrupt, foreign or older-version save JSON:** `deserialize` returns `{ ok: false }` with a readable message, and the UI shows it instead of crashing. Test is in Task 17 (`rejects garbage and wrong versions`).
5. **Placement on map edges, water, other buildings, roads or urban tiles:** rejected with a specific message. Test is in Task 9 (`placement rejection matrix`).

---

## Agent Orchestration

Work proceeds in **waves**. Tasks within a wave are independent and run as **parallel agents**, each in its own git worktree on branch `task/NN-slug` (use superpowers:using-git-worktrees). Each task gets a review pass (superpowers:requesting-code-review) before it merges into `main`. A wave starts only after every task in the previous wave has merged and `npm test && npx tsc --noEmit` passes on `main`.

| Wave | Tasks (parallel) | Unblocks |
|---|---|---|
| 0 | 1 Kernel & scaffold | everything |
| 1 | 2 Catalog · 3 Map generator · 4 Pathfinding · 5 Finances · 7 UI kit · 8 Audio → then 6 Market (needs Task 2's `GOODS`) | sim core, UI |
| 2 | 9 State & construction · 10 Camera & terrain · 11 Sprite painter · 12 Atmosphere (all import `TILE`/`Camera` from `src/render/constants.ts`) | gameplay, world view |
| 3 | 13 Production & retail · 14 Trucks & routes · 15 HUD & toolbar · 16 World renderer | loop |
| 4 | 17 Sim loop & saves → then 18 Bootstrap & tools (**playable milestone**) | features |
| 5 | 19 Inspectors · 20 Route editor · 21 Finance dashboard · 22 Eras · 23 Newspaper & events · 24 Pollution · 25 Rival AI · 26 Contracts | polish |
| 6 | 27 Railways · 28 Menu, scenarios & achievements → then 29 Tutorial & balance · 30 Deploy & final verification | ship |

**Model per task** (pass as the Agent `model` parameter; every task also gets an Opus reviewer before merge, plus a whole-branch Opus review after Waves 4 and 6):

| Model | Tasks |
|---|---|
| haiku | 2, 5, 7, 12, 21, 30 |
| sonnet | 3, 4, 6, 8, 10, 11, 13, 15, 19, 20, 22, 23, 24, 26, 28 |
| opus | 1, 9, 14, 16, 17, 18, 25, 27, 29 |

If a review fails, send the findings back to the same agent once; on a second failure, hand the task to the next stronger model.

Each agent prompt should contain: the task section, the Game Design + Global Constraints + Review Focus sections, and the Interfaces blocks of the tasks it consumes.

---

## File Map

```
index.html                     Vite entry; <canvas id="world"> + <div id="ui">
src/main.ts                    bootstrap (Task 18)
src/core/result.ts             Result<T>
src/core/events.ts             EventBus + GameEvent union
src/sim/types.ts               ALL shared state types
src/sim/rng.ts                 deterministic RNG on state.rngState
src/sim/clock.ts               GameDate math
src/sim/mapgen.ts              terrain, deposits, cities
src/sim/pathfinding.ts         A* + passability predicates
src/sim/finance.ts             company money, ledger, loans
src/sim/market.ts              demand, prices, sales split, growth
src/sim/state.ts               createGame, placement, roads, demolish
src/sim/production.ts          production, retail, maintenance systems
src/sim/vehicles.ts            routes, trucks, movement
src/sim/systems.ts             SimSystem registry
src/sim/simulation.ts          stepTick/runTicks, serialize/deserialize
src/sim/eras.ts | events.ts | pollution.ts | rival.ts | contracts.ts | rail.ts | scenarios.ts
src/data/goods.ts | recipes.ts | buildings.ts | names.ts
src/render/camera.ts | terrain.ts | sprites.ts | atmosphere.ts | particles.ts | world.ts | overlays.ts
src/audio/sfx.ts
src/ui/dom.ts | format.ts | window.ts | toasts.ts | theme.css | hud.ts | toolbar.ts | tools.ts
src/ui/panels/index.ts + one file per panel
src/game/controller.ts | input.ts | toolController.ts | saves.ts
```

---

### Task 1: Kernel & scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/core/result.ts`, `src/core/events.ts`, `src/sim/types.ts`, `src/sim/rng.ts`, `src/sim/clock.ts`
- Test: `src/sim/rng.test.ts`, `src/sim/clock.test.ts`, `src/core/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (every later task relies on these exact names):
  - `result.ts`: `type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }`, `ok<T>(value: T): Result<T>`, `err(error: string): Result<never>`
  - `types.ts`:
    - `GoodId = string`, `BuildingTypeId = string`, `OwnerId = 'player' | 'rival'`, `Vec2 = { x: number; y: number }`, `Inventory = Record<GoodId, number>`
    - `Terrain = 'water' | 'sand' | 'grass' | 'forest' | 'hills' | 'mountain'`
    - `Tile { terrain; deposit: GoodId | null; road: boolean; rail: boolean; buildingId: number | null; cityId: number | null; pollution: number }`
    - `GameMap { width; height; tiles: Tile[] }`
    - `GameDate { year; month /*1-12*/; day /*1-30*/; hour /*0-23*/ }`
    - `BuildingStatus = 'ok' | 'no_input' | 'output_full' | 'halted' | 'idle'`
    - `Building { id; typeId; ownerId; pos: Vec2; recipeId: string | null; input: Inventory; output: Inventory; progress: number; status: BuildingStatus; cityId: number | null; haltedUntil: GameDate | null; producedThisMonth: Inventory }`
    - `MarketEntry { sold30: number; demand30: number; pending: number /* fractional unmet demand carried day to day */ }`
    - `City { id; name; center: Vec2; population; prevPopulation /* Task 3 sets = population; Task 13 growthMonth saves old value first */; happiness /*0..1*/; pollution /*0..1*/; market: Record<GoodId, MarketEntry>; urbanRadius: number }`
    - `RouteStop { buildingId; load: GoodId[]; unload: GoodId[] }`
    - `Route { id; ownerId; name; color: string; stops: RouteStop[]; kind: 'truck' | 'train' }`
    - `VehicleState = 'moving' | 'loading' | 'stuck' | 'idle'`
    - `Vehicle { id; kind: 'truck' | 'train'; ownerId; routeId: number | null; pos: Vec2; prevPos: Vec2; path: Vec2[]; pathIndex; stopIndex; cargo: Inventory; capacity; state: VehicleState; waitTicks: number; stuckNotified: boolean }`
    - `LedgerCategory = 'sales' | 'construction' | 'maintenance' | 'vehicles' | 'interest' | 'contracts' | 'events' | 'demolition'`
    - `LedgerMonth { year; month; income: Partial<Record<LedgerCategory, number>>; expense: Partial<Record<LedgerCategory, number>>; salesByGood: Partial<Record<GoodId, number>>; cashEnd: number; netWorthEnd: number }` (Task 5 `currentLedger` initialises `salesByGood: {}` and `netWorthEnd: 0`; Task 13 `retailDay` adds revenue to `salesByGood`; Task 17's finance system writes `netWorthEnd = money − loan + assetValue`)
    - `Company { id: OwnerId; name; money; loan; ledger: LedgerMonth[]; monthsInRed: number; roadTiles: number; railTiles: number; active: boolean }`
    - `NewsKind = 'historic' | 'random' | 'invention' | 'market' | 'rival' | 'contract' | 'warning'`
    - `NewsItem { id; date: GameDate; headline; body; kind: NewsKind }`
    - `DemandModifier { id; goodId: GoodId | '*'; cityId: number | null; factor: number; until: GameDate }`
    - `Contract { id; cityId; goodId; qty; delivered; deadline: GameDate; reward; status: 'offered' | 'active' | 'done' | 'failed' }`
    - `GameState { version: 1; seed; rngState; date: GameDate; tick; map: GameMap; buildings: Record<number, Building>; cities: City[]; vehicles: Record<number, Vehicle>; routes: Record<number, Route>; companies: Record<OwnerId, Company>; news: NewsItem[]; modifiers: DemandModifier[]; contracts: Contract[]; unlocked: string[]; nextId: number; speed: Speed /* 0 | 1 | 2 | 4 | 8 */; scenarioId: string; rivalProject: RivalProject | null; flags: Record<string, number | boolean | string> }`, `RivalProject { cityId; goodId; stage: number }`. Flags hold primitives only; timed effects store `dateToDays()` numbers (e.g. `flags.railStrikeUntil`).
    - `SimContext { state: GameState; bus: EventBus }`
  - `events.ts`: the `GameEvent` union, complete now so no later task edits it:
    `buildingPlaced{building}` · `buildingRemoved{buildingId}` · `roadChanged{tiles: Vec2[]}` · `railChanged{tiles}` · `sale{cityId, goodId, qty, revenue, ownerId, buildingId}` · `dayStart{date}` · `monthEnd{date}` · `yearEnd{year}` · `news{item}` · `vehicleStuck{vehicleId}` · `unlock{defId, kind: 'good' | 'building' | 'recipe'}` · `toast{message, tone: 'info' | 'good' | 'bad'}` · `achievement{id}` · `contract{contractId, status}` · `gameOver{reason}` · `victory{reason}`.
    `class EventBus { on<K extends GameEvent['type']>(type: K, fn: (e: Extract<GameEvent, {type: K}>) => void): () => void; onAny(fn): () => void; emit(e: GameEvent): void }`
  - `rng.ts`: `random(s: { rngState: number }): number` (mulberry32; advances `rngState`; returns [0,1)), `randInt(s, min, max)` (inclusive), `pick<T>(s, arr: T[]): T`, `chance(s, p): boolean`
  - `clock.ts`: `TICKS_PER_DAY = 24`, `DAYS_PER_MONTH = 30`, `START_DATE = {year:1900,month:1,day:1,hour:0}`, `advanceHour(d): { date; newDay; newMonth; newYear }`, `compareDates(a, b): -1|0|1`, `addDays(d, n): GameDate`, `dateToDays(d): number`, `formatDate(d): string` → `"12 Mar 1905"`, `isWinter(month)`, `isSummer(month)`

- [ ] **Step 1:** `git init`. Create `package.json` (`"type": "module"`; scripts `dev: vite`, `build: tsc --noEmit && vite build`, `test: vitest run`, `typecheck: tsc --noEmit`) with the pinned dev deps, a strict `tsconfig.json` (target ES2022, `lib: ["ES2022","DOM"]`, `moduleResolution: "bundler"`), and `index.html` with `<canvas id="world">` and `<div id="ui">`. Run `npm install`.
- [ ] **Step 2: Write failing tests.**
  - `rng.test.ts`: `same seed same sequence` (two states with `rngState: 42` produce identical first 100 values); `values in [0,1)`; `randInt inclusive bounds` (10,000 draws of `randInt(s,1,3)` hit exactly {1,2,3}).
  - `clock.test.ts`: `hour rollover` (`{1900,1,30,23}` → `{1900,2,1,0}` with `newDay && newMonth && !newYear`); `year rollover` (`{1900,12,30,23}` → `{1901,1,1,0}`, `newYear`); `formatDate({1905,3,12,0}) === '12 Mar 1905'`; `addDays({1900,1,25,0}, 10)` → `{1900,2,5,0}`.
  - `events.test.ts`: `on receives only its type`; `unsubscribe stops delivery`; `onAny sees everything`.
- [ ] **Step 3:** Run `npx vitest run src/sim src/core`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement the files per the Interfaces block.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: all PASS.
- [ ] **Step 6:** `git add -A && git commit -m "chore: scaffold project and core kernel (types, rng, clock, events)"`

---

### Task 2: Content catalog

**Files:**
- Create: `src/data/goods.ts`, `src/data/recipes.ts`, `src/data/buildings.ts` (`src/data/names.ts` already exists on main)
- Test: `src/data/catalog.test.ts`

**Interfaces:**
- Consumes: `types.ts` (Task 1).
- Produces:
  - `GoodDef { id; name; tier: 0|1|2; basePrice; era; fadeYear: number | null; icon: string; color: string }`, `GOODS: Record<GoodId, GoodDef>`, `DEMAND_PER_1000: Record<GoodId, number>`
  - `RecipeDef { id; inputs: Inventory; outputs: Inventory; days: number }`, `RECIPES: Record<string, RecipeDef>`, `recipeEra(id): number` (max era over inputs and outputs)
  - `BuildingCategory = 'extractor' | 'factory' | 'retail' | 'logistics'`
  - `BuildingDef { id; name; category; size: { w; h }; cost; maintenance; allowedTerrain: Terrain[]; requiresDeposit: boolean; requiresCity: boolean; recipes: string[]; storage; era; pollution; color: string; description: string }`, `BUILDINGS: Record<BuildingTypeId, BuildingDef>`
  - `getBuilding(id)`, `getGood(id)`, `getRecipe(id)`: each throws `Error('Unknown …: id')` on a miss
  - `CITY_NAMES: string[]` (≥ 12, e.g. Ironford, Millbrook, Coalhaven, Port Sterling, Ashby, Brassmoor, Kettleton, Rivermouth, Cinderfield, Gearwick, Copperdale, Smelton), `COMPANY_NAMES` (≥ 6 whimsical player defaults)

- [ ] **Step 1: Write failing tests** in `catalog.test.ts`:
  - `every recipe good exists`: all input/output keys are in `GOODS`.
  - `every building recipe exists`.
  - `every consumer good is producible from raw goods`: a fixpoint over recipes starting from extractor outputs reaches all 11 tier-2 goods.
  - `recipe era`: `recipeEra('r_toys_plastic') === 1935` and `recipeEra('r_cars') === 1910`.
  - `exact values`: `GOODS.cars.basePrice === 420`, `GOODS.radios.fadeYear === 1965`, `BUILDINGS.car_plant.size` equals `{w:4,h:4}`, `BUILDINGS.store.requiresCity === true`, `DEMAND_PER_1000.bread === 30`.
  - `every manufacturing recipe is profitable at base price`: Σ outputs × basePrice > Σ inputs × basePrice.
- [ ] **Step 2:** Run `npx vitest run src/data`. Expected: FAIL.
- [ ] **Step 3:** Transcribe the Content catalog from Game Design exactly. Give each good a distinct `color` and each building a `description` in a period voice ("Turns honest timber into honest planks.").
- [ ] **Step 4:** Run `npx vitest run src/data`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(data): goods, recipes and buildings catalog`.

---

### Task 3: Map generator

**Files:**
- Create: `src/sim/mapgen.ts`, `src/sim/noise.ts`
- Test: `src/sim/mapgen.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `rng.ts` (Task 1); `CITY_NAMES` (Task 2).
- Produces: `generateMap(seed: number, width = 128, height = 96): { map: GameMap; cities: City[] }`; `valueNoise2D(seed, x, y, octaves): number` in [0,1]; `tileIndex(map, x, y): number`; `tileAt(map, x, y): Tile | undefined`

- [ ] **Step 1: Write failing tests:**
  - `deterministic`: two calls with seed 7 are deep-equal; seed 8 differs.
  - `dimensions`: `tiles.length === 128*96`.
  - `land ratio ≥ 0.55`.
  - `five cities, centers on grass, ≥ 25 tiles apart, ≥ 6 tiles from the edge, unique names, population in [2000,12000]`.
  - `deposits on legal terrain`: iron_ore/coal only on hills/mountain, oil only on grass/sand; at least 4 clusters of each.
  - `no roads or buildings yet`.
  - `every city has iron, coal, forest and sand nearby` (seeds 1–10: iron and coal within 20 tiles, forest and sand within 25).
  - `terrain variety`: averaged over seeds 1–10, water ≥ 10% and mountain ≥ 2%.
  - `small map works`: `generateMap(1, 64, 48)` returns valid output (or a clear error).
- [ ] **Step 2:** Run `npx vitest run src/sim/mapgen.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use fractal value noise (4 octaves) for elevation `e` and, at a different seed offset, for moisture `m`. Stretch contrast first: `e = clamp((e − 0.5) × 1.6 + 0.5, 0, 1)` (and the same for `m`). Then classify terrain: `e<0.30` water, `<0.34` sand, `>0.78` mountain, `>0.66` hills, else forest if `m>0.55` else grass. Place cities first, then deposits. Each city gets 1 iron and 1 coal cluster seeded on hills/mountain within 20 tiles of its centre, and 1 oil cluster on grass/sand within 25 tiles. Then add random clusters up to totals of 8 iron, 8 coal and 7 oil. Clusters are 3–6 tiles. Reject the attempt (and retry with `seed+1000`) if any city lacks forest or sand within 25 tiles. If the land ratio is below 0.55, regenerate with `seed+1000`. City `urbanRadius = 3 + floor(pop/3000)`, `happiness 0.7`, `market {}`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): procedural map generator with deposits and cities`.

---

### Task 4: Pathfinding

**Files:**
- Create: `src/sim/pathfinding.ts`
- Test: `src/sim/pathfinding.test.ts`

**Interfaces:**
- Consumes: `types.ts`.
- Produces:
  - `type Passable = (tile: Tile, x: number, y: number) => boolean`
  - `findPath(map: GameMap, from: Vec2, targets: Vec2[], passable: Passable, stepCost?: (tile: Tile) => number): Vec2[] | null`: A* with 4-way moves and a binary heap. Returns the tile list from `from` to the first target reached, both inclusive. `from` itself need not be passable.
  - `roadPassable: Passable` (`tile.road`), `railPassable: Passable` (`tile.rail`), `roadBuildable: Passable` (not mountain, no building, `cityId === null || tile.road`), `waterAvoidingCost(tile)` (water 8, else 1)

- [ ] **Step 1: Write failing tests:** `straight road path`; `detours around gap`; `null when disconnected`; `multi-target picks nearest`; `from equals target returns [from]`; `128×96 open-field corner-to-corner under 30 ms`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with a Manhattan heuristic over min(targets) and typed arrays for gScore/cameFrom.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): A* pathfinding with passability predicates`.

---

### Task 5: Company finances

**Files:**
- Create: `src/sim/finance.ts`
- Test: `src/sim/finance.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `result.ts`.
- Produces: `STARTING_MONEY = 300000`, `LOAN_STEP = 50000`, `MAX_LOAN = 500000`, `LOAN_RATE = 0.06`, `BANKRUPT_MONTHS = 6`;
  `createCompany(id: OwnerId, name: string, money = STARTING_MONEY): Company`; `canAfford(c, amount): boolean`; `spend(c, cat: LedgerCategory, amount, date): void` (may go negative); `earn(c, cat, amount, date): void`; `currentLedger(c, date): LedgerMonth` (creates the month entry if missing); `takeLoan(c, amount): Result`; `repayLoan(c, amount): Result`; `closeMonth(c, date): { interest: number; bankrupt: boolean }`. The ledger keeps at most 120 months.

- [ ] **Step 1: Write failing tests:**
  - `spend and earn round and record in ledger`: `spend(c,'construction',1000.4,d)` → money 298999 and `expense.construction === 1000`.
  - `loan steps and cap`: 50000 ok; 30000 → err `'Loans come in $50,000 steps'`; 550000 total → err `'Loan limit is $500,000'`.
  - `repay needs cash`.
  - `interest monthly`: loan 100000 → `closeMonth` charges 500 as `interest`.
  - `bankrupt after six red months`: money −1 across 6 closes → the 6th returns `bankrupt: true`; a positive month resets `monthsInRed`.
  - `ledger capped at 120`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): company finances, ledger and loans`.

---

### Task 6: Market model

**Files:**
- Create: `src/sim/market.ts`
- Test: `src/sim/market.test.ts`

**Interfaces:**
- Consumes: `types.ts`; `GOODS`, `DEMAND_PER_1000` (Task 2).
- Produces:
  - `lifecycleFactor(goodId, year): number`
  - `monthlyDemand(city: City, goodId, year, modifier = 1): number`
  - `salePrice(goodId, supplyRatio: number): number` (rounded to whole dollars, min 1)
  - `supplyRatio(entry: MarketEntry | undefined): number` (0 when there is no demand history)
  - `StoreStock { buildingId; ownerId: OwnerId; stock: Inventory }`, `Sale { buildingId; ownerId; goodId; qty; revenue }`
  - `computeDailySales(city, stores: StoreStock[], year, demandMod: (goodId) => number, dayOffset = 0): Sale[]`: dealing starts at store `(dayOffset + goodIndex) % activeStores` so leftover units rotate fairly between owners. mutates only `city.market[g].pending`. Each day, `pending = min(pending + monthly/30, max(monthly/30 × 3, 1))`. Whole units `floor(pending + 1e-9)` are dealt round-robin to stores that still have stock until the units or the stock run out, and the units actually sold are subtracted from `pending`. This lets low-demand goods such as cars still sell every few days.
  - `updateMarketDay(city, goodId, sold: number, demandToday: number): void`: `x30 = x30 × 29/30 + today`
  - `satisfaction(city, goodId): number` = clamp(sold30 / demand30, 0, 1)
  - `monthlyGrowth(population, avgSatisfaction, pollution): number`
  - `urbanRadius(population): number`

- [ ] **Step 1: Write failing tests** with the spec's numbers:
  - `lifecycle`: radios 1920 → 0, 1930 → 1, 1970 → 0.6, 1980 → 0.2.
  - `demand`: pop 10000, bread, 1900 → 300.
  - `price`: furniture ratio 0 → 72, 1 → 36, 3 → 24.
  - `split between two stores`: equal stock, demand ⇒ equal qty; a store with 0 stock gets nothing.
  - `cannot sell more than stock`.
  - `low demand accumulates`: pop 10000, cars (5/month) → 0 sold on day 1, and exactly 1 sold by day 6.
  - `growth`: (10000, 0.9, 0) → 10100; (10000, 0, 1) → 9820; never below 500.
  - `urbanRadius(9000) === 6`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): city market demand, pricing and growth`.

---

### Task 7: UI kit & theme

**Files:**
- Create: `src/ui/dom.ts`, `src/ui/format.ts`, `src/ui/window.ts`, `src/ui/toasts.ts`, `src/ui/theme.css`
- Test: `src/ui/format.test.ts`, `src/ui/dom.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `events.ts`.
- Produces:
  - `h(tag: string, props?: Record<string, unknown> | null, ...children: (Node | string | null | false)[]): HTMLElement`. Props starting with `on` attach listeners, `class` → className, `style` accepts an object.
  - `formatMoney(n)`: `1234` → `"$1,234"`, `1250000` → `"$1.25M"`, `-5000` → `"-$5,000"`. `formatNumber(n)`, `formatPercent(0.734)` → `"73%"`.
  - `createWindow({ id, title, content: HTMLElement, onClose?, width? }): { el; close(); setContent(el) }`: a draggable brass-framed window; reopening the same `id` focuses the existing one.
  - `Toasts.attach(root, bus)`: shows `toast` events, stacking at most 4, each for 4 s.
  - `theme.css`: an industrial art-deco look. CSS variables `--walnut #2b1d14`, `--brass #c9a227`, `--paper #f3e9d2`, `--ink #1d1a16`, `--player #2f6fb5`, `--rival #b5302f`, `--good #3c8d3c`, `--bad #b5302f`. Serif display font stack `Georgia, 'Times New Roman', serif`.
- [ ] **Step 1: Write failing tests** for the format examples above and for `h` (attributes, children, `onClick` fires, `false` children skipped).
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): DOM helpers, formatters, windows, toasts and theme`.

---

### Task 8: Procedural audio

**Files:**
- Create: `src/audio/sfx.ts`
- Test: `src/audio/sfx.test.ts`

**Interfaces:**
- Consumes: `events.ts`.
- Produces: `class Sfx { constructor(ctxFactory = () => new AudioContext()); play(name: SfxName): void; setVolume(v: number /*0..1*/): void; setMuted(m: boolean): void; startAmbience(): void; attach(bus: EventBus): void }`; `type SfxName = 'click' | 'build' | 'demolish' | 'kaching' | 'whistle' | 'horn' | 'error' | 'news' | 'achievement'`.
  `attach` mapping: `buildingPlaced` → build, `buildingRemoved` → demolish, `sale` → kaching (at most once every 1.5 s), `news` → news, `achievement` → achievement, `vehicleStuck` → horn, `toast` with tone `bad` → error.
  The AudioContext is created lazily on the first `play` after a user gesture. Ambience is a low filtered-noise factory hum.
- [ ] **Step 1: Write failing tests** with a fake AudioContext factory: `no context before first play`; `muted plays nothing`; `kaching throttled` (5 sales within 1 s → 1 oscillator start); `attach maps events`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement each sound with oscillators, gain envelopes and noise buffers. Kaching is two bright square blips plus a bell partial; the whistle is a sliding sine pair. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(audio): synthesized sound effects and ambience`.

---

### Task 9: Game state & construction

**Files:**
- Create: `src/sim/state.ts`
- Test: `src/sim/state.test.ts`, `src/sim/testkit.ts` (test helpers: `flatMap(w,h,terrain)`, `testState(opts)`, `testCtx()`)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `createGame(opts: { seed: number; companyName?: string; scenarioId?: string; rival?: boolean }): GameState`: runs mapgen; lays city street grids (centre row and column plus every 3rd row/column inside the urban radius, on land only); links each city to its nearest neighbour with `findPath(…, roadBuildable, waterAvoidingCost)`; calls `refreshUrbanTiles`; creates companies (`rival.active = opts.rival ?? true`); sets `unlocked` to the ids of goods, buildings and recipes with era ≤ 1900.
  - `canPlaceBuilding(state, owner, typeId, pos): Result<{ cost: number }>`, `placeBuilding(ctx, owner, typeId, pos, recipeId?): Result<Building>`. Error strings: `'Out of bounds'`, `'Not invented yet'`, `'Wrong terrain'`, `'Tile occupied'`, `'Must be inside a city'`, `'Cannot build on city land'`, `'Needs a resource deposit'`, `'Not enough money'`. For deposit buildings, the default recipe is the one whose output matches the deposit.
  - `demolishBuilding(ctx, id): Result`: refunds 25% as `demolition` income, removes the building's stops from routes, sets vehicles on routes with < 2 stops to `idle`, emits `buildingRemoved`.
  - `buildRoad(ctx, owner, tiles: Vec2[]): Result<{ built: number; cost: number }>`: atomic; skips tiles that already have road. Errors: `'Cannot build road there'`, `'Not enough money'`. Increments `company.roadTiles` and emits `roadChanged`.
  - `removeRoad(ctx, owner, tiles): Result`: refuses tiles where a vehicle currently stands.
  - `lPath(from, to): Vec2[]`: horizontal then vertical, inclusive.
  - `accessTiles(state, building): Vec2[]`: road tiles orthogonally adjacent to the footprint.
  - `footprint(building | {typeId,pos}): Vec2[]`, `buildingsInCity(state, cityId, typeId?)`, `refreshUrbanTiles(state)`, `findPlacement(state, owner, typeId, near: Vec2, maxRadius = 20): Vec2 | null` (spiral search using `canPlaceBuilding`), `assetValue(state, owner): number` (Σ building cost × 0.5 + vehicles × 0.5).
  - `nextId(state): number`.
- [ ] **Step 1: Write failing tests:**
  - `createGame deterministic & cities connected`: seed 42 twice gives equal states, and a road path exists between each city and its nearest neighbour.
  - `placement rejection matrix`: one assertion per error string above.
  - `refuses when unaffordable`: money 100 → `'Not enough money'`, state deep-equal to before.
  - `place charges cost and marks tiles`.
  - `demolish removes route stops` and refunds 25%.
  - `buildRoad atomic`: a path crossing a mountain builds nothing and charges nothing.
  - `bridge costs 3000 on water`.
  - `accessTiles finds adjacent roads`.
  - `findPlacement finds a legal store spot in a city`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): game creation, placement, roads and demolition`.

---

### Task 10: Camera & terrain renderer

**Files:**
- Create: `src/render/camera.ts`, `src/render/terrain.ts`
- Test: `src/render/camera.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `mapgen.ts` (`tileAt`).
- Produces:
  - `TILE` and `Camera` live in `src/render/constants.ts` (already on main); `camera.ts` re-exports them. `Camera { x; y; zoom; viewW; viewH }` (x/y = world px at the top-left of the view)
  - `screenToWorld(cam, sx, sy): Vec2`, `screenToTile(cam, sx, sy): Vec2` (floored), `tileToScreen(cam, tx, ty): Vec2`, `zoomAt(cam, sx, sy, factor): void` (keeps the point under the cursor fixed; clamps zoom to [0.5, 3]), `clampCamera(cam, map): void`, `visibleTileRange(cam, map): { x0; y0; x1; y1 }`
  - `class TerrainRenderer { constructor(map: GameMap, seed: number); draw(ctx: CanvasRenderingContext2D, cam: Camera, timeMs: number, opts: { oilVisible: boolean; month: number }): void; invalidateTile(x, y): void }`. Draws 16×16-tile chunks into cached offscreen canvases. Each terrain gets a seeded-hash pixel texture: grass speckles, forest tree crowns with shadows, hills contour shading, mountains as grey peaks with snow caps, sand dots. Water is drawn per frame with animated shimmer lines. Deposits are drawn as coloured ore rocks; oil only when `oilVisible`. In winter months (Dec–Feb), grass and forest get a light snow overlay (re-cache on season change).
- [ ] **Step 1: Write failing tests:** `screenToTile inverse of tileToScreen` (zoom 1 and 2); `zoomAt keeps cursor anchor`; `zoom clamped`; `clampCamera keeps view inside map`; `visibleTileRange clipped to map`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(render): camera math and chunk-cached procedural terrain`.

---

### Task 11: Procedural sprite painter

**Files:**
- Create: `src/render/sprites.ts`
- Test: `src/render/sprites.test.ts`

**Interfaces:**
- Consumes: `BUILDINGS`, `GOODS` (Task 2); `TILE` from `src/render/constants.ts`.
- Produces:
  - `spriteKey(typeId, ownerId, variant): string`
  - `getBuildingSprite(typeId, ownerId: OwnerId): HTMLCanvasElement`: cached, sized `size.w*TILE × size.h*TILE` plus a 16 px headroom for chimneys. Style by category: extractors are a camp, farm field rows, a mine headframe or an oil derrick; factories are brick with a sawtooth roof and chimneys tinted by `def.color`; the store has an awning in the owner colour; the warehouse is a big shed with doors. A small owner pennant goes in the corner.
  - `chimneyOffsets(typeId): Vec2[]`: pixel offsets inside the sprite (used by smoke).
  - `windowRects(typeId): { x; y; w; h }[]`: for night lighting.
  - `drawHouse(ctx, px, py, variant: number, year: number, lit: boolean): void`: style by era (cottage < 1920, brick rowhouse < 1945, art-deco block < 1970, modern tower ≥ 1970).
  - `drawTruck(ctx, px, py, dir: 'N'|'E'|'S'|'W', ownerId, cargoColor: string | null): void`, `drawTrain(ctx, px, py, dir, ownerId, wagons: number): void`
  - `drawGoodIcon(ctx, goodId, px, py, size): void` (emoji, with a coloured-dot fallback)
- [ ] **Step 1: Write failing tests** (pure parts only): `chimneyOffsets inside sprite bounds for every factory`; `every factory has ≥ 1 chimney, extractors other than mine/oil_well have 0`; `spriteKey distinct by owner`; `houseStyle(year)` (an exported helper) returns `'cottage'` at 1900, `'brick'` at 1930, `'deco'` at 1950 and `'modern'` at 1990.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. Only the pure helpers are unit-tested; the drawing is checked visually in Task 18. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(render): procedural building, house and vehicle sprites`.

---

### Task 12: Atmosphere & particles

**Files:**
- Create: `src/render/atmosphere.ts`, `src/render/particles.ts`
- Test: `src/render/atmosphere.test.ts`, `src/render/particles.test.ts`

**Interfaces:**
- Consumes: `types.ts`.
- Produces:
  - `lightLevel(hour: number): number`: 1.0 from 8–17, 0.25 from 21–4, linear ramps between.
  - `eraGrade(year): { sepia: number; saturate: number }`: sepia 0.8 → 0 and saturate 0.6 → 1.15, linear from 1900 to 1965, then constant.
  - `seasonTint(month): string | null` (rgba overlay: cool blue in winter, warm in summer, null otherwise)
  - `applyAtmosphere(ctx, w, h, date): void`: night overlay (multiply dark blue by 1 − lightLevel) plus season tint.
  - `cssFilterFor(year): string` (e.g. `"sepia(0.8) saturate(0.6)"`), applied to the world canvas element.
  - `class ParticleSystem { emitSmoke(wx, wy, density: number, dtMs: number): void /* rate-based: ~4 puffs/s at density 1, frame-rate independent */; emitFloatText(wx, wy, text: string, color: string): void; emitSparks(wx, wy): void; update(dtMs): void; draw(ctx, cam): void; count(): number }`. Capped at 2000 particles. Smoke rises, drifts with a global wind and fades over ~3 s. Float text ("+$48") rises 24 px and fades over 1.2 s.
- [ ] **Step 1: Write failing tests:** `lightLevel(12)===1`, `lightLevel(0)===0.25`, `lightLevel(6)` strictly between; `eraGrade(1900).sepia===0.8`, `eraGrade(1965).sepia===0`, `eraGrade(1990)` equals `eraGrade(1965)`; `particles expire` (emit, update 5000 ms → count 0); `cap respected`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(render): day/night, seasons, era grading and particles`.

---

### Task 13: Production & retail systems

**Files:**
- Create: `src/sim/production.ts`
- Test: `src/sim/production.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 6, 9 (`testkit`).
- Produces:
  - `acceptsGood(building, goodId): boolean`: a factory accepts its recipe inputs; a store accepts tier-2 goods; warehouses and stations accept anything; extractors accept nothing.
  - `loadSource(building): Inventory`: `output` for extractors/factories, `input` for warehouse/station/store.
  - `storageLeft(building, goodId): number`
  - `demandModifier(state, cityId, goodId): number`: product of active `state.modifiers` that match the good (or `'*'`) and the city (or null).
  - `productionDay(ctx): void`: extractors produce `outputs × efficiency` (lumber camp efficiency = forest tiles in footprint / footprint size; farms use the season factor); factories advance progress by `1/days` when inputs are present and output is not full; sets `status`; respects `haltedUntil`; accumulates `producedThisMonth`.
  - `retailDay(ctx): void`: per city, applies `computeDailySales` to stores (passing `dayOffset = dateToDays(state.date)`), earns `sales` (also adding revenue to the ledger month's `salesByGood`), updates the market, emits one `sale` event per (store, good) with qty > 0. Every good with demand updates `demand30` even when nothing sold.
  - `maintenanceMonth(ctx): void`: building maintenance plus `roadTiles × 5` plus `railTiles × 0` (Task 27 sets rail upkeep), charged as `maintenance`.
  - `growthMonth(ctx): void`: applies `monthlyGrowth` per city using the average satisfaction over goods with demand > 0 and `city.pollution`; sets `happiness`; calls `refreshUrbanTiles`; resets `producedThisMonth`.
  - Registers in `SYSTEMS` (via Task 17's registry; until Task 17 merges, export the functions only and Task 17 wires them).
- [ ] **Step 1: Write failing tests:**
  - `lumber camp produces 4 wood/day on full forest`.
  - `farm fallow in January, ×1.5 in August` (grain 0 and 7.5 → stored as a float; inventories may hold fractions, and loading only moves whole units).
  - `sawmill converts 4 wood → 2 lumber`; `status no_input when empty`; `output_full stops production`.
  - `car plant takes 2 days per car`.
  - `store sells to city and earns money` (stock 10 furniture, pop 10000 → sells 2 on day one, at $72 each).
  - `demand modifier doubles sales`.
  - `maintenance charged monthly`.
  - `well-supplied city grows`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): production chains, retail sales, maintenance and growth`.

---

### Task 14: Trucks & routes

**Files:**
- Create: `src/sim/vehicles.ts`
- Test: `src/sim/vehicles.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 9, 13 (`acceptsGood`, `loadSource`, `storageLeft`).
- Produces:
  - `TRUCK = { cost: 8000, capacity: 20, speed: 0.5, maintenance: 150, loadTicks: 6 }`
  - `createRoute(ctx, owner, name, stops: RouteStop[], kind = 'truck'): Result<Route>`: ≥ 2 stops, own buildings only, and each stop needs access tiles. Errors: `'A route needs at least two stops'`, `'Stop has no road access'`, `'Not your building'`. The colour is picked from an 8-colour palette by id.
  - `updateRoute(ctx, routeId, patch: Partial<Pick<Route,'name'|'stops'|'color'>>): Result`, `deleteRoute(ctx, routeId): Result` (sells its vehicles)
  - `buyTruck(ctx, owner, routeId): Result<Vehicle>`: spawns at the first stop's first access tile.
  - `sellVehicle(ctx, id): Result` (50% refund under `vehicles`)
  - `vehiclesTick(ctx): void`: state machine `moving → loading → moving`. On arrival it unloads `stop.unload` goods the building accepts (bounded by `storageLeft`), then loads `stop.load` goods from `loadSource` (whole units, split evenly, capped by capacity). Then it paths to any access tile of the next stop via `findPath(roadPassable)`. With no path it goes `stuck`, emits `vehicleStuck` once and retries every 24 ticks, staggered by `vehicle.id % 24` so many stuck trucks don't all search the map on the same tick (a failed search scans the whole map, 10–20 ms). It sets `prevPos` before moving each tick. A route with < 2 stops makes its vehicles `idle`.
  - `vehicleMaintenanceMonth(ctx): void`
- [ ] **Step 1: Write failing tests:**
  - `round trip delivers wood to sawmill` (a straight 10-tile road; after enough ticks, sawmill input wood > 0 and camp output decreased).
  - `respects capacity 20`.
  - `does not unload goods building rejects`.
  - `stuck truck recovers when road restored` (remove a middle road tile → stuck with exactly one event; restore → moving again within 24 ticks).
  - `vehicle idles when route drops below two stops`.
  - `travel speed` (a 10-tile path takes 20 ticks).
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): routes and truck logistics`.

---

### Task 15: HUD & build toolbar

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/toolbar.ts`, `src/ui/tools.ts`
- Test: `src/ui/hud.test.ts`, `src/ui/toolbar.test.ts`

**Interfaces:**
- Consumes: Task 7 (`h`, `formatMoney`, …), Task 2 catalog, Task 9 (`canPlaceBuilding` for the cost tooltip).
- Produces:
  - `type ToolSpec = { kind: 'inspect' } | { kind: 'build'; typeId: BuildingTypeId } | { kind: 'road' } | { kind: 'rail' } | { kind: 'bulldoze' } | { kind: 'pickStop'; routeId: number | null }`
  - `class Hud { constructor(root: HTMLElement, handlers: { onSpeed(s: GameState['speed']): void; onOpenPanel(id: string): void }); update(state: GameState): void }`: a top bar with company name, money (red when negative), date, era name, speed buttons (active one highlighted), and buttons for Routes, Finance, Newspaper and Contracts. It also holds a bottom headline ticker element, `#ticker`, that Task 23 fills.
  - `class Toolbar { constructor(root, onSelect: (t: ToolSpec) => void); update(state): void; select(t: ToolSpec): void }`: category tabs Extract / Refine / Manufacture / Retail & Logistics / Transport (road, rail, bulldoze). Each item shows icon, name, cost, maintenance and its inputs → outputs. Locked items are greyed with "Invented in 1925".
- [ ] **Step 1: Write failing tests (jsdom):** `money turns red when negative`; `speed click calls onSpeed(4)`; `locked building disabled with invention year`; `selecting building emits build ToolSpec`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): HUD top bar and build toolbar`.

---

### Task 16: World renderer

**Files:**
- Create: `src/render/world.ts`, `src/render/overlays.ts`
- Test: `src/render/world.test.ts`

**Interfaces:**
- Consumes: Tasks 10, 11, 12; `accessTiles`, `footprint` (Task 9).
- Produces:
  - `roadMask(map, x, y, layer: 'road' | 'rail'): number` (N=1, E=2, S=4, W=8)
  - `interface Overlay { id: string; enabled: boolean; draw(ctx, state: GameState, cam: Camera): void }`; `OVERLAYS: Overlay[]` (registry); `setOverlay(id, enabled)`
  - `interface Ghost { kind: 'building'; typeId; pos: Vec2; valid: boolean; label: string } | { kind: 'tiles'; tiles: Vec2[]; valid: boolean; label: string }`
  - `class WorldRenderer { constructor(canvas: HTMLCanvasElement, state: GameState); render(state, cam, alpha: number /*0..1 tick interpolation*/, nowMs: number): void; setGhost(g: Ghost | null): void; setSelection(sel: { buildingId?: number; routeId?: number; vehicleId?: number } | null): void; particles: ParticleSystem }`
  - Layer order: terrain → roads (autotiled asphalt or dirt by era, with lane dashes after 1930; bridges over water) → houses on urban tiles (variant = hash(x,y); density rises toward the centre) → buildings (y-sorted) → vehicles (lerp `prevPos → pos` by alpha, facing from delta, cargo colour from first cargo good) → particles (smoke from `chimneyOffsets` with density ∝ building status `ok`) → selected route polyline in the route colour → ghost (green/red translucent footprint plus a cost label) → overlays → atmosphere. At night, lit windows from `windowRects` and street lamps on every 4th road tile glow yellow. A store emits a "+$N" float text on each `sale` event (subscribe via a `bus` passed to `attachEffects(bus)`).
- [ ] **Step 1: Write failing tests:** `roadMask crossroads === 15`, `roadMask dead-end east === 2`; `overlay registry toggles`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(render): world renderer with roads, houses, buildings, vehicles and night lights`.

---

### Task 17: Simulation loop, systems registry & saves

**Files:**
- Create: `src/sim/systems.ts`, `src/sim/simulation.ts`
- Test: `src/sim/simulation.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 13, 14.
- Produces:
  - `interface SimSystem { id: string; onTick?(ctx): void; onDay?(ctx): void; onMonth?(ctx): void; onYear?(ctx): void }`; `SYSTEMS: SimSystem[]`, seeded in this order: `vehicles` (tick; month = vehicle maintenance), `production` (day = `productionDay`), `retail` (day = `retailDay`), `upkeep` (month = `maintenanceMonth`, `growthMonth`), `finance` (month = `closeMonth` per company; on bankruptcy of the player emit `gameOver{reason:'Bankrupt'}`).
  - `stepTick(ctx): void`: advances `date` and `tick`, runs `onTick`, then on boundaries emits `dayStart`, runs `onDay`; at month end runs `onMonth` and emits `monthEnd`; at year end runs `onYear` and emits `yearEnd`. On reaching 1 Jan 2001 it emits `victory{reason:'The century is over'}` and sets speed to 0.
  - `runTicks(ctx, n)`, `runDays(ctx, n)`
  - `SAVE_VERSION = 1`; `serialize(state): string`; `deserialize(json: string): Result<GameState>` (checks parseable JSON, `version === SAVE_VERSION`, and the presence and type of `map.tiles`, `companies.player`, `date`)
- [ ] **Step 1: Write failing tests:**
  - `month boundary fires systems once`: a spy system counts 30 days → `onDay`×30, `onMonth`×1.
  - `deterministic replay`: two games seed 9, same scripted actions, 2 years → `serialize` equal.
  - `round-trip save`.
  - `rejects garbage and wrong versions`: `'{'` → err `'Save file is corrupted'`; version 99 → err `'Save from an incompatible version'`; missing map → err `'Save file is incomplete'`.
  - **`headless chain earns money`**: on seed 42, using `findPlacement`, `lPath` + `buildRoad` and `createRoute`/`buyTruck`, script lumber_camp → sawmill → furniture_factory → store in the nearest city with 2 trucks per leg. After 365 days, store sales income > 0 and the city's furniture `sold30` > 0.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): tick loop, system registry and save serialization`.

---

### Task 18: Bootstrap, input & tools — playable milestone

**Files:**
- Create: `src/main.ts`, `src/game/controller.ts`, `src/game/input.ts`, `src/game/toolController.ts`, `src/ui/panels/index.ts`
- Modify: `index.html` (link `src/ui/theme.css`)
- Test: `src/game/toolController.test.ts`

**Interfaces:**
- Consumes: everything from Waves 0–4.
- Produces:
  - `class GameController { constructor(canvas, uiRoot); newGame(opts): void; load(state: GameState): void; ctx: SimContext; camera: Camera; setSpeed(s): void; setTool(t: ToolSpec): void; openPanel(id: string, arg?: unknown): void; destroy(): void }`. Fixed-timestep loop on `requestAnimationFrame`: `msPerTick = 2000 / 24 / speed`; at most 200 ticks per frame (drop the backlog beyond that); render alpha = accumulator / msPerTick. The HUD updates at 4 Hz.
  - `interface PanelDef { id: string; open(game: GameController, arg?: unknown): void }`; `PANELS: Record<string, PanelDef>` (registry; empty object now).
  - `class ToolController { constructor(game: GameController); pointerDown(tile: Vec2): void; pointerMove(tile: Vec2): void; pointerUp(tile: Vec2): void; cancel(): void; ghost(): Ghost | null }`. `build` places on click and shows a ghost with validity and cost. `road`/`rail` drag uses an `lPath` preview with the total cost and builds on release. `bulldoze` demolishes a building or removes a road. `inspect` opens `PANELS.building` / `PANELS.city` / `PANELS.vehicle` when present. `pickStop` forwards the clicked building id to the `onPick` callback. Errors become `toast` events with tone `bad`.
  - Input: as in Game Design → Controls; the camera starts centred on the largest city.
- [ ] **Step 1: Write failing tests (jsdom, with a stub game):** `road drag builds L path on release`; `invalid build emits bad toast and changes nothing`; `escape returns to inspect tool`; `bulldoze on road tile removes road`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Manual verification.** Run `npm run dev` and open it in a browser (use the `run` skill to screenshot). Confirm: terrain, cities and roads render; pan and zoom work; you can build lumber camp → sawmill → furniture factory → store, connect them with roads and create a route (a temporary debug button that creates a route between the last two placed buildings is acceptable until Task 20); trucks visibly drive; money rises on sales with "+$" floaters; night falls and windows light up; the world is sepia.
- [ ] **Step 6:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(game): bootstrap loop, input and tools — playable vertical slice`.

---

### Task 19: Inspector panels

**Files:**
- Create: `src/ui/panels/building.ts`, `src/ui/panels/city.ts`, `src/ui/panels/vehicle.ts`
- Modify: `src/ui/panels/index.ts` (append 3 entries)
- Test: `src/ui/panels/inspectors.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 9, 13, 14, 18.
- Produces: `PANELS.building`, `PANELS.city`, `PANELS.vehicle`, each opened with an id `arg`, refreshing at 2 Hz and closing automatically if the entity disappears.
  - Building: name, owner, status badge with a plain-language reason ("Waiting for Wood"), input/output inventory bars vs. storage, a recipe selector for unlocked recipes (changing it resets progress), produced-this-month counts, routes serving this building, and a Demolish button with a two-click confirm showing the refund.
  - City: name, population with a ▲/▼ trend, happiness, pollution, and a table per tier-2 unlocked good: monthly demand, satisfaction bar, current price, and the stores selling it (owner colour). The top 3 unmet goods are flagged "★ Craves".
  - Vehicle: cargo, current route, state, next stop, Sell button.
- [ ] **Step 1: Write failing tests (jsdom):** `recipe change updates building.recipeId`; `city panel lists craved goods sorted by unmet demand`; `panel closes when building demolished`; `status reason text for no_input names missing good`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): building, city and vehicle inspectors`.

---

### Task 20: Route editor

**Files:**
- Create: `src/ui/panels/routes.ts`, `src/sim/routeHelpers.ts`
- Modify: `src/ui/panels/index.ts` (append `routes`); remove the Task 18 debug button.
- Test: `src/sim/routeHelpers.test.ts`, `src/ui/panels/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 14, 18 (`pickStop` tool).
- Produces:
  - `suggestStop(state, buildingId, prevStops: RouteStop[]): RouteStop`: loads everything the building outputs that a later or earlier stop accepts; unloads everything previous stops load that this building accepts.
  - `routeThroughput(state, routeId): number`: estimated units per month = trucks × capacity × 720 / round-trip ticks (round trip from path lengths).
  - `PANELS.routes`: a list of routes (colour swatch, stops, trucks, throughput) with New Route, which enters pick mode and appends stops by clicking buildings (each pre-filled with `suggestStop`). Each stop row has load/unload good toggle chips and ↑/↓/✕ controls. Truck +/− buttons buy and sell; Delete Route. Selecting a route highlights it on the map via `setSelection({routeId})`.
- [ ] **Step 1: Write failing tests:** `suggestStop camp→sawmill loads wood, unloads wood`; `throughput scales with trucks`; `(jsdom) picking two buildings then Save creates route`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): route editor with stop suggestions`.

---

### Task 21: Finance dashboard

**Files:**
- Create: `src/ui/charts.ts`, `src/ui/panels/finance.ts`
- Modify: `src/ui/panels/index.ts` (append `finance`)
- Test: `src/ui/charts.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 7, 9 (`assetValue`).
- Produces:
  - `niceTicks(min, max, count): number[]`; `lineChart(canvas, series: { label; color; values: number[] }[], labels: string[]): void`; `barChart(canvas, bars: { label; value; color }[]): void`
  - `PANELS.finance`: an income statement for the last 12 months (rows = ledger categories, plus a profit row), a cash-and-net-worth line chart (player in blue, rival in crimson when active), sales by good this year as a bar chart using good colours, and loan controls (Borrow $50k / Repay $50k) with interest shown.
- [ ] **Step 1: Write failing tests:** `niceTicks(0, 97, 5)` returns `[0,20,40,60,80,100]`; `niceTicks(-1000, 1000, 4)` includes 0; `negative-only range handled`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): finance dashboard with charts and loans`.

---

### Task 22: Eras, inventions & product lifecycle

**Files:**
- Create: `src/sim/eras.ts`
- Modify: `src/sim/systems.ts` (append `eras` system)
- Test: `src/sim/eras.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 17.
- Produces: `ERAS: { name; start; end; blurb }[]`; `eraName(year): string`; `isUnlocked(state, id): boolean`; `checkUnlocks(ctx): void` (on day: adds newly eligible good/building/recipe ids to `state.unlocked`, emits `unlock`, and publishes an `invention` news item with a flavourful headline, e.g. "HORSELESS CARRIAGE TAKES TOWN BY STORM — Automobile plants now possible"; sets `state.flags.oilRevealed = true` in 1910 with "BLACK GOLD! Oil found beneath the plains"); `fadeWarnings(ctx)` (on year: news the year before `fadeYear` and when demand halves); `eraBanner` toast on era change.
- [ ] **Step 1: Write failing tests:** `cars unlocked on 1 Jan 1910 with one news item`; `no duplicate unlock`; `oil revealed in 1910`; `eraName(1955)==='Atomic Age'`; `radio fade warning in 1964`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. Also make the toolbar (Task 15) read `isUnlocked`: a one-line change in `toolbar.ts`. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): eras, inventions and product lifecycle news`.

---

### Task 23: The Daily Smokestack — newspaper & events

**Files:**
- Create: `src/sim/events.ts`, `src/ui/panels/newspaper.ts`, `src/ui/ticker.ts`
- Modify: `src/sim/systems.ts` (append `events`), `src/ui/panels/index.ts` (append `newspaper`)
- Test: `src/sim/events.test.ts`

**Interfaces:**
- Consumes: Tasks 6 (modifiers), 13 (`haltedUntil`), 17, 22.
- Produces:
  - `publishNews(ctx, kind, headline, body): NewsItem` (keeps the last 200; emits `news`)
  - `HISTORIC_EVENTS`, fixed-date: 1914-08 Great War (steel and tools ×1.5 until 1918-11); 1929-10 Crash (`'*'` ×0.6 for 18 months); 1945-09 Post-war boom (`'*'` ×1.2 for 24 months); 1969-07 Moon landing (toys ×2 for 6 months); 1973-10 Oil crisis (fuel price note plus cars ×0.6 for 12 months); 1983 Home-computer craze (computers ×1.5 for 24 months).
  - `RANDOM_EVENTS: { id; weight; minYear; apply(ctx): NewsItem | null }[]`: `strike` (a random player factory halts for 10 days), `fire` (a factory loses its output stock), `bumper_harvest` (farms ×2 this month via flag), `festival` (one city ×1.3 on all goods for 30 days), `gold_rush` (a city gains 15% population), `inventor` (the next locked recipe unlocks 2 years early), `heatwave` (juice ×2 for 30 days, summer only), `rail_strike` (≥ 1930; trains halt 7 days; skipped if there are no trains). Rolled monthly with probability 0.35 via the rng.
  - `monthlyMarketReport(ctx)`: on month: the top-selling good with player revenue, plus one "Smogsworth says…" quip when the rival is active.
  - `PANELS.newspaper`: a newspaper modal styled on paper with the masthead "THE DAILY SMOKESTACK", "Est. 1900 · Price 2¢", the date, a lead story, a two-column layout of the other stories this month, and an era-appropriate classifieds block of humorous fake ads. It opens automatically at month end when a historic event happened (setting can disable this).
  - `Ticker.attach(el: HTMLElement /* #ticker */, bus)`: scrolls the latest 5 headlines.
- [ ] **Step 1: Write failing tests:** `1929 crash applies '*' 0.6 modifier for 18 months`; `modifier expires`; `strike halts and resumes production`; `random roll deterministic for seed`; `news capped at 200`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: The Daily Smokestack newspaper, historic and random events`.

---

### Task 24: Pollution & happiness

**Files:**
- Create: `src/sim/pollution.ts`, `src/render/pollutionOverlay.ts`
- Modify: `src/sim/systems.ts` (append `pollution`), `src/render/overlays.ts` (append overlay), `src/ui/hud.ts` (overlay toggle button "☁")
- Test: `src/sim/pollution.test.ts`

**Interfaces:**
- Consumes: Tasks 13, 16, 17.
- Produces: `pollutionDay(ctx)`: each building with status `ok` adds `def.pollution × 2` to tiles within radius 3 (falloff `1 − d/4`); every tile decays 3%/day; capped at 100. `cityPollution(state, cityId): number` = mean urban-tile pollution / 100. Monthly, it writes `city.pollution`, which feeds Task 13's growth. `happiness` = 0.6 × avg satisfaction + 0.4 × (1 − pollution). The overlay is a translucent brown heat map. Cities above 0.5 pollution post a `warning` news item ("Citizens of Coalhaven cough in protest") at most once a year.
- [ ] **Step 1: Write failing tests:** `steel mill pollutes neighbours, not far tiles`; `decays to near zero after 120 idle days`; `city pollution reduces growth` (two cities, same supply, one polluted, so it grows less); `warning news at most once per year`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: pollution diffusion, city happiness and smog overlay`.

---

### Task 25: Rival tycoon — Baron Cornelius Smogsworth

**Files:**
- Create: `src/sim/rival.ts`, `src/render/portrait.ts`, `src/ui/panels/rival.ts`
- Modify: `src/sim/systems.ts` (append `rival`), `src/ui/panels/index.ts` (append `rival`)
- Test: `src/sim/rival.test.ts`

**Interfaces:**
- Consumes: Tasks 9 (`findPlacement`, `buildRoad`, `assetValue`), 14, 17, 23 (`publishNews`).
- Produces:
  - `chainFor(goodId, state): BuildingTypeId[]`: the backward chain from extractor to factory using the first unlocked recipe per good. `furniture` → `['lumber_camp','sawmill','furniture_factory']`.
  - `rivalMonth(ctx)` (only when `companies.rival.active`): with at most one project in flight (`state.rivalProject`), it picks the (city, tier-2 good) with the highest `unmet demand × price` among chains costing ≤ money − $50,000. It builds a store in that city and the chain buildings via `findPlacement` near the city; connects each to the road network with `findPath(roadBuildable)` + `buildRoad`; and creates routes with 1–2 trucks per leg. It adds trucks to legs whose source output is ≥ 80% full. It never spends below its $50,000 reserve and takes loans only when money < $20,000.
  - `rivalTaunt(ctx)`: on month with probability 0.3, a `rival` news item from a pool of 20 quips ("Smogsworth: 'Your furniture would embarrass a woodpecker.'").
  - `netWorth(state, owner)` = money − loan + `assetValue`.
  - `canTakeover(state)`: player net worth ≥ 3 × rival net worth and ≥ $1,000,000. `takeover(ctx): Result` transfers all rival buildings, routes and vehicles to the player for a price of 1.2 × rival net worth, sets `rival.active=false` and `state.flags.takeover = true`, and emits `achievement{id:'baron_busted'}` and the news headline "SMOGSWORTH OUSTED!". Task 28's goals system turns the flag into a scenario victory.
  - `drawBaronPortrait(ctx, size, mood: 'smug' | 'furious')`: a procedural portrait with top hat, monocle and moustache.
  - `PANELS.rival`: portrait, net worth comparison bar, his stores per city, and a Takeover button (enabled when `canTakeover`).
- [ ] **Step 1: Write failing tests:** `chainFor furniture`; `after 24 months headless the rival owns ≥ 1 store and ≥ 1 route`; `rival never dips below reserve from construction`; `takeover transfers ownership`; `inactive rival does nothing`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: rival tycoon AI, taunts and hostile takeover`.

---

### Task 26: Mayor's contracts

**Files:**
- Create: `src/sim/contracts.ts`, `src/ui/panels/contracts.ts`
- Modify: `src/sim/systems.ts` (append `contracts`), `src/ui/panels/index.ts` (append `contracts`)
- Test: `src/sim/contracts.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 13 (`sale` events), 17, 23.
- Produces:
  - `offerContracts(ctx)`: every 2 months, if fewer than 3 contracts are `offered`, picks a city and an unlocked tier-2 good with satisfaction < 0.6. qty = round(monthlyDemand × 1.5); deadline = +4 months; reward = qty × basePrice × 1.5. Publishes a `contract` news item ("Mayor of Ashby pleads for bread!").
  - `acceptContract(ctx, id): Result` (at most 3 active)
  - `onSale(ctx, sale)`: player sales of that good in that city count toward `delivered`.
  - `contractsDay(ctx)`: on completion it earns `reward` under `contracts`, grows the city population by 5% and emits `contract{status:'done'}` plus a good toast. Past the deadline the contract is `failed`, the city's happiness drops by 0.1 and a bad toast fires.
  - `PANELS.contracts`: a notice-board style list with progress bars and countdowns.
- [ ] **Step 1: Write failing tests:** `offer targets low-satisfaction goods`; `sales count only after acceptance and only for player`; `completion pays and grows city`; `failure after deadline`; `max 3 active`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: mayor's delivery contracts`.

---

### Task 27: Railways

**Files:**
- Create: `src/sim/rail.ts`
- Modify: `src/sim/vehicles.ts` (train kind), `src/sim/production.ts` (rail upkeep $10/tile/month), `src/render/world.ts` (rails with ties, level crossings, train sprites with trailing wagons and steam puffs before 1950, diesel afterwards), `src/game/toolController.ts` (rail drag), `src/ui/panels/routes.ts` (train routes)
- Test: `src/sim/rail.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 9, 14, 20.
- Produces:
  - `TRAIN = { cost: 60000, capacity: 120, speed: 1.0, maintenance: 1200, loadTicks: 12 }`
  - `buildRail(ctx, owner, tiles): Result<{ built; cost }>`: $1,200/tile; a crossing over an existing road tile is allowed (level crossing); no water or mountain.
  - `stationAccess(state, station): Vec2[]`: rail tiles adjacent to the station footprint. Keep `findPath` target lists small (access tiles only); never pass every rail or road tile as a target, because the heuristic scans all targets per node.
  - Train routes (`kind: 'train'`) accept only `train_station` stops and path with `railPassable`. `buyTrain(ctx, owner, routeId): Result<Vehicle>`. The station behaves like a warehouse (uses `input` as storage, accepts anything), so trucks feed it and trains haul between stations.
  - Upkeep is charged via `company.railTiles`.
- [ ] **Step 1: Write failing tests:** `rail crosses road but not water`; `train hauls 120 between stations`; `truck route can stop at station`; `train route rejects non-station stop`; `rail upkeep charged`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: railways, stations and trains`.

---

### Task 28: Main menu, scenarios, achievements & save slots

**Files:**
- Create: `src/sim/scenarios.ts`, `src/game/saves.ts`, `src/game/achievements.ts`, `src/ui/menu.ts`, `src/ui/panels/goals.ts`
- Modify: `src/main.ts` (start at the menu), `src/sim/systems.ts` (append `goals`), `src/ui/panels/index.ts`
- Test: `src/sim/scenarios.test.ts`, `src/game/saves.test.ts`, `src/game/achievements.test.ts`

**Interfaces:**
- Consumes: Tasks 17, 18, 25.
- Produces:
  - `Goal = { kind: 'money'; amount; byYear } | { kind: 'sell'; goodId; qty; byYear } | { kind: 'takeover'; byYear } | { kind: 'population'; amount; byYear }`
  - `ScenarioDef { id; name; blurb; startYear; money; rival: boolean; goals: Goal[] }`; `SCENARIOS`: `sandbox` (Free Play, 1900, $300k, rival, no goals), `lumber_baron` ($1M cash by 1920), `motor_city` (start 1910, sell 500 cars by 1940), `beat_the_baron` (takeover by 1950), `boomtown` (any city at 50,000 population by 1960).
  - `evaluateGoals(state): { done: boolean[]; failed: boolean }`; the `goals` system emits `victory` or `gameOver` monthly. Sell counts are tracked in `state.flags['sold:<goodId>']`, incremented from `sale` events.
  - `saves.ts`: `SLOTS = ['auto','slot1','slot2','slot3']`; `saveTo(slot, state): Result`; `loadFrom(slot): Result<GameState>`; `listSaves(): { slot; date: string; company: string; money: number }[]`. Uses localStorage key `smokestack:save:<slot>`. Autosaves every in-game January. Every access is wrapped in try/catch.
  - `achievements.ts`: `ACHIEVEMENTS` (12 entries: first_sale, chain_gang (any tier-2 good produced from an own extractor), millionaire, motor_mogul (100 cars), fleet_50, rail_baron (10 trains), clean_hands (no building with pollution > 2 by 1950 while netWorth > $1M), contract_killer (10 contracts), crash_survivor (positive cash through 1929–1931), baron_busted, centennial (reach 2000), monopoly (sole seller of a good in all 5 cities)); `checkAchievements(state, unlocked: Set<string>): string[]`; persisted in localStorage `smokestack:achievements`; toast plus fanfare on unlock.
  - `menu.ts`: the title screen "SMOKESTACK" in art-deco lettering over a live, slowly panning night-time render of a generated map with smoke. Buttons: New Game (company name, seed with 🎲, scenario cards, rival toggle), Continue (autosave), Load (slots with metadata), Achievements, Settings (master volume, mute, auto-open newspaper). In game, Esc opens a pause menu with Save to slot / Load / Quit to menu.
- [ ] **Step 1: Write failing tests:** `lumber_baron won when money ≥ 1M before 1920, failed after`; `save/load round-trip in jsdom localStorage`; `loadFrom empty slot → err 'Empty slot'`; `quota exceeded handled → err`; `first_sale achievement fires once`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: main menu, scenarios, save slots and achievements`.

---

### Task 29: Tutorial & balance pass

**Files:**
- Create: `src/ui/tutorial.ts`, `src/sim/balance.test.ts`, `scripts/chain-report.ts`
- Modify: catalog numbers in `src/data/*.ts` only if the balance tests demand it (record every change in the commit message).

**Interfaces:**
- Consumes: everything.
- Produces:
  - `TUTORIAL_STEPS: { id; text; done(state): boolean; highlight?: string /* CSS selector */ }[]`: 9 steps: welcome → place lumber camp on forest → sawmill → furniture factory → store in a city → connect roads → create route → buy truck → first sale ("Ka-ching! You're in business."). It shows as a brass hint card with a Skip option and is offered for new Free Play games.
  - `npx tsx scripts/chain-report.ts` (add `tsx` as a dev dep pinned to `4.19.2`): prints per tier-2 good the cost of raw inputs, revenue at base price, and daily profit at full utilisation net of all chain maintenance.
- [ ] **Step 1: Write failing balance tests** in `balance.test.ts`:
  - `every 1900 chain is profitable at full utilisation`.
  - `reference strategy grows money`: the Task 17 headless furniture + bread strategy over 5 years ends with money between 1.5× and 5× the starting money. Too low means the economy is broken; too high means it is trivial.
  - `rival does not bankrupt itself in 20 years`.
  - `100-year headless run completes under 20 s with no exceptions and victory emitted`.
- [ ] **Step 2:** Run `npx vitest run src/sim/balance.test.ts`. Expected: FAIL or PASS. Tune constants until all pass, never weakening a test's bounds.
- [ ] **Step 3:** Implement the tutorial and the chain report.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: tutorial and economy balance pass`.

---

### Task 30: Deploy & final verification

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: the finished game.
- Produces: a multi-stage `Dockerfile` (`node:18-alpine` runs `npm ci && npm run build`, then `nginx:1.27-alpine` serves `dist/` with gzip and long-cache asset headers); `docker-compose.yml` service `smokestack` mapping `8080:80`; a README with pitch, features, controls, how to run (dev and `docker compose up -d --build`) and an architecture summary.
- [ ] **Step 1:** Run `npm test && npm run build`. Expected: all PASS, `dist/` created.
- [ ] **Step 2:** Run `docker compose up -d --build && curl -s -o /dev/null -w "%{http_code}" http://localhost:8080`. Expected: `200`.
- [ ] **Step 3: Full manual playthrough** via the `run` skill with screenshots. Check the menu; start Free Play; follow the tutorial to the first sale; jump with 8× speed to 1910 (car invention news); check the newspaper; check that the rival has built something; check the finance charts; save, reload and confirm the state is identical; confirm the colour grading has warmed toward technicolor by the 1960s.
- [ ] **Step 4:** Run `docker compose down`.
- [ ] **Step 5:** Commit `chore: docker compose deployment and README`.
