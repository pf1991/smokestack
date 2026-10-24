# SMOKESTACK II Phase 4b: Logistics, Upgrades and Managers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Works that can be upgraded to levels 2–4, truck models by era with upgrade kits, automatic routes with auto-sizing, warehouse hubs that distribute goods within a range with their own fleets, and managers hired from an open market whose skill decides how well hubs dispatch. The Baron and the regional firms use all of it.

**Architecture:**
- All new sim code lives in `src/sim/logistics/`, written only through its own functions. Data tables live in `src/data/levels.ts`, `src/data/vehicleModels.ts` and `src/data/managers.ts`.
- Level-scaled values (rate, workers, upkeep, storage, smoke, hub range) come from one module, `src/sim/logistics/levels.ts`. Every existing reader of `BUILDINGS[t].storage`/`.workers`/`.pollution`/`.maintenance` for a placed building goes through it.
- Hub trucks and auto-route trucks use the existing vehicle state machine. A hub truck's two-stop trip is built from its saved `job` by a leaf module (`logistics/jobRoute.ts`), and an auto truck picks its next stop from a job board saved on the route and rebuilt daily.
- One system is appended to `SYSTEMS`: `{ id: 'logistics', onDay: logisticsDay, onMonth: logisticsMonth, onYear: logisticsYear }`. Every new state field is added by one save migration `{ from: 7 }`, which bumps `SAVE_VERSION` to 8. Task 1 creates it, and later tasks extend it until the phase merges.

