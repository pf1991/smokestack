# SMOKESTACK II Phase 3: Smog and Society Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pollution a moving, visible force that cities react to, from grumbling up to protests and national law. Give cities social classes that shape demand and votes. Add inflation and aging assets, so the late game keeps asking for decisions.

**Architecture:**
- The static pollution kernel becomes a smog field. It still lives in `Tile.pollution`, so the overlay, `city.pollution` and the funnel all keep working.
- The field is advected by a daily wind in `state.weather`, absorbed by forest and parks, and cleared by rain.
- City reactions live in new systems under `src/sim/society/`: escalation, strikes, regulation, classes, economy and aging.
- Every new state field is added by one save migration `{ from: 5 }`, which bumps `SAVE_VERSION` to 6. Task 1 creates it and later tasks extend it.

**Tech Stack:** TypeScript 5.6 strict, Canvas 2D, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-11-smokestack-v2-design.md` §6 (smog and society) and §11 Phase 3. Strike cards, card triggers, factions, the opinion funnel, mayor edicts (`smog_limit`) and philanthropy parks come from Phase 2.

## Global Constraints

- No runtime dependencies or asset files. Canvas 2D only.
- `src/sim` is deterministic. Use only the state rng (`src/sim/rng.ts`). Iterate in array or id order.
- `pollutionDay` (renamed `smogDay`, keeping a `pollutionDay` alias export for old importers) is the only writer of `Tile.pollution`. Update the funnel test to the new name.
- Opinion is written only through `adjustOpinion`.
- `GameState` stays plain JSON. `SAVE_VERSION` becomes 6 with one `{ from: 5 }` migration. The `phase0`, `phase1` and `phase2` fixtures must load, pass `checkInvariants` and run a year.
- Registries are append-only. No emoji anywhere in `src`. Icons come from the atlas.
- Performance: 60 fps at 1366×768 with 300 vehicles. Each sim day must cost at most 1.5× its Phase 2 time in the soak: Phase 2 runs about 13.5 s per seed per century, so the budget is about 20 s.
- The century soak with autoplay stays solvent on seeds 7, 42 and 1234 without the player ever using scrubbers, strikes or regulation tools.
- Use `docker compose`. Run `chown -R freire:freire /home/freire/projects/industry` after `npm install` and after merges. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Smog stays bounded and cheap.** The field never goes NaN, stays within [0, `POLLUTION_CAP`], and the dirty-tile list never grows past the map. Wind cannot pile all the smog on one edge tile forever. Pinned in Task 1.
2. **Escalation never locks a city out.** Tier 4 (political action) eases off when smog falls. Protests end. Every tier has a visible cause in the city panel. Pinned in Task 3.
3. **Strikes always end.** A strike has a hard maximum length, and the strike card offers at least one free resolution. Pinned in Task 4.
4. **Regulation is survivable.** Fines are capped per month as a share of revenue, and an upgrade path always exists in the era the law arrives. Pinned in Task 5.
5. **Inflation does not break the old economy.** Prices, costs and wages scale together, so a chain that was profitable in 1910 stays profitable in 1990 when nothing else changes. Pinned in Task 8.

---

### Task 1: Smog field with wind, terrain and rain

**Files:**
- Modify:
  - `src/sim/pollution.ts`: `smogDay`, wind advection, absorption.
  - `src/sim/types.ts`: `GameState.weather`.
  - `src/sim/state.ts`: `createGame`.
  - `src/sim/migrations.ts` and `src/sim/version.ts`: `{ from: 5 }`, version 6.
  - `src/sim/funnels.test.ts`.
  - `src/sim/invariants.ts`.
- Create: `src/sim/weather.ts`
- Test: `src/sim/pollution.test.ts`, `src/sim/weather.test.ts`, `src/sim/migrations.test.ts`

**Interfaces:**
- `GameState.weather: { windX: number; windY: number; rain: boolean; rainDays: number }`. The wind components are each in [-1, 1].
- `export function prevailingWind(month: number): { x: number; y: number }`:
  - Months 3–8 give westerlies `(1, -0.2)`.
  - Months 9–11 give `(0.6, 0.6)`.
  - Months 12, 1 and 2 give northerlies `(0.2, 1)`.
- `export function weatherDay(ctx: SimContext): void`:
  - The wind becomes prevailing plus a jitter in ±0.35 per component from `random(state)`, clamped to [-1, 1].
  - Rain falls with `chance(state, RAIN_CHANCE[month])`. The table has 12 values: wetter in winter (0.35) and drier in summer (0.15).
  - It runs before `smogDay` each day.
- `smogDay` rules, run in this order:
  1. **Emission.** Each `'ok'` building emits `def.pollution × 2` at its centre tile, with a 1-tile kernel: centre 1, orthogonal neighbours 0.5. This replaces the radius-3 kernel. The emission is scaled by Phase 3 emission modifiers (Task 6), which are 1 until then.
  2. **Advection.** For each dirty tile, a fraction `ADVECT = 0.25` moves downwind, split between the x and y neighbours in proportion to |windX| and |windY|. A 0.06 share diffuses equally to the 4 neighbours. Moves come out of a snapshot of the old values, so the step does not depend on processing order.
  3. **Decay.** The base decay is `0.97`. Forest tiles get `×0.94`. Park landmark tiles get `×0.90`; they are tiles in the `LANDMARK` layer that belong to a `park` landmark, so look them up from the city landmarks. Hills and mountain tiles get `×0.95` (wind-scoured). Grass, sand and water get the base decay only. On a rain day every tile is multiplied by `0.7`.
  4. **Settling.** A tile whose 4 neighbours are all hills or mountain (a valley pocket) keeps 50% of its decay loss. Smog pools there.
  5. **Clamp.** Values are clamped to [0, `POLLUTION_CAP`], and anything below `1e-4` becomes 0. The dirty list is maintained as now.
- The emission totals change, so retune `SOURCE_FACTOR` until the soak's mean `city.pollution` in 1950 for seed 7 is within ±30% of the Phase 2 value. Record both values in the commit body.

- [ ] **Step 1: Write the failing tests:**
  - **Determinism:** two runs give the same field hash.
  - **Bounds:** a single source with a constant east wind for 60 days leaves more smog on the 3 tiles east of the source than on the 3 tiles west of it.
  - **Absorption:** a forest tile next to a source holds less than a grass tile at the same offset.
  - **Rain:** one rain day lowers the total by at least 30%.
  - **Valley pocket:** a pocket surrounded by hills keeps more smog than open grass.
  - **Bounded field:** with 50 max-emission sources, no tile exceeds the cap and none is NaN over 365 days.
  - **Wind:** `prevailingWind(6).x > 0` and `prevailingWind(1).y > 0`.
  - **Migration:** the phase2 fixture migrates to v6 with a default `weather`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42 --years 100` and record the timings. The day cost must stay within budget, so profile if it doesn't.
