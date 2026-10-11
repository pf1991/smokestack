# SMOKESTACK II Phase 0: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the v1 codebase for v2 features without changing gameplay. The work covers save versioning and migrations, generic company ownership, an ownership-transfer funnel, per-tile numeric layers, a spatial index, split oversized files, determinism and century soak checks, and a screenshot script.

**Architecture:** Every change is either a pure refactor or a new module under `src/sim` with its own tests. Gameplay output stays identical. A determinism test pins that, and the existing 422 tests must keep passing unchanged, apart from import paths.

**Tech Stack:** TypeScript 5.6 strict, Vite 5.4, Vitest 2.1 + jsdom, tsx scripts, headless Chrome for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-11-smokestack-v2-design.md` (sections 3, 10, 11 Phase 0).

## Global Constraints

- No runtime dependencies. No asset files. Canvas 2D only.
- `src/sim` stays deterministic: randomness only via `state.rngState`. No `Math.random`, no `Date.now` in sim.
- `GameState` stays plain JSON (no typed arrays, Maps or class instances inside it).
- Keep v1 invariant funnels:
  - `invalidatePaths` is called by buildRoad/removeRoad/buildRail/removeRail.
  - `sellVehicle` is the only vehicle deleter.
  - `pollutionDay` is the only writer of tile pollution.
  - Vehicle path arrays are never mutated in place.
- Registries stay append-only: `SYSTEMS`, `OVERLAYS`, `PANELS`.
- Use `docker compose` (never `docker-compose`).
- After merging into main, or after `npm install`, run `chown -R freire:freire /home/freire/projects/industry`.
- Avoid wall-clock timing assertions in unit tests.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (decided here)

- **Migrations location:** migrations live in `src/sim/migrations.ts`, not `src/game/migrations.ts`, because `deserialize` is in `src/sim/simulation.ts` and sim must not import from game.
- **Tile storage:** the `Tile[]` object array stays as it is. The spec's "TileGrid typed arrays" becomes **per-tile numeric layers**: `state.layers`, plain `number[]`, packed in saves. That's what Phase 3 smog needs. Converting all 61 `tiles[...]` access sites gives no measured gain on a 128×96 map.
- **Literal company keys stay valid:** `state.companies.player` and `state.companies.rival` keep working because the player id stays `'player'` and the Baron id stays `'rival'`. Only loops over companies and save packing must become generic.

## Review Focus

1. **Loading a v1 save:** a slot saved by SMOKESTACK I (version 1) shows "Save from SMOKESTACK I cannot be loaded in this version". The menu's load list does not crash. Pinned in Task 3.
2. **A save containing a company id other than player/rival** (a regional firm or a future heir) packs and unpacks with its road/rail ownership intact. Pinned in Task 4.
3. **Save → load → continue gives the same game as never saving.** No module cache (path memo, fleet order, polluted-tile set, spatial index) may change results after a load. Pinned in Task 8.
4. **The takeover still works end to end** after it moves onto `transferOwnership`: Baron buildings, routes, vehicles and tiles become the player's, and the Baron's AI stops. Pinned in Task 5.
5. **A building placed or demolished mid-game is seen by the spatial index on the same tick.** Pinned in Task 7.

---

### Task 1: Split `src/sim/rival.ts` into a folder

**Files:**
- Create: `src/sim/rival/index.ts` (re-exports the public API, plus `rivalMonth`)
- Create: `src/sim/rival/chains.ts` (rival.ts "chains" section, lines 46–114)
- Create: `src/sim/rival/takeover.ts` ("valuation & takeover", 115–174)
- Create: `src/sim/rival/market.ts` ("market reading", 175–297)
- Create: `src/sim/rival/projects.ts` ("project execution", 298–635)
- Create: `src/sim/rival/railways.ts` ("railways", 636–1025)
- Create: `src/sim/rival/taunts.ts` ("taunts", 1026–end)
- Create: `src/sim/rival/shared.ts` (constants and flag helpers used by more than one section, lines 1–45)
- Delete: `src/sim/rival.ts`
- Test: `src/sim/rival.test.ts` stays where it is. Its import `./rival` resolves to `./rival/index.ts`.

**Interfaces:**
- Produces: every symbol `src/sim/rival.ts` exports today, exported from `src/sim/rival/index.ts` with the same names and signatures.

- [ ] **Step 1:** Run `npm test` and record the pass count as the baseline (expected: 422 passed).
- [ ] **Step 2:** Move each section verbatim into its file. Add imports between the new files. Move nothing else. No module may exceed 400 lines, and no circular import may exist between the new files (`shared.ts` imports only from outside the folder).
- [ ] **Step 3:** Run `npx tsc --noEmit && npm test`. Expected: no type errors and the same pass count as Step 1.
- [ ] **Step 4:** Run `grep -rn "from '.*sim/rival'" src` and confirm that every importer still compiles. It needs no edits.
- [ ] **Step 5: Commit** with `refactor(sim): split rival.ts into rival/ modules`.

### Task 2: Split `src/render/world.ts` into a folder

**Files:**
- Create: `src/render/world/index.ts` (the `WorldRenderer` class, `Ghost`, `Selection`; re-exports the module's current public API)
- Create: `src/render/world/roads.ts` (`roadMask`, `roadEra`, `hasLamp`, `paintRoadTile`, `paintBridgeTile`)
- Create: `src/render/world/rails.ts` (`paintRailTile` and its constants)
- Create: `src/render/world/glows.ts` (`getLampGlow`, `getHouseGlow`, `getWindowGlow`, `chimneysOf`, `paintGardenTree`, and their caches)
- Create: `src/render/world/vehicles.ts`. It holds the bodies of `vehiclePose`, `drawVehicles`, `trainPolyline`, `sampleBack` and `drawTrainConsist`, as functions that take the renderer's state as explicit parameters.
- Create: `src/render/world/selection.ts` (the bodies of `drawPick`, `drawSelection`, `ghostBounds`, `drawGhost`, `drawGhostLabel`)
- Delete: `src/render/world.ts`
- Test: `src/render/world.test.ts` stays. Its import `./world` resolves to `./world/index.ts`.

**Interfaces:**
- Produces: the exports of `src/render/world.ts` today (`WorldRenderer`, `Ghost`, `Selection`, `roadMask`, `roadEra`, `hasLamp`, `DIESEL_YEAR`, `FLOAT_FLUSH_MS`) from `src/render/world/index.ts`.

- [ ] **Step 1:** Move the code as listed. `WorldRenderer` private methods become thin calls into the new modules. Do not change drawing order, constants or caching. `index.ts` must be ≤ 600 lines.
- [ ] **Step 2:** Run `npx tsc --noEmit && npm test`. Expected: same pass count as the Task 1 baseline.
- [ ] **Step 3:** Run `npm run dev`, then open `http://localhost:5173/?seed=7&autoplay=1&hour=21` in headless Chrome. Save a screenshot, then compare it visually with one from `git stash` of this task. Roads, rails, trucks, train wagons and lit windows must look identical.
- [ ] **Step 4: Commit** with `refactor(render): split world.ts into world/ modules`.