**Tech Stack:** TypeScript 5.6 strict, Canvas 2D, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-18-v2-phase4b-logistics-design.md` (rulings R1–R5 and D1–D11, the level, model, skill and salary tables). Owner brief: `docs/superpowers/specs/2026-10-17-logistics-and-upgrades-brief.md`.

## Global Constraints

- Work in `/home/freire/projects/industry/.claude/worktrees/v2-phase4b` on branch `v2/phase4b` (base `69d8d86`). Never `cd` into the main checkout. Never push.
- No runtime dependencies or asset files. Canvas 2D only. No emoji anywhere in `src`. Icons come from the atlas (`src/render/icons.ts`); this phase adds `manager` and `hub` painters.
- `src/sim` is deterministic. Use only seeded rng: the state rng (`src/sim/rng.ts`), and for the manager market its own stream `state.logistics.rngState` (seeded from the game seed, like the exchange's). Iterate in array or id order (`companyIds` for companies; buildings, routes, vehicles and managers by ascending id). Break every tie by id. Never iterate an unordered `Map`/`Set`/object where the order changes the result.
- Money is authored in 1900 dollars and charged at `atPrices(state, x)` (`src/sim/society/economy.ts`). Card costs go through `choiceCost`. Soak money comparisons use `realMoney`.
- Funnels kept: `transferOwnership` is the only way assets change company; `adjustOpinion` the only writer of faction opinion; `sellVehicle` the only vehicle deleter; `smogDay` the only writer of tile pollution; `builtYear` reassigned only in `society/aging.ts` and migrations; and every other funnel in `src/sim/funnels.test.ts`.
- New funnels, each pinned in `src/sim/funnels.test.ts` (Tasks 2, 3, 5, 6):
  - building `level`/`works` written only by `logistics/levels.ts` (and `migrations.ts`);
  - vehicle `model`/`speed` written only by `vehicles.ts` and `logistics/models.ts` (and `migrations.ts`);
  - manager `employer`/`post`/`salary` written only by `logistics/managers.ts`, `logistics/release.ts` and `companies.ts`;
  - vehicle `job`/`hubId` written only by `logistics/hubs.ts`, `logistics/jobRoute.ts`, `logistics/autoRoutes.ts` and `logistics/release.ts`.
- `GameState` stays plain JSON. `SAVE_VERSION` becomes 8 with one `{ from: 7 }` migration. The `phase0`–`phase4` fixtures must load, pass `checkInvariants` and run a year (360 days). Task 10 adds `phase4b` with `npm run fixture -- --name phase4b --days 18000`.
- Registries are append-only and never reordered: `SYSTEMS`, `PANELS`, `MIGRATIONS`, `RETALIATION_KINDS`, `CardTrigger`, card ids, `LedgerCategory`, `BuildingStatus`, `GameEvent`, `NewsKind`, `SHORTCUTS`, menu `GROUPS` items.
- UI follows the overhaul conventions: side-panel tabs through `createWindow` (pass `tabTitle` when the title is longer than one word), the shared `.p-row`/`.p-section`/`.p-head` density classes and no inline font sizes (`src/ui/panels/density.test.ts`), a `SHORTCUTS` entry for every menu panel or an exemption in `src/ui/menuDrift.test.ts`, and screenshots at 1366 and 1920.
- Performance:
  - Dispatch and job boards run daily, greedily, with Manhattan distances. No pathfinding during planning, no per-tick planning.
  - Base measurement (Task 1): in a temporary worktree of `69d8d86` (`git worktree add --detach /home/freire/projects/industry/.claude/worktrees/phase4b-base 69d8d86`, then `npm ci` there), run `perf stat -e instructions:u -x, npx tsx scripts/soak.ts --seeds 42 --years 101` 3 times and keep the median. Remove the worktree after Task 10.
  - Gate: the same command on this branch must stay within 1.25× of that median (Tasks 6, 8, 9, 10).
  - The 100-year test in `src/sim/balance.test.ts` stays under its 21 s CPU limit. Report its `cpu=` line in every task that touches daily or per-tick code (Tasks 1, 3, 4, 6, 7, 8, 9).
- The century soak (seeds 7, 42, 1234, `--years 101`) ends in 2001 with victory, not game over, and stays solvent. Autoplay uses the new features only through the public API (`autoplayLogistics`, Task 9).
- Use `docker compose`. Run `chown -R freire:freire /home/freire/projects/industry/.claude/worktrees/v2-phase4b` after `npm ci`/`npm install` and at the end of every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A hub never loses a truck or its cargo.** When a hub's warehouse is demolished or its job's other building disappears mid-trip, the truck is released or sent home, never deleted, and cargo on board goes back into the hub or stays on the released truck. On a takeover, hub trucks, hubs and their jobs move with the warehouse. Pinned in Task 6.
2. **An automatic route never deadlocks or spins.** With no job, a truck waits at its stop and rechecks daily, and never drives an empty leg. Cargo with nowhere to go waits at an unloading stop instead of looping. A stop removed or edited mid-job drops the jobs that name it at the next daily rebuild. A route cut below two stops idles as manual routes do. Pinned in Task 4.
3. **Works in progress survive everything.** An upgrade in progress survives save and load, a strike, sabotage and a takeover. The same day count finishes it. Demolishing a building mid-works charges no further cost. A second upgrade cannot be started while one runs. Pinned in Task 2.
4. **Managers leave cleanly.** Firing, retiring, quitting and poaching all clear the post at once. The hub stops dispatching from the next day and its inspector says why. Salary stops from the month after they leave, and severance is charged once. A manager is never employed by two companies. A raise card whose manager has left resolves with no effect. Pinned in Tasks 5 and 8.
5. **Automatic spending is bounded.** Route and hub auto-sizing never buy below the $20,000 (1900 $) reserve or above the cap, never sell the last truck and change at most one truck per month. AI upgrades and hubs respect each company's reserve. A company in the red buys nothing automatically. Pinned in Tasks 4, 7 and 8.

---

### Task 1: Save v8, the logistics state and level plumbing

**Files:**
- Create:
  - `src/sim/logistics/types.ts`;
  - `src/sim/logistics/levels.ts` (effect helpers only; the upgrade action comes in Task 2);
  - `src/data/levels.ts`;
  - `src/sim/logistics/index.ts` (`logisticsDay`, `logisticsMonth`, `logisticsYear`, empty for now).
- Modify:
  - `src/sim/types.ts`: `Building.level`, `Building.works?`, `Building.hub?`, `BuildingStatus` + `'upgrading'`, `Vehicle.model`, `Vehicle.speed`, `Vehicle.kits?`, `Vehicle.hubId?`, `Vehicle.job?`, `Vehicle.dwell?`, `Route.mode`, `Route.autoSize?`, `Route.jobs?`, `Route.stats?`, `RouteStop.minLoad?`, `GameState.logistics`, and `LedgerCategory` + `'salaries'`;
  - `src/sim/state.ts`: `placeBuilding` sets `level: 1`; `createGame` creates `logistics`;
  - `src/sim/vehicles.ts`: `buyVehicle` sets `model`/`speed`; `createRoute` sets `mode: 'manual'`;
  - `src/sim/version.ts`: 8;
  - `src/sim/migrations.ts`: `{ from: 7 }`;
  - `src/sim/systems.ts`: append `{ id: 'logistics', onDay: logisticsDay, onMonth: logisticsMonth, onYear: logisticsYear }`;
  - `src/sim/invariants.ts`.
  - Level readers:
    - `src/sim/production.ts` (rate and storage caps);
    - `src/sim/inventory.ts` (`storageLeft`);
    - `src/sim/politics/workforce.ts` (need);
    - `src/sim/politics/factions.ts` (the `workers > 0` filter);
    - `src/sim/pollution.ts` (`emissionFactor`);
    - `src/sim/society/upgrades.ts` (`buildingMaintenance`);
    - `src/sim/rival/projects.ts`, `src/sim/rival/railways.ts` and `src/sim/events.ts` (storage caps);
    - `src/ui/panels/building.ts` (storage bars).
- Test: `src/sim/logistics/levels.test.ts`, `src/sim/migrations.test.ts`

**Interfaces:**
- Produces in `src/sim/logistics/types.ts`:
  ```ts
  export type BuildingLevel = 1 | 2 | 3 | 4;
  export interface BuildingWorks { toLevel: BuildingLevel; startDay: number; untilDay: number }
  export type Skill = 1 | 2 | 3 | 4 | 5;
  export interface ManagerSkills { logistics: Skill; production: Skill; frugality: Skill }
  export interface Manager {
    id: number; name: string; born: number; skills: ManagerSkills;
    salary: number;                 // 1900 $ per month
    employer: OwnerId | null;       // null while on the market
    post: number | null;            // building id
    hiredYear: number | null; lastRaiseYear: number | null;
  }
  export type HubJobKind = 'collect' | 'deliver' | 'balance' | 'return';
  export interface HubJob { kind: HubJobKind; from: number; to: number; good: GoodId | null; qty: number }
  export interface HubState {
    autoSize: boolean; maxTrucks: number; nextDispatchDay: number;
    month: { jobs: number; idleTruckDays: number; backlogDays: number };
    yesterday: { jobs: number; idle: number };
  }
  export interface AutoJob { from: number; to: number; good: GoodId; qty: number; score: number }
  export interface LogisticsState {
    managers: Manager[];            // employed by some company, ascending id
    market: Manager[];              // candidates, employer null
    marketYear: number;
    nextManagerId: number;
    rngState: number;               // the market's own stream
    rev: number;                    // bumped by every write to managers/posts (post-index cache key)
    raiseAsk: number | null;        // manager id with an open raise card
    stats: {
      hubJobs: Record<OwnerId, number>; upgrades: Record<OwnerId, number>;
      hires: Record<OwnerId, number>; retirements: number; autoLoaded: Record<OwnerId, number>;
    };
  }
  export function newLogistics(seed: number, year: number): LogisticsState; // market empty until Task 5
  ```
  Also `VehicleModelId = 'steam_lorry' | 'motor_truck' | 'diesel_truck' | 'articulated' | 'train'`, `VehicleKits = { body: boolean; engine: boolean }`, `RouteMode = 'manual' | 'auto'`, `AutoSize = { on: boolean; maxTrucks: number }` and `RouteStats = { loaded: number; empty: number; backlogDays: number }`, all re-used by `types.ts`.
- `src/data/levels.ts`: `WORKS_LEVELS` and `WAREHOUSE_LEVELS`, typed `readonly LevelDef[]` and indexed by level − 1, with exactly the spec §4.1 numbers:
  ```ts
  export interface LevelDef {
    level: BuildingLevel; year: number;
    rate: number; workers: number; upkeep: number; storage: number; smoke: number;
    costShare: number; days: number;
    range?: number; hubTrucks?: number;   // warehouses only
  }
  ```
- `src/sim/logistics/levels.ts`:
  - `levelDef(b): LevelDef | null`. It returns the works table for extractors and factories, the warehouse table for `typeId === 'warehouse'`, and null otherwise;
  - `buildingStorage(b): number`;
  - `buildingWorkers(b): number`;
  - `levelRate(b): number`;
  - `levelUpkeep(b): number`;
  - `levelSmoke(b): number`;
  - `hubRange(b): number` (0 for non-warehouses).

  Each is the catalogue value × the level factor, and ×1 when `levelDef` is null.
- Migration `{ from: 7 }`:
  - buildings get `level: 1`;
  - trucks get `model: 'steam_lorry'` and `speed: 0.5`; trains get `model: 'train'` and `speed: 1`;
  - routes get `mode: 'manual'`;
  - `o.logistics = newLogistics(seed, date.year)`.
- Invariants:
  - `level` is an integer within the building's table;
  - `works`, when present, has `untilDay > startDay` and `toLevel === level + 1`;
  - every vehicle `speed` is finite and > 0;
  - `route.mode` is `'manual'` or `'auto'`;
  - manager ids are unique across `managers` and `market`;
  - an employed manager's employer is a company;
  - a `post` names an existing building of that employer;
  - no two managers share a post.

- [ ] **Step 1: Measure the perf baseline.** Create the base worktree and run the median-of-3 `perf stat` command in Global Constraints. Run `npx vitest run src/sim/balance.test.ts` there and note its `cpu=`. Both numbers go in this task's commit body.
- [ ] **Step 2: Write the failing tests** (`levels.test.ts`, `migrations.test.ts`):
  - A placed sawmill is level 1, and `buildingStorage` equals its catalogue storage.
  - A sawmill forced to level 3 (test-only assignment) has storage 120 × 1.8 = 216, workers 60 × 1.6 = 96 and `levelRate` 1.8.
  - A warehouse at level 2 has `hubRange` 16 and storage 1,500. A store has a null `levelDef`.
  - A level-2 extractor's daily yield is ×1.4 of a level-1 twin's over 30 days.
  - `storageLeft` uses the level storage.
  - The v7 `phase4.save.json` migrates to v8 with every building at level 1, every truck a `steam_lorry` at speed 0.5, every route manual and `logistics` present. It passes invariants and plays 360 days.
  - Every fixture `phase0`–`phase4` still loads, passes invariants and plays 360 days.
- [ ] **Step 3:** Run `npx vitest run src/sim/logistics src/sim/migrations.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement.
  - `move()` in `vehicles.ts` reads `veh.speed` where it read `def.spec.speed`, so the hot path still does one property read.
  - Every level reader listed under Files calls the helpers; grep `BUILDINGS\[[^\]]*\]\.(storage|workers)` in `src/sim` and `src/ui` and leave only catalogue uses (placement, the build menu, chain economics).
  - `newLogistics` seeds `rngState` from `seed ^ 0x4c4f4749` ("LOGI").