- [ ] **Step 5: Commit** with `feat(smog): drifting smog field with wind, rain and absorption`.

### Task 2: Smog rendering: diorama haze, survey heatmap legend, wind vane

**Files:**
- Create: `src/render/smogHaze.ts`
- Modify:
  - `src/render/pollutionOverlay.ts`: legend.
  - `src/render/world/index.ts`: draws the haze in diorama blend.
  - `src/ui/hud.ts`: a wind vane next to the date.
- Test: `src/render/smogHaze.test.ts`, `src/render/pollutionOverlay.test.ts`

**Interfaces:**
- `export function hazeAlpha(pollution: number): number` returns `min(0.45, (p / POLLUTION_CAP) ** 0.7 * 0.6)`.
- The haze is drawn in the diorama regime (blend > 0) as soft brown-grey blobs over polluted tiles.
  - It is cached per chunk on an offscreen canvas at 1/4 resolution with a blur.
  - The cache is rebuilt at most once per game day, and only for chunks in view.
  - Haze alpha is multiplied by blend.
  - Haze drifts visually: offset the blob texture by the wind vector times a real-time phase, purely cosmetic.
- The survey regime keeps the heatmap only when the overlay is on.
- The pollution overlay gains a legend in the faction overlay's style: a ramp labelled "Clean / Hazy / Choking", drawn from an offscreen cache.
- The HUD wind vane is a small arrow icon rotated to the wind direction, with the tooltip "Wind: west, brisk" (or similar) and "Rain" on rain days.

- [ ] **Step 1: Write the failing tests:**
  - `hazeAlpha(0) === 0`, `hazeAlpha(POLLUTION_CAP) === 0.45`, and the function is monotonic.
  - The haze cache rebuilds only when the day changes.
  - The overlay legend is drawn from the cache: no per-frame `createLinearGradient`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Check performance with the DEV `fps=1` param at zoom 2, against the base commit: the regression must stay under 10%.
