# SMOKESTACK II: The Living Century — Design

Status: approved in conversation 2026-10-11, awaiting written-spec review.
Scope: umbrella spec for v2 (epic, ~58 tasks in 6 phases). Each phase gets its own
detailed spec and implementation plan before it is built; this document fixes the
vision, systems, interfaces between them, and phase boundaries.

## 1. Intent

- **Goal:** a version of SMOKESTACK the owner enjoys playing for a full century and
  can show to friends.
- **Inspiration:** Tropico (factions, elections, edicts, a ruler with a story), kept
  in SMOKESTACK's setting: an industrial company from 1900 to 2000 against Baron
  Smogsworth.
- **Problems v2 solves** (from the 2026-10 design, visual and tech reviews):
  1. After ~1915 nothing pushes back: the empire runs itself, the Baron ignores
     the player, money has nothing to buy, stories are random rather than caused.
  2. The first five minutes undersell the game (cream-on-cream January 1900 start,
     emoji icons, flat buildings, tiny vehicles, windows covering the HUD).
  3. Cities do not visibly grow (a 64k city in 1985 sits on its 1925 footprint).
- **Success criteria:**
  - A full 1900→2000 game produces player-caused stories: elections won and lost,
    strikes, a regulation fight, a Baron vendetta, a succession, a patent coup.
  - An onlooker in the first five minutes sees an attractive, alive map.
  - Every new system changes something the player already manages (prices,
    permits, output, workforce, growth); no detached minigames.
- **Constraints kept from v1:** browser only, TypeScript strict, Vite/Vitest, Canvas 2D,
  procedural art and audio (no asset files), no runtime dependencies, deterministic
  pure simulation in `src/sim`, Docker deploy via `docker compose`.
- **Not in scope:** individually simulated citizens, multiplayer, WebGL, map editor,
  mobile/touch layout, loading v1 saves (v1 saves show an "incompatible save" message).

## 2. Core loop

| Timescale | Player activity |
|---|---|
| Minutes | Build chains, routes, fleets (v1 loop, better presented) |
| Years | Spring event card, city elections every 4 years, faction swings, Baron schemes, strikes and protests |
| Decades | Patent race reshapes technology, heir succession, regulation eras, 1999 showdown with Smogsworth Jr. |

Final score becomes **Legacy** = fortune + landmarks built + faction reputation +
dynasty prestige, shown in an end-of-century timelapse.

## 3. Architecture

- **Systems stay the unit of feature.** New files in `src/sim`, each registered in
  `SYSTEMS`, reacting only to state and bus events: `factions.ts`, `politics.ts`,
  `cards.ts`, `smog.ts`, `society.ts`, `dynasty.ts`, `nemesis.ts`, `exchange.ts`,
  `patents.ts`, `history.ts`.
- **Content as data.** Event cards, inventions, factions, edicts, landmarks and
  Baron dialogue live in `src/data/*.ts` tables, validated by catalog tests.
- **Save versioning.** `state.version` plus an ordered list of migrations in
  `src/game/migrations.ts`; every phase ships a fixture save that later phases must load.
- **Generic ownership.** `OwnerId` becomes a string company id;
  `companies: Record<string, Company>` with `kind: 'player' | 'baron' | 'regional'`.
  Player, Baron, Smogsworth Jr. (same company, new head), regional firms and
  takeovers all use it. Helpers `playerCompany(state)` / `baronCompany(state)` replace
  literal keys.
- **Typed-array tiles behind an adapter** (`TileGrid` with get/set accessors) so
  smog fields and per-tile data scale; JSON save packs them as today.
- **Spatial index** (chunked buckets of buildings/vehicles) for "near X" queries used
  by factions, smog, workforce and protests.
- **Invariant funnels kept** from v1 Task 29: `invalidatePaths`, `sellVehicle` as sole
  vehicle deleter, `pollutionDay` as sole writer of the polluted-tile set (becomes
  `smogDay`), vehicle path arrays never mutated in place. New funnels: `transferOwnership`
  is the only way assets change company; `adjustOpinion` the only writer of faction opinion.
- **File splits first:** `rival.ts` (1,075 lines) into `rival/{planner,builder,routes,rail}.ts`;
  `render/world.ts` into layer modules.
- **Rendering** adds a zoom-regime layer on top of the chunk cache; still Canvas 2D.

## 4. Visual and interface direction

### 4.1 Two zoom regimes (blend between zoom 1.3 and 1.7)
- **Survey map (< 1.5):** engraved, hand-tinted look: hatched hills, contour lines,
  stippled forests, watercolour region washes, copperplate labels. Strategy view with
  smog heatmap and faction colours.
- **Diorama (≥ 1.5):** ¾ view: south wall face on tiles, building height and roof
  silhouettes, long sun shadows, tilt-shift blur at screen edges. Cached per chunk.

### 4.2 Era printing styles (post-pass grade, paper texture, outline weight)
1900s sepia lithograph · 1920–30s deco poster (flat colour, gold lines) ·
1950–60s Kodachrome · 1980–90s clean offset with night neon.