- [ ] **Step 5:** Run `npm test` and `npm run typecheck`. Expected: PASS. No balance number changes: every level is 1 and every speed equals the old spec. Report the balance test `cpu=`.
- [ ] **Step 6: Commit** with `feat(logistics): save v8, logistics state and level plumbing`. Put the base perf median and the base balance `cpu=` in the body.

### Task 2: Building upgrades and works

**Files:**
- Modify:
  - `src/sim/logistics/levels.ts`: `upgradeCost`, `nextLevel`, `upgradeRefusal`, `startUpgrade`, `worksDay`;
  - `src/sim/logistics/index.ts` (`logisticsDay` calls `worksDay`);
  - `src/sim/production.ts` (`'upgrading'` buildings skip production);
  - `src/sim/society/aging.ts` (`markRenewed(state, b)`, so `builtYear` stays in its funnel);
  - `src/core/events.ts` (`{ type: 'buildingUpgraded'; buildingId: number; level: BuildingLevel; ownerId: OwnerId }`);
  - `src/render/world/index.ts` (static full scaffold while `b.works`; the existing reveal animation on `buildingUpgraded`);
  - `src/ui/panels/building.ts` (mounts the card);
  - `src/sim/funnels.test.ts`.
- Create: `src/ui/panels/buildingLevel.ts` (the upgrade card section)
- Test: `src/sim/logistics/upgrades.test.ts`, `src/ui/panels/inspectors.test.ts`, `src/render/construction.test.ts`

**Interfaces:**
- `upgradeCost(state, b): number` is `round(def.cost × next.costShare × priceIndex)`.
- `nextLevel(b): LevelDef | null` returns the next level, or null at the top.
- `upgradeRefusal(state, b, owner?): string | null`. The refusals are, in this order:
  - 'Not your building';
  - 'This building has no levels';
  - 'Already at the top level';
  - 'Works already under way';
  - `Level ${n} arrives in ${year}`;
  - 'Not enough money'.
- `startUpgrade(ctx, buildingId, owner?): Result<{ cost: number; days: number }>`. It charges `'construction'`, sets `works = { toLevel, startDay: today, untilDay: today + days }`, sets status `'upgrading'` and bumps `logistics.stats.upgrades[owner]`.
- `worksDay(ctx)`: for each building with `works`, in id order, where `today >= untilDay`:
  - `level = toLevel` and `works = null`;
  - `markRenewed(state, b)`;
  - status `'idle'` (production sets the real status the next day);
  - emit `buildingUpgraded`.
- `productionDay` treats `works` like a halt (status `'upgrading'`, no output). It is checked before strikes and halts, so their timers keep running, and smoke stops because only `'ok'` buildings emit.
- Card (`buildingLevel.ts`, `levelCard(host, b): { el: HTMLElement; refresh(): void }`):
  - a `.p-section` with a `.p-head` "Level";
  - two columns, current and next. Works show output per day, workers, upkeep per month, smoke and storage; warehouses show range, storage, hub truck cap and upkeep;
  - the button `Upgrade ${formatMoney(cost)}: ${days} days, output paused`, with the refusal as its title and as muted text;
  - during works, "Upgrading to level N: D days left".
- Funnel regex: `/\.level\s*(?:[-+*/]?=(?!=)|\+\+|--)|\.works\s*=(?!=)/` → `['logistics/levels.ts', 'migrations.ts']`, and nothing outside `src/sim`.

- [ ] **Step 1: Write the failing tests:**
  - Level 2 costs 50% of the build price × the index.
  - Level 3 is refused before 1920 with "Level 3 arrives in 1920". Level 4 is refused before 1950.
  - A works produces nothing for exactly 30 days (level 2), then produces at ×1.4.
  - Upgrading resets `builtYear`.
  - A second `startUpgrade` during works is refused.
  - A strike or a sabotage halt during works leaves `untilDay` unchanged.
  - Works survive `packState` and `unpackState` and finish on the same day.
  - `transferOwnership` mid-works keeps `works` and the new owner gets the level.
  - Demolishing mid-works refunds only the demolition refund.
  - A works under upgrade emits no smoke.
  - The inspector card shows both columns and the refusal text. The density test still passes.
  - `drawConstruction` with `{ scaffold: 1, reveal: 1, done: false }` draws scaffold poles on a mock context.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics src/ui/panels/inspectors.test.ts src/render/construction.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add the funnel test.
- [ ] **Step 4:** Run `npm test`. Run `bash scripts/shots.sh` with a temporary dev param `upgrading=1`. Add it to `src/main.ts` (it starts a level-2 upgrade on the autoplay sawmill) and to the `UI_SHOTS` list as `tab-building-level 25 inspect2=1&upgrading=1`. Look at the 1366 and 1920 shots of the scaffold and the card.
- [ ] **Step 5: Commit** with `feat(logistics): building levels and works`.

### Task 3: Truck models and kits

**Files:**
- Create: `src/data/vehicleModels.ts`, `src/sim/logistics/models.ts`
- Modify:
  - `src/sim/vehicles.ts`:
    - `buyVehicle(ctx, owner, routeId, kind, model?)`, defaulting to `newestModel`;
    - `vehiclePrice(state, kindOrModel)`;
    - `sellRefund(state, veh)`;
    - `replaceCost(state, veh)`;
    - `replaceVehicle` buys the newest model and is allowed before `AGING_GRACE` when a newer model exists;
    - `vehicleUpkeep` uses the model's maintenance;
  - `src/sim/state.ts`: valuation by model price instead of `VEHICLE_COST[kind]`;
  - `src/sim/rival/projects.ts`, `src/sim/rival/railways.ts`, `src/sim/rival/market.ts`: price checks through `vehiclePrice(state, newestModel(state))`;
  - `src/ui/panels/fleet.ts`: a Model column and a route bulk action;
  - `src/ui/panels/vehicle.ts`: model, kits with Fit buttons, and Replace text naming the model;
  - `src/sim/funnels.test.ts`.
