# SMOKESTACK 1.0 R4: Product Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the catalogue from 27 to 61 goods across the century: 6 raw goods, 8 materials, a
new tier of 7 components, and 13 consumer goods, made in 20 new works. Add a Trading House that
sells surplus materials and components at a drifting national price, so that deep chains of four or
five levels pay more per worker than the 1900 two- and three-level chains.

**Architecture:**
- **Data first.** `GoodDef.kind` replaces `tier === n` everywhere. New goods, recipes and buildings
  are plain entries in `src/data/*.ts`. The chain helpers, unlocks, codex, Baron planner and chain
  report are already data-driven, so they pick the entries up.
- **One new sim system, `trade`.** It runs on `src/sim/trade.ts` and keeps its own rng stream in
  `state.trade`, so price drift never moves `state.rngState`. A v9 save migration adds it.
- **A new building category, `'trade'`.** It is a shared-storage seller like `retail`, but it is
  not a store. Every site that tests `'retail'` is listed in Task 4 with its ruling.
- **UI.** The kind drives the build-bar tab, adding a "Components" tab. The codex gets kind
  filters. Route chips cap their overflow.

**Tech Stack:** TypeScript 5.6 strict, Vite 5, Vitest + jsdom, Canvas 2D. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-smokestack-1.0-release-design.md` (§7 R4, §9 global
constraints). Brief: `docs/superpowers/specs/2026-10-17-product-expansion-brief.md`. Touchpoint map and
early rulings: `.superpowers/sdd/r4-touchpoints.md`.

## Global Constraints

- **Branch:** build on `release/r4`, cut from `main` once R1–R3 have merged. Run tests under
  Node 24: `source ~/.nvm/nvm.sh && nvm use 24` before any `npm` or `npx` command. Run
  `chown -R freire:freire /home/freire/projects/industry` after `npm ci` and at the end of every task.
- **Determinism:** `src/sim` uses state rng only:
  - the main stream (`state.rngState`, via `random(state)`);
  - or a stream of its own, stored in its state slice and seeded from `state.seed`, as
    `state.logistics` and `state.exchange` already are.

  No `Math.random`, no wall clock and no iteration over `Set`s built from unordered input. Every
  new loop over goods runs in catalogue order (`Object.keys(GOODS)` or `demandGoods()`).
- **Saves:**
  - `SAVE_VERSION` becomes 9, with exactly one new migration, `{ from: 8 }` (Task 4).
  - Every fixture in `src/sim/__fixtures__/` must still load, pass `checkInvariants` and run 360
    days.
  - Task 10 adds `phase4c.save.json`.
  - Old saves get no new deposits. **Binding ruling:** copper ore and bauxite come from
    terrain-only extractors, not map deposits (`r4-touchpoints.md`). So `mapgen.ts`,
    `Tile.deposit` and `render/terrain.ts` stay untouched.
- **Existing content is unchanged:**
  - **Values:** every existing recipe, good price, demand figure and building stat stays as it is.
  - **Placement in the tables:**
    - New demand entries go at the **end** of `DEMAND_PER_1000` and `CLASS_DEMAND`.
      `computeDailySales` rotates its starting store by the good's index, so the old goods must
      keep theirs.
    - New recipes come **after** every existing recipe that makes the same good. `firstRecipeFor`
      and `producerOf` take the first match, so the Baron and the chain report keep their old
      choices for old goods.
    - In `GOODS`, new goods go in their kind's section, which the codex reads as catalogue order.
    - In `BUILDINGS`, new works go before `store` and the Trading House goes after it. No new
      building makes an old good, except the farm's beet recipe and the electronics plant's tube
      radios, which are appended to those buildings' own `recipes` lists.
- **No runtime dependencies, no CDN, no emoji in `src`.** Icons come from the atlas.
- **UI:** any new or changed UI uses the R2 tokens and `src/ui/kit.ts` components only. CSS goes in
  files already listed in `MIGRATED_CSS`, which is now every UI CSS file, so the CSS gate covers it.
- **Layout bounds:** it must work at 1366×768 and 1920×1080. The build bar's tab row stays on one
  line at 1366 with UI scale 1.3.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One commit per
  task unless a step says otherwise.

## Rulings made in this plan

These are the decisions an implementer could not make alone. Later tasks rely on them.

| # | Question | Ruling |
|---|---|---|
| P1 | How does the Trading House fit the category model? | It gets a **new category, `'trade'`**, not a flag. TypeScript's exhaustive `switch` in `acceptsGood` and the `Record<BuildingCategory, …>` maps then force every site that must decide. A `category === 'retail'` test excludes the Trading House by default, which is right for towns, politics, the Baron and the regional firms. |
| P2 | Where do components go in the build bar? | A **new "Components" tab**, between Refine and Manufacture, with the `gear` icon. A building's tab is the kind of its **first recipe's first output**. That gives the same tab as today for all 25 existing buildings. |
| P3 | How many codex chips? | **All, plus five filters:** Raw, Materials, Components, Consumer, I make this. All stays as the default and the reset; R3's tests depend on it. |
| P4 | What happens to growth when the town wants 24 goods? | The **baseline rule** below. Without it, 13 new unmet goods would cut every town's mean satisfaction and slow growth in old saves. |
| P5 | Is drift on the main rng stream? | **No.** `state.trade.rngState` is seeded `(seed ^ 0x54524144) \| 0` ("TRAD"). Drift then never changes the outcome of contracts, the Baron, cards or anything else. |
| P6 | Do hub trucks deliver to a Trading House? | **No, not in R4.** Hubs would dump the inputs that factories wait for. Only manual or automatic routes the player sets up feed it. |
| P7 | How do component contracts get delivered? | Through the player's **Trading House sales of that good, anywhere in the country**. They're offered only while the player owns a Trading House and can make the component (`canMake`). |
| P8 | How is the fade text pluralised? | An optional `GoodDef.plural` for goods with a singular name, read through `goodPlural(g) = g.plural ?? g.name`. |
| P9 | What do the regional firms get? | **One new firm**, `regional_4` making shoes, founded from 1912. Its chain is cattle → leather → shoes, which is linear, so `chainBuilder` handles it. |
| P10 | Is there an alternative recipe? | **Two, both appended:** `r_calculators_chip` (1972) and `r_radios_tubes` (1925). No other variants. |
| P11 | Where does copper ore come from? | The **Copper Mine** is a separate terrain-only extractor on hills and mountain. The existing `mine` stays deposit-only. |

**Baseline rule (P4).**
- `BASELINE_GOODS` is the 11 goods of the v1 catalogue: `furniture`, `bread`, `tools`, `clothes`,
  `cheese`, `juice`, `toys`, `cars`, `radios`, `tvs` and `computers`. It's exported from
  `src/data/goods.ts`.
- `averageSatisfaction` takes two means over the goods the town wants this month:
  - `base`: the mean satisfaction of the baseline goods (0.4 when none are wanted, as today);
  - the overall result: the mean over all wanted goods, where each **non-baseline** wanted good
    counts as `max(satisfaction, base)`.
- A town that is sold none of the new goods therefore gets exactly today's figure. Selling a new
  good can only raise it.

## Review Focus

1. **Old saves.** A v8 save has no `trade` slice and no new buildings, and its map has no new
   deposits.
   - After migration, its first `checkUnlocks` unlocks the new goods for its year.
   - Its towns' `averageSatisfaction` is unchanged by the baseline rule.
   - The Baron may now pick new goods.

   Pinned in Task 4 (migration test) and Task 3 (baseline test on the `phase4b` fixture, before
   any day runs).
2. **The Baron planning chains he can't finish.** Terrain-only extractors can find no site, for
   example a copper mine on a map with no free hills near the plant. Deep chains (refrigerators
   need 10 works and a store) tie up his cash. A failed site must reach `fail` → `abandon` →
   `block` within the existing limits (`MAX_FAILS = 2`, `rival/projects.ts:26`), with no leaked
   buildings or routes, and the chain's cost must be counted before he starts. Pinned in Task 9.
3. **Storage pools flooded by many goods.**
   - A store's 300-unit shared pool now accepts 24 goods.
   - A Trading House's 600-unit pool accepts 22.
   - A warehouse accepts all 61.
   - A full pool must refuse cargo (`storageLeft` 0), and the truck keeps it, as today.
   - The route editor must stay usable with 24 chips.

   Pinned in Tasks 4 and 5.
4. **Contracts for goods nobody can make yet.** Two cases must stay off the board: microchips
   in 1970–1971, before their recipe unlocks in 1972, and any component while the player has no
   Trading House to sell it through. `canMake` and the ownership check keep them off. Pinned in
   Tasks 4 and 8.
5. **Price drift exploits.**
   - Hoarding stock and dumping it at the top of the drift is worth at most base × 0.8 × 1.25,
     which is the base price.
   - Saturation is national and shared by every house, so building ten houses doesn't sell ten
     times as much at full price.
   - Nothing can be bought, so no buy-low, sell-high loop exists.

   Pinned in Task 4.
6. **The cost of 24 demand goods per town per day.** `computeDailySales`, `averageSatisfaction`,
   `chooseProject` and `cityDemand` all loop over the demand goods. The century soak's ms must stay
   within 1.2× the baseline recorded in Task 1. Gated in Task 10.

---

## Data tables

These are the values the implementation must use. The chain figures in Table E come from a scratch
model of `chainEconomics` with these tables. Task 3 makes `scripts/chain-report.ts` print them, and
the balance gate in Task 3 enforces them.

### Table G: new goods (34)

`tier` is kept for compatibility: raw 0, material and component 1, consumer 2. Nothing reads it
after Task 1.

| id | name | kind | era | fadeYear | basePrice | color | plural |
|---|---|---|---|---|---|---|---|
| copper_ore | Copper Ore | raw | 1900 | null | 6 | #4f8a6e | |
| cattle | Cattle | raw | 1900 | null | 10 | #7a4b3a | |
| sugar_beet | Sugar Beet | raw | 1900 | null | 3 | #c77d9b | |
| clay | Clay | raw | 1900 | null | 2 | #b5653d | |
| rubber | Rubber | raw | 1910 | null | 8 | #5a5f3c | |
| bauxite | Bauxite | raw | 1920 | null | 6 | #d08a5a | |
| copper | Copper | material | 1900 | null | 24 | #c46f3b | |
| leather | Leather | material | 1900 | null | 14 | #b08060 | |
| sugar | Sugar | material | 1900 | null | 9 | #f5efe0 | |
| bricks | Bricks | material | 1900 | null | 8 | #a63d2a | |
| paper | Paper | material | 1900 | null | 10 | #efe6c8 | |
| chemicals | Chemicals | material | 1920 | null | 24 | #9bcf3c | |
| aluminium | Aluminium | material | 1925 | null | 45 | #c9d1d9 | |
| silicon | Silicon | material | 1965 | null | 45 | #6b7fa3 | |
| wire | Wire | component | 1900 | null | 32 | #d4a017 | |
| tyres | Tyres | component | 1910 | null | 20 | #34495e | |
| engines | Engines | component | 1910 | null | 150 | #5b6770 | |
| electric_motors | Electric Motors | component | 1920 | null | 140 | #3e7cb1 | |
| vacuum_tubes | Vacuum Tubes | component | 1920 | null | 22 | #ffb347 | |
| microchips | Microchips | component | 1972 | null | 50 | #3a7d2c | |
| displays | Displays | component | 1975 | null | 90 | #0f6e8c | |
| shoes | Shoes | consumer | 1900 | null | 52 | #4a2c1a | |
| candy | Candy | consumer | 1900 | null | 16 | #ff7eb6 | |
| books | Books | consumer | 1900 | null | 36 | #7d2e46 | |
| canned_food | Canned Food | consumer | 1900 | null | 18 | #b0413e | |
| phonographs | Phonograph | consumer | 1905 | **1955** | 120 | #a67c00 | Phonographs |
| bicycles | Bicycle | consumer | 1910 | null | 120 | #2f8f83 | Bicycles |
| motorcycles | Motorcycle | consumer | 1915 | null | 480 | #6d1a1a | Motorcycles |
| refrigerators | Refrigerator | consumer | 1930 | null | 520 | #dfe7ee | Refrigerators |
| washing_machines | Washing Machine | consumer | 1935 | null | 480 | #8fb8d8 | Washing Machines |
| cosmetics | Cosmetics | consumer | 1950 | null | 40 | #d65a8c | |
| calculators | Calculator | consumer | 1970 | **1995** | 120 | #707070 | Calculators |
| video_games | Video Games | consumer | 1978 | null | 150 | #7b3fe4 | |
| mobile_phones | Mobile Phone | consumer | 1990 | null | 650 | #14213d | Mobile Phones |

- **Existing goods also get a `plural`** (Task 6): radios `Radios`, tvs `Televisions`, computers
  `Computers`, cars `Automobiles`.
- **Kind of the existing goods** (Task 1): tier 0 → `raw`, tier 1 → `material`, tier 2 →
  `consumer`. None of them is a component.
- **Final counts:** 15 raw, 15 material, 7 component and 24 consumer goods, 61 in all.

### Table D: town demand (appended in this order)

`MIDDLE` is a new class profile, `{ working: 0.8, middle: 1.5, upper: 1.2 }`. `STAPLE`, `LUXURY` and
`PLAIN` already exist.

| good | DEMAND_PER_1000 | CLASS_DEMAND |
|---|---|---|
| shoes | 14 | STAPLE |
| candy | 30 | PLAIN |
| books | 10 | MIDDLE |
| canned_food | 40 | STAPLE |
| phonographs | 3 | MIDDLE |
| bicycles | 4 | STAPLE |
| motorcycles | 1.5 | PLAIN |
| refrigerators | 1.5 | MIDDLE |
| washing_machines | 1.5 | MIDDLE |
| cosmetics | 12 | LUXURY |
| calculators | 3 | MIDDLE |
| video_games | 4 | PLAIN |
| mobile_phones | 2 | PLAIN |

### Table R: new recipes (37)

The recipe era is the max era of its goods, from `recipeEra`.

| id | building | inputs | outputs | days | era |
|---|---|---|---|---|---|
| r_copper_ore | copper_mine | — | copper_ore 10 | 1 | 1900 |
| r_cattle | ranch | — | cattle 4 | 1 | 1900 |
| r_sugar_beet | farm (appended) | — | sugar_beet 12 | 1 | 1900 |
| r_clay | clay_pit | — | clay 12 | 1 | 1900 |
| r_rubber | rubber_plantation | — | rubber 8 | 1 | 1910 |
| r_bauxite | bauxite_quarry | — | bauxite 10 | 1 | 1920 |
| r_copper | smelter | copper_ore 8, coal 2 | copper 4 | 1 | 1900 |
| r_aluminium | smelter | bauxite 8, coal 4 | aluminium 2 | 1 | 1925 |
| r_leather | tannery | cattle 2 | leather 4 | 1 | 1900 |
| r_sugar | sugar_refinery | sugar_beet 12 | sugar 6 | 1 | 1900 |
| r_bricks | brickworks | clay 10, coal 2 | bricks 8 | 1 | 1900 |
| r_paper | paper_mill | wood 10 | paper 6 | 1 | 1900 |
| r_chemicals | chemical_works | coal 4, oil 4 | chemicals 4 | 1 | 1920 |
| r_silicon | chemical_works | sand 8, coal 2 | silicon 2 | 1 | 1965 |
| r_cosmetics | chemical_works | chemicals 2, glass 1 | cosmetics 4 | 1 | 1950 |
| r_wire | machine_shop | copper 4 | wire 4 | 1 | 1900 |
| r_tyres | machine_shop | rubber 4, fabric 1 | tyres 4 | 1 | 1910 |
| r_engines | machine_shop | steel 3, fuel 1 | engines 1 | 1 | 1910 |
| r_electric_motors | machine_shop | wire 2, steel 1 | electric_motors 1 | 1 | 1920 |
| r_vacuum_tubes | electronics_works | glass 2, wire 1 | vacuum_tubes 6 | 1 | 1920 |
| r_microchips | electronics_works | silicon 2, wire 1 | microchips 4 | 1 | 1972 |
| r_displays | electronics_works | glass 2, chemicals 1, plastic 1 | displays 2 | 1 | 1975 |
| r_shoes | shoe_factory | leather 4 | shoes 2 | 1 | 1900 |
| r_candy | confectionery | sugar 3, milk 2 | candy 6 | 1 | 1900 |
| r_books | print_works | paper 6 | books 3 | 1 | 1900 |
| r_canned_food | cannery | cattle 2, steel 1 | canned_food 6 | 1 | 1900 |
| r_bicycles | cycle_works | steel 2, tyres 2 | bicycles 2 | 1 | 1910 |
| r_motorcycles | cycle_works | engines 1, tyres 2, steel 1 | motorcycles 1 | 1 | 1915 |
| r_phonographs | appliance_plant | lumber 2, copper 2 | phonographs 2 | 1 | 1905 |
| r_refrigerators | appliance_plant | steel 3, electric_motors 1, chemicals 1 | refrigerators 1 | 1 | 1930 |
| r_washing_machines | appliance_plant | steel 3, electric_motors 1, rubber 1 | washing_machines 1 | 1 | 1935 |
| r_calculators | gadget_assembly | vacuum_tubes 2, plastic 1 | calculators 2 | 1 | 1970 |
| r_calculators_chip | gadget_assembly | microchips 1, plastic 1 | calculators 2 | 1 | 1972 |
| r_video_games | gadget_assembly | microchips 2, plastic 1 | video_games 2 | 1 | 1978 |
| r_mobile_phones | gadget_assembly | microchips 2, displays 1, aluminium 1 | mobile_phones 1 | 1 | 1990 |
| r_radios_tubes | electronics_plant (appended) | vacuum_tubes 2, lumber 2 | radios 2 | 1 | 1925 |

At base price, every consumer recipe's output is worth more than its inputs. The tightest is
`r_mobile_phones`, at 650 against 235.

### Table B: new buildings (21)

Every one has `requiresDeposit: false` and `requiresCity: false`. `EX` sets 20 workers and `FA`
sets 60, except where the table gives a value in bold.

| id | name | cat | size | cost | maint | terrain | recipes | storage | era | smoke | workers | height | color |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ranch | Cattle Ranch | extractor | 3×3 | 14000 | 200 | grass | r_cattle | 120 | 1900 | 1 | 20 | 8 | #9c6b3f |
| clay_pit | Clay Pit | extractor | 2×2 | 8000 | 125 | grass, hills | r_clay | 160 | 1900 | 1 | 20 | 6 | #b86b45 |
| copper_mine | Copper Mine | extractor | 2×2 | 22000 | 350 | hills, mountain | r_copper_ore | 160 | 1900 | 3 | 20 | 10 | #5f7a68 |
| rubber_plantation | Rubber Plantation | extractor | 3×3 | 15000 | 200 | grass, forest | r_rubber | 120 | 1910 | 0 | 20 | 8 | #4f6b3a |
| bauxite_quarry | Bauxite Quarry | extractor | 2×2 | 20000 | 300 | hills | r_bauxite | 160 | 1920 | 3 | 20 | 8 | #b5562e |
| smelter | Smelter | factory | 3×3 | 45000 | 600 | grass, sand, hills | r_copper, r_aluminium | 120 | 1900 | 6 | 60 | 20 | #7a4e3a |
| tannery | Tannery | factory | 2×2 | 18000 | 250 | grass, sand | r_leather | 120 | 1900 | 3 | **90** | 14 | #8c6d4f |
| sugar_refinery | Sugar Refinery | factory | 3×3 | 25000 | 300 | grass, sand | r_sugar | 120 | 1900 | 2 | 60 | 16 | #e9d9d0 |
| brickworks | Brickworks | factory | 3×3 | 20000 | 250 | grass, sand, hills | r_bricks | 160 | 1900 | 5 | **90** | 16 | #9e3b2b |
| paper_mill | Paper Mill | factory | 3×3 | 28000 | 350 | grass, sand | r_paper | 120 | 1900 | 3 | 60 | 16 | #d9cfb0 |
| chemical_works | Chemical Works | factory | 3×3 | 65000 | 850 | grass, sand | r_chemicals, r_silicon, r_cosmetics | 120 | 1920 | 7 | 60 | 18 | #7fa83a |
| machine_shop | Machine Shop | factory | 3×3 | 40000 | 500 | grass, sand, hills | r_wire, r_tyres, r_engines, r_electric_motors | 100 | 1900 | 3 | 60 | 16 | #56606b |
| electronics_works | Electronics Works | factory | 3×3 | 80000 | 800 | grass, sand | r_vacuum_tubes, r_microchips, r_displays | 80 | 1920 | 1 | **30** | 18 | #3b7f9e |
| shoe_factory | Shoe Factory | factory | 2×2 | 20000 | 250 | grass, sand | r_shoes | 80 | 1900 | 1 | 60 | 14 | #5a3a26 |
| confectionery | Confectionery | factory | 2×2 | 16000 | 200 | grass, sand | r_candy | 80 | 1900 | 1 | 60 | 14 | #f29bc0 |
| print_works | Print Works | factory | 3×3 | 25000 | 300 | grass, sand | r_books | 80 | 1900 | 1 | 60 | 16 | #6e2f40 |
| cannery | Cannery | factory | 2×2 | 20000 | 250 | grass, sand | r_canned_food | 80 | 1900 | 2 | 60 | 14 | #a8473f |
| cycle_works | Cycle Works | factory | 3×3 | 35000 | 450 | grass, sand | r_bicycles, r_motorcycles | 80 | 1910 | 2 | 60 | 16 | #3b9a8c |
| appliance_plant | Appliance Plant | factory | 3×3 | 70000 | 900 | grass, sand | r_phonographs, r_refrigerators, r_washing_machines | 60 | 1905 | 3 | 60 | 18 | #9fb5c8 |
| gadget_assembly | Gadget Assembly | factory | 3×3 | 60000 | 800 | grass, sand | r_calculators, r_calculators_chip, r_video_games, r_mobile_phones | 60 | 1970 | 1 | **30** | 16 | #6b4fd1 |
| trading_house | Trading House | **trade** | 3×2 | 35000 | 400 | grass, sand, hills | — | 600 | 1900 | 0 | **12** | 12 | #7d6b4f |

**Descriptions** (one line each, period voice):

| id | description |
|---|---|
| ranch | Longhorns on the open range, driven to the railhead. |
| clay_pit | Stiff red clay, dug wet for the brick kilns. |
| copper_mine | Green-stained adits worked for copper ore. |
| rubber_plantation | Rows of tapped trees weeping latex into tin cups. |
| bauxite_quarry | Red benches blasted from the hillside for the smelters. |
| smelter | Roaring furnaces that win copper, and later aluminium, from ore. |
| tannery | Pits of bark liquor; the smell carries for a mile. |
| sugar_refinery | Beet sliced, boiled and crystallised into white sugar. |
| brickworks | Kilns fired day and night; the town is built of their bricks. |
| paper_mill | Pulp and rollers turn timber into reams of paper. |
| chemical_works | Retorts and towers distilling coal and oil into chemicals. |
| machine_shop | Lathes and drop hammers making parts for other works. |
| electronics_works | Clean benches where valves, then chips, are made by the tray. |
| shoe_factory | Lasts, awls and stitching machines: boots for the nation. |
| confectionery | Copper pans of boiling sugar, wrapped by the penny. |
| print_works | Presses thunder out books and almanacs. |
| cannery | Sealed tins of meat that keep a winter or a war. |
| cycle_works | Frames brazed and wheels trued: bicycles, then motorcycles. |
| appliance_plant | From talking machines to iceboxes that need no ice. |
| gadget_assembly | Pocket wonders assembled under bright lamps. |
| trading_house | Brokers on the telephone sell your materials and parts to the whole nation. |

**Build-bar icon** (`toolbar.ts` `BUILDING_ICON`):

| buildings | icon |
|---|---|
| ranch | `cattle` |
| clay_pit | `clay` |
| copper_mine | `copper_ore` |
| rubber_plantation | `rubber` |
| bauxite_quarry | `bauxite` |
| trading_house | `money` |
| machine_shop, electronics_works | `gear` |
| each consumer works | its first output's good icon: `shoes`, `candy`, `books`, `canned_food`, `bicycles`, `phonographs`, `calculators` |
| smelter, tannery, sugar_refinery, brickworks, paper_mill, chemical_works | their first output's good icon |

### Table E: chain economics

These are the expected values at each good's era: base prices, one manufacturer at full
utilisation, and per worker-month. Depth counts levels, with raw at 1 (cheese is 2, bread is 3).
The figures come from a scratch model, before sugar beet became seasonal, which lowers candy a
little.

| good | era | depth | profit/day | margin | workers | $/worker-mo |
|---|---|---|---|---|---|---|
| candy | 1900 | 3 | 54 | 56% | 116 | 14.0 |
| canned_food | 1900 | 3 | 55 | 51% | 117 | 14.1 |
| books | 1900 | 3 | 58 | 54% | 152 | 11.4 |
| shoes | 1900 | 3 | 62 | 60% | 172 | 10.9 |
| phonographs | 1905 | 3 | 151 | 63% | 144 | 31.4 |
| bicycles | 1910 | 4 | 147 | 61% | 185 | 23.8 |
| motorcycles | 1915 | 4 | 311 | 65% | 334 | 27.9 |
| refrigerators | 1930 | 5 | 319 | 61% | 361 | 26.5 |
| washing_machines | 1935 | 5 | 298 | 62% | 345 | 26.0 |
| cosmetics | 1950 | 3 | 65 | 41% | 129 | 15.1 |
| calculators | 1970 | 5 | 125 | 52% | 96 | 39.2 |
| video_games | 1978 | 5 | 165 | 55% | 132 | 37.4 |
| mobile_phones | 1990 | 5 | 430 | 66% | 209 | 61.9 |

**Reference: the existing chains at depth 2–3** run from tools (8.4) to computers (86.0). Their
median is about 15.1 in 1910 and stays near 15 to 19 through 1990.

**Trading House surplus sales are deliberately thin.** At 0.8 × base, a materials or components
chain into a Trading House nets about 0 to 7 $/worker-month. Every value is at least 0. Finishing
the goods always pays more.

---

### Task 1: `GoodDef.kind` and call-site migration (behaviour-identical)

**Files:**
- Modify:
  - `src/data/goods.ts`: add `export type GoodKind = 'raw' | 'material' | 'component' | 'consumer'`,
    `GoodDef.kind: GoodKind`, the `@deprecated` JSDoc on `tier` and `kind` on all 27 goods;
  - `src/sim/inventory.ts:36-37`;
  - `src/sim/contracts.ts:54`;
  - `src/sim/rival/market.ts:17-18`: rename `tier2Goods` to `consumerGoods`;
  - `src/sim/rival/projects.ts:364`;
  - `src/ui/panels/city.ts:57`;
  - `src/game/achievements.ts:36`;
  - `src/sim/chainEconomics.ts:76`: `kind === 'raw'`;
  - `src/ui/toolbar.ts:30-35` (`tabOf`);
  - `src/ui/panels/codex.ts:18-33`;
  - `scripts/chain-report.ts:18`;
  - the tests `src/data/catalog.test.ts:48,88`, `src/sim/balance.test.ts:25,37`,
    `src/sim/contracts.test.ts:39` and `src/ui/panels/codex.test.ts`.
- Create: `src/sim/kindMigration.test.ts`. It's temporary, and Task 3 deletes it.

**Interfaces:**
- Produces:
  - `GoodKind`, `GoodDef.kind`.
  - In codex.ts, `kindOf(g) = g.kind`.
  - `KIND_LABEL: Record<GoodKind, string>`: raw `Raw`, material `Material`, component `Component`,
    consumer `Consumer`.
  - Codex filter chips for now: All, Raw, Materials (`data-filter="material"`), Consumer and
    I make this. Task 5 adds Components.
- Produces `tabOf` (P2):
  - `extractor` → `extract`;
  - `retail` and `logistics` → `retail`;
  - a factory goes by the kind of `RECIPES[def.recipes[0]]`'s first output: `material` →
    `refine`, anything else → `manufacture` (Task 5 adds `components`).
- Behaviour: the sim must be identical. Only the codex labels change in the UI.

- [ ] **Step 0:** Record the performance baseline for Task 10. Run
  `npm run soak -- --seeds 42 --years 101` three times on the unmodified tree, and note the
  median ms in the commit message body.
- [ ] **Step 1:** Write `src/sim/kindMigration.test.ts`. It runs `createGame({ seed: 42 })`,
  then `runAutoplay`, then `runDays(ctx, 720)`, then
  `expect(stateHash(ctx.state)).toMatchInlineSnapshot()`. Run it once on the unmodified tree, so
  Vitest writes the hash inline.
- [ ] **Step 2:** In `catalog.test.ts`, add a failing test:
  - every good has `kind`;
  - `tier` 0 ↔ `raw`, `tier` 2 ↔ `consumer`, and `tier` 1 ↔ `material | component`;
  - `Object.values(GOODS).filter((g) => g.kind === 'consumer').map((g) => g.id)` equals
    `Object.keys(DEMAND_PER_1000)` as sets.

  Switch the tests listed above from `tier` to `kind`. In `codex.test.ts`, use the
  `data-filter="material"` selector.
- [ ] **Step 3:** Run `npx vitest run src/data/catalog.test.ts`. Expected: FAIL (no `kind`).
- [ ] **Step 4:** Add `kind` and migrate every listed site. Then run `grep -rnE "(GOODS\[[^]]+\]\??|\bg|\bgood)\.tier\b" src scripts`.
  Expected: hits only in `goods.ts` and in `catalog.test.ts`'s mapping test.
- [ ] **Step 5:** Run `npm test`. Expected: PASS, including the unchanged inline hash.
- [ ] **Step 6: Commit** with `refactor(data): GoodDef.kind replaces tier at every call site`.

### Task 2: Art batch: good icons, new extractor sprites and heights

This comes before the goods, so that `icons.test.ts` ("covers every good") and `sprites.test.ts`
("every building has a BUILDING_HEIGHT") never fail in between. Painters and heights keyed by ids
that don't exist yet are harmless.

**Files:**
- Modify:
  - `src/render/icons.ts`: 34 painters in `GOOD_PAINTERS` (:126), under a
    `// R4 goods` comment, in Table G order;
  - `src/render/sprites.ts`:
    - `BUILDING_HEIGHT` (:26): the 21 heights from Table B;
    - `flatChimneys` (:113): table entries `smelter: [[0.2, 3], [0.7, 5]]`,
      `brickworks: [[0.25, 4], [0.75, 4]]`, `chemical_works: [[0.15, 2], [0.5, 6], [0.85, 3]]`,
      `tannery: [[0.3, 7]]`, `paper_mill: [[0.2, 5]]`, `sugar_refinery: [[0.25, 6]]`;
    - `paintFarm` palette (:419): `sugar_beet: ['#6f9a3c', '#4f7a2a', '#c77d9b']` with a dot row
      like cotton;
    - `extractorCasters` (:545): five new cases;
    - `paintBuilding` (:833): five new extractor painters and one Trading House painter.