- [ ] **Step 4:** Check visually at 1955 zoom 2 and zoom 0.5 with the overlay on. Read the images.
- [ ] **Step 5: Commit** with `feat(render): smog haze, smog legend and wind vane`.

### Task 3: Escalation tiers, Black Lung ledger, protests

**Files:**
- Create: `src/sim/society/escalation.ts`, `src/render/protesters.ts`
- Modify:
  - `src/sim/types.ts`: `City.smog`.
  - `src/sim/production.ts`: the protest throughput factor.
  - `src/sim/market.ts` or growth: the health penalty.
  - `src/sim/politics/workforce.ts`: health reduces the pool.
  - `src/sim/politics/mayorEdicts.ts`: tier 4 forces `smog_limit` and permits.
  - `src/ui/panels/city.ts`.
  - `src/render/world/index.ts`.
- Test: `src/sim/society/escalation.test.ts`

**Interfaces:**
- `City.smog: { tier: 0 | 1 | 2 | 3 | 4; months: number; blackLung: number }`. `months` counts consecutive months above the current tier's threshold. `blackLung` is the cumulative number of smog deaths.
- Thresholds on `city.pollution`, entered after 3 consecutive months above the threshold:

  | Tier | Pollution above |
  |---|---|
  | 1 | 0.15 |
  | 2 | 0.30 |
  | 3 | 0.45 |
  | 4 | 0.60 |

  A city drops one tier after 3 consecutive months below 80% of its tier's threshold.
- Tier effects, each tier including the ones below it:
  1. Monthly reformers −1.5 and workers −1 in that city (not logged), plus a smog editorial at most once a year. The editorial reuses the existing `HEADLINES`.
  2. Growth loses `0.004` per month from the rate. Black Lung deaths of `round(population * pollution * 0.0004)` per month are added to `blackLung`. The workforce pool is multiplied by `(1 - 0.5 * pollution)`.
  3. Protests. Player polluting buildings in the city zone run at `×0.8` throughput. Protester sprites (5–9 marchers with placards) walk the road tiles nearest the largest player polluter, drawn per frame in the diorama. Survey mode shows a red fist glyph near the city label. A `'protest'` news item is published when tier 3 is entered.
  4. Political action. The city gains `smog_limit` and `permits_required` regardless of its mayor; `chooseMayorEdicts` then unions them in. The reformers' election score gets `×1.5`.
- `export function nationalBlackLung(state): number`, shown in the politics window ("Black Lung toll").
- The city panel shows a smog tier row: the tier name (Clean / Grumbling / Ailing / Protesting / Revolt), the current pollution, the trend, and what lowers it.