### Task 3: Save version 2, migrations, pack/unpack split

**Files:**
- Create: `src/sim/migrations.ts`
- Modify: `src/sim/simulation.ts`. `SAVE_VERSION` becomes `2`, and `deserialize` calls `migrateSave` before `isComplete`.
- Modify: `src/sim/types.ts`. `GameState.version` becomes `number`.
- Modify: `src/sim/state.ts`. `createGame` sets `version: SAVE_VERSION`.
- Modify: `src/game/saves.ts`. Extract `packState` and `unpackState`; `saveTo` and `loadFrom` call them.
- Test: `src/sim/migrations.test.ts`, `src/game/saves.test.ts`

**Interfaces:**
- Produces:
  - `export const MIN_SAVE_VERSION = 2` (in migrations.ts)
  - `export interface Migration { from: number; migrate(o: Record<string, unknown>): void }`. A migration upgrades from `from` to `from + 1`.
  - `export const MIGRATIONS: Migration[]` (empty for now; later phases append)
  - `export function migrateSave(o: Record<string, unknown>, migrations?: Migration[], current?: number): Result<Record<string, unknown>>`. The defaults are `MIGRATIONS` and `SAVE_VERSION`. It mutates `o` and sets `o.version` to `current`.
  - `export function packState(state: GameState): string` and `export function unpackState(raw: string): Result<GameState>` (in saves.ts)