- Test: `src/render/icons.test.ts`, `src/render/sprites.test.ts`

**Interfaces:**
- **Icon painters** follow the atlas style rules (`icons.ts:1-10`): flat fills, ink outline,
  at most a handful of shapes and no text. Suggested glyphs:

  | goods | glyph |
  |---|---|
  | copper_ore, bauxite, clay | an ore lump (green / ochre / red-brown) |
  | cattle | a cow's head |
  | sugar_beet | a beet with leaves |
  | rubber | a latex drop on a cup |
  | copper | an ingot |
  | leather | a hide |
  | sugar | a cone |
  | bricks | a stack of three |
  | paper | a ream |
  | chemicals | a flask |
  | aluminium | a sheet |
  | silicon | a wafer |
  | wire | a spool |
  | tyres | a tyre |
  | engines | an engine block |
  | electric_motors | a motor with its shaft |
  | vacuum_tubes | a valve |
  | microchips | a chip with legs |
  | displays | a panel |
  | shoes | a boot |
  | candy | a wrapped sweet |
  | books | a book |
  | canned_food | a tin |
  | bicycles | a bicycle (use `wheel`) |
  | phonographs | a horn |
  | motorcycles | a motorcycle |
  | refrigerators | a fridge |
  | washing_machines | a drum |
  | cosmetics | a lipstick |
  | calculators | a keypad |
  | video_games | a gamepad |
  | mobile_phones | a handset |