### 4.3 Living world
- Weather (rain, snow, fog, heat haze) with small vehicle slowdowns.
- Day/night; smog dims sunlight. Game starts in **April 1900**.
- Cities physically spread; **landmarks** at population thresholds (church, town hall,
  station, stadium, skyscraper) and from philanthropy (park, library, hospital).
  Districts tinted by class.
- Construction animation (scaffold → reveal). Vehicles ~2× size with puffs and headlights.
- Fix the speed-8 lit-window bug found in review.

### 4.4 Interface
- Canvas-drawn icon atlas replaces all emoji (shared with map).
- Juice: rolling treasury counter, "+$" profit floaters, stamp animation for milestones.
- Window manager: max two floating windows; others dock as tabs in a right drawer;
  collapse rules at ≤ 1366 px width.
- Overlays with legends: smog heatmap, faction mood map.
- Newspaper is the narrative hub: event cards, elections, Baron taunts; masthead and
  typography change per era.
- **Photo mode** (hide UI, vignette, PNG export with era caption) and **century timelapse**.

### 4.5 Performance budget
60 fps at 1366×768 with 300 vehicles.

## 5. Factions and politics

### 5.1 Factions
Opinion 0–100 per city and national (national = population-weighted mean).

| Faction | Likes | Hates | Lever |
|---|---|---|---|
| Workers | wages, jobs, safety | layoffs, smog at home | strikes cut output; good mood speeds hiring |
| Old Money | profit, tradition, low taxes | unions, reform | bank credit rate, land price |
| Reformers → Greens (1960) | clean air, schools, parks | child labour, bribes | permits in large cities |
| Church/Community | charity, Sunday rest | vice, demolitions | local permits, press tone |
| Baron's Circle | the Baron | the player | sabotage, bad press |

Opinion changes only via `adjustOpinion(state, factionId, cityId | 'national', delta, reason)`,
driven by bus events (building built near city, smog level, building sold = layoffs,
wages paid, contract kept/failed) and card choices. Opinion drifts 2%/month toward 50.

### 5.2 City politics
- Each city has a mayor and council alignment (dominant faction).
- Elections every 4 years per city (staggered). Vote share = faction opinion ×
  class weights; winner drawn with the state rng.
