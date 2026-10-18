# SMOKESTACK II Phase 4b: Logistics, Upgrades and Managers — Design

Status: written 2026-10-18 from the owner's backlog brief
(`2026-10-17-logistics-and-upgrades-brief.md`, committed alongside) with the owner's rulings on its
open questions. Parent spec: `2026-10-11-smokestack-v2-design.md`. Built after the Phase 4 merge and
the UI overhaul (`69d8d86`), before Phase 5 (alternate history).

## 1. Intent

The owner asked for four things: works that can be upgraded to produce more, a smarter and more
automatic fleet, warehouses that distribute goods within a range, and managers hired from an open
market whose skill decides how well that distribution works. Trucks should also improve.

- **Goal:** the mid and late game gets new things to buy that change how the empire runs, not just
  how big it is: bigger works, better trucks, automatic routes, hubs and the people who run them.
- **Guard rail (parent spec §1, problem 1):** automation must not make the game play itself. Every
  gain has a price the player feels: salaries, hub fleets, range planning, paused output during
  works, more smoke and more workers.
- **Success criteria:**
  - In the century soak the player, the Baron and at least one regional firm all upgrade works and
    run a hub; the player runs an automatic route and employs managers; at least one manager
    retires; trucks of later models are bought.
  - A player who never touches the new systems plays exactly as before (manual routes, level 1
    works, one truck model in 1900).
  - The soak stays solvent and victorious, and its cost stays within 1.25× of the base commit.

## 2. Owner rulings (binding)

| # | Question | Ruling |
|---|---|---|
| R1 | Hubs vs manual routes | Hubs sit **beside** manual routes. Manual routes stay the best tool for long single-good lines. |
| R2 | Managers' lives | Managers **age and retire** (between 60 and 70); there is **no death roll**. The Baron can **poach a manager** as a new nemesis retaliation kind, appended to the registries and never reordered. A **raise-request** event card exists. |
| R3 | Upgrade timing | Upgrades take **construction time with output paused**, shown with the existing construction animation. The pause is the cost, so it is short: **30, 45 and 60 days** for levels 2, 3 and 4 (§4.3). |
| R4 | Breakdowns | Truck breakdowns and servicing are **out of scope**. |
| R5 | Unlocking | Automatic routes, hubs and the manager market are available **from 1900**. Some building levels and truck models **unlock with eras**. There is **no gating building**; the price of automation is salaries, hub fleets and range planning. |

## 3. Design rulings made in this spec

Each is a decision the brief left open. The plan implements them as written.

- **D1 A hub needs a manager.** A warehouse hub dispatches only while a manager employed by its
  owner is posted to it. Without one, its trucks wait at home and the inspector says "Hire a
  manager to run this hub". This makes salary the entry price of automation (R5).
- **D2 Routes take precedence, per good.** A hub never collects a good from a building where a route
  of the same owner loads that good, and never delivers a good to a building where such a route
  unloads it. Hubs and routes work side by side without stealing each other's cargo (R1).
- **D3 Upgrades renew.** Finishing an upgrade resets the building's age (`builtYear`), as a renewal
  would. An upgrade cannot be cancelled; works in progress move with the building on a takeover.
- **D4 Levels for works and warehouses only.** Stores, train stations and company housing have no
  levels. Train stations are never hubs.
- **D5 Newest model by default.** Every purchase (`buyTruck`, hub trucks, Replace) buys the newest
  truck model of the year, for every company, so the AI adopts models without new AI code. Replace
  is allowed before the aging grace when a newer model than the vehicle's exists. Kits are lost on
  replacement.
- **D6 Auto-sizing is a count cap.** The utilisation band is fixed at 60–85% of loaded departures.
  The player sets auto-sizing on or off and a maximum truck count (1–20); a money cap would need
  re-indexing with inflation and is harder to read. Auto-sizing never spends below a reserve of
  $20,000 (1900 dollars), never sells the last truck and changes at most one truck per route per
  month.
- **D7 Three skills.** Managers have *logistics*, *production* and *frugality*. The brief's optional
  *people* skill and the "shrewd family member as a free manager" idea are deferred.