- **Extractor painters**, each with a distinct silhouette, drawn with the existing helpers
  (`raised`, `silo`, `rect`, `circle`):
  - `paintRanch`: a fenced paddock with cattle dots and a red barn;
  - `paintClayPit`: stepped orange-red pit terraces with a drying shed;
  - `paintCopperMine`: a timber headframe with green spoil heaps;
  - `paintRubberPlantation`: a grid of round tree crowns with a tapping shed;
  - `paintBauxiteQuarry`: ochre benches with a conveyor and crusher.
- **`paintTradingHouse`:** a colonnaded hall with a pediment and a clock. Its owner pennant and
  facade wall colour are `#d8ccb0`, added to `facadeWall`.
- `sprites.test.ts` band for `trade`: 8–14.

- [ ] **Step 1:** Add failing tests.
  - In `icons.test.ts`: `const R4_GOODS = [...34 ids...]`, and every one is in `ICON_IDS`.
  - In `sprites.test.ts`:
    - each of the 21 new ids has a `BUILDING_HEIGHT` equal to Table B;
    - the five extractor painters draw with a mock context;
    - their `extractorCasters` list is non-empty, using a synthetic `BuildingDef` of the Table B
      size until Task 3 adds the defs;
    - the band check gains `trade` [8, 14].