- Test: `src/sim/logistics/models.test.ts`, `src/sim/vehicles.test.ts`, `src/ui/panels/fleet.test.ts`

**Interfaces:**
- `TRUCK_MODELS: Record<Exclude<VehicleModelId, 'train'>, { name: string; year: number; capacity: number; speed: number; cost: number; maintenance: number }>` holds exactly the spec §5.1 rows. The model `train` maps to the `TRAIN` spec. `KITS = { body: { capacity: 1.25, costShare: 0.3 }, engine: { speed: 1.15, costShare: 0.25 } }`.
- `newestModel(state): VehicleModelId`. It returns the latest truck model whose `year ≤ date.year`.
- `modelSpec(model)` returns `{ capacity, speed, cost, maintenance }`.
- `kitCost(state, veh, kit): number` is `round(atPrices(model.cost × costShare))`.
- `kitRefusal(state, veh, kit, owner?): string | null` refuses with 'Not your vehicle', 'Trucks only', 'Already fitted' or 'Not enough money'.
- `fitKit(ctx, vehicleId, kit, owner?): Result`:
  - charges `'vehicles'`;
  - body: `capacity = round(model capacity × 1.25)`;
  - engine: `speed = model speed × 1.15`.
- `upgradeRouteTrucks(ctx, routeId, owner): Result<{ replaced: number }>` replaces, in id order, every truck on the route whose model is older than `newestModel`. It stops at the first one the owner cannot afford.
- `TRUCK` stays exported as the steam lorry spec, for `chainEconomics` and older callers.
- Funnel regex: `/\.(?:model|speed)\s*=(?!=)/` → `['logistics/models.ts', 'migrations.ts', 'vehicles.ts']`.

- [ ] **Step 1: Write the failing tests:**
  - `newestModel` is steam_lorry in 1919, motor_truck in 1920, diesel_truck in 1950 and articulated in 1975.
  - A truck bought in 1925 has capacity 28 and speed 0.6, and costs `atPrices(11000)`.
  - A motor truck covers 20% more tiles than a steam lorry in the same ticks.
  - A body kit gives capacity 35 on a motor truck. The engine gives speed 0.69. A second fit is refused.
  - Replace in 1921 of a 1915 steam lorry is allowed (a newer model exists) and yields a motor truck without kits. The same replace in 1919 is refused with `NO_WEAR`.
  - `upgradeRouteTrucks` replaces 2 of 3 trucks when cash covers only 2, and reports `replaced: 2`.
  - Net worth counts a motor truck at half its model price.
  - The fleet panel shows "Motor Truck" in its Model column.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics/models.test.ts src/sim/vehicles.test.ts src/ui/panels/fleet.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The fleet window's route filter row gains "Upgrade all trucks on this route" when a route is selected. The vehicle panel shows "Replace with Motor Truck $X" when a newer model exists.
- [ ] **Step 4:** Run `npm test`, then `npm run soak -- --seeds 7,42,1234 --years 101`. Every company now buys newer models after 1920. Expected: exit 0. Report the per-seed ms and the balance test `cpu=`.
- [ ] **Step 5: Commit** with `feat(logistics): truck models by era and upgrade kits`.

### Task 4: Automatic routes, smart waits and route auto-sizing

**Files:**
- Create: `src/sim/logistics/autoRoutes.ts`, `src/ui/panels/routeAuto.ts`
- Modify:
  - `src/sim/vehicles.ts`. In the `'loading'` case of `tickVehicle`, an auto route asks `nextAutoStop`; a manual stop with `minLoad` holds the truck. `transfer` takes an optional `onlyGood` for a job's pickup. Departures bump `route.stats.loaded`/`empty`. `updateRoute` accepts `mode`, `autoSize` and per-stop `minLoad`;
  - `src/sim/logistics/index.ts` (`logisticsDay` → `autoRoutesDay`; `logisticsMonth` → `autoSizeRoutesMonth`);
  - `src/ui/panels/routes.ts` (mounts the controls).
- Test: `src/sim/logistics/autoRoutes.test.ts`, `src/ui/panels/routes.test.ts`

**Interfaces:**
- Constants:
  - `AUTO_MIN_JOB = 5`;
  - `AUTO_JOB_CAP = 16`;
  - `DIST_BIAS = 8`;
  - `MIN_LOAD_MAX_WAIT_TICKS = 240` (10 days);
  - `AUTO_BAND = { low: 0.6, high: 0.85 }`;
  - `AUTO_BACKLOG_DAYS = 10`;
  - `AUTO_RESERVE = 20_000` (1900 $).
- `autoRoutesDay(ctx)`:
  - for each `mode === 'auto'` route in id order, rebuilds `route.jobs` exactly as spec §6.2: `distance` is the Manhattan distance between building centres, ties are broken by from, to, then good id, and the board is capped at `AUTO_JOB_CAP`;
  - bumps `route.stats.backlogDays` when a job of at least one truck capacity was left untaken from yesterday's board;
  - "Promised" cargo = Σ of `qty` over this route's trucks whose `job` is not yet loaded, by stop and good.
- An auto truck's pickup is saved in `veh.job` as a `HubJob` of kind `'collect'` whose `from`/`to` are **stop indices** on its route (hub jobs use building ids); the job funnel is shared.
- `departAuto(state, veh, route): number | 'wait'` follows spec §6.3: cargo first, then the board, then `'wait'`. It sets or clears `veh.job` itself and returns the next stop index. `'wait'` keeps the truck `'loading'` with `waitTicks = 24`.
- Smart waits: when `stop.minLoad > 0` on a manual route, at dwell end with `cargo < minLoad × capacity` and `veh.dwell < MIN_LOAD_MAX_WAIT_TICKS`, `transfer` is retried and the truck waits 24 more ticks (`dwell += 24`). `dwell` resets on departure.
- `autoSizeRoutesMonth(ctx)`: spec §6.4 for every route with `autoSize?.on`, in id order. It buys through `buyTruck` and sells through `sellVehicle` (oldest `builtYear`, then lowest id), then resets `stats`. The cap is clamped to 1–20.
- Every loaded departure on an auto route adds 1 to `logistics.stats.autoLoaded[owner]`.
- `routeAuto.ts`, `autoControls(host, routeId): { el; refresh() }`, a `.p-section` with:
  - the Manual/Auto switch (`data-act="mode"`);
  - auto-sizing on/off (`data-act="autosize"`), a max-trucks number input (1–20) and "Last month: N% loaded";
  - in manual mode, a "Leave at" select per stop (`data-act="minload"`, 0/50/100%).