- **D8 One shared market.** The manager market is shared by every company. It refreshes at the turn
  of the year; companies other than the player hire only at the end of January, so the player has
  first pick. The market rolls from its own rng stream (as the exchange does), so other systems'
  random sequences are unchanged by it.
- **D9 Balancing by overlap only.** Hub-to-hub balancing joins two hubs of one owner whose range
  circles overlap. Linking hubs through routes or train lines is deferred.
- **D10 Smart waits are manual-route only.** A manual route stop can say "leave at 0%, 50% or 100%
  load", with at most 10 days of waiting. Automatic routes decide their own waits.
- **D11 Demolition releases, never deletes.** Demolishing a hub warehouse leaves its trucks idle and
  unassigned (the player can reassign or sell them) and unposts its manager. `sellVehicle` stays
  the only vehicle deleter.

## 4. Building levels

### 4.1 Levels

Works (extractors and factories) have levels 1–4; warehouses have levels 1–3. Every building is
level 1 when placed and after the save migration.

**Works:**

| Level | From year | Rate | Workers | Upkeep | Storage | Smoke | Price (share of build cost) | Works time |
|---|---|---|---|---|---|---|---|---|
| 1 | — | ×1.0 | ×1.0 | ×1.0 | ×1.0 | ×1.0 | — | — |
| 2 | 1900 | ×1.4 | ×1.3 | ×1.3 | ×1.4 | ×1.3 | 50% | 30 days |
| 3 | 1920 | ×1.8 | ×1.6 | ×1.6 | ×1.8 | ×1.6 | 75% | 45 days |
| 4 | 1950 | ×2.2 | ×1.9 | ×1.9 | ×2.2 | ×1.9 | 100% | 60 days |

**Warehouses:**

| Level | From year | Hub range | Storage | Hub truck cap | Upkeep | Price | Works time |
|---|---|---|---|---|---|---|---|
| 1 | — | 12 tiles | 1,000 | 4 | ×1.0 | — | — |
| 2 | 1900 | 16 tiles | 1,500 | 6 | ×1.3 | 50% | 30 days |
| 3 | 1930 | 20 tiles | 2,000 | 8 | ×1.6 | 75% | 45 days |

- **Rate** multiplies the daily recipe progress of a factory and the daily yield of an extractor,
  alongside staffing, aging and the existing modifiers.
- **Workers** multiplies the hands the works needs from its town (Phase 2 workforce): a bigger
  works lowers staffing in a crowded town, and staffing lowers output.
- **Upkeep** multiplies the building's maintenance; scrubbers and aging still apply on top.
- **Smoke** multiplies the building's emission in `smogDay`; scrubbers still apply on top.
- **Price** is the share of the catalogue build cost at today's price index, charged under
  `'construction'`. The year gate comes from the era (§8.1 of the parent spec will later move it to
  inventions in Phase 5).

### 4.2 Effective values