- [ ] **Step 2:** Run `npx vitest run src/render/icons.test.ts src/render/sprites.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the painters, heights, chimneys, casters and farm palette.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Render a dev sheet of the 34 icons at 16 and 32 px,
  using the existing icon preview if there is one, or a temporary `?icons=1` dev page that you
  delete before the commit. Read it: every glyph is legible on walnut and on paper.
- [ ] **Step 5: Commit** with `feat(render): R4 good icons, extractor sprites and diorama heights`.

### Task 3: 1900 goods, works and the balance gate

**Files:**
- Modify:
  - `src/data/goods.ts`:
    - the 1900 rows of Tables G and D: copper_ore, cattle, sugar_beet, clay, copper, leather,
      sugar, bricks, paper, wire, shoes, candy, books, canned_food;
    - `MIDDLE`;
    - `BASELINE_GOODS`;
    - `SEASONAL_CROPS: readonly GoodId[] = ['grain', 'cotton', 'fruit', 'sugar_beet']`;
  - `src/data/recipes.ts`: r_copper_ore, r_cattle, r_sugar_beet, r_clay, r_copper, r_leather,
    r_sugar, r_bricks, r_paper, r_wire, r_shoes, r_candy, r_books, r_canned_food;
  - `src/data/buildings.ts`:
    - new: ranch, clay_pit, copper_mine, smelter (`recipes: ['r_copper']` for now), tannery,
      sugar_refinery, brickworks, paper_mill, machine_shop (`['r_wire']`), shoe_factory,
      confectionery, print_works and cannery;
    - farm `recipes` gets `'r_sugar_beet'` appended;
  - `src/sim/production.ts:53`: `SEASONAL_CROPS.includes(g)`;
  - `src/sim/chainEconomics.ts`:
    - `SEASONAL` (:17) becomes `SEASONAL_CROPS`;
    - add `depth`, `workers` and `profitPerWorkerMonth` to `ChainReport`;
  - `src/sim/market.ts:243` (`averageSatisfaction`, the baseline rule P4);
  - `src/sim/eras.ts`: `canMake`;
  - `src/sim/contracts.ts:52-59`: consumer options also need `canMake`;
  - `scripts/chain-report.ts`: `depth`, `workers` and `$/wk-mo` columns, and a closing per-era
    line;
  - `src/ui/toolbar.ts:46`: `BUILDING_ICON` entries for the buildings added here;
  - tests: `src/data/catalog.test.ts`, `src/sim/balance.test.ts`, `src/sim/market.test.ts`,
    `src/sim/contracts.test.ts`, `src/sim/fixtures.test.ts` (the baseline load test).
- Delete: `src/sim/kindMigration.test.ts`.

**Interfaces:**
- Consumes: `GoodKind` (Task 1) and the painters and heights (Task 2).
- **`canMake(state: GameState, goodId: GoodId): boolean`** in `src/sim/eras.ts`. It's true when
  some building id in `state.unlocked` lists a recipe id in `state.unlocked` whose outputs include
  `goodId`.
- **The new `ChainReport` fields:**
  - `depth: number`: the longest producer path, with raw = 1, following `producerOf`;
  - `workers: number`: Σ `BUILDINGS[t].workers` × fractional count, store included;
  - `profitPerWorkerMonth = profitPerDay × 30 / workers`.
- **The chain report per-era line:**
  `era 1900-1919: shallow median $15.1/wk-mo, deep (depth>=4) min $23.8/wk-mo`.
  The brackets are 1900–1919, 1920–1949, 1950–1979 and 1980–2000.
- **The balance gate**, in `balance.test.ts`, as `describe('deep chains pay')`. For every consumer
  good `d` with `depth ≥ 4` at year `y = d.era`, `profitPerWorkerMonth(d)` must be at least the
  median `profitPerWorkerMonth` of the consumer goods with `depth ≤ 3` and `era ≤ y`, all
  evaluated with `chainEconomics(g, y)`. It's written over the whole catalogue, so Tasks 6–8 must
  pass it as they add goods.
- **The baseline rule (P4).** `BASELINE_GOODS` is a `ReadonlySet<GoodId>` of the 11 v1 ids.
- **Pins in `catalog.test.ts`:**
  - "every consumer good is producible": its length becomes `Object.keys(DEMAND_PER_1000).length`,
    not 11;
  - workers become a table: `steel_mill` and `car_plant` 120; `tannery` and `brickworks` 90;
    `electronics_works` and `gadget_assembly` 30; otherwise extractors 20, factories 60, retail 12
    and trade 12;
  - `recipeEra('r_sugar_beet') === 1900`;
  - every building's `era` ≤ the minimum `recipeEra` of its `recipes`.

- [ ] **Step 1:** Write the failing tests.
  - **`catalog.test.ts`:** the Table G, R and B values for the 1900 rows, through a table-driven
    `it.each`, plus the pins above.
  - **`balance.test.ts`:**
    - the "every 1900 chain" list becomes the 11 ids `books, bread, candy, canned_food, cheese,
      clothes, furniture, juice, shoes, tools, toys`;
    - add the deep-chains gate.
  - **`market.test.ts`:**
    - a town with only baseline goods sold has `averageSatisfaction` equal to the mean over its
      wanted baseline goods;
    - a new good at satisfaction 1 raises the result, and one at 0 leaves it unchanged.
  - **A load test** on `__fixtures__/phase4b.save.json`: after `unpackState`, before any day runs,
    every town's `averageSatisfaction` equals the pre-R4 formula, which the test computes inline
    over `BASELINE_GOODS`.
  - **`contracts.test.ts`:** a 1900 state never offers a good for which `canMake` is false.
    Simulate it by removing `r_shoes` from `state.unlocked`.
- [ ] **Step 2:** Run `npx vitest run src/data src/sim/balance.test.ts src/sim/market.test.ts src/sim/contracts.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Delete `kindMigration.test.ts`; the catalogue changes the hash from
  here on.