- [ ] **Step 1: Write the failing tests:**
  - A 3-stop auto route (camp → sawmill → factory, as in the spec) builds a board sorted by score, with id tie-breaks.
  - An empty truck takes the top job and loads only its good.
  - A loaded truck drives to the nearest stop with room.
  - With no job the truck stays put and rechecks after 24 ticks.
  - Over 360 days on that route, empty departures are only toward a pickup that had a job when chosen.
  - Cargo with no room anywhere waits at the nearest unloading stop.
  - Removing a stop mid-job drops its jobs at the next rebuild without throwing.
  - Cutting a route to one stop idles its trucks.
  - Save at a mid-day tick, load, then 30 days match an uninterrupted run (`stateHash`).
  - `minLoad: 1` holds a truck until full or 10 days.
  - Auto-sizing buys one truck at u = 0.9 with 12 backlog days, sells the oldest at u = 0.5, never sells the last truck, never exceeds `maxTrucks`, never buys below the reserve and buys nothing for a company with negative cash.
  - The route panel shows the switch and the select, and toggling calls `updateRoute`.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics/autoRoutes.test.ts src/ui/panels/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the balance test. Report `cpu=`. It must stay under 21,000.
- [ ] **Step 5: Commit** with `feat(logistics): automatic routes, smart waits and auto-sizing`.

### Task 5: Managers: market, employment, effects, retirement and raises

**Files:**
- Create:
  - `src/data/managers.ts` (40 given names and 40 surnames, period-neutral);
  - `src/sim/logistics/managers.ts`;
  - `src/sim/logistics/release.ts` (leaf: `releaseBuilding(state, id)` and `releaseCompany(state, owner)`);
  - `src/ui/panels/managers.ts` (`PANELS.managers`);
  - the `manager` icon painter.
- Modify:
  - `src/sim/logistics/index.ts`: `logisticsMonth` → `salariesMonth`; `logisticsYear` → `retireYear`, `raiseYear` and `refreshMarket` (AI hiring comes in Task 8);
  - `src/sim/production.ts` (rate × `managerRate`);
  - `src/sim/society/upgrades.ts` (`buildingMaintenance` × `managerUpkeep`);
  - `src/sim/state.ts`: `demolishBuilding` calls `releaseBuilding`;
  - `src/sim/companies.ts`: `transferOwnership` moves managers;
  - `src/sim/regional/firms.ts`: `closeFirm` calls `releaseCompany`;
  - `src/data/cards/types.ts` (`CardTrigger` + `'manager'`);
  - `src/data/cards/triggered.ts` (`manager_raise`);
  - `src/core/events.ts`: `managerHired`, `managerLeft`;
  - `src/ui/panels/index.ts` (append);
  - `src/ui/hud.ts` (Operations group: `{ panel: 'managers', label: 'Managers', icon: 'manager' }`);
  - `src/ui/shortcuts.ts` (`{ key: 'J', label: 'Managers', group: 'Panels', action: { kind: 'panel', id: 'managers' } }`);
  - `src/ui/panels/buildingLevel.ts` (the manager slot);
  - `src/ui/panels/finance.ts` (the Salaries row);
  - `src/game/controller.ts` (`managerLeft` toast);
  - `src/sim/funnels.test.ts`;
  - `src/ui/panels/density.test.ts` (`managers: 2`).