One module computes every level-scaled value, and every reader goes through it: storage caps
(production, `storageLeft`, the Baron's back-up checks, events), workers (workforce), upkeep
(`buildingMaintenance`), smoke (`smogDay`) and rate (`productionDay`). Readers never use
`BUILDINGS[t].storage` or `.workers` directly for a placed building.

### 4.3 Works

- Starting an upgrade charges the price, sets `works = { toLevel, startDay, untilDay }` and the
  building's status becomes `'upgrading'`. Output stops: it produces nothing, emits no smoke, and its
  stock stays where it is and can still be collected or delivered.
- When `today >= untilDay`, the level rises, `works` clears, the age resets (D3) and the bus emits
  `buildingUpgraded`.
- While the works run, the renderer draws the building under full scaffold. When they finish, the
  existing scaffold-and-reveal animation plays once.
- A sabotage or strike during works changes nothing about the works timer.

### 4.4 Inspector

A works or warehouse inspector shows an **upgrade card**: the current and next level side by side
(output per day, workers, upkeep per month, smoke, storage; for a warehouse range and hub truck cap),
the price and the works time, and a button "Upgrade: N days, output paused". It shows the refusal
reason when the next level is not available yet ("Level 3 arrives in 1920"). During works it shows
"Upgrading to level N: D days left".

## 5. Trucks: models and kits

### 5.1 Models

| Model | From | Capacity | Speed (tiles/tick) | Price (1900 $) | Upkeep / month (1900 $) |
|---|---|---|---|---|---|
| Steam Lorry | 1900 | 20 | 0.5 | 8,000 | 150 |
| Motor Truck | 1920 | 28 | 0.6 | 11,000 | 180 |
| Diesel Truck | 1950 | 36 | 0.7 | 15,000 | 200 |
| Articulated Lorry | 1975 | 48 | 0.8 | 21,000 | 220 |

The Steam Lorry is today's truck, so every existing truck migrates to it unchanged. Trains keep their
one spec (model `train`). Each vehicle stores its `model` and its effective `capacity` and `speed`.
Asset valuation and sale refunds use the vehicle's model price.

### 5.2 Kits

| Kit | Effect | Price |
|---|---|---|
| Bigger body | capacity ×1.25 (rounded) | 30% of the model's price |
| Tuned engine | speed ×1.15 | 25% of the model's price |

Each kit is bought once per truck, takes effect at once and is lost on replacement.

### 5.3 Replacement

Replace sells the old vehicle and buys the newest model (D5). The fleet window gains "Upgrade all
trucks on this route", which replaces every truck on the route that is older than the newest model,
stopping at the first one the player cannot afford.

## 6. Automatic routes

### 6.1 Modes

`Route.mode` is `'manual'` (today's behaviour, the default) or `'auto'`.

- **Manual** gains per-stop smart waits (D10): `minLoad` of 0, 0.5 or 1. A truck at such a stop
  keeps loading, checking once a day, until its cargo reaches `minLoad × capacity` or it has waited
  10 days.
- **Auto** treats the stops as a pool. The stop's `load` and `unload` lists still say which goods
  may be picked up and dropped where.

### 6.2 The job board (daily)

Each day, for each auto route in id order, the sim rebuilds `route.jobs`, a list of at most 16
jobs `{ from, to, good, qty, score }` (stop indices):

- for each stop *i* and each good *g* in its `load`: `avail` = whole units in stock, less the cargo
  already promised to trucks heading to *i* for *g*;
- for each other stop *j* whose `unload` has *g* and accepts it: `room` = `storageLeft`. A *pool*
  stop (one whose `load` and `unload` both list *g*, such as a warehouse used as a buffer) never sends
  *g* to another pool stop, so goods do not bounce between buffers;
- `qty = min(avail, room)`; jobs under 5 units are dropped;
- `score = qty × basePrice(g) / (distance(i, j) + 8)`, where distance is the Manhattan distance
  between the two buildings' centres;
- sorted by score, then `from`, then `to`, then good id.

The board is saved with the route, so a reload continues identically.

### 6.3 Picking a job (per departure)

When an auto truck finishes its dwell:

1. **If it carries cargo**, it heads for its job's drop stop while that has room. Otherwise it heads
   for the nearest stop (by distance, then stop index) that unloads a carried good and has room for it.
   If no stop has room, it heads for the nearest stop that unloads it and waits there. It never drops
   cargo back at the stop it loaded it from, nor from one pool stop at another (§6.2).
2. **Otherwise** it takes the first board job with `qty > 0`, lowers that job's `qty` by its
   capacity, and heads for the job's pickup stop. At the pickup it loads only the job's good; the
   job then becomes a delivery (no longer promised cargo) that remembers its pickup and drop.
3. **With no job**, it stays at its stop and checks again the next day. It never drives an empty
   leg unless a job waits at its end.

### 6.4 Auto-sizing (monthly)

A route with `autoSize = { on: true, maxTrucks }` counts loaded and empty departures and its
backlog days (`backlogDays`). At the month end:

- only departures **from a stop that loads something** count: leaving an unload-only stop empty is
  the return leg, not waste (so a busy two-stop route reads 100%, not 50%);
- a backlog day on an automatic route is a day whose board ended with a job of at least one truck
  load (the smallest truck on the route) left untaken; on an auto-sized manual route, which has no
  board, it is a day ending with at least one truck load of a loaded good waiting at a loading stop;
- utilisation `u = loaded / (loaded + empty)` (0 with no counted departures);
- if `u > 0.85`, `backlogDays ≥ 10`, the route has fewer than `maxTrucks` trucks and the owner keeps
  the reserve after paying, it buys one truck of the newest model;
- else if `u < 0.60` and the route has more than one truck, it sells the oldest (lowest `builtYear`,
  then lowest id);
- the counters reset.

### 6.5 Route window

The route editor gains a Manual / Auto switch, a "Leave at" select per stop (manual only), and an
auto-sizing row (on or off, maximum trucks, and last month's utilisation).

## 7. Managers

### 7.1 The market

- Refreshed at each year end for the new year, and once at load for migrated saves. It holds 4–6
  candidates (`randInt(4, 6)`); unhired candidates leave at the refresh.
- Each candidate has a name (`src/data/managers.ts`), an age of 25–55, and skills from 1 to 5 in
  *logistics*, *production* and *frugality*, each rolled with weights 35/30/20/10/5 for 1/2/3/4/5.
  The first candidate's logistics is at least 2, so a useful hub manager is always on offer.
- **Salary** (1900 dollars a month): `50 + 20 × (logistics² + production² + frugality²)`. A 1/1/1
  manager costs $110, a 5/1/1 one $590 and a 5/5/5 one $1,550. It is charged monthly at today's
  prices under a new ledger category `'salaries'`.

### 7.2 Employment

- **Hire:** takes a candidate off the market; no fee. **Fire:** a severance of 3 months' salary at
  today's prices, under `'salaries'`.
- **Post:** a manager serves one building (a works or a warehouse) or none; a building has at most one
  manager. Unposted managers are still paid.
- **Effects at a works:** output rate ×`(1 + 0.04 × production)`; upkeep ×`(1 − 0.04 × frugality)`.
- **Effects at a hub:** logistics sets dispatch quality (§8.3); frugality cuts the warehouse's upkeep
  and its hub trucks' upkeep by the same factor.
- **Takeover:** `transferOwnership` moves the old company's managers to the buyer, posts included. A
  regional firm that closes releases its managers (they leave the game).

### 7.3 Life

- **Retirement:** each December every employed manager aged 60 or more retires with chance
  `(age − 59) / 10`, and always at 70. Their post clears and the bus emits `managerLeft`
  (`'retired'`). There is no death roll (R2).
- **Raise requests:** each December, if no request is open, the player's manager who has gone longest
  without a raise (counted from hiring), at least 4 years, asks with chance 0.3. This opens the card
  `manager_raise` (new trigger `'manager'`, appended): *grant* (salary ×1.2, free, the default),
  *pay a one-off bonus* (cost 1,500 card units; no raise, and the clock restarts) or *refuse* (free;
  with chance 0.5 the manager quits at once, `managerLeft` `'quit'`). A card whose manager has
  already left resolves with no effect.
- **Poaching (R2):** a new retaliation kind `poach_manager` is appended to `RETALIATION_KINDS`.
  Precondition: the player employs a manager with any skill of 3 or more. The Baron pays $4,000
  (1900 dollars). The player's manager with the highest skill total (lowest id on ties) joins the
  Baron at ×1.25 salary and is posted to the Baron's unmanaged hub, else his busiest unmanaged works,
  else unposted. Trait weights: cunning +3, greedy +1. Baron lines: at least 4.

### 7.4 Managers window

`PANELS.managers` ("Managers", shortcut **J**, in the Operations menu) lists the market (name, age,
skills, salary, Hire) and the company's staff (post, skills, salary, years to retirement, Assign,
Fire). Building inspectors show a manager slot with an Assign select and Unassign.

## 8. Warehouse hubs

### 8.1 The hub

A player warehouse becomes a hub when it gets its first hub truck ("Buy hub truck" in its
inspector). Hub trucks belong to the warehouse (`vehicle.hubId`), not to a route. A hub's trucks are
capped by its level (4/6/8). Every building of the owner inside the hub's range is attached, except
warehouses, stations and housing, and except for the goods routes carry there (D2).

### 8.2 Dispatch (daily, greedy)

On a hub's dispatch day (§8.3), with a manager posted and no works running, in hub id order:

1. **Candidates.**
   - *Collect* from each attached producer, for each output good not loaded there by a route:
     `amt` = whole units in stock (plus look-ahead), less loads already promised to hub trucks;
     kept if `amt ≥ 10` and the hub has room for 10. Score `amt × basePrice / (distance + 8)`, ×1.5
     when the producer's output is at least 80% of its storage.
   - *Deliver* to each attached consumer (a factory that takes the good as input, or a store for
     tier-2 goods), for each good the hub holds and no route unloads there: `qty` =
     `min(hub stock − promised, storageLeft − inbound)` (plus look-ahead), kept if `qty ≥ 10`. Score
     `qty × basePrice / (distance + 8)` × priority: 2 for a store in a town with unmet demand for the
     good, 1.5 for a factory holding less than one batch of the input, else 1.
   - *Balance* (logistics 4+, D9): for each other hub of the owner whose range overlaps, each good this
     hub holds 100+ of while the other hub's attached consumers need more than it holds: score ×0.5.
2. **Order:** score descending, then kind (deliver, collect, balance), building id, good id.
3. **Assign:** idle trucks at home in id order take candidates in order; each assignment takes up to
   one truck's capacity from the candidate, until candidates or trucks run out.
4. **Stats:** jobs assigned, idle truck-days and backlog days (a candidate of 10+ left over) feed hub
   auto-sizing (§8.4); cumulative counts per company feed the soak gates.

A hub truck's job is a two-stop trip (pickup, drop) built from its saved job, so it uses the
vehicle state machine as route trucks do. After a drop away from home it drives back and waits.
If the job's other building disappears, the job is dropped and the truck returns home; cargo on board
is unloaded into the hub.

### 8.3 Manager skill sets quality

| Logistics | Range used | Dispatch every | Look-ahead | Balancing |
|---|---|---|---|---|
| 1 | 1/3 of the range | 7 days | no | no |
| 2 | 1/2 | 5 days | no | no |
| 3 | 2/3 | 3 days | 3 days of output and use | no |
| 4 | 5/6 | 2 days | 3 days | yes |
| 5 | full | daily | 3 days | yes |

"Range used" is the radius within which buildings are attached for this dispatch; a better manager
sees further. Look-ahead adds the producer's expected output (or the consumer's expected use) over 3
days, bounded by storage. Dispatch days are staggered by hub id so hubs do not all plan on one day.

### 8.4 Hub auto-sizing (monthly)

With hub auto-sizing on (the default for new hubs), a hub buys one truck when it had 10+ backlog days
and is below its cap and the owner keeps the reserve, and sells its oldest when its trucks averaged
1.5+ idle per day and it has more than one. At most one change per hub per month. Only a truck at
home, empty and without a job is sold; with none, the sale is skipped that month. When an upgrade
finishes, the hub's truck cap rises to the new level's only if it equalled the old one.

Implementation notes: balancing counts a consumer's need over 30 days of its use (capped at its
storage); look-ahead output ignores terrain efficiency, so extractor forecasts are approximate.