- [ ] **Step 4:** Run `npx tsx scripts/chain-report.ts`. Check the 1900 rows against Table E,
  within 10%, since beet seasonality moves candy. Then run `npm test`.
  - If a rival, city-panel or inspector test pins the old set of 1900 goods, update it to the
    computed list (`demandGoods()`), not to a new hard-coded count.
  - List every expectation you changed in the commit body.
- [ ] **Step 5: Commit** with `feat(data): 1900 products: copper, leather, sugar, bricks, paper, wire and four consumer goods`.

### Task 4: Trading House and the national market (save v9)

**Files:**
- Create: `src/sim/trade.ts`, `src/sim/trade.test.ts`
- Modify:
  - `src/data/buildings.ts`: `BuildingCategory` gets `'trade'`; add `trading_house`;
  - `src/sim/types.ts`: `TradeState` and `GameState.trade`;
  - `src/sim/state.ts`: `createGame` sets `trade: newTrade(opts.seed)`;
  - `src/sim/version.ts:5`: 9;
  - `src/sim/migrations.ts`: append `{ from: 8 }`;
  - `src/sim/invariants.ts`: `tradeProblems`;
  - `src/sim/systems.ts`: append `{ id: 'trade', onDay: tradeDay }` at the end of `SYSTEMS`;
  - `src/sim/contracts.ts`: component contracts and `onTradeSale`;
  - `src/sim/scenarios.ts`: `recordNationalSale`;
  - the `'retail'` sites listed below;
  - `src/ui/panels/building.ts`: the Trading House inspector;
  - `src/ui/panels/contracts.ts`: the component contract line;
  - `src/main.ts`: a dev-only `inspecttrade=1`.
- Test: `src/sim/trade.test.ts`, `src/sim/migrations.test.ts`, `src/sim/inventory.test.ts`,
  `src/sim/contracts.test.ts`, `src/sim/logistics/hubs.test.ts`, `src/ui/panels/inspectors.test.ts`

**Interfaces:**
- **Types:** `TradeState { rngState: number; factor: Record<GoodId, number>; sold30: Record<GoodId, number> }`.
  A missing `factor[g]` reads as 1, and a missing `sold30[g]` as 0.