- Test: `src/sim/logistics/managers.test.ts`, `src/ui/panels/managers.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- Constants:
  - `SKILL_WEIGHTS = [35, 30, 20, 10, 5]`;
  - `MARKET_MIN = 4`, `MARKET_MAX = 6`;
  - `AGE_MIN = 25`, `AGE_MAX = 55`;
  - `SEVERANCE_MONTHS = 3`;
  - `RETIRE_FROM = 60`, `RETIRE_AT = 70`;
  - `RAISE_AFTER_YEARS = 4`, `RAISE_CHANCE = 0.3`, `RAISE_FACTOR = 1.2`;
  - `QUIT_CHANCE = 0.5`;
  - `PRODUCTION_PER_POINT = 0.04`, `FRUGALITY_PER_POINT = 0.04`.
- `managerSalary(skills): number` is `50 + 20 × (l² + p² + f²)`.
- `refreshMarket(state, year)` rolls `randInt(4, 6)` candidates from `logistics.rngState`, with the first candidate's logistics floored at 2. It also sets `marketYear`. A save from Task 1 gets a market at load: extend the `{ from: 7 }` migration to call it.
- `hire(ctx, owner, managerId): Result`, `fire(ctx, owner, managerId): Result` (severance under `'salaries'`), `assign(ctx, owner, managerId, buildingId | null): Result`. The refusals are 'No such manager', 'Not on the market', 'Not your manager', 'Not your building', 'This building takes no manager' (stores, stations, housing) and 'Post already filled'.
- `managerAt(state, buildingId): Manager | null`. It is O(1) through a post index cached on `logistics.rev`.
- `managerRate(state, b)` is `1 + 0.04 × production`, or 1 at a warehouse or without a manager.
- `managerUpkeep(state, b)` is `1 − 0.04 × frugality`, or 1 without a manager.
- `salariesMonth(ctx)` charges `atPrices(salary)` per employed manager, in id order, under `'salaries'`.
- `retireYear(ctx)` follows spec §7.3. It uses the state rng in manager id order and emits `managerLeft` `'retired'`.
- `raiseYear(ctx)` sets `raiseAsk` and calls `triggerCard(ctx, 'manager', null)`.
- Card `manager_raise`:
  - years [1900, 2000], weight 1, cooldown 0, `needsCity: false`;
  - condition: `raiseAsk` names an employed player manager;
  - `vars` fills `{manager}`;
  - choices: grant (cost 0, salary ×1.2, `lastRaiseYear = year`), bonus (cost 1500, `lastRaiseYear = year`), refuse (cost 0, `chance(0.5)` → `fire` without severance and `managerLeft` `'quit'`);
  - default 0;
  - every choice clears `raiseAsk`, and a choice whose manager has gone does nothing else.
- Funnel regex: `/\.(?:employer|post)\s*=(?!=)|\.salary\s*(?:[-+*/]?=(?!=))/` → `['companies.ts', 'logistics/managers.ts', 'logistics/release.ts']`.
- `PANELS.managers`:
  - `createWindow({ id: 'managers', title: 'Managers', ... })`;
  - two `.p-section`s, "On the market" and "Your staff";
  - each candidate row: name, age, L/P/F chips, salary per month at today's prices and Hire;
  - each staff row: post, chips, salary, years to 70, an Assign select of the player's works and warehouses without a manager, and Fire with the severance in its title.

- [ ] **Step 1: Write the failing tests:**
  - Salary 110 / 590 / 1,550 for 1/1/1, 5/1/1 and 5/5/5.
  - Over 200 seeded markets: sizes are within 4–6, the first candidate's logistics is ≥ 2, skill frequencies are within ±5 points of the weights, and ages are within 25–55.
  - Rolling the market does not change `state.rngState`.
  - Hire, assign and fire refusals.
  - Severance is 3 months at today's prices, charged once.
  - Salary is booked under `'salaries'` and stops the month after firing.
  - A production-5 manager at a sawmill gives ×1.20 output, and a frugality-5 one ×0.80 upkeep.
  - Retirement chance is 0 at 59 and certain at 70.
  - A retired manager's post is cleared that day.
  - The raise card's grant gives ×1.2. Refuse with a forced rng quits. A card answered after its manager retired does nothing.
  - Demolishing a posted building unposts the manager.
  - `transferOwnership` moves managers and their posts. `closeFirm` releases its managers.
  - The managers panel lists the market and the staff. The menu drift and density tests pass.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics/managers.test.ts src/ui/panels/managers.test.ts src/data/catalog.test.ts src/ui/menuDrift.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Run `bash scripts/shots.sh` with `tab-managers 25 panel=managers` added to `UI_SHOTS`, and look at the 1366 and 1920 shots.
- [ ] **Step 5: Commit** with `feat(logistics): the manager market`.

### Task 6: Warehouse hubs and daily dispatch

**Files:**
- Create:
  - `src/sim/logistics/hubs.ts`;
  - `src/sim/logistics/jobRoute.ts` (leaf);
  - the `hub` icon painter.
- Modify:
  - `src/sim/vehicles.ts`:
    - `vehiclesTick` resolves a hub truck's route with `hubRoute(state, veh)`;
    - the `'loading'` case of a hub truck calls `advanceHubJob`;
    - `assignVehicle` clears `hubId`/`job`;
    - `replaceVehicle` keeps a hub truck on its hub.
  - `src/sim/rival/projects.ts` (`renewOldAssets` also replaces hub trucks);
  - `src/sim/logistics/release.ts` (`releaseBuilding` releases hub trucks);
  - `src/sim/logistics/index.ts` (`logisticsDay` → `hubsDay`);
  - `src/render/world/selection.ts`: range circles for a selected warehouse and for the warehouse ghost;
  - `src/ui/panels/buildingLevel.ts`: the hub section;
  - `src/ui/panels/fleet.ts`: "Hub: <name>" in the route column;
  - `src/sim/invariants.ts`;
  - `src/sim/funnels.test.ts`.
- Test: `src/sim/logistics/hubs.test.ts`, `src/sim/determinism.test.ts`, `src/ui/panels/inspectors.test.ts`

**Interfaces:**
- Constants:
  - `HUB_MIN_LOAD = 10`;
  - `HUB_FULL_RATIO = 0.8`;
  - `STORE_PRIORITY = 2`, `STALL_PRIORITY = 1.5`, `FULL_BONUS = 1.5`;
  - `SKILL_TIERS: Record<Skill, { rangeShare: number; every: number; lookAhead: boolean; balance: boolean }>`, exactly spec §8.3: 1/3·7, 1/2·5, 2/3·3, 5/6·2, 1·1.
- `openHub(ctx, warehouseId, owner): Result` creates `b.hub` with `{ autoSize: true, maxTrucks: cap, nextDispatchDay: today + (id % every) }`.
- `buyHubTruck(ctx, owner, warehouseId): Result<Vehicle>` opens the hub if needed, refuses at the level cap ('Hub fleet is full'), and spawns at the warehouse's access tile with `routeId: null`, `hubId`, `job: null` and state `'idle'`. It builds the vehicle with a helper extracted from `buyVehicle`: `newVehicle(state, owner, kind, model, spawn: Vec2, routeId: number | null): Vehicle` in `vehicles.ts` (no charge; the caller spends under `'vehicles'`).
- `hubAttached(state, hub, radius): Building[]` returns the owner's buildings within `radius` (Chebyshev distance of footprints, through `buildingsNear`) that `handlesCargo`, excluding warehouses, stations and housing, in id order.
- `routedGoods(state, owner): { loads: Set<string>; unloads: Set<string> }` holds keys `${buildingId}:${good}`. It is cached per owner on the routes record and `nextId`, as `fleet()` caches.
- `hubsDay(ctx)`, for each building with `hub` in id order:
  - skip if `works`, or if no manager of the same owner is posted (`yesterday = { jobs: 0, idle: trucks }`);
  - else, on `today >= nextDispatchDay`, build the candidates and assign them exactly as spec §8.2 with `radius = hubRange × rangeShare`. Look-ahead and balancing stay off until Task 7, even at skills 3–5;
  - set `nextDispatchDay = today + every`;
  - bump `logistics.stats.hubJobs[owner]` and the hub's `month` and `yesterday` counters.
- `hubRoute(state, veh): Route | undefined` (leaf, cached in a `WeakMap` keyed by the job object):
  - `collect`/`deliver`/`balance` → stops `[from: load [good], to: unload [good]]`;
  - `return` → `[hub]`;
  - no job → undefined (the truck idles where it stands, which is home after a `return`).
- `advanceHubJob(state, veh)` at the dwell's end:
  - stop 0 → stop 1;
  - after the drop, `job = { kind: 'return' }` if away from home, else `null`;
  - when the job's other building is gone, the job becomes `return`; on reaching home, cargo unloads into the hub as far as storage allows and the rest stays aboard.
- `releaseBuilding` on a hub warehouse: its trucks get `hubId = null`, `job = null`, state `'idle'` and their path cleared.
- Invariants:
  - a vehicle with `hubId` has `routeId === null`, and `hubId` names a warehouse of its owner with `hub` set;
  - a hub job's `from`/`to` are integers. They may name a building demolished since dispatch: `advanceHubJob` turns such a job into `return` at the next dwell end, so the invariant does not require them to exist;
  - hub trucks ≤ the level cap.
- Funnel regex: `/\.(?:job|hubId)\s*=(?!=)/` → `['logistics/autoRoutes.ts', 'logistics/hubs.ts', 'logistics/jobRoute.ts', 'logistics/release.ts']`.
- Hub section (warehouse inspector, `.p-section` "Hub"):
  - range, the attached count, trucks `n / cap`, and "Buy hub truck $X" (`data-act="hub-truck"`);
  - the auto-size switch;
  - "Yesterday: N jobs, M trucks idle";
  - the warning "Hire a manager to run this hub" when unmanned.

- [ ] **Step 1: Write the failing tests:**
  - Without a manager no job is assigned.
  - A level-1 hub with a logistics-1 manager uses radius 12 × 1/3 = 4: a producer 3 tiles from the warehouse footprint is served and one 8 tiles away is not. With logistics 5 (radius 12) both are served.
  - Dispatch runs every 7 days at skill 1 and daily at skill 5.
  - Candidates are ordered by score, then kind, building id and good id, on a crafted two-store case.
  - A store in a town with unmet demand outranks an equal factory delivery.
  - A good loaded at a building by a route is never collected there (D2).
  - A collect trip ends with the goods in the hub. A deliver trip ends at the consumer and the truck returns home.
  - Demolishing the target mid-trip sends the truck home with its cargo unloaded into the hub.
  - Demolishing the hub releases its trucks idle, with no vehicle deleted.
  - `transferOwnership` moves the hub, its trucks and their jobs.
  - The fleet cap is 4 at level 1 and 6 at level 2.
  - Save and load mid-trip, then 30 days, match an uninterrupted run.
  - The inspector hub section shows the warning when unmanned.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics/hubs.test.ts src/sim/determinism.test.ts src/ui/panels/inspectors.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, the balance test (report `cpu=`) and the perf command on seed 42 (report the ratio to base). Run `bash scripts/shots.sh` with `tab-hub 25 inspecthub=1`. `inspecthub=1` is a new dev param in `src/main.ts`: it opens a hub on the player's first warehouse if any, and selects it. Look at the range circle in both sizes.
- [ ] **Step 5: Commit** with `feat(logistics): warehouse hubs and daily dispatch`.

### Task 7: Look-ahead, hub-to-hub balancing and hub auto-sizing

**Files:**
- Modify: `src/sim/logistics/hubs.ts`, `src/sim/logistics/index.ts` (`logisticsMonth` → `hubAutoSizeMonth`), `src/ui/panels/buildingLevel.ts` (auto-size cap input; "Balancing with <hub>" line)
- Test: `src/sim/logistics/hubs.test.ts`

**Interfaces:**
- Constants:
  - `LOOKAHEAD_DAYS = 3`;
  - `BALANCE_MIN_STOCK = 100`;
  - `BALANCE_FACTOR = 0.5`;
  - `HUB_BACKLOG_DAYS = 10`;
  - `HUB_IDLE_PER_DAY = 1.5`;
  - `HUB_RESERVE = 20_000` (1900 $).
- `dailyOutput(state, b, good): number` is the recipe output per day × `levelRate` × `managerRate` × staffing. It is 0 for a halted or upgrading building.
- `dailyUse(state, b, good)` is the same for inputs, and a store's `demand30 / 30` share.
- Look-ahead (skills 3–5) adds `LOOKAHEAD_DAYS ×` those to a collect's `amt` and a delivery's need, bounded by storage.
- Balancing (skills 4–5) works with the owner's other hubs whose centres are within the sum of the two full ranges. For each good this hub holds ≥ 100 of while the other hub's attached consumers need more than the other hub holds, it adds a `balance` candidate: `qty = min(stock − 100, need − other stock)`, score ×0.5.
- `hubAutoSizeMonth(ctx)`, per hub with `autoSize` in id order:
  - buys one truck when `month.backlogDays ≥ 10`, trucks < `min(maxTrucks, cap)` and money − price ≥ `atPrices(20000)`;
  - else sells the oldest (lowest `builtYear`, then id) when `month.idleTruckDays / 30 ≥ 1.5` and trucks > 1;
  - then resets `month`.

- [ ] **Step 1: Write the failing tests:**
  - With look-ahead, a producer holding 8 units that makes 2 a day is collected at skill 3 and not at skill 2.
  - Two overlapping hubs, one with 300 bread and one whose bakery-fed store needs 120: skill 4 sends a `balance` job and skill 3 does not.
  - Non-overlapping hubs never balance.
  - Auto-sizing buys at 12 backlog days, never above the cap, never below the reserve, sells at 2.0 idle per day, never sells the last truck, and makes one change per month.
  - A company in the red buys nothing.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics/hubs.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the balance test (report `cpu=`).
- [ ] **Step 5: Commit** with `feat(logistics): manager skill drives look-ahead and hub balancing`.

### Task 8: The Baron and regional firms adopt; the Baron poaches managers

**Files:**
- Create: `src/sim/logistics/ai.ts`
- Modify:
  - `src/sim/nemesis/types.ts` (append `'poach_manager'` to `RETALIATION_KINDS`);
  - `src/sim/nemesis/retaliation.ts` (`RETALIATION_COST.poach_manager = 4000`, `hasTarget`, `apply`, `cause` unchanged);
  - `src/data/nemesis.ts` (cunning `poach_manager: 3`, greedy `poach_manager: 1`);
  - `src/data/baronLines.ts` (`retaliation.poach_manager`, 4+ lines);
  - `src/ui/panels/rival.ts` (kind label "Poached a manager");
  - `src/sim/logistics/index.ts`: `logisticsMonth` also calls `aiLogisticsMonth`;
  - `src/sim/chainBuilder.ts`: `buildChain(..., opts?: { routes?: boolean; near?: Vec2 })`; with `routes: false` it links roads and builds no routes or trucks;
  - `scripts/soak.ts` (a `logistics` report line, no gates yet).
- Test: `src/sim/logistics/ai.test.ts`, `src/sim/nemesis/retaliation.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- Constants:
  - `BARON_UPGRADE_GAP_MONTHS = 6`;
  - `FIRM_UPGRADE_GAP_MONTHS = 12`;
  - `UPGRADE_MIN_AGE = 2`;
  - `BARON_HUB_YEAR = 1910`, `BARON_HUB_CHAINS = 3`;
  - `FIRM_HUB_AGE = 5`;
  - `AI_HUB_TRUCKS = 2`;
  - `BARON_MAX_MANAGERS = 2`, `FIRM_MAX_MANAGERS = 1`;
  - `POACH_MANAGER_MIN_SKILL = 3`;
  - `POACH_SALARY_FACTOR = 1.25`.
