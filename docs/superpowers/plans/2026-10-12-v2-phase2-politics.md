# SMOKESTACK II Phase 2: Politics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the century push back through politics. Cities gain factions with an opinion of the player's company, mayors elected every 4 years, edicts, a workforce drawn from nearby towns, and about 60 event cards with visible trade-offs. All of it is reported through a reworked newspaper and shown on a faction map overlay.

**Architecture:**
- New deterministic systems in `src/sim/politics/`, appended to `SYSTEMS`. They react to state and bus events and use the state rng.
- Content lives in `src/data/factions.ts` and `src/data/cards.ts` as tables checked by catalog tests.
- New state is plain JSON, added by one save migration `from: 4`. Task 1 creates it and later tasks in this phase extend it; it is frozen at merge.
- UI goes through the existing PANELS and OVERLAYS registries and the window manager.

**Tech Stack:** TypeScript 5.6 strict, Canvas 2D, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-11-smokestack-v2-design.md`, §5 (factions and politics) and §11 Phase 2. Phase 3 owns strikes, smog escalation, classes and inflation. Phase 4 owns Baron retaliation. This phase only lays hooks for them.

## Global Constraints

- No runtime dependencies and no asset files. Canvas 2D only.
- `src/sim` stays deterministic: randomness only from `chance`/`pick`/`randInt`/`random` in `src/sim/rng.ts` on `state`. No `Math.random`, no `Date`. Iterate cities in array order and companies via `companyIds`.
- Faction opinion is written only by `adjustOpinion` in `src/sim/politics/factions.ts`. A funnel test pins this.
- `GameState` stays plain JSON. `SAVE_VERSION` becomes 5 (in `src/sim/version.ts`).
  - One migration `{ from: 4 }` in `src/sim/migrations.ts` adds every Phase 2 field with defaults.
  - Task 1 creates it, and each later task extends it.
  - `phase0.save.json` and `phase1.save.json` must still load, pass `checkInvariants`, and run a year.
- Registries (`SYSTEMS`, `PANELS`, `OVERLAYS`, `ICON_IDS`) are append-only.
- Every UI string is free of emoji, and `src/ui/noEmoji.test.ts` must stay green. Icons come from `src/render/icons.ts` / `iconEl`.
- The v1 and Phase 0/1 invariant funnels and `src/sim/funnels.test.ts` stay green.
- The game must stay playable and fair when the player ignores politics. The soak runs autoplay without ever touching an edict, endorsement or slush fund, and the player must not go bankrupt from politics alone on seeds 7, 42 and 1234.
- Performance budget: 60 fps at 1366×768 with 300 vehicles. Politics runs monthly or yearly, never per tick.
- Use `docker compose`. Run `chown -R freire:freire /home/freire/projects/industry` after `npm install` and after merging.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A player who ignores politics.** The century soak with autoplay must still end solvent. No faction may sit pinned at 0 or 100 for more than 10 consecutive years in any city. Pinned in Tasks 1 and 11.
2. **Cards never trap the player.**
   - A card that is open pauses the game.
   - Loading a save that has a pending card shows it again.
   - Every choice can be afforded, or it is shown disabled with the reason, and at least one choice is always affordable.
   - A headless run auto-resolves cards after 60 days with `defaultChoice`.

   Pinned in Task 7.
3. **Edicts and permits never soft-lock building.** A refused permit always says which faction and city refused it, and how to fix it. No edict can block every building type in every city at once. Pinned in Task 6.
4. **Elections always produce a mayor.** This holds when all factions have equal scores, when a city has just been founded, and when an election falls on a loaded save. Pinned in Task 4.
5. **Old saves.** Phase 0/1 fixtures load, get default politics, and the first election lands at a future date, never in the past. Pinned in Tasks 1 and 4.

---

### Task 1: Factions and the opinion funnel

**Files:**
- Create: `src/data/factions.ts`, `src/sim/politics/factions.ts`, `src/sim/politics/index.ts` (the system wiring)
- Modify:
  - `src/sim/types.ts`: `City.opinion`, `GameState.politics`.
  - `src/sim/state.ts`: `createGame` defaults.
  - `src/sim/mapgen.ts`: if cities are created there.
  - `src/sim/migrations.ts`: migration `from: 4`.
  - `src/sim/version.ts`: `SAVE_VERSION = 5`.
  - `src/sim/systems.ts`: append `politics`.
  - `src/sim/funnels.test.ts`.
  - `src/sim/invariants.ts`: opinion in [0,100] and finite.
  - `src/ui/panels/city.ts`: opinion bars.
- Test: `src/sim/politics/factions.test.ts`, `src/data/catalog.test.ts`, `src/sim/migrations.test.ts`

**Interfaces:**
- Produces:
  - `export type FactionId = 'workers' | 'oldmoney' | 'reformers' | 'church' | 'baron'`
  - `export const FACTIONS: Record<FactionId, { id; name: string; greenName?: string; color: string; likes: string; hates: string; weight: number }>`. `weight` is the base share of the city that the faction speaks for. Use workers 0.40, oldmoney 0.18, reformers 0.17, church 0.20 and baron 0.05; the weights sum to 1. Reformers have `greenName: 'Greens'`.
  - `export function factionName(id: FactionId, year: number): string` returns `'Greens'` for reformers from 1960.
  - `City.opinion: Record<FactionId, number>`. This is the opinion of the player's company, 0..100, and starts at 50 (baron starts at 35).
  - `GameState.politics: { edicts: CompanyEdicts; cards: CardState; nextCardYear: number; log: PoliticsLogEntry[] }`. Later tasks fill these in. Task 1 creates the object with `edicts: { wage: 'fair', safety: 'standard', union: 'tolerate' }` and fills the remaining fields with their empty defaults.
  - `export function adjustOpinion(state: GameState, faction: FactionId, scope: number | 'national', delta: number, reason: string): void`.
    - It clamps to [0,100].
    - `'national'` applies the delta to every city.
    - It appends `{ date, faction, scope, delta, reason }` to `state.politics.log`, capped at 200 entries, oldest dropped. Entries with `|delta| < 0.5` are left out of the log.
  - `export function nationalOpinion(state: GameState, faction: FactionId): number` is the population-weighted mean.
  - `export function factionsMonth(ctx: SimContext): void`.
    - **Drift:** every city's opinion moves 2% toward 50 (`op += (50 - op) * 0.02`).
    - **Smog:** `adjustOpinion(reformers, city, -4 * city.pollution)` and `adjustOpinion(workers, city, -2 * city.pollution)`.
    - **Baron's Circle:** −1 in each city where the player's monthly sales there exceed the Baron's.
  - Bus-driven drivers, wired in the politics system's `onDay` from a per-day queue, or directly with `ctx.bus.on` registered by `attachPolitics(ctx)`. Choose whichever keeps determinism. Simplest: compute them from state in `factionsMonth`, by diffing building counts per city against `state.politics.lastCounts`.
    - A player building placed within `urbanRadius + 4` of a city: workers +2 (jobs). If it emits pollution: reformers −1.
    - A player building removed: workers −4 (layoffs).
    - A contract done in a city: workers +1, church +1. A contract failed: oldmoney −2.
- Funnel: `src/sim/funnels.test.ts` adds a rule that writes to `.opinion[` happen only in `politics/factions.ts`.

- [ ] **Step 1: Write the failing tests:**
  - Drift: opinion 90 becomes 89.2 after one `factionsMonth` with no other drivers.
  - Clamping at 0 and 100.
  - `'national'` touches every city.
  - `nationalOpinion` is weighted by population.
  - Placing a player factory near a city raises workers by 2 the next month.
  - Removing it lowers workers by 4.
  - The log is capped at 200.
  - The funnel rule fires on a synthetic offending file string.
  - `phase0.save.json` and `phase1.save.json` migrate to v5 with every city at opinion 50 (baron 35), and pass `checkInvariants`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, including the city panel's "Opinion of your company" section: five labelled bars using `FACTIONS[f].color`, with names from `factionName`.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7 --years 100`. Expected: pass, and the soak exits 0. Add a soak report line with the national opinion of each faction in 2000.
- [ ] **Step 5: Commit** with `feat(politics): factions and the opinion funnel`.

### Task 2: Workforce

**Files:**
- Modify:
  - `src/data/buildings.ts`: `workers: number` on `BuildingDef`.
  - `src/sim/types.ts`: `Building.staffing: number`, 0..1.
  - `src/sim/production.ts`: the production rate is multiplied by `staffing`.
  - `src/sim/migrations.ts`: `staffing: 1`.
  - `src/ui/panels/building.ts`: a staffing row.
- Create: `src/sim/politics/workforce.ts`
- Test: `src/sim/politics/workforce.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- `BuildingDef.workers` values: extractor 20, factory 60 (steel_mill and car_plant 120), retail 12, logistics 6. Every def has a value.
- `export const WORK_RADIUS = 30`, `export const REMOTE_STAFFING = 0.75`, `export const MIN_STAFFING = 0.5`.
- `export function workforceMonth(state: GameState): void`, run in the politics system's `onMonth` before `factionsMonth`.
  1. Assign each building, of any company, to the nearest city within `WORK_RADIUS` of its footprint centre. Ties go to the lower city id. Use `citiesNear` and clamp its radius.
  2. For each city:
     - `pool = population * 0.4 * (0.7 + 0.6 * opinion.workers / 100)`;
     - `need =` the sum of `workers` over assigned buildings;
     - `ratio = need === 0 ? 1 : min(1, pool / need)`.
  3. Set `staffing = max(MIN_STAFFING, ratio)` on every assigned building, and `REMOTE_STAFFING` on unassigned ones.
- Company housing (Task 3) adds +150 to its building's city pool.

- [ ] **Step 1: Write the failing tests:**
  - A lone factory next to a 5,000-person city gets staffing 1.
  - 40 factories next to a 1,000-person city get 0.5.
  - A mine 40 tiles from any city gets 0.75.
  - Workers opinion 0 lowers the pool by 30% compared with 50.
  - `productionDay` with staffing 0.5 produces half as much, for the same recipe over 30 days.
  - Every building def has `workers > 0`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Show "Staff 85% — short of hands in Ashford" in the building inspector.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42 --years 100`. Expected: pass. Update `balance.test.ts` expectations only if they fail because of staffing, and record the old and new values in the commit body.
- [ ] **Step 5: Commit** with `feat(politics): workforce drawn from nearby towns`.

### Task 3: Company edicts, the politics window, and philanthropy

**Files:**
- Create: `src/sim/politics/edicts.ts`, `src/ui/panels/politics.ts`
- Modify:
  - `src/data/landmarks.ts`: `park` and `hospital`, plus `philanthropy?: { cost: number; effects: Partial<Record<FactionId, number>> }`.
  - `src/sim/landmarks.ts`: auto-build skips philanthropy-only landmarks.
  - `src/render/landmarks.ts` and `src/render/icons.ts`: painters and icons for park and hospital.
  - `src/data/buildings.ts`: `company_housing`, a 2×2 logistics building.
  - `src/sim/production.ts`: the maintenance multiplier.
  - `src/ui/hud.ts`: a "Politics" button.
  - `src/ui/panels/index.ts`: `PANELS.politics`.
- Test: `src/sim/politics/edicts.test.ts`, `src/ui/panels/politics.test.ts`

**Interfaces:**
- `export type WageLevel = 'low' | 'fair' | 'generous'`, `export type SafetyLevel = 'minimal' | 'standard' | 'high'`, `export type UnionStance = 'crush' | 'tolerate' | 'recognise'`
- `export interface CompanyEdicts { wage: WageLevel; safety: SafetyLevel; union: UnionStance }`
- `export function setEdict<K extends keyof CompanyEdicts>(ctx: SimContext, key: K, value: CompanyEdicts[K]): Result` takes effect from the next month and publishes a one-line news item.
- `export function maintenanceFactor(edicts: CompanyEdicts): number` is the product of:
  - wage: low 0.85, fair 1, generous 1.25;
  - safety: minimal 0.95, standard 1, high 1.12;
  - union: recognise 1.05, otherwise 1.

  It applies to the player's building maintenance only.
- `export function edictsMonth(ctx: SimContext): void` applies national monthly opinion effects:
  - wage: low gives workers −2 and oldmoney +1; generous gives workers +2 and oldmoney −1.
  - safety: minimal gives workers −1 and reformers −1; high gives workers +1.
  - union: crush gives workers −2 and oldmoney +1; recognise gives workers +1.5 and oldmoney −1.
- `export function buyPhilanthropy(ctx: SimContext, cityId: number, id: 'park' | 'library' | 'hospital'): Result`.
  - Costs: park $25,000, library $60,000, hospital $120,000.
  - It needs a free site (reuse `findLandmarkSite`) and can be used once per city per landmark id.
  - Effects, applied as one-off opinion changes in that city:
    - park: church +6, reformers +6, workers +2;
    - library: reformers +8, church +4;
    - hospital: workers +8, church +6, reformers +4.
  - It spends under the ledger category `'events'` and emits `landmarkBuilt`.
- `company_housing`:
  - cost $8,000, maintenance 120, workers 0;
  - it must be placed within 3 tiles of one of the player's factories;
  - it adds +150 to the workforce pool of the city its factory is assigned to, and gives workers +3 once in that city.
- Politics window (`PANELS.politics`) has three sections:
  1. Company edicts: three segmented controls, each showing its monthly cost effect and its opinion effect.
  2. National opinion: five bars, each with a trend arrow comparing to 12 months ago. Store `state.politics.history` as one sample per year.
  3. "Recent political news": the last 8 entries of `state.politics.log`.

- [ ] **Step 1: Write the failing tests:**
  - `maintenanceFactor` for each combination listed.
  - Generous wages raise national workers opinion over 12 months, relative to fair, net of drift.
  - `buyPhilanthropy` with too little money returns an error. On success it places the landmark and applies the opinion changes. A second purchase of the same landmark in the same city is refused.
  - `company_housing` placed more than 3 tiles from a factory is refused.
  - The politics window renders 3 segmented controls, and clicking one calls `setEdict`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Add philanthropy buttons to the city panel ("Endow a park — $25,000"). Show them disabled with a tooltip reason when unaffordable or already built.
- [ ] **Step 4:** Run `npm test`. Expected: pass.
- [ ] **Step 5: Commit** with `feat(politics): company edicts, politics window and philanthropy`.

### Task 4: Mayors and elections

**Files:**
- Create: `src/sim/politics/elections.ts`, `src/data/politicians.ts` (name parts per faction and era)
- Modify: `src/sim/types.ts` (`City.politics`), `src/sim/migrations.ts`, `src/ui/panels/city.ts` (mayor, council and next-election row with an Endorse control)
- Test: `src/sim/politics/elections.test.ts`

**Interfaces:**
- `City.politics: { mayor: { name: string; faction: FactionId; since: number }; council: FactionId; nextElection: number; endorsed: FactionId | null; slush: number; scandalRisk: number; edicts: MayorEdictId[] }`.
  - `since` and `nextElection` are absolute month indices: `year * 12 + (month - 1)`.
  - `MayorEdictId` is defined in Task 6. Task 4 leaves `edicts: []`.
- `export function firstElection(cityIndex: number, startYear: number): number` gives `(startYear + 2 + (cityIndex % 4)) * 12 + ((cityIndex * 5) % 9) + 2`, so elections are staggered across years and fall between March and November.
- A new or migrated city gets a mayor from `FACTIONS` by the highest `weight` (workers), `council = mayor.faction`, and `nextElection = max(firstElection(...), currentMonthIndex + 6)`.
- `export function voteShares(city: City): Record<FactionId, number>`.
  - Each faction's score is `FACTIONS[f].weight * (0.6 + 0.8 * |opinion_f − 50| / 50)`. Strong feelings mobilise voters.
  - An endorsed faction's score is multiplied by 1.3.
  - Slush multiplies the endorsed faction's score by `1 + 0.25 * city.politics.slush`, at most 3 uses.
  - Scores are then normalised to shares.
- `export function holdElection(ctx: SimContext, city: City): FactionId`.
  1. Draw the winner with `random(state)` over the shares.
  2. Set the mayor to a name from `politicians.ts` (via `pick`) and the council to the winner. The council is the same faction as the mayor in this phase.
  3. Set `nextElection += 48`.
  4. Reset `endorsed` and `slush` to `null`/`0`.
  5. Publish news of kind `'politics'` (add `'politics'` to `NewsKind`): `"{FACTION} CANDIDATE {NAME} WINS {CITY}"` with the vote shares in the body.
  6. Emit `{ type: 'election'; cityId; winner: FactionId }` on the bus.
- `export function electionsMonth(ctx: SimContext): void` holds every election whose `nextElection <= currentMonthIndex`, in city order.
- `export function endorse(ctx: SimContext, cityId: number, faction: FactionId): Result`. It is allowed only within 12 months of the election. It applies +5 to the endorsed faction in that city and −3 to each other faction in that city.

- [ ] **Step 1: Write the failing tests:**
  - `firstElection` is staggered: four consecutive cities fall in four different years.
  - `voteShares` sum to 1.
  - Equal opinions give shares proportional to weight.
  - Endorsing raises that faction's share.
  - A seeded `holdElection` is deterministic, sets `nextElection += 48`, publishes news and emits `election`.
  - An election due in a loaded `phase1.save.json` is scheduled at least 6 months ahead.
  - With every score equal, a winner is still chosen.
  - `endorse` 13 months before the election is refused.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7 --years 100`. The soak prints the number of elections held, which must be ≥ 100 over a century with 5+ cities.
- [ ] **Step 5: Commit** with `feat(politics): city mayors and staggered elections`.

### Task 5: Slush fund and scandals

**Files:**
- Modify: `src/sim/politics/elections.ts` (`paySlush`, `scandalMonth`), `src/ui/panels/city.ts` (Slush button with odds preview and risk warning)
- Test: `src/sim/politics/elections.test.ts`

**Interfaces:**
- `export function slushCost(year: number): number` returns `Math.round(5000 * (1 + (year - 1900) / 25) / 500) * 500`.
- `export function paySlush(ctx: SimContext, cityId: number): Result`:
  - It requires an endorsement in that city and fewer than 3 prior uses.
  - It spends `slushCost` under `'events'`.
  - It adds 1 to `city.politics.slush` and 0.15 to `city.politics.scandalRisk`.
  - It returns err when unaffordable.
- `export function scandalMonth(ctx: SimContext): void`:
  - For each city, `chance(state, scandalRisk * 0.1)` triggers a scandal:
    - publish `'politics'` news, headline "BRIBERY SCANDAL ROCKS {CITY} CITY HALL";
    - apply reformers −10 and church −6 in that city, and reformers −3 nationally;
    - fine the player `2 * slushCost(year)` under `'events'`;
    - set `scandalRisk = 0`;
    - emit `{ type: 'scandal'; cityId }`.
  - Otherwise `scandalRisk = max(0, scandalRisk - 0.01)`.

- [ ] **Step 1: Write the failing tests:**
  - The `slushCost` values are $5,000 for 1900 and $9,000 for 1920.
  - `paySlush` without an endorsement is refused, and a 4th use is refused.
  - Paying raises the endorsed faction's share in `voteShares`.
  - A seeded run with `scandalRisk` forced to 1 for 12 months triggers a scandal, applies the fine, the opinion changes and the reset, and emits `scandal`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The city panel shows "Win odds 38% → 47%" before paying, and "Scandal risk: 15%".
- [ ] **Step 4: Commit** with `feat(politics): slush fund and scandals`.

### Task 6: Mayor edicts and faction levers

**Files:**
- Create: `src/sim/politics/mayorEdicts.ts`
- Modify:
  - `src/sim/state.ts`: `canPlaceBuilding`/`planPlacement` checks permits, and `placeBuilding` applies the cost multiplier.
  - `src/sim/finance.ts`: loan rate from Old Money.
  - `src/sim/production.ts`: the smog limit.
  - `src/sim/vehicles.ts` or the maintenance code: truck tolls.
  - `src/ui/panels/city.ts`: an edict list with icons and tooltips.
  - `src/ui/tools.ts` or `src/game/toolController.ts`: the placement ghost shows the refusal reason.
- Test: `src/sim/politics/mayorEdicts.test.ts`

**Interfaces:**
- `export type MayorEdictId = 'permits_required' | 'smog_limit' | 'truck_tolls' | 'minimum_wage' | 'tax_break'`
- `export function chooseMayorEdicts(city: City): MayorEdictId[]`. This is pure, and it runs after each election and on migration. With `op` = the opinion of the mayor's faction:

  | Mayor's faction | Edicts |
  |---|---|
  | workers | `minimum_wage`; plus `permits_required` if op < 35 |
  | oldmoney | `tax_break` if op ≥ 50, else `truck_tolls` |
  | reformers | `smog_limit`; plus `permits_required` if op < 40 |
  | church | `truck_tolls` if op < 50 |
  | baron | `truck_tolls` and `permits_required` |

- Effects. All apply to the player only. The Baron ignores them in this phase.
  - **`permits_required`:** placing an extractor or factory within the city's `urbanRadius + 4` costs a 10% permit fee. If the mayor's faction opinion is below 25, the placement is refused instead, with ``A permit was refused by the ${factionName} mayor of ${city}. Raise their opinion above 25 or build elsewhere.``
  - **`smog_limit`:** player buildings with `pollution > 0` within `urbanRadius + 4` of the city run at 0.75 production while `city.pollution > 0.4`.
  - **`truck_tolls`:** $40/month per player truck whose route has a stop at a building assigned to that city. Booked as `'vehicles'`.
  - **`minimum_wage`:** maintenance ×1.1 for player buildings assigned to that city. If the company wage edict is `'low'`, it counts as `'fair'` there.
  - **`tax_break`:** −25% construction cost for player factories in that city.
- Faction levers:
  - **Old Money credit:** `loanRate(state) = LOAN_RATE * (1.5 - nationalOpinion(oldmoney) / 100)`, so 0.06 at 50 and 0.09 at 0. Use it in `closeMonth`.
  - **Old Money land price:** construction cost in a city × `1 + (50 - opinion.oldmoney) / 200`.
  - **Reformers:** in cities with more than 20,000 people, reformers opinion below 30 adds `permits_required` even if the mayor didn't pick it.
  - **Church:** church opinion below 25 in a city adds +25% construction cost there ("community objections").
- No soft-lock: `permits_required` never applies to retail or logistics buildings, and never to sites outside any city's `urbanRadius + 4`.

- [ ] **Step 1: Write the failing tests:**
  - `chooseMayorEdicts` against each row of the table.
  - A permit fee is applied, and a refusal message names the faction and the city.
  - Retail is never refused, and rural sites are never refused.
  - Smog limit scales production to 0.75 only when the city's pollution is above 0.4.
  - Tolls book `'vehicles'` expense.
  - `loanRate` is 0.06 at 50 and 0.09 at 0.
  - The land-price and church multipliers combine multiplicatively.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The placement ghost turns red with the refusal reason, and the city panel lists active edicts with their effect text.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42,1234 --years 100`. Expected: pass, and no seed goes bankrupt.
- [ ] **Step 5: Commit** with `feat(politics): mayor edicts and faction levers`.

### Task 7: Event card engine

**Files:**
- Create:
  - `src/sim/politics/cards.ts`: the engine;
  - `src/data/cards.ts`: types, plus 6 seed cards that exercise every feature;
  - `src/ui/cardModal.ts` and `src/ui/cardModal.css`.
- Modify: `src/game/controller.ts` (shows the modal when a card is pending, pauses, restores speed), `src/sim/migrations.ts`
- Test: `src/sim/politics/cards.test.ts`, `src/ui/cardModal.test.ts`

**Interfaces:**
- `export interface CardEffect { faction: FactionId; scope: 'city' | 'national'; delta: number }`
- `export interface CardChoice { label: string; cost: number; effects: CardEffect[]; apply?: (ctx: SimContext, cityId: number | null) => void; note?: string }`
  - `cost` is a positive amount of money spent, or a negative amount received.
  - `note` is extra effect text shown to the player.
- `export interface CardDef { id: string; title: string; body: string; trigger: 'spring' | 'election' | 'scandal' | 'strike' | 'disaster' | 'invention' | 'crash'; years: [number, number]; weight: number; cooldownYears: number; needsCity: boolean; condition?: (state: GameState, cityId: number | null) => boolean; choices: CardChoice[]; defaultChoice: number }`
  - `body` may contain `{city}` and `{faction}`.
- `CardState = { pending: CardInstance[]; history: { id: string; year: number }[] }`
- `CardInstance = { uid: number; cardId: string; cityId: number | null; openedDay: number }`
- `export function drawSpringCard(ctx: SimContext): void`.
  - It runs on day 1 of April from 1901 onward. Use `state.politics.nextCardYear` to make it fire once per year.
  - It filters by era, cooldown and condition, then picks by weight with the state rng.
  - For a `needsCity` card it picks the city by weight, favouring cities where the card's factions have extreme opinions. The simplest acceptable rule is the city with the most extreme opinion, ties going to the lowest id.
- `export function triggerCard(ctx: SimContext, trigger: CardDef['trigger'], cityId: number | null): void` is called from the `election` and `scandal` handlers and from Phase 3+ systems.
- `export function resolveCard(ctx: SimContext, uid: number, choice: number): Result`.
  1. Check affordability.
  2. Spend or earn the cost under `'events'`.
  3. Apply the effects through `adjustOpinion`.
  4. Call `apply`.
  5. Record the result in `history`.
  6. Publish news of kind `'politics'` with the choice taken.
- `export function cardsDay(ctx: SimContext): void` auto-resolves any card pending for 60 or more days with `defaultChoice`. If that choice is unaffordable, it uses the first affordable choice.
- At least one choice is always affordable. The catalog test checks that every card has a choice with `cost <= 0`.
- UI:
  - When `state.politics.cards.pending.length > 0`, the controller opens a modal card. The card is styled as a newspaper clipping and shows each choice's cost and its effect chips (faction colour, +/−).
  - The modal sets speed 0 and restores the previous speed after the player resolves the card.
  - Esc does not close it: a card must be answered.
  - Loading a save with a pending card shows it again.

- [ ] **Step 1: Write the failing tests:**
  - The spring card draws once per year, and not in 1900.
  - Cooldown and era filters work.
  - `resolveCard` applies cost and effects and is recorded in history.
  - An unaffordable choice is refused.
  - Auto-resolve after 60 days.
  - A determinism check: two runs with the same seed give the same card sequence over 20 years.
  - Modal: rendered while pending, and the game paused. Clicking a choice resolves it and restores speed. Esc is ignored. A pending card in a loaded save is shown again.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Commit** with `feat(politics): event card engine and card modal`.

### Task 8: Card content (about 60 cards)

**Files:**
- Modify: `src/data/cards.ts`
- Test: `src/data/catalog.test.ts`, `src/sim/politics/cards.test.ts`

**Interfaces:**
- At least 60 cards in total:
  - 40 or more `spring` cards spread across eras: at least 8 per quarter-century (1900–24, 1925–49, 1950–74, 1975–2000);
  - 6 or more `election`;
  - 4 or more `scandal`;
  - 4 or more each of `disaster` and `crash`;
  - 2 or more `strike` and `invention` cards, which stay dormant until Phase 3/5 triggers them.
- Each card has 2–3 choices with clear trade-offs. Every faction appears in effects across the set, and the Baron's Circle appears in at least 6 cards.
- Tone: the existing period-humour newspaper voice (see `src/ui/panels/newspaper.ts` ADS and `src/sim/events.ts`).
- Effects stay within ±15 opinion per choice and cost at most 3× `slushCost(year)`, unless the card is a crash or disaster.

- [ ] **Step 1: Write the failing catalog tests:**
  - The counts above.
  - Unique ids.
  - Every `defaultChoice` index is valid.
  - Every card has an affordable choice.
  - `{city}` appears only in `needsCity` cards.
  - Effect magnitudes are within bounds.
  - Every faction is represented.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Write the cards.
- [ ] **Step 4:** Run `npm test && npm run soak -- --seeds 7,42,1234 --years 100`. The soak prints the number of cards resolved, which must be ≥ 99 per seed.
- [ ] **Step 5: Commit** with `content(politics): sixty event cards`.

### Task 9: Faction overlay

**Files:**
- Create: `src/render/factionOverlay.ts`
- Modify: `src/render/overlays.ts` (append), `src/ui/hud.ts` or `src/ui/toolbar.ts` (an overlay toggle next to Smog, with a faction selector), `src/render/world/survey.ts` (city labels show a mayor-faction colour dot in survey mode)
- Test: `src/render/factionOverlay.test.ts`

**Interfaces:**
- `export const factionOverlay: Overlay`, id `'factions'`.
- Mode `'mayor'`, the default, fills each city's urban disc with its mayor's faction colour at 30% alpha.
- Mode `<FactionId>` fills each disc with a red→grey→green ramp of that faction's opinion.
- It draws a legend at the bottom-left: the faction swatches in mayor mode, or the ramp with 0/50/100 labels.
- The disc fill is cached per city per month. No per-frame allocations.
- `export function opinionColor(op: number): string` maps 0 to `#b03a2e`, 50 to `#9a9184` and 100 to `#3f8f5a`, interpolated linearly in RGB.

- [ ] **Step 1: Write the failing tests:**
  - `opinionColor(0|50|100)` gives the three exact hex values.
  - Drawing on a mock context makes one arc or fill per city and draws the legend text.
  - With the overlay disabled, nothing is drawn.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Then visual check: take shots at z0.5 and z2 with the overlay on (add a DEV `overlay=factions` param) and Read them.
- [ ] **Step 4: Commit** with `feat(render): faction mood overlay with legend`.

### Task 10: Newspaper as the narrative hub

**Files:**
- Modify: `src/ui/panels/newspaper.ts` and `newspaper.css`, `src/sim/news.ts` (kind `'politics'` styling)
- Test: `src/ui/panels/newspaper.test.ts`

**Interfaces:**
- The front page gains three parts:
  1. A lead story: the most recent `'politics'` or `'historic'` item, in a large headline.
  2. A "Ballot Box" column with the last 3 elections (city, winner faction chip, vote bar) and the next 3 upcoming (city, date).
  3. A "From the Smogsworth Desk" box with the latest `'rival'` item.
- Past cards are listed as "Decisions of the Year" with the choice taken.
- The masthead name and typeface change by era: 1900 "The Daily Smokestack" in blackletter-like serif small caps, 1925 an Art-Deco geometric sans, 1950 a bold slab, 1975 a clean grotesk. Use CSS font stacks only, with no font files.
- `export function mastheadFor(year: number): { title: string; className: string }`

- [ ] **Step 1: Write the failing tests:**
  - `mastheadFor(1900|1925|1950|1975|1999)`.
  - The rendered paper contains the Ballot Box with 3 past elections when history has them.
  - The lead story is the latest politics item.
  - Decisions of the Year lists resolved cards.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Then visual check: screenshot the open newspaper at 1366×768 in 1910 and 1985, and Read the images.
- [ ] **Step 4: Commit** with `feat(ui): newspaper as the political front page`.

### Task 11: Phase 2 gate

**Files:**
- Create: `src/sim/__fixtures__/phase2.save.json` (`npm run fixture -- --name phase2`)
- Modify:
  - `scripts/soak.ts`: assertions that, per seed over a century,
    - the player is not bankrupt,
    - at least 99 cards were resolved,
    - at least 100 elections were held,
    - no faction stayed pinned at ≤ 2 or ≥ 98 for 10 or more consecutive years in any city,
    - and the Baron built something.
  - `README.md`: a "What's new in SMOKESTACK II (Phase 2)" section.

- [ ] **Step 1:** Run `npm run fixture -- --name phase2 && npm test`. Expected: all pass, including all three fixtures.
- [ ] **Step 2:** Run `npm run soak -- --seeds 7,42,1234 --years 101`. Expected: exit 0 with the new assertions. Compare timings with Phase 1 (about 13.5 s per seed); a regression above 25% must be explained.
- [ ] **Step 3:** Run `bash scripts/shots.sh`. Read the shots and the newspaper and overlay shots.
- [ ] **Step 4:** Run `npm run build && docker compose build`. `up` and curl are deferred to the merge.
- [ ] **Step 5: Commit** with `test: phase 2 fixture and gate`, then run `chown`.