- [ ] **Step 1: Write the failing tests:**
  - Tier entry needs 3 months above the threshold, and exit needs 3 months below 80% of it.
  - The tier effects stack.
  - Black Lung accumulates deterministically.
  - Tier 4 adds `smog_limit` and `permits_required`, and removes them when the tier drops (unless the mayor's own edicts include them).
  - Protest throughput is 0.8 only for player polluters in the zone.
  - The protesters render: one draw call batch per city, using a mock context.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42,1234 --years 100` and report the highest tier reached per seed. Then check visually: a forced tier-3 city via the DEV param `smogtier=<cityId>:3`. Read the image.
- [ ] **Step 5: Commit** with `feat(society): smog escalation, black lung and protests`.

### Task 4: Strikes

**Files:**
- Create: `src/sim/society/strikes.ts`
- Modify:
  - `src/sim/types.ts`: `Building.strike?: { until: number; reason: string } | null`.
  - `src/sim/production.ts`: a striking building produces nothing and its status is `'halted'`.
  - `src/sim/politics/cards.ts`: trigger `'strike'`.
  - `src/render/world/index.ts`: picket sprites.
  - `src/ui/panels/building.ts`.
- Test: `src/sim/society/strikes.test.ts`

**Interfaces:**
- **Slowdown.** While a city's `opinion.workers` is below 30, player buildings staffed from that city run at `×0.9`.
- **Strike chance.** Monthly, each player factory or extractor staffed from a city with `opinion.workers < 25` strikes with `chance(state, p)`:
  - The base `p` is 0.04.
  - Union stance multiplies it: crush ×1.5, tolerate ×1, recognise ×0.4.
  - Wage multiplies it: low ×1.5, generous ×0.5.
  - At most one new strike starts per city per month.
- A strike lasts 30–90 days (`randInt`), with a hard maximum of 120 days.
- When a strike starts, `triggerCard(ctx, 'strike', cityId)` opens a strike card. The dormant Phase 2 strike cards fire now. Their `apply` hooks resolve the strike as follows:
  - **Concede:** cost, workers +8, the strike ends now.
  - **Wait it out:** free, the strike continues.
  - **Break it:** cost, workers −12, oldmoney +4, the strike ends in 7 days, and scandal risk +0.1.

  The engine passes the building through the card instance's `cityId`. Keep a `strikeTarget` in the strike state, so `apply` can find the building in that city.
- Pickets are drawn as 3–5 sprites with placards at the building's access tile, per frame, in the diorama only.
- The building inspector shows "On strike until <date> — <reason>".

- [ ] **Step 1: Write the failing tests:**
  - Slowdown at workers 29 but not at 30.
  - The strike chance is scaled by union stance and wages, checked with seeded counts over 1,000 trials within tolerance.
  - A strike halts production and ends by 120 days at the latest.
  - At most one new strike per city per month.
  - Each strike card's choices end the strike as specified.
  - A building demolished mid-strike leaves no dangling state.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Make sure every strike card has a free choice: "Wait it out".
- [ ] **Step 4:** Run `npm test` and the soak. The autoplay player rarely has low workers opinion, so report the number of strikes per seed.
- [ ] **Step 5: Commit** with `feat(society): slowdowns, strikes and pickets`.

### Task 5: National regulation

**Files:**
- Create: `src/sim/society/regulation.ts`, `src/data/laws.ts`
- Modify: `src/sim/types.ts` (`state.society.laws`), `src/ui/panels/politics.ts` (a "Law of the land" section), `src/data/cards/*` (one card per law passing, plus "lobby against" choices)
- Test: `src/sim/society/regulation.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- `export type LawId = 'smoke_abatement' | 'clean_air' | 'emission_caps'`
- `LAWS`:

  | Law | Earliest | Latest (forced) | Trigger | Scrubber tier required |
  |---|---|---|---|---|
  | smoke_abatement | 1908 | 1925 | national mean `city.pollution` (population-weighted) > 0.25 for 24 consecutive months | 1 |
  | clean_air | 1950 | 1970 | the same, > 0.18 | 2 |
  | emission_caps | 1988 | 1995 | the same, > 0.12 | 3 |

- `export function regulationMonth(ctx: SimContext): void` passes a law when its trigger holds within the window, or at the start of its latest year.
  - Passing publishes a `'historic'` news item and opens a law card with choices: comply (free), lobby for delay (cost, scandal risk), or praise publicly (reformers +6).
  - From the passing date, each player building with `def.pollution > 0` whose scrubber tier is below the law's required tier pays a monthly fine of `def.pollution * 400 * priceIndex`. Total fines are capped at 25% of last month's sales revenue.
  - Lobbying delays enforcement by 24 months, once per law.
- Task 5 creates `src/sim/society/economy.ts` with `export function priceIndex(state: GameState): number`, which returns `state.economy?.priceIndex ?? 1`. Tasks 5 and 6 use it. Task 8 adds `state.economy` and inflation, so before Task 8 the index is simply 1.
- `state.society = { laws: Record<LawId, { passed: number | null; enforcedFrom: number | null; lobbied: boolean }>; streak: Record<LawId, number> }`

- [ ] **Step 1: Write the failing tests:**
  - A law passes at its latest year when the trigger never holds.
  - A law passes early when the trigger holds for 24 months inside its window.
  - The fine is booked and capped at 25% of revenue.
  - Compliant buildings are not fined.
  - Lobbying delays enforcement by 24 months, and only once.
  - The catalog has a card per law.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the soak. Autoplay never upgrades, so it pays fines. It must stay solvent; report total fines per seed.
- [ ] **Step 5: Commit** with `feat(society): national smoke laws with fines`.

### Task 6: Scrubbers, tall chimneys, tree planting

**Files:**
- Modify:
  - `src/sim/types.ts`: `Building.upgrades?: { scrubber: 0 | 1 | 2 | 3; tallChimney: boolean }`.
  - `src/sim/pollution.ts`: emission modifiers.
  - `src/ui/panels/building.ts`: upgrade buttons.
  - `src/render/sprites.ts`: visible upgrades.
  - `src/ui/toolbar.ts` and `src/game/toolController.ts`: a "Plant trees" tool.
- Create: `src/sim/society/upgrades.ts`
- Test: `src/sim/society/upgrades.test.ts`

**Interfaces:**
- `SCRUBBER_TIERS`:

  | Tier | Year | Emission × | Cost × build | Upkeep × |
  |---|---|---|---|---|
  | 1 | 1905 | 0.7 | 0.3 | 1.1 |
  | 2 | 1948 | 0.45 | 0.5 | 1.2 |
  | 3 | 1985 | 0.2 | 0.8 | 1.3 |

  Cost and upkeep are multiplied by the price index. An upgrade replaces the previous tier.
- **Tall chimney:** available from 1900, costs 0.2× build. Emission goes to the downwind tile 2 away instead of the centre. Its advection fraction for that building's contribution is 0.4, so it spreads farther and leaves less locally.
- `export function buyUpgrade(ctx: SimContext, buildingId: number, kind: 'scrubber' | 'tallChimney'): Result` checks the owner, era, money, and that the tier only goes up.
- **Plant trees tool:** $300 × priceIndex per tile. It works on grass tiles only, never on roads, buildings, deposits, cities' core tiles or landmarks. It sets `terrain = 'forest'`. The tile writer goes through `state.ts` (`plantForest`), and the funnel test keeps the terrain writers listed.
- **Sprites:** a scrubber draws a grey filter box on the chimney. A tall chimney draws a taller stack.

- [ ] **Step 1: Write the failing tests:**
  - Each tier's emission multiplier applies.
  - A tall chimney moves deposition downwind.
  - Era gating works.
  - Cost and upkeep are multiplied by the price index.
  - `plantForest` refuses roads, buildings and landmarks, and accepts grass.
  - Absorption goes up after planting.
  - The tier must go up.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Commit** with `feat(society): scrubbers, tall chimneys and tree planting`.

### Task 7: Classes and class demand

**Files:**
- Create: `src/sim/society/classes.ts`
- Modify:
  - `src/sim/types.ts`: `City.classes: { working: number; middle: number; upper: number }`, summing to 1.
  - `src/sim/market.ts`: `monthlyDemand` is class-weighted.
  - `src/data/goods.ts`: `CLASS_DEMAND`.
  - `src/sim/politics/elections.ts`: faction weights from classes.
  - `src/render/sprites.ts`: house art by class.
  - `src/ui/panels/city.ts`: a class bar.
- Test: `src/sim/society/classes.test.ts`

**Interfaces:**
- **Initial classes:** working 0.75, middle 0.2, upper 0.05.
- `export function classesMonth(ctx)` shifts the classes each month by small deltas, then normalises:
  - middle `+0.0004 × (1 + satisfaction)`, plus `0.0002` after 1945 (post-war boom);
  - upper `+0.0001 × satisfaction`, and `−0.0006 × pollution` (the rich flee smog);
  - working takes up the remainder.
  - Each class is clamped to [0.05, 0.85].
- `CLASS_DEMAND[good]: { working; middle; upper }` multipliers:
  - **Luxury:** furniture, cars, computers, toys, cheese, juice are low for working (0.6), 1.2 for middle and 2.0 for upper.
  - **Staples:** bread and clothes are 1.2 for working, 1.0 for middle and 0.7 for upper.
  - **Everything else:** 1.0.
  - Demand is multiplied by `sum(class share × multiplier) / sum(initial share × multiplier)`, so a 1900 city keeps its v1 demand.
- **Election faction weights:**
  - workers: `0.40 × working / 0.75`
  - oldmoney: `0.18 × upper / 0.05` (capped at 0.4)
  - reformers: `0.17 × middle / 0.2`
  - church: 0.20
  - baron: 0.05

  Normalise the weights. `FACTIONS[f].weight` stays as the base.
- **House art:** villas when the city's upper share exceeds 0.15, semis when middle exceeds 0.35, and terraces stay for the working class. This adds `'semi' | 'villa'` to `HouseTier`, decided per tile by a hash so that districts mix.

- [ ] **Step 1: Write the failing tests:**
  - The classes always sum to 1 and stay within their clamps.
  - Pollution lowers the upper share.
  - Demand for a 1900 initial-class city equals the pre-change demand, within 1e-9.
  - An upper-heavy city demands more cars and less bread.
  - The election weights shift with the classes.
  - `houseTier` returns villa for an upper-heavy city.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42,1234 --years 100`. Expected: solvent. Report the class mix in 2000 for the biggest city.
- [ ] **Step 5: Commit** with `feat(society): social classes shape demand, votes and housing`.

### Task 8: Inflation and asset aging

**Files:**
- Create: `src/sim/society/economy.ts`, `src/sim/society/aging.ts`
- Modify:
  - `src/sim/types.ts`: `state.economy: { priceIndex: number; history: number[] }`, `Building.builtYear`, `Vehicle.builtYear`.
  - `src/sim/market.ts`: `salePrice × priceIndex`.
  - `src/sim/state.ts` and `src/sim/politics/mayorEdicts.ts`: construction costs × priceIndex.
  - `src/sim/production.ts`: maintenance × priceIndex × aging.
  - `src/sim/vehicles.ts`: vehicle prices and upkeep × priceIndex × aging.
  - `src/sim/politics/cards.ts`: `cardScale` uses priceIndex instead of the era term.
  - `src/ui/panels/building.ts` and `src/ui/panels/fleet.ts`: age plus a Renew or Replace action.
  - `src/ui/panels/finance.ts`: a price-index line.
- Test: `src/sim/society/economy.test.ts`, `src/sim/society/aging.test.ts`

**Interfaces:**
- `export const DECADE_INFLATION: Record<number, number>` gives annual rates per decade start:

  | Decade | Annual rate |
  |---|---|
  | 1900 | 0.01 |
  | 1910 | 0.05 |
  | 1920 | −0.01 |
  | 1930 | −0.02 |
  | 1940 | 0.05 |
  | 1950 | 0.025 |
  | 1960 | 0.03 |
  | 1970 | 0.08 |
  | 1980 | 0.05 |
  | 1990 | 0.03 |

  The `economyMonth` step multiplies `priceIndex` by `(1 + rate)^(1/12)`. The index starts at 1 in 1900 and reaches about 6 by 2000.
- Scaled by the index:
  - all sale prices, construction and upgrade costs, maintenance, vehicle prices and upkeep, tolls, fines, philanthropy prices and slush cost;
  - `STARTING_MONEY`, which applies only to new games and so stays 1.
  - Loans stay nominal: `LOAN_STEP` and `MAX_LOAN` are scaled by the index at the time the loan is taken, and the balance owed is nominal.
- **Aging:** buildings and vehicles record `builtYear`, set by migration to the current year for existing assets.
  - After 15 years, efficiency is `max(0.7, 1 − 0.01 × (age − 15))`, applied to production and vehicle speed.
  - Upkeep is `min(1.8, 1 + 0.02 × (age − 15))`.
  - `renewBuilding` costs 40% of the current build cost and sets `builtYear` to now. `replaceVehicle` sells and rebuys at the current price, keeping the route.
- The building inspector shows "Built 1912 (age 41): 74% efficiency". The fleet window shows an age column and a "Replace" button.

- [ ] **Step 1: Write the failing tests:**
  - The price index after 12 months in the 1970s is ×1.08 ± 1e-9.
  - The index in 2000 is in [5, 8].
  - **Review Focus #5:** a fixed chain's profit margin (revenue/cost ratio) in 1990 is within ±5% of its 1910 value when aging is disabled.
  - The aging efficiency and upkeep curves.
  - Renew resets the age.
  - Replace keeps the route.
  - Migration sets `builtYear` and `priceIndex = 1`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Autoplay never renews, so its old buildings decline. That is intended pressure, but the soak must stay solvent. If it doesn't, add a renew step to autoplay (the autoplay player renews every building at age 30) and report it.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42,1234 --years 101`. Expected: solvent. Report final net worths.
- [ ] **Step 5: Commit** with `feat(society): inflation and aging assets`.

### Task 9: Phase 3 gate

**Files:**
- Create: `src/sim/__fixtures__/phase3.save.json`
- Modify:
  - `scripts/soak.ts`, adding these assertions:
    - a smog tier ≥ 2 reached in at least one city per seed;
    - a regulation law passed;
    - `priceIndex` in 2000 within [5, 8];
    - no NaN anywhere in the smog field;
    - still solvent.
  - `README.md`: a "What's new (Phase 3)" section.

- [ ] **Step 1:** Run `npm run fixture -- --name phase3 && npm test`. Expected: all four fixtures load.
- [ ] **Step 2:** Run `npm run soak -- --seeds 7,42,1234 --years 101`. Expected: exit 0, with timing within budget compared with Phase 2.
- [ ] **Step 3:** Run `bash scripts/shots.sh`, read the shots, and take showcase shots of the haze, protests, a strike and the smog legend.
- [ ] **Step 4:** Run `npm run build && docker compose build`. The `up` waits for the merge.
- [ ] **Step 5: Commit** with `test: phase 3 fixture and gate`, then run `chown`.