- `aiLogisticsMonth(ctx)`, for each non-player active company in `companyIds` order:
  - `aiUpgrade`: spec §9, with the Baron keeping 2 × `rivalReserve` after paying and each firm `REGIONAL_RESERVE` × 2 at today's prices. Its last upgrade month is kept in `state.flags['lastUpgrade:<owner>']` (a month index);
  - `aiHub`: spec §9. It places the warehouse with `findPlacement` near the centroid of the owner's buildings, links roads with `ensureRoadLink` to the nearest owned building, buys 2 hub trucks and turns `autoSize` on;
  - `aiHire` runs only when `date.month === 1`. It hires the cheapest candidate with logistics ≥ 2 that the company can pay a year of while keeping its reserve, posts them to its unmanned hub, and for the Baron also to his busiest unmanned works.
- `poach_manager`:
  - target: the player's employed manager with the highest skill total, lowest id on ties, with any skill ≥ 3;
  - effect: employer → `'rival'`, salary ×1.25, post as spec §7.3;
  - emits `managerLeft` `'poached'`;
  - news headline `SMOGSWORTH LURES ${name.toUpperCase()} FROM ${firm.toUpperCase()}`.

  Appending the kind leaves existing draws unchanged while the player has no qualifying manager. A test pins this: `eligibleKinds` without managers equals the Phase 4 list.