- **`src/sim/trade.ts` exports:**
  - `TRADE_GOODS: readonly GoodId[]`: the goods whose kind is `material` or `component`, in
    `GOODS` order;
  - `newTrade(seed: number): TradeState`: `rngState: (seed ^ 0x54524144) | 0`, and `factor` and
    `sold30` start empty;
  - the constants `TRADE_FACTOR = 0.8`, `DRIFT_STEP = 0.06`, `DRIFT_PULL = 0.05`,
    `FACTOR_MIN = 0.75`, `FACTOR_MAX = 1.25`, `ABSORB_VALUE = 30_000`, `SATURATION_FLOOR = 0.5`
    and `TRADE_DAILY_UNITS = 40`;
  - `absorb(g) = ABSORB_VALUE / GOODS[g].basePrice`, in units per 30 days;
  - `tradePrice(state, g): number`. It returns 0 for a good that isn't in `TRADE_GOODS`;
    otherwise
    `max(1, round(basePrice × TRADE_FACTOR × factor × max(SATURATION_FLOOR, 1 − 0.5 × sold30 / absorb(g)) × priceIndex(state)))`;
  - `tradeDay(ctx)`, in this order:
    1. **Sales.** For each `trade` building in `buildingList` order, skip it when it's halted,
       upgrading or on strike, or its status says so. Otherwise:
       - its cap is `floor(TRADE_DAILY_UNITS × b.staffing)`;
       - it sells whole units from `b.input`, taking 1 unit per held `TRADE_GOODS` good per
         round, in catalogue order, until the cap is reached or the stock runs out;
       - each unit earns today's `tradePrice`, computed before any of today's sales;
       - for each good sold, it books `earn(company, 'sales', revenue)` and `salesByGood`, then
         calls `recordNationalSale`, then `onTradeSale`, then emits
         `bus.emit({ type: 'sale', cityId: b.cityId ?? -1, … })`;
       - its status becomes `'ok'` when it sold anything, else `'idle'`.
    2. **Saturation.** For every `TRADE_GOODS` good with a `sold30` entry or a sale today:
       `sold30 = sold30 × 29/30 + soldToday`.
    3. **Drift.** For every `TRADE_GOODS` good in order, take exactly one draw from
       `state.trade`:
       `f = clamp(f + (random(trade) − 0.5) × DRIFT_STEP + DRIFT_PULL × (1 − f), FACTOR_MIN, FACTOR_MAX)`.
- **`recordNationalSale(state, e: { ownerId; goodId; qty })`** in `scenarios.ts` bumps only the
  player's `sold:<good>` flag. It writes no `seller:` flag, because it has no town.
- **Contracts (P7):**
  - `onTradeSale(state, { ownerId, goodId, qty })` credits every active contract with that
    `goodId` whose good is a `component`, when the owner is the player, whatever the contract's
    town.
  - `offerContracts` builds the component pool only when the player owns a `trading_house`:
    - each city × each unlocked component `g` with `canMake`, not already open;
    - `monthly = 30 × outputs/day` of `g`'s first unlocked producer recipe;
    - `qty = max(10, round(1.5 × monthly))`;
    - `reward = round(atPrices(qty × basePrice × 1.5))`.
  - The pool to draw from is the components pool if it isn't empty and either the consumer pool
    is empty or `random(state) < COMPONENT_CONTRACT_CHANCE (0.3)`; otherwise the consumer pool.
  - No extra draw happens when the component pool is empty.
  - The `PLEAS` entries:

    | good | plea |
    |---|---|
    | wire | `telegraph wire` |
    | tyres | `tyres for the fire engines` |
    | engines | `engines for the new tramway` |
    | electric_motors | `motors for the waterworks` |
    | vacuum_tubes | `valves for the telephone exchange` |
    | microchips | `microchips for the traffic lights` |
    | displays | `displays for the station boards` |

  - A component's news body reads `… offers $X for N sold through any Trading House within four months.`
- **Migration `{ from: 8 }`:** `o.trade = newTrade(seed)`, with the same seed guard as the v8 entry.
  It has no `afterLoad`.
- **`tradeProblems`:**
  - `trade` is present;
  - `rngState` is an integer;
  - every factor is finite and within [0.75, 1.25];
  - every `sold30` is finite and ≥ 0.
- **The `'retail'` and category sites, with their rulings:**

  | Site | Change |
  |---|---|
  | `inventory.ts:8-11` `sharesStorage` | adds `trade` |
  | `inventory.ts:31` `acceptsGood` | `case 'trade': return good.kind === 'material' \|\| good.kind === 'component'` |
  | `routeHelpers.ts:16` `offeredGoods` | `trade` offers nothing, like `retail` |
  | `production.ts:123` | no change: `trade` is idle in `productionDay`, and `tradeDay` sets its status |
  | `production.ts:179` `retailDay` | no change: towns never buy at a Trading House |
  | `logistics/hubs.ts:308, 337, 345, 398, 446` | **no change (P6).** The test pins that `hubCandidates` never yields a `deliver` to a `trade` building |
  | `game/alerts.ts:72` | no change: `trade` raises no status alert |
  | `render/statusBadges.ts:25` | no change: no badge |
  | `ui/panels/building.ts` | `:148` `statusReason`, for `trade`: `storeStocked(b)` ? `Selling to the national market` : `Nothing to sell: route materials or components here`. `:182` `statusAdvice`: the same texts, positive or warning. `:411`: staff hidden for `trade`. `:440`: `shared` includes `trade` |
  | `ui/toolbar.ts` | `tabOf`: `trade` → `retail`. `CATEGORY_ICON` (:47) `trade: 'money'`. `recipeStrip` (:55) text `Sells materials and components to the nation`. The tab title (:106) becomes `Retail, Trade & Logistics` |
  | `ui/panels/routeActions.ts:15` `CATEGORY_ICON` | `trade: 'money'` |
  | `main.ts:307` | the "works" lookup becomes `extractor \|\| factory` |
  | `rival/lines.ts:31`, `rival/market.ts:74`, `rival/projects.ts:95`, `regional/firms.ts:74`, `ui/tutorial.ts:36`, `ui/panels/city.ts:431`, `ui/panels/rival.ts:53` | no change: they mean town stores |

- **Inspector:** a Trading House shows a `card({ title: 'National prices' })` with a `dataTable`.
  Its rows are the goods it holds: icon and name, stock, today's price and a pill for the price
  relative to `basePrice × TRADE_FACTOR`, ▲ when the factor is above 1.05 and ▼ when it's below
  0.95. Its `emptyState` reads `Route materials or components here to sell them`.
- **Contracts panel:** a component contract's card shows the line `Sell through a Trading House`.

- [ ] **Step 1:** Write the failing tests in `trade.test.ts`:
  - **drift bounds:** 20,000 days of drift keep every factor within [0.75, 1.25], and the mean
    factor is within 0.05 of 1;
  - **determinism:** two states from the same seed reach equal `trade` after 365 days, and
    `tradeDay` never changes `state.rngState`;
  - **a sale:** a house holding 30 steel and 30 lumber sells 20 of each on day 1, earning
    `20 × tradePrice(steel) + 20 × tradePrice(lumber)`, booked in `sales` and `salesByGood`;
  - **acceptance:** `acceptsGood(house, 'bread')` is false, while `steel` and `wire` are true;
  - **saturation:**
    - ten houses each fed 40 steel a day for 60 days push `tradePrice(steel)` to at most
      `0.65 × basePrice × TRADE_FACTOR × priceIndex`;
    - the price never exceeds `basePrice × priceIndex` (the exploit cap);
  - **halted:** a halted house sells nothing;
  - **pool:** a full pool (600) gives `storageLeft` 0 for every good.

  In `migrations.test.ts`: a v8 object migrates to v9 with `trade` equal to `newTrade(seed)`,
  and the `phase4b` fixture loads and passes `checkInvariants`.

  In `contracts.test.ts`:
  - with no Trading House, no component contract is offered over 24 odd months;
  - with one, and `wire` makeable, a `wire` contract appears, its qty is 180 and a trade sale of
    180 wire completes it;
  - a component that `canMake` rejects is never offered.

  In `hubs.test.ts`: a hub with a Trading House in range yields no `deliver` to it.

  In `inspectors.test.ts`:
  - the Trading House inspector lists `Steel` with `formatMoney(tradePrice(state, 'steel'))`;
  - its empty state shows the text above.
- [ ] **Step 2:** Run those test files. Expected: FAIL.
- [ ] **Step 3:** Implement. TypeScript flags every exhaustive `switch` and
  `Record<BuildingCategory, …>`; resolve each one with the table above.
- [ ] **Step 4:** Run `npm test`, then `npm run dev` with `?seed=7&autoplay=1&skipYears=5&inspecttrade=1`.
  `inspecttrade` places a Trading House beside the player's sawmill, routes lumber there and opens
  the inspector. Screenshot it at 1366.
- [ ] **Step 5: Commit** with `feat(sim): Trading House sells materials and components at a drifting national price (save v9)`.