### 8.5 Rendering and UI

- Selecting a warehouse draws its range circle, plus the inner "range used" circle when a manager is
  posted. Placing a warehouse shows the level-1 circle on the ghost.
- The warehouse inspector's hub section shows range, attached buildings, trucks and cap with "Buy hub
  truck", the auto-sizing switch, yesterday's jobs and idle trucks, and the no-manager warning.
- The fleet window lists hub trucks with "Hub: <warehouse>" in the route column.

## 9. The Baron and regional firms

The AI uses the same public functions as the player.

- **Levels:** once a month the Baron may upgrade one works: his works with the highest output value
  this month that is below the highest available level, not under works, at least 2 years old, when
  he keeps 2× his reserve after paying. He makes at most one upgrade every 6 months. Each regional
  firm does the same at most once a year with its own reserve.
- **Hubs:** from 1910, a Baron with 3+ chains and no hub places a warehouse at the free site nearest
  his buildings' centroid, buys 2 hub trucks and hires the best affordable market candidate with
  logistics 2+ (at the end of January, D8) to run it. A regional firm founded 5+ years ago does the
  same for its chain once it can pay for the warehouse, 2 trucks and a year of salary above its
  reserve. Hub auto-sizing grows their fleets.
- **Managers:** the Baron employs at most 2 (his hub and his busiest works), each firm at most 1.
  The AI replaces a retired or poached hub manager at the next end of January.