- [ ] **Step 1: Write the failing tests:**
  - The Baron upgrades his best works when he can keep 2× his reserve, and not twice within 6 months.
  - A firm upgrades at most once a year.
  - From 1910, a Baron with 3 chains builds one hub with 2 trucks and hires a logistics ≥ 2 candidate at the end of January, not in December.
  - A firm founded 5 years ago with enough cash builds a hub. A firm short of cash does not.
  - `poach_manager` moves the manager, posts him to the Baron's unmanned hub, raises his salary ×1.25 and the player's hub stops dispatching the next day.
  - `poach_manager` is ineligible without a skill-3 manager.
  - The Baron lines catalog has 4+ `poach_manager` lines without emoji.
  - `buildChain` with `routes: false` builds no route.
- [ ] **Step 2:** Run `npx vitest run src/sim/logistics/ai.test.ts src/sim/nemesis src/data/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, the balance test (report `cpu=`), the perf command on seed 42 (ratio to base) and the soak. The soak prints per seed: the Baron's and firms' upgrades and hubs, AI hires, and `poach_manager` count. Expected: exit 0 on every Phase 0–4 gate.
- [ ] **Step 5: Commit** with `feat(logistics): the Baron and the regional firms adopt levels and hubs`.

### Task 9: Autoplay uses logistics; soak gates; perf pass

**Files:**
- Modify:
  - `src/game/autoplay.ts` (`autoplayLogistics`);
  - `scripts/soak.ts` (calls it monthly; gates);
  - `scripts/make-fixture.ts` and `src/main.ts` (the skipYears loop calls it monthly, like `autoplayDefend`);
  - any hot path the perf pass finds.
- Test: `src/game/autoplay.test.ts`

**Interfaces:**
- `autoplayLogistics(ctx)` is monthly and uses only the public API. It makes the first applicable step each month, in this order:
  1. **Hire** (any January, while it employs fewer than 2 managers): the market candidate with the highest logistics, then the lowest salary, then id, whose salary is at most 5% of last month's sales income.
  2. **Auto line** (once, from 1903): a 4-stop auto route over the furniture chain's buildings (camp: load wood; sawmill: unload wood, load lumber; factory: unload lumber, load furniture; store: unload furniture) with `autoSize = { on: true, maxTrucks: 6 }`. The 3 leg trucks move to it through `assignVehicle`, and then the leg routes are deleted with no trucks left on them.
  3. **Hub** (once, from 1905, when cash ≥ `atPrices(120_000)`): `buildChain(ctx, 'player', city, 'cheese', 0, { routes: false })`. Place a warehouse with `findPlacement` near the centroid of the dairy farm, creamery and store, link roads, buy 2 hub trucks and post the best-logistics unposted manager there.
  4. **Upgrade** (any month with no works running and cash ≥ 3 × the cost): the first of the furniture factory, sawmill, camp, creamery, dairy farm and hub warehouse whose next level is available.
  5. **Trucks** (any month with cash ≥ 3 × the cost): `upgradeRouteTrucks` on the auto line when a newer model exists.
- Soak counters:
  - `buildingUpgraded` by owner;
  - `managerHired` by owner;
  - `managerLeft` by reason;
  - `logistics.stats.hubJobs` and `autoLoaded`;
  - the player's highest truck model;
  - per company, the max works level seen and whether it has had a hub.
- Soak gates (years ≥ 100), from spec §12:
  - player: upgrades ≥ 3, hires ≥ 2, hub jobs ≥ 300, auto loaded ≥ 300, a `motor_truck` or later bought;
  - Baron: max level ≥ 2, a hub, ≥ 1 hire;
  - regional: some firm with max level ≥ 2 and some firm with a hub;
  - Σ hub jobs ≥ 1,000;
  - retirements ≥ 1.

  The new `logistics` line prints them all.

- [ ] **Step 1: Write the failing tests:**
  - On seed 42, 10 years of `runDays(30)` plus `autoplayLogistics` hire a manager, build the auto line, open a hub with a posted manager and start at least one upgrade.
  - Each step is skipped while it cannot be afforded.
  - Two runs of the same seed hash equal.
- [ ] **Step 2:** Run `npx vitest run src/game/autoplay.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Then profile one seed-42 soak with `node --cpu-prof` through `tsx`. If the instruction ratio to base is above 1.15×, cut the top logistics frame before moving on. Likely fixes:
  - `hubAttached` cached per hub until `nextId` or `rev` changes;
  - `routedGoods` cached;
  - auto boards rebuilt only for routes whose trucks moved stock that day.
- [ ] **Step 4:** Run `npm test`, `npm run soak -- --seeds 7,42,1234 --years 101` and the perf command. Expected: exit 0 with every gate, victory and solvency on all 3 seeds, and an instruction ratio ≤ 1.25. If victory or solvency fails, tune the autoplay's thresholds (cash multiples, hire budget), never the gates. Report each seed's `logistics` line and ms.
- [ ] **Step 5: Commit** with `feat(logistics): autoplay runs hubs, auto routes and upgrades; soak gates`.

### Task 10: Phase 4b gate

**Files:**
- Create: `src/sim/__fixtures__/phase4b.save.json` with `npm run fixture -- --name phase4b --days 18000` (1950: levels, hubs, managers, auto routes and Motor Trucks present)
- Modify:
  - `src/sim/migrations.test.ts`: a phase4b case that loads, passes invariants and plays 360 days, and asserts at least one level-2 building, one hub truck, one employed manager and one auto route;
  - `scripts/shots.sh`: Phase 4b showcase shots;
  - `README.md`: a "What's new in SMOKESTACK II (Phase 4b)" section, and the Controls list gains "J Managers".

- [ ] **Step 1:** Run `npm run fixture -- --name phase4b --days 18000 && npm test`. Expected: all six fixtures load and play a year.
- [ ] **Step 2:** Run `npm run soak -- --seeds 7,42,1234 --years 101`. Expected: exit 0. Then run the perf command 3 times on seed 42. Expected: median ≤ 1.25 × the Task 1 base median. Run the balance test. Expected: `cpu` < 21,000. Put all three numbers in the commit body.
- [ ] **Step 3:** Add showcase lines (1366 and 1920 through `ushot`):
  - `hub 55 inspecthub=1` (the range circle and the hub section);
  - `managers 55 panel=managers`;
  - `upgrade 25 inspect2=1&upgrading=1` (scaffold and card);
  - `route-auto 55 panel=routes`.

  Run `bash scripts/shots.sh` and look at every new shot at both sizes: no clipped text, no horizontal scroll, and the circle visible.
- [ ] **Step 4:** Run `npm run build && docker compose build`. The `up` waits for the merge. Remove the base worktree: `git worktree remove /home/freire/projects/industry/.claude/worktrees/phase4b-base`.
- [ ] **Step 5: Commit** with `test: phase 4b fixture and gate`, then run `chown -R freire:freire /home/freire/projects/industry/.claude/worktrees/v2-phase4b`.