- [ ] **Step 1: Write the failing tests** in `migrations.test.ts`:
```ts
it('rejects a SMOKESTACK I save', () => {
  expect(migrateSave({ version: 1 })).toEqual(err('Save from SMOKESTACK I cannot be loaded in this version'));
});
it('rejects a save from a newer version', () => {
  expect(migrateSave({ version: 99 })).toEqual(err('Save from a newer version of SMOKESTACK'));
});
it('rejects a non-numeric version', () => {
  expect(migrateSave({ version: 'x' })).toEqual(err('Save file is corrupted'));
});
it('applies migrations in order up to current', () => {
  const seen: number[] = [];
  const ms: Migration[] = [3, 2].map((from) => ({ from, migrate: (o) => { seen.push(from); o[`m${from}`] = true; } }));
  const r = migrateSave({ version: 2 }, ms, 4);
  expect(seen).toEqual([2, 3]);
  expect(r.ok && r.value).toMatchObject({ version: 4, m2: true, m3: true });
});
it('fails when a migration step is missing', () => {
  expect(migrateSave({ version: 2 }, [], 3)).toEqual(err('Save from an incompatible version'));
});
```
In `saves.test.ts`, add: `unpackState(packState(createGame({seed: 7})))` deep-equals the original. Also, a slot holding `JSON.stringify({ version: 1, ... })` makes `loadFrom` return the SMOKESTACK I error, and `listSaves()` skips that slot without throwing.
- [ ] **Step 2:** Run `npx vitest run src/sim/migrations.test.ts src/game/saves.test.ts`. Expected: FAIL (module not found, or `packState` missing).
- [ ] **Step 3:** Implement as specified. `migrateSave` checks, in this order: version not an integer, then `< MIN_SAVE_VERSION`, then `> current`, then it walks the migrations. Run `npx vitest run` on the same files. Expected: PASS.
- [ ] **Step 4:** Run `npm test`. Fix every test that hard-codes `version: 1` so that it uses `SAVE_VERSION`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat(saves): save version 2 with migration pipeline`.

### Task 4: Generic company ownership

**Files:**
- Create: `src/sim/companies.ts`
- Modify: `src/sim/types.ts`. `OwnerId = string`; add `CompanyKind`; `Company.kind: CompanyKind`; `companies: Record<OwnerId, Company>`.
- Modify: `src/sim/state.ts` (`createGame` sets `kind`)
- Modify: `src/sim/production.ts:141` and `src/render/spritesPreview.ts:16` (loops over `['player','rival']` become `companyIds(state)`)
- Modify: `src/sim/systems.ts:31` (use `companyIds(state)`)
- Modify: `src/render/sprites.ts:24`. `OWNER_COLOR` stays for the two existing ids. Add `ownerColor(id)`, and route every `OWNER_COLOR[...]` read through it.
- Modify: `src/game/saves.ts`. The fixed `OWNERS` table becomes a per-save owner table.
- Test: `src/sim/companies.test.ts`, `src/game/saves.test.ts`, `src/render/sprites.test.ts`

**Interfaces:**
- Consumes: `packState` and `unpackState` (Task 3).
- Produces (in `src/sim/companies.ts`):
  - `export type CompanyKind = 'player' | 'baron' | 'regional'` (defined in types.ts, re-exported)
  - `export const PLAYER_ID: OwnerId = 'player'`, `export const BARON_ID: OwnerId = 'rival'`
  - `export function playerCompany(state: GameState): Company` and `export function baronCompany(state: GameState): Company`
  - `export function companyIds(state: GameState): OwnerId[]`: player first, then Baron, then the rest sorted by id
  - `export function addCompany(state: GameState, c: Omit<Company, 'ledger' | 'monthsInRed' | 'roadTiles' | 'railTiles' | 'active'>): Company`. It fills zeroed fields and `active: true`. It throws if the id already exists.
- Produces (in `src/render/sprites.ts`): `export function ownerColor(id: OwnerId): string`. It returns the existing colours for `'player'` and `'rival'`, and otherwise `REGIONAL_COLORS[hash(id) % REGIONAL_COLORS.length]` with `REGIONAL_COLORS = ['#3f8f5a', '#8a5aa8', '#c07a2a']`.
- Save format: the packed map carries `owners: string[]`. Packed tile slots 3 and 4 index into it (with `-1` meaning null). Because unpack reads the table from the save, any id round-trips.

- [ ] **Step 1: Write the failing tests:**
  - After `addCompany` of `r_b` then `r_a`, `companyIds(state)` equals `['player','rival','r_a','r_b']`.
  - `addCompany` with an existing id throws.
  - Saves: add company `r_a`, set `roadOwner = 'r_a'` on 3 tiles, then `unpackState(packState(s))` keeps `'r_a'` on exactly those tiles.
  - `ownerColor('player') === '#2f6fb5'`. `ownerColor('r_a')` is one of `REGIONAL_COLORS` and is stable across calls.
  - Finance: a state with an extra regional company closes the month for all three companies without emitting `gameOver` for the regional one.
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3:** Implement the changes. `isComplete` in simulation.ts still requires `companies.player` and `companies.rival`.
- [ ] **Step 4:** Run `npx tsc --noEmit && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat(sim): generic company ids with player/baron/regional kinds`.

### Task 5: `transferOwnership` funnel and funnel guard test

**Files:**
- Modify: `src/sim/companies.ts` (add `transferOwnership`)
- Modify: `src/sim/rival/takeover.ts` (`takeover` calls `transferOwnership` instead of its own loops)
- Modify: `src/core/events.ts` (new event `{ type: 'ownershipChanged'; from: OwnerId; to: OwnerId }`)
- Modify: `src/render/world/index.ts` (`attachEffects` invalidates all chunks on `ownershipChanged`)
- Create: `src/sim/funnels.test.ts`
- Test: `src/sim/companies.test.ts`, `src/sim/rival.test.ts` (the existing takeover tests must pass unchanged)

**Interfaces:**
- Produces: `export function transferOwnership(ctx: SimContext, from: OwnerId, to: OwnerId): { buildings: number; routes: number; vehicles: number; roadTiles: number; railTiles: number }`
  - It moves every building, route, vehicle, tile `roadOwner` and tile `railOwner` from `from` to `to`.
  - It adds `from`'s `roadTiles` and `railTiles` counts to `to` and zeroes them on `from`.
  - It emits `ownershipChanged`.
  - It does not touch money, loans or `active`; the caller decides those.

- [ ] **Step 1: Write the failing tests:**
  - Set up a state where the Baron owns 2 buildings, 1 route, 2 vehicles, 5 road tiles and 3 rail tiles. After `transferOwnership(ctx, 'rival', 'player')`, the return is `{buildings:2, routes:1, vehicles:2, roadTiles:5, railTiles:3}`, no asset has `ownerId === 'rival'`, `companies.rival.roadTiles === 0`, and exactly one `ownershipChanged` event was emitted.
  - In `funnels.test.ts`, read every non-test `.ts` file under `src/sim` recursively with `node:fs` and assert:
    - matches of `/\.ownerId\s*[-+*/]?=(?!=)/` occur only in `companies.ts`;
    - `/\b(roadOwner|railOwner)\s*=(?!=)/` occurs only in the allowlist (run `grep -rnE "(roadOwner|railOwner)\s*=[^=]" src/sim` now, put the resulting files in the list, and add `companies.ts`);
    - `/delete\s+state\.vehicles\[/` occurs only in `vehicles.ts`;
    - `/\.pollution\s*[-+*/]?=(?!=)/` (catches `+=` too) occurs only in `pollution.ts`.
- [ ] **Step 2:** Run the tests. Expected: `transferOwnership` FAILS. The funnel test FAILS on `rival/takeover.ts`.
- [ ] **Step 3:** Implement `transferOwnership` and rewrite `takeover` to use it. Run `npx vitest run src/sim`. Expected: PASS, including the existing takeover tests.
- [ ] **Step 4: Commit** with `feat(sim): transferOwnership funnel and source-level funnel guard`.

### Task 6: Per-tile numeric layers

**Files:**
- Create: `src/sim/layers.ts`
- Modify: `src/sim/types.ts`. Add `layers: Record<LayerId, number[]>` to `GameState`.
- Modify: `src/sim/state.ts` (`createGame` sets `layers: {}`)
- Modify: `src/game/saves.ts`. `packState` and `unpackState` pack each layer with `packLayer` and `unpackLayer`.
- Modify: `src/sim/simulation.ts`. `isComplete` requires `layers` to be an object; each layer's length must equal `width*height` after unpacking.
- Test: `src/sim/layers.test.ts`, `src/game/saves.test.ts`

**Interfaces:**
- Produces:
  - `export type LayerId = string`
  - `export function layer(state: GameState, id: LayerId): number[]`. It returns the layer, creating a zero-filled array of `width*height` on first use.
  - `export function layerAt(state: GameState, id: LayerId, x: number, y: number): number`. It returns 0 out of bounds or for a missing layer, and never creates one.
  - `export function packLayer(a: number[]): number[]`. Values are rounded to 3 decimals. A run of `k ≥ 2` zeros is encoded as the pair `-1, k`; any other value is written as-is (layers hold non-negative values only).
  - `export function unpackLayer(p: number[], n: number): number[]`. It throws `Error('bad layer')` if the decoded length ≠ `n` or a value is negative and not a `-1` marker.

- [ ] **Step 1: Write the failing tests:**
  - `unpackLayer(packLayer(a), a.length)` equals `a` rounded to 3 decimals, for a random 12,288-cell array that is 90% zeros.
  - The packed length is < 20% of the input for that array.
  - `layer(state,'smog')` is created once (the same reference on a second call), and `layerAt` out of bounds returns 0.
  - `unpackLayer([-1, 5], 4)` throws.
  - In saves, a state with a `'smog'` layer round-trips, and a corrupted layer makes `loadFrom` return `'Save file is corrupted'`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `npx tsc --noEmit && npm test`. Expected: all pass.
- [ ] **Step 4: Commit** with `feat(sim): per-tile numeric layers with compact save packing`.

### Task 7: Spatial index

**Files:**
- Create: `src/sim/spatial.ts`
- Modify: `src/sim/state.ts` (`placeBuilding` and `demolishBuilding` call `invalidateSpatial(state)`)
- Modify: `src/sim/funnels.test.ts`. Every function in `src/sim` that assigns `state.buildings[` or deletes from it must live in `state.ts`.
- Test: `src/sim/spatial.test.ts`

**Interfaces:**
- Produces:
  - `export const BUCKET = 8` (tiles per bucket side)
  - `export function buildingsNear(state: GameState, center: Vec2, radius: number, owner?: OwnerId): Building[]`. It returns buildings whose footprint centre is within Euclidean `radius` tiles of `center`, sorted by `id` ascending.
  - `export function citiesNear(state: GameState, center: Vec2, radius: number): City[]`, using `city.center`, sorted by `id`.
  - `export function invalidateSpatial(state: GameState): void`
  - The index is module-level in a `WeakMap<GameState['buildings'], Index>`, so a loaded save (a new `buildings` object) is rebuilt automatically.

- [ ] **Step 1: Write the failing tests:**
  - On `createGame({seed: 7})` with 40 buildings placed by the test kit, 200 random `(center, radius ∈ [1, 30])` queries equal a brute-force filter-and-sort.
  - A building placed after the first query appears in the next query.
  - A demolished building disappears from the next query.
  - The owner filter returns only that owner.
  - Radius 0 on an empty tile returns `[]`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `npx vitest run src/sim`. Expected: PASS.
- [ ] **Step 4: Commit** with `feat(sim): bucketed spatial index for buildings and cities`.

### Task 8: Determinism hash, invariants, century soak

**Files:**
- Create: `src/sim/hash.ts`
- Create: `src/sim/invariants.ts`
- Create: `src/sim/determinism.test.ts`
- Create: `scripts/soak.ts`
- Modify: `package.json` (script `"soak": "tsx scripts/soak.ts"`)
- Test: `src/sim/invariants.test.ts`

**Interfaces:**
- Consumes: `packState` and `unpackState` (Task 3), and `runAutoplay` (`src/game/autoplay.ts`).
- Produces:
  - `export function stateHash(state: GameState): string`: FNV-1a 32-bit, as 8 hex digits, over `serialize({ ...state, speed: 0 })`.
  - `export function checkInvariants(state: GameState): string[]`: messages for violated invariants, empty when the state is healthy. It checks:
    - every company's `money` and `loan` are finite;
    - every city population is an integer in `[500, POP_CAP]`;
    - every vehicle's `routeId` is null or an existing route;
    - every route stop references an existing building;
    - every building's footprint tiles are in bounds and have `buildingId === b.id`;
    - every layer's length equals `width*height`.
- CLI: `npm run soak -- --seeds 7,42,1234 --years 100`. Per seed it runs `createGame`, `runAutoplay` (player chain) and the yearly `runDays(ctx, 360)` until 1 Jan 2001 or game over. It calls `checkInvariants` each year, and prints `seed | final year | player net worth | baron net worth | ms`. It exits with code 1 on any invariant message.

- [ ] **Step 1: Write the failing tests:**
  - `invariants.test.ts`: a fresh game returns `[]`. Setting `companies.player.money = NaN` returns one message containing `player`. Pointing a vehicle at route 999 returns one message containing `999`.
  - `determinism.test.ts`:
    - Two independent runs of seed 7 (createGame, runAutoplay, `runDays` 720) give an equal `stateHash`; seed 8 differs.
    - **Load continuity:** run A runs 720 days straight. Run B runs 360 days, does `unpackState(packState(state))` with a **new bus**, then runs 360 more days. Their `stateHash` values are equal.
- [ ] **Step 2:** Run `npx vitest run src/sim/invariants.test.ts src/sim/determinism.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. If load continuity fails, the cause is a module-level cache that a load must reset. Fix that cache's invalidation, never the test.
- [ ] **Step 4:** Run `npm run soak -- --seeds 7 --years 10`. Expected: exit 0, one result line.
- [ ] **Step 5:** Run `npm run soak -- --seeds 7,42,1234 --years 100` and record the per-seed ms in the commit body. Expected: exit 0.
- [ ] **Step 6: Commit** with `test(sim): determinism hash, invariant checker and century soak script`.

### Task 9: Screenshot matrix script

**Files:**
- Modify: `src/main.ts`. Add dev-only debug params `skipYears=<n>` (after autoplay, `runDays(setup, n * 360)` on the setup bus) and `zoom=<0.5..3>` (camera zoom in the start callback). Add both to `DEBUG_KEYS` and the doc comment.
- Create: `scripts/shots.sh`
- Modify: `.gitignore` (add `shots/`)

**Interfaces:**
- CLI: `scripts/shots.sh [port]` (default 5199).
  - It starts `npx vite --port <port> --strictPort` in the background and waits until it answers.
  - For each size in `1366,768 1920,1080`, each `skipYears` in `0 25 55 85` and each `zoom` in `0.5 1 2`, it runs `google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=8000 --window-size=<size> --screenshot=shots/<w>-y<skip>-z<zoom>.png "http://localhost:<port>/?seed=7&autoplay=1&speed=1&skipYears=<skip>&zoom=<zoom>"`.
  - It kills the server on exit (`trap`), and prints the count of PNGs written (expected 24).

- [ ] **Step 1:** Add the params. Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 2:** Write the script and run `bash scripts/shots.sh`. Expected: `24 screenshots written`, every file > 50 KB.
- [ ] **Step 3:** Open `shots/1366-y55-z1.png` and `shots/1920-y85-z2.png` with the Read tool. Check that the world is rendered (not a blank canvas) and the date in the HUD reads 1955 and 1985.
- [ ] **Step 4: Commit** with `chore: screenshot matrix script and skipYears/zoom debug params`.

### Task 10: Phase 0 gate: fixture save, full verification, Docker

**Files:**
- Create: `scripts/make-fixture.ts` (args `--name <phase> --seed 7 --days 720`). It runs createGame, runAutoplay and runDays, then writes `packState(state)` to `src/sim/__fixtures__/<name>.save.json`.
- Create: `src/sim/__fixtures__/phase0.save.json` (generated)
- Create: `src/sim/fixtures.test.ts`
- Modify: `package.json` (script `"fixture": "tsx scripts/make-fixture.ts"`)

**Interfaces:**
- Consumes: `unpackState` (Task 3), `checkInvariants` (Task 8).

- [ ] **Step 1: Write the test.** For every `*.save.json` in `src/sim/__fixtures__`:
  - `unpackState` succeeds;
  - `checkInvariants` returns `[]`;
  - after `runDays(ctx, 30)`, `checkInvariants` still returns `[]`.
- [ ] **Step 2:** Run `npm run fixture -- --name phase0`, then `npx vitest run src/sim/fixtures.test.ts`. Expected: PASS.
- [ ] **Step 3:** Run `npm test && npm run build`. Expected: all tests pass, and the build succeeds with no type errors.
- [ ] **Step 4:** Run `docker compose up -d --build`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/`. Expected: `200`.
- [ ] **Step 5: Commit** with `test: phase 0 fixture save and gate`, then run `chown -R freire:freire /home/freire/projects/industry`.
- [ ] **Step 6:** Report to the owner: test count, soak timings, and the confirmation that the game plays identically. Wait for phase approval before starting Phase 1.