## 10. Save format

`SAVE_VERSION` becomes 8 with one migration `{ from: 7 }`:

- every building gets `level: 1`;
- every truck gets `model: 'steam_lorry'`, `speed: 0.5`; every train `model: 'train'`, `speed: 1`;
  capacities are kept;
- every route gets `mode: 'manual'`;
- `state.logistics` is created with an empty staff, the stats at zero, the market rng seeded from the
  game seed, and a market rolled for the save's year;
- the ledger category `'salaries'` needs no migration (absent means zero).

Every existing fixture (phase0–phase4) must load, pass `checkInvariants` and run a year. A new
fixture `phase4b` is made 50 years in by `scripts/make-fixture.ts`.

## 11. Architecture and constraints

- New code lives in `src/sim/logistics/` (types, levels, models, auto routes, hubs, managers, AI),
  with tables in `src/data/levels.ts`, `src/data/vehicleModels.ts` and `src/data/managers.ts`. One
  system is appended to `SYSTEMS`: `{ id: 'logistics', onDay, onMonth, onYear }`.
- **Determinism:** seeded rng only (the market has its own stream); every loop in id order; ties broken
  by id; no iteration over unordered maps where order matters.
- **Money:** authored in 1900 dollars and charged at `atPrices`; reported in 1900 dollars with
  `realMoney` where the soak compares.