- Player influence: endorse a candidate (costs opinion with rivals' factions) or pay
  the **slush fund** (raises odds; each use adds scandal risk; a scandal is a news event
  with opinion and fine penalties).
- Mayor's local edicts: permits required, smog limit, truck tolls, minimum wage,
  new-factory tax break.

### 5.3 Company edicts (player)
Wage level (low/fair/generous) · safety spend · company town housing next to a
factory · philanthropy purchases (park, library, hospital → landmarks) · union stance
(crush / tolerate / recognise).

### 5.4 Workforce
Each industry needs workers drawn from cities within a radius (spatial index). Shortage
lowers output. Low Workers opinion → slowdown → **strike** (building stops for weeks,
picket sprites), resolvable via a card.

### 5.5 Event cards
One spring card per year plus triggered cards (strike, scandal, disaster, invention,
crash). Each card has 2–3 choices with visible money and faction effects. ~60 cards in
`src/data/cards.ts`, filtered by era, conditions and cooldowns. Cards appear in the
newspaper with a modal choice; game pauses while a card is open.

## 6. Smog and society

### 6.1 Smog field
Replaces static pollution. Per-tile field (typed array): factories emit daily; the field
drifts with wind (seasonal prevailing direction + daily jitter), settles in low
terrain, clears with rain, is absorbed by forest and parks. Rendered as haze (diorama)
and heatmap with legend (survey map).

### 6.2 Escalation per city
1. Grumbling: Reformers/Workers opinion loss, editorials.
2. Health: slower growth, "Black Lung" ledger, smaller workforce.
3. Protests: marcher sprites, nearby building throughput reduced.
4. Political action: smog edict or Reformer election win, permits refused.

### 6.3 National regulation
Triggered by national smog vs time, so dates shift: Smoke Abatement Act (~1910–20s),
Clean Air Act (~1950–70s), Emission Caps (1990s). Each brings fines or upgrade requirements.

### 6.4 Player tools
Scrubbers/filters (per-building upgrade, tier from patents), tall chimneys (spread
further), relocation, forests and parks, lobbying (slush fund, scandal risk),
clean-tech patents (electric arc furnace, natural gas power).

### 6.5 Society
- Three classes per city (working, middle, upper), proportions shift with wealth,
  smog and time. Class drives demand (v1 price tiers become class demand), voting
  weights, and housing art (terraces → semis → villas).
- **Inflation** per decade on prices and wages.
- **Asset aging:** buildings and vehicles lose efficiency and gain maintenance with age;
  renew/replace actions in inspectors and fleet window.

## 7. Nemesis, dynasty and the stock exchange

### 7.1 Baron as nemesis
- **Grudge ledger:** entries `{kind, weight, year}` for undercutting, stolen contracts,
  share purchases, lost cities; weights decay yearly.
- **Traits** rolled at start: greedy, vindictive, showman, cunning.
- **Retaliation menu:** price war in a shared city, poaching workers, funding the
  player's election opponents, smear articles, sabotage (breakdown, scandal risk to him),
  patent race, hostile share buying.
- **Voice:** taunts/boasts in newspaper and toasts; portrait expression changes.
- **Succession:** retires or dies 1940s–50s; **Smogsworth Jr.** inherits company,
  grudges and one new trait.
- **1999 showdown:** final event chain chosen by state (takeover battle, decisive
  national election, or world fair contest).

### 7.2 Player dynasty
- Head of family has age and traits; marriage card ~1905–10 (dowry or faction bonus).
- Children born with traits (shrewd, charming, reckless, idealist, brute).
- Player names an heir; on death (age-based chance) the heir takes over, traits change
  faction modifiers and edict costs. Passed-over siblings can become rivals or scandals.
- No heir at death = game over.

### 7.3 Stock exchange
- Public companies: player, Baron, 2–3 lightweight **regional firms** (simple AI on
  generic ownership).
- Daily share price from profit, assets and news.
- Player can buy/sell any company's shares, including own. 51% = **takeover**
  (assets transfer via `transferOwnership`). The Baron can take over the player:
  game over unless bought back within a grace period.
- 1929 crash is scheduled; other crashes come from cards.

## 8. Alternate history

### 8.1 Patent race (replaces fixed calendar unlocks in `eras.ts`)
- ~20 inventions in a light tree (automobile, diesel, assembly line, electric grid,
  aviation, plastics, containerisation, electric arc furnace, computers, …), each with a
  historical year when the AI world reaches it.
- Player funds research (R&D building + budget) to arrive earlier.
- First patent holder collects royalties from other companies' use for 20 years.
- The Baron competes for patents. The newspaper reports divergent history.

### 8.2 World events
Wars (demand shocks), 1929 crash, 1973 oil shock: scheduled, delivered as cards.

## 9. Onboarding and modes
- Start April 1900 with a cold-open: camera pans the survey map, Baron taunt, family
  portrait.
- Tutorial "The First Season": cards teaching chain, route, first election, first Baron
  jab in ~10 minutes.
- Difficulty presets: Gentle / Standard / Robber Baron (Baron aggression, faction
  volatility, regulation strictness).
- Scenarios rewritten: Company Town, Clean Air 1970, Hostile Takeover.

## 10. Testing and quality gates
- TDD as in v1: pure sim functions, unit tests per system, seeded rng.
- **Century soak:** autoplay 1900→2000 on 3 seeds; assert no crash, money within bounds,
  ≥ N cards and elections fired, factions not pinned at 0 or 100, Baron acted.
- **Determinism:** same seed + inputs ⇒ same state hash after 50 years.
- **Save migrations:** each phase ships a fixture save; all later phases load it.
- **Visual check:** Playwright screenshot script at 1366 and 1920 px per era and zoom,
  reviewed at each phase end.
- **Perf budget test:** one simulated year under a loose threshold with 300 vehicles.
- Avoid timing-based asserts in unit tests (known flake sources: `rival.test.ts`,
  `pathfinding.test.ts`).

## 11. Phases

Each phase ends with a playable build, updated Docker image and an owner playtest
before the next phase is approved (same wave approval as v1).

| # | Phase | ~Tasks | Contents |
|---|---|---|---|
| 0 | Foundations | 10 | save version + migrations; generic company ids; TileGrid typed arrays; spatial index; split `rival.ts` and `render/world.ts`; new invariant funnels; century soak + determinism harness; screenshot script |
| 1 | First five minutes | 12 | April start + softer 1900 grade; icon atlas replacing emoji; treasury juice and floaters; window manager; bigger vehicles; construction animation; survey-map engraving; diorama layer; city growth + landmarks; speed-8 lights fix; cold-open; photo mode |
| 2 | Politics | 10 | factions + opinion funnel; workforce; city mayors and elections; slush fund + scandals; mayor edicts; company edicts; event card engine; card content (~60); faction overlay; newspaper hub rework |
| 3 | Smog and society | 8 | smog field + wind; escalation tiers + protests; strikes; national regulation; scrubbers/chimneys; classes + class demand; inflation; asset aging |
| 4 | Nemesis and dynasty | 10 | grudge ledger + traits; retaliation menu; Baron voice/portrait; Smogsworth Jr. succession; player dynasty + heirs; regional firms; share prices; buy/sell + takeovers; 1929 crash; Legacy score |
| 5 | Alternate history and finish | 8 | invention tree + R&D; patents + royalties; world events; era printing styles; weather; 1999 showdown; difficulty presets + scenarios + First Season tutorial; century timelapse + balance pass |

Phase 0 and Phase 1 receive detailed specs next; later phases are specified at their
phase gate, informed by playtests.

## 12. Risks
- **Scope:** 58 tasks; mitigated by phase gates and playable builds after each phase.
- **Balance explosion:** many interacting modifiers; mitigated by century soak bounds and
  a single modifier pipeline per output (production, demand, growth).
- **Render performance** of the diorama layer; mitigated by chunk caching and the perf budget.
- **Save churn:** mitigated by migrations and fixtures from Phase 0.