### Task 5: UI at 60 goods: Components tab, codex filters and route chips

**Files:**
- Modify:
  - `src/ui/toolbar.ts`: `TabId`, `TABS`, `tabOf`;
  - `src/ui/toolbar.css`: only if the tab row needs it;
  - `src/ui/panels/codex.ts`, `src/ui/panels/codex.css`;
  - `src/ui/panels/routes.ts:561-583, 601`, `src/ui/panels/routes.css`.
- Test: `src/ui/toolbar.test.ts`, `src/ui/panels/codex.test.ts`, `src/ui/panels/routes.test.ts`

**Interfaces:**
- **Toolbar:**
  - `TabId` gets `'components'`, and `TABS` gets
    `{ id: 'components', label: 'Components', icon: 'gear' }` after `refine`.
  - `tabOf` for a factory: first output kind `material` → `refine`, `component` → `components`,
    `consumer` → `manufacture`.
  - The expected tabs:
    - `machine_shop` and `electronics_works` → `components`;
    - `smelter`, `chemical_works` and `refinery` → `refine`;
    - `appliance_plant` and `electronics_plant` → `manufacture`.
- **Codex:**
  - **`FILTERS`:** All, Raw, Materials (`material`), Components (`component`), Consumer and
    I make this.
  - **Row order:** goods unlocked by `state.date.year` come first, in catalogue order; locked
    goods follow, by era then catalogue order. A locked row has `data-locked="true"`, uses the
    `--text-faint` text and has the title `Unlocks <era>`.
  - **"Used in", when nothing consumes the good:** `Sold to towns` for a consumer good, and
    `Sold at a Trading House` for a material or component.
  - **The detail card** for a material or component adds the line
    `Trading House pays <formatMoney(tradePrice(state, g))> today`.
- **Route chips:**
  - `CHIP_CAP = 10`. A stop row whose chip list is longer shows the pressed chips first, then the
    rest in catalogue order, up to `CHIP_CAP`.
  - After those comes a `button.rt-chip-more` reading `+N`, with `aria-expanded="false"`. It
    reveals the rest for that stop and kind. The panel keeps the expanded set in a
    `Set<string>` keyed `${i}:${kind}`, cleared on `endDraft`.
  - The unload list (:601): for `logistics`, and for `retail` and `trade` when another stop loads
    anything, only goods the other stops load, plus those already pressed.

  - In `toolbar.test.ts`:
    - the tab list ids;
    - the cards in `components` are exactly the factories whose first recipe's first output is a
      component, computed from `BUILDINGS`, and that set contains `machine_shop`;
    - the tab of each of the 25 v1 buildings is unchanged, as a table.
    buildings is unchanged, as a table.
  - In `codex.test.ts`:
    - the filter `component` lists every component good in `GOODS`;
    - `material` lists every material good in `GOODS` (a computed count, not 15);
    - in a 1900 state, the first row is `wood` and the last row is the latest-era good, with
      `data-locked`;
    - `wire`'s detail shows `Trading House pays`.
  - In `routes.test.ts`:
    - a stop at a store with every consumer good accepted, and no other stop loading anything,
      shows 10 chips and `+14`;
    - clicking `+14` shows 24 chips;
    - pressed chips always show.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then screenshot `buildtab=components` and `panel=codex` at 1366
  and 1920, and at UI scale 1.3 at 1366. The tab row must stay on one line.
- [ ] **Step 5: Commit** with `feat(ui): components build tab, codex kind filters and capped route chips`.

### Task 6: 1905–1929 goods: rubber, bauxite, chemicals, aluminium, the first components and three consumer goods

**Files:**
- Modify:
  - `src/data/goods.ts`: rubber, bauxite, chemicals, aluminium, tyres, engines,
    electric_motors, vacuum_tubes, phonographs, bicycles, motorcycles, with their Table D rows;
    `GoodDef.plural?: string`, `goodPlural(g: GoodDef): string`, and the plurals for radios,
    tvs, computers, cars, phonographs, bicycles and motorcycles;
  - `src/data/recipes.ts`: r_rubber, r_bauxite, r_aluminium, r_chemicals, r_tyres, r_engines,
    r_electric_motors, r_vacuum_tubes, r_phonographs, r_bicycles, r_motorcycles and
    r_radios_tubes (after `r_computers`);
  - `src/data/buildings.ts`:
    - new: rubber_plantation, bauxite_quarry, chemical_works (`['r_chemicals']` for now),
      electronics_works (`['r_vacuum_tubes']`), cycle_works and appliance_plant
      (`['r_phonographs']`);
    - smelter gets `r_aluminium`; machine_shop gets `r_tyres`, `r_engines` and
      `r_electric_motors`; electronics_plant gets `r_radios_tubes` appended;
  - `src/sim/eras.ts`:
    - `:87`: `Demand for ${goodPlural(g).toLowerCase()} is expected to decline from next year.`;
    - `FADE_LINES` (:76): `phonographs: 'The gramophone falls silent in the modern home'`;
    - new `INVENTIONS` (:34) entries: `phonographs`, `bicycles`, `motorcycles`,
      `electronics_works` and `aluminium` (headlines below);
  - `src/sim/contracts.ts:76`: `PLEAS[g] ?? goodPlural(good).toLowerCase()`;
  - `src/ui/toolbar.ts`: `BUILDING_ICON` entries.
- Test: `src/data/catalog.test.ts`, `src/sim/eras.test.ts`, `src/sim/balance.test.ts` (the gate
  from Task 3 now covers bicycles and motorcycles)

**Interfaces:**
- **INVENTIONS** (headline, body):

  | id | headline | body |
  |---|---|---|
  | phonographs | `TALKING MACHINES: The phonograph sings in the parlour` | `Appliance plants now press phonographs from lumber and copper.` |
  | bicycles | `SAFETY BICYCLES FOR EVERY CLERK` | `Cycle works turn steel and tyres into bicycles.` |
  | motorcycles | `THE MOTOR-CYCLE ROARS INTO TOWN` | `Engines and tyres make motorcycles: a machine shop and a cycle works.` |
  | electronics_works | `THE VALVE AGE: Electronics works open` | `Wire and glass become vacuum tubes for radios and more.` |
  | aluminium | `ALUMINIUM: The metal of the air age` | `Smelters now win aluminium from bauxite.` |

- **Phonograph fading:** `lifecycleFactor('phonographs', 1965)` is 0.2, from the existing curve.

- [ ] **Step 1:** Write the failing tests.
  - **`catalog.test.ts`:**
    - the Table G, R and B rows for these goods;
    - `recipeEra('r_radios_tubes') === 1925`;
    - `firstRecipeFor('radios')` on a 1930 state is still `r_radios`. Test this through
      `planChain('radios', s).nodes.at(-1).recipeId`.
  - **`eras.test.ts`:**
    - running `fadeWarnings` in 1954 publishes `Demand for phonographs is expected to decline from next year.`;
    - in 1964, the radio warning still reads `Demand for radios is expected to decline from next year.`
      (now through `plural`);
    - a 1905 `checkUnlocks` publishes the phonograph headline.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx tsx scripts/chain-report.ts` and check the rows against Table E. Run
  `npm test`; the deep-chains gate must pass.
- [ ] **Step 5: Commit** with `feat(data): 1905-1929 products: rubber, aluminium, chemicals, tyres, engines, motors, valves`.

### Task 7: 1930–1959 goods: refrigerators, washing machines and cosmetics

**Files:**
- Modify:
  - `src/data/goods.ts`: refrigerators, washing_machines and cosmetics, with Table D and their
    plurals;
  - `src/data/recipes.ts`: r_refrigerators, r_washing_machines and r_cosmetics;
  - `src/data/buildings.ts`: appliance_plant gets r_refrigerators and r_washing_machines;
    chemical_works gets r_cosmetics;
  - `src/sim/eras.ts`: `INVENTIONS` for refrigerators
    (`ICE WITHOUT THE ICEMAN: The electric refrigerator`, `Appliance plants build refrigerators
    from steel, motors and chemicals.`), washing_machines (`WASHDAY REVOLUTION`,
    `The electric washing machine arrives.`) and cosmetics (`THE BEAUTY COUNTER`, `Chemical works
    now bottle cosmetics.`).
- Test: `src/data/catalog.test.ts`, `src/sim/balance.test.ts`, `src/sim/rival.test.ts`

**Interfaces:**
- No new code paths. This task proves that the five-level chains plan and pay.
- `planChain('refrigerators', s1930)` has 10 nodes, one per good: copper_mine (copper_ore),
  mine (coal), smelter (copper), machine_shop (wire), mine (iron_ore), steel_mill (steel),
  machine_shop (electric_motors), oil_well (oil), chemical_works (chemicals) and appliance_plant
  (refrigerators). They're in post-order, as `planChain` builds them.

- [ ] **Step 1:** Write the failing tests.
  - The catalog rows.
  - `planChain('refrigerators', s1930)` isn't null, its last node is `appliance_plant` running
    `r_refrigerators`, and its node count equals `new Set(nodes.map(n => n.good)).size`.
  - `chainEconomics('washing_machines', 1935).depth === 5`.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx tsx scripts/chain-report.ts` and `npm test`.