- **Registries are append-only:** `SYSTEMS`, `PANELS`, `MIGRATIONS`, `RETALIATION_KINDS`,
  `CardTrigger`, card ids, `LedgerCategory`, `BuildingStatus`, `GameEvent`, `SHORTCUTS`.
- **Funnels:** the existing ones stay pinned. New ones: building `level`/`works` written only by
  `logistics/levels.ts`; vehicle `job`/`hubId` only by `logistics/hubs.ts`, `logistics/jobRoute.ts`,
  `logistics/autoRoutes.ts` and `logistics/release.ts`;
  manager `employer`/`post`/`salary` only by `logistics/managers.ts`, `logistics/release.ts` and
  `companies.ts`; vehicle `model`/`speed` only by `vehicles.ts` and `logistics/models.ts`.
- **Performance:** dispatch and job boards run daily, are greedy, and use Manhattan distances (no
  pathfinding in planning). The soak on seed 42 for 101 years must stay within 1.25× of the base
  commit's instruction count (`perf stat -e instructions:u`), and the 100-year balance test stays
  under its 21 s CPU limit.
- **UI:** side-panel tabs through `createWindow` (with `tabTitle` when the title is long), the shared
  `.p-row`/`.p-section` density classes, a `SHORTCUTS` entry or a drift-test exemption for each menu
  panel, and screenshots at 1366 and 1920.

## 12. Testing and gates

- Unit tests per module: level effects, works timing, model and kit maths, job boards and picking,
  auto-sizing, dispatch ordering and skill tiers, market rolls, salaries, retirement, the raise card,
  poaching, AI adoption.
- Funnel tests for the four new funnels; catalog tests for the new card and Baron lines; menu drift
  and density tests for the new window.
- Soak gates (seeds 7, 42, 1234, `--years 101`), on top of every Phase 0–4 gate:
  - player: 3+ upgrades completed, 2+ managers hired, 300+ hub jobs, 300+ loaded auto-route
    departures, a Motor Truck or later bought;
  - Baron: a works at level 2+, a hub, a manager hired;
  - regional: at least one firm with a works at level 2+ and at least one with a hub;
  - all companies: 1,000+ hub jobs; at least one manager retirement;
  - victory in 2001 and the player solvent.
- The soak's autoplay exercises the features through the public API (`autoplayLogistics`), so the
  gates measure use, not just existence.

## 13. Risks

- **Performance:** hub trucks add vehicles. Mitigated by caps (4/6/8 per hub, AI with one hub each),
  daily greedy planning and the perf gate.
- **Balance:** levels compound with growth. Mitigated by paused output, sub-linear worker and smoke
  costs that still bite in crowded towns, and AI adoption so the player's edge is not free.
- **Save churn:** one migration adds levels, models, modes and the logistics state. The phase4b
  fixture pins it for later phases.