- [ ] **Step 5: Commit** with `feat(data): 1930-1959 products: refrigerators, washing machines, cosmetics`.

### Task 8: 1960–2000 goods: silicon, chips, displays and the gadget age

**Files:**
- Modify:
  - `src/data/goods.ts`: silicon, microchips, displays, calculators, video_games and
    mobile_phones, with Table D and their plurals;
  - `src/data/recipes.ts`: r_silicon, r_microchips, r_displays, r_calculators,
    r_calculators_chip, r_video_games and r_mobile_phones;
  - `src/data/buildings.ts`:
    - chemical_works gets r_silicon; electronics_works gets r_microchips and r_displays;
    - new: gadget_assembly;
  - `src/sim/eras.ts`:
    - `FADE_LINES` `calculators: 'Pocket calculators give way to the home computer'`;
    - `INVENTIONS` for microchips (`THE INTEGRATED CIRCUIT`, `Electronics works etch microchips
      from silicon.`), calculators (`SUMS IN YOUR POCKET`, `Gadget assembly plants build electronic
      calculators.`), video_games (`SPACE INVADERS AT HOME`, `Video games are now in the shops.`)
      and mobile_phones (`THE TELEPHONE LEAVES THE WALL`, `Mobile phones need chips, displays and
      aluminium.`);
  - `src/ui/toolbar.ts`: the `BUILDING_ICON` entry.
- Test: `src/data/catalog.test.ts`, `src/sim/balance.test.ts`, `src/sim/eras.test.ts`, `src/sim/contracts.test.ts`

**Interfaces:**
- `recipeEra`: `r_calculators` 1970, `r_calculators_chip` 1972, `r_mobile_phones` 1990.
- The calculator chain stays on the tube recipe in 1972 and later (it comes first in
  `RECIPES`). The chip recipe is the player's choice in the inspector's recipe selector.
- In 1970–1971, calculators are on the board while microchips aren't makeable. `canMake`
  (calculators) is true through the tube recipe, so contracts may ask for them. A 1971 state never
  offers a microchips contract.

- [ ] **Step 1:** Write the failing tests.
  - The catalog rows, and the counts: 15 raw, 15 material, 7 component, 24 consumer, 61 goods.
    This replaces the per-task count assertions.
  - `fadeWarnings` in 1994 says `Demand for calculators …`.
  - The 1971 contract case above.
  - `lifecycleFactor('calculators', 2000) === 0.6`.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx tsx scripts/chain-report.ts`. Every per-era line must show the deep
  minimum at or above the shallow median. Run `npm test`.
- [ ] **Step 5: Commit** with `feat(data): 1960-2000 products: silicon, microchips, displays, calculators, video games, mobile phones`.

### Task 9: AI adoption: the Baron, the nemesis and regional firms

**Files:**
- Modify:
  - `src/sim/rival/market.ts:17-18, 102`: `consumerGoods` also needs `canMake`;
  - `src/sim/nemesis/grudges.ts:135, 173`: `Object.keys(GOODS)` becomes `demandGoods()`;
  - `src/sim/scenarios.ts:180`: the monopoly check iterates `demandGoods()`;
  - `src/sim/chainBuilder.ts:17, 25-29`: `ChainId` gets `'shoes'`, and `CHAIN_RECIPES.shoes` is
    `['r_cattle', 'r_leather', 'r_shoes']`;
  - `src/sim/regional/firms.ts:44-48`: append `{ id: 'regional_4', year: 1912, chain: 'shoes' }`;
  - `src/data/names.ts:13`: append `'{city} Boot & Shoe Co.'`.
- Test: `src/sim/rival.test.ts`, `src/sim/rival/lines.test.ts`, `src/sim/regional/firms.test.ts`, `src/sim/nemesis/grudges.test.ts`

**Interfaces:**
- **Baron:** chooses from the consumer goods that are demanded, unlocked and makeable. Planning
  needs no change; `planChain` is generic, and its depth cap of 6 covers depth 5.
- **A site that can't be built** (no hills for a copper mine) goes through the existing path:
  `fail` → `abandon` → `block(cityId:goodId)`.
- **Nemesis:** the goods it iterates come from `demandGoods()`. Only town-sold goods carry
  `seller:` flags, so its results are unchanged, and the loop is shorter.
- **Regional firms:** there are four, and at most one is founded a year (unchanged).

- [ ] **Step 1:** Write the failing tests.
  - **`rival.test.ts`:**
    - on a 1935 state with the Baron rich, `chooseProject` can return a new consumer good. Push
      one `state.modifiers` entry `{ goodId: <old good>, cityId: null, factor: 0 }` per baseline
      good, then assert that the result is a Table D good;
    - on a synthetic map with no hills, a project for `phonographs` (which needs copper) ends
      abandoned within `MAX_FAILS + 1` months, and blocks `<cityId>:phonographs`;
    - afterwards the Baron owns no building except his store, and no route without a truck.
  - **`firms.test.ts`:** the table gains `['regional_4', 1912, 'shoes']`. A 1912 January founding
    builds ranch, tannery and shoe factory, with three routes. `companyIds` lists four regional
    firms by 1936.
  - **`grudges.test.ts`:** `noteContested` iterates only demand goods. Spy on `sellersInclude`, or
    assert that a `seller:0:steel` flag is ignored.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then `npm run soak -- --seeds 7 --years 101`. The Phase 4 gate
  must still pass: at least 2 firms active in 2000 and at least 5 retaliations. The soak prints
  each firm's founding year; `regional_4` must be founded.
- [ ] **Step 5: Commit** with `feat(ai): Baron and nemesis over demanded goods; a regional shoe firm`.

### Task 10: Balance, soak, fixture and screenshot gate

**Files:**
- Modify:
  - `scripts/soak.ts`: a `trade` line: per seed, the min and max factor seen at month ends, the
    player's Trading House sales total, and the component contracts done and failed;
  - `scripts/shots.sh`: showcase shots `codex-r4 90 panel=codex&panelarg=mobile_phones`,
    `components 25 buildtab=components`, `trade 25 inspecttrade=1` and
    `r4-buildings 25 r4showcase=1`;
  - `src/main.ts`: a dev-only `r4showcase=1`. It places one of each of the five new extractors
    and a Trading House for the player near city 0, then centres on them at zoom 2;
  - `src/sim/fixtures.test.ts`: only if it needs the new name, since it globs.
- Create: `src/sim/__fixtures__/phase4c.save.json` (generated)

- [ ] **Step 1:** Run `npm test && npm run build && npm run check-dist`. Expected: PASS.
- [ ] **Step 2:** Run `npx tsx scripts/chain-report.ts`. Paste the per-era lines into the commit
  body. Every era must have its deep minimum at or above its shallow median, and every
  consumer chain must have profit > 0.
- [ ] **Step 3:** Run `npm run soak -- --seeds 7,42,1234 --years 101`. Every existing phase gate
  must pass. The trade factors must stay within [0.75, 1.25].
  - **Time:** seed 42 must take at most 1.2× the Task 1 baseline ms.
  - **If it's slower,** profile `retailDay` and `averageSatisfaction` first, and precompute
    per-good arrays the way `market.ts:62-70` does.
- [ ] **Step 4:** Run `npm run fixture -- --name phase4c --days 18000`. Then
  `npx vitest run src/sim/fixtures.test.ts`. Expected: all seven fixtures load, pass invariants
  and run 360 days.
- [ ] **Step 5:** Run `bash scripts/shots.sh`, then read every new shot and the existing build bar,
  codex and routes shots at 1366 and 1920. Fix anything clipped, overlapping or unreadable:
  the tab row, the 61-row codex list, the `+N` chip and the five extractor sprites.
- [ ] **Step 6:** Run `docker compose build`.
- [ ] **Step 7: Commit** with `test: release r4 gate (chain report, soak, phase4c fixture, shots)`.
  The body carries the chain-report era lines, the soak's trade lines and the timing against the
  baseline.
