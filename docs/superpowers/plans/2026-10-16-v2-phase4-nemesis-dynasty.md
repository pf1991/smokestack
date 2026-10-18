# SMOKESTACK II Phase 4: Nemesis and Dynasty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the century two families, the Smogsworths and the player's own, who remember, retaliate, age, die and inherit. Add a stock exchange where companies are bought and sold, and a Legacy score that judges the whole century.

**Architecture:**
- The Baron's memory and temper live in `state.nemesis`, written only by `src/sim/nemesis/*`. Retaliation acts through the same public sim APIs the player uses: modifiers, `adjustOpinion`, `haltedUntil`, news and share purchases. He never cheats.
- The player's family lives in `state.dynasty` (`src/sim/dynasty/*`). Traits feed one modifier lookup, `dynastyModifier`, that opinion, edict and card code read.
- Regional firms are ordinary `kind: 'regional'` companies (generic ownership from Phase 0). Each is founded with one chain, built by the same builder that autoplay uses, generalised to any owner.
- The exchange (`state.exchange`, `src/sim/exchange/*`) prices every company daily. Holdings of 51% or more trigger a takeover through `transferOwnership`.
- Every new state field is added by one save migration `{ from: 6 }`, which bumps `SAVE_VERSION` to 7. Task 1 creates it and later tasks extend it.

**Tech Stack:** TypeScript 5.6 strict, Canvas 2D, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-11-smokestack-v2-design.md`: §7 (nemesis, dynasty and the stock exchange), §2 (Legacy), §11 Phase 4. Taunts, the Baron portrait, the takeover path, crash cards (dormant `trigger: 'crash'`) and the scheduled `crash1929` historic event already exist.

## Global Constraints

- No runtime dependencies or asset files. Canvas 2D only. Portraits are procedural (`src/render/portrait.ts`).
- `src/sim` is deterministic. Use only the state rng (`src/sim/rng.ts`). Iterate in array or id order (`companyIds` for companies).
- Funnels kept:
  - `transferOwnership` is the only way assets change company;
  - `adjustOpinion` is the only writer of faction opinion;
  - `sellVehicle` is the only vehicle deleter;
  - `smogDay` is the only writer of tile pollution.
- New funnels, each pinned in `src/sim/funnels.test.ts`:
  - `src/sim/nemesis/grudges.ts` `addGrudge` is the only writer of `state.nemesis.grudges`;
  - `src/sim/exchange/shares.ts` `moveShares` is the only writer of share holdings.
- `GameState` stays plain JSON. `SAVE_VERSION` becomes 7 with one `{ from: 6 }` migration. The `phase0`–`phase3` fixtures must load, pass `checkInvariants` and run a year.
- Registries are append-only: `SYSTEMS`, `PANELS`, `MIGRATIONS`, card ids, news kinds. No emoji anywhere in `src`. Icons come from the atlas.
- Money is authored in 1900 dollars and charged at `atPrices(state, x)` (`src/sim/society/economy.ts`). Card costs go through `choiceCost`.
- Performance: the soak's per-seed time must stay within 1.25× the Phase 3 merge (`03ce7e2`) measured back to back on the same machine. Measure the baseline in a temporary `git worktree` of `03ce7e2`, with seed 42 and `--years 101`.
- The century soak with autoplay (seeds 7, 42, 1234) ends in 2001 with victory, not game over, and stays solvent. Autoplay may answer hostile bids and name heirs only through the public API (Task 8, Task 5).
- Use `docker compose`. Run `chown -R freire:freire /home/freire/projects/industry` after `npm install` and after merges. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **No unlosable or unwinnable deaths.** When the head of the family dies with no living heir, the game is over. Every head must get a fair chance at an heir: the marriage card's default choice marries, and children are born while the head is married and under 50. When no heir is named, the eldest living child is the default. Pinned in Task 5.
2. **A hostile bid is always answerable.** When the Baron reaches 51% of the player's shares, the player gets a 6-month grace period. Buying back below 51% is always possible at a quoted price, and a loan can fund it. The grace period survives save and load. Pinned in Task 8.
3. **Retaliation is bounded and legible.** At most one retaliation per month and at most 6 a year. Each one prints a news item that names its cause (the grudge), and every effect expires. Sabotage can be exposed. Pinned in Task 2.
4. **Share prices stay finite and positive.** No NaN, no zero, no negative prices, even for a company with negative net worth, an inactive company or a company taken over. A taken-over company is delisted and its holdings are cleared. Pinned in Task 7.
5. **Succession keeps the Baron's story continuous.** The Baron's succession happens exactly once, between 1940 and 1955. It works the same when the Baron is inactive (taken over or bankrupt), in which case it prints no news. Junior keeps the grudges at 60% weight. Pinned in Task 4.

---

### Task 1: Nemesis state, traits and the grudge ledger

**Files:**
- Create: `src/sim/nemesis/types.ts`, `src/sim/nemesis/grudges.ts`, `src/data/nemesis.ts`
- Modify:
  - `src/sim/types.ts` (`GameState.nemesis: NemesisState`);
  - `src/sim/state.ts` (`createGame` rolls traits);
  - `src/sim/version.ts` (7);
  - `src/sim/migrations.ts` (`{ from: 6 }`);
  - `src/sim/systems.ts` (append `{ id: 'nemesis', onMonth: nemesisMonth, onYear: grudgesYear }`);
  - `src/sim/invariants.ts`.
- Test: `src/sim/nemesis/grudges.test.ts`, `src/sim/migrations.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- Produces in `src/sim/nemesis/types.ts`:
  ```ts
  export type BaronTrait = 'greedy' | 'vindictive' | 'showman' | 'cunning';
  export type GrudgeKind = 'undercut' | 'contract' | 'shares' | 'city' | 'sabotage_exposed' | 'takeover_bid';
  export interface Grudge { kind: GrudgeKind; weight: number; year: number; cityId: number | null }
  export interface BaronHead { name: string; born: number; generation: 1 | 2 }
  export interface NemesisState {
    head: BaronHead;
    traits: BaronTrait[];            // 2 at start; Junior adds one (Task 4)
    grudges: Grudge[];               // capped at GRUDGE_CAP = 40, lightest dropped first
    lastAction: { kind: RetaliationKind; year: number; month: number } | null;
    actionsThisYear: number;
    effects: RetaliationEffect[];    // live timed effects (Task 2)
    succession: { done: boolean; year: number | null };
  }
  ```
  `RetaliationKind` and `RetaliationEffect` are declared in this file, so Task 2 does not have to touch the types.
- `src/data/nemesis.ts`:
  - `BARON_TRAITS: Record<BaronTrait, { label: string; blurb: string; actionWeights: Partial<Record<RetaliationKind, number>> }>`;
  - `GRUDGE_WEIGHTS: Record<GrudgeKind, number>`: undercut 2, contract 3, shares 4, city 5, sabotage_exposed 6, takeover_bid 8.
- `grudges.ts`:
  - `addGrudge(state, kind, cityId, scale = 1): void`, the only writer;
  - `grudgeTotal(state): number`;
  - `grudgesYear(ctx)`, which multiplies every weight by `GRUDGE_DECAY = 0.8` and drops weights under 0.5;
  - `nemesisMonth(ctx)`, which detects grudge causes from state diffs and calls `retaliateMonth` (Task 2; a no-op stub until then).
- Grudge causes, all checked monthly and only while `companies.rival.active`:
  - **undercut:** a city and good with `flags['seller:<city>:<good>'] === 'both'`, at most one per city per month;
  - **contract:** a contract the player finished this month in a city where the Baron has a store (`politics.track.contractsSeen` style: keep `nemesis`'s own seen-id list, capped at 50);
  - **city:** `politics.track.sales[city].player > 2 × baron` while the Baron sells there and his sales are greater than 0, at most once per city per year.
- `createGame` rolls 2 distinct traits with `pick`. The head is `{ name: 'Baron Cornelius Smogsworth', born: 1852, generation: 1 }`. The migration does the same, rolling from the save's `rngState`. Rolling traits in `createGame` consumes rng draws, so the determinism hash changes: re-baseline it in the same commit and say so in the commit body.

- [ ] **Step 1: Write the failing tests:**
  - A new game has 2 distinct traits and no grudges.
  - Each cause adds exactly one grudge of the right kind, and the second month without a new cause adds none.
  - `grudgesYear` decays 10 → 8 and drops weights under 0.5.
  - The cap of 40 drops the lightest grudge.
  - An inactive Baron collects no grudges.
  - The v6 fixture migrates with `nemesis` set and passes invariants.
- [ ] **Step 2:** Run `npx vitest run src/sim/nemesis src/sim/migrations.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add an invariant that every grudge weight is finite and > 0 and that `grudges.length <= 40`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS, with the determinism baseline updated.
- [ ] **Step 5: Commit** with `feat(nemesis): baron traits and the grudge ledger`.

### Task 2: Retaliation menu

**Files:**
- Create: `src/sim/nemesis/retaliation.ts`
- Modify:
  - `src/sim/market.ts` (`computeDailySales` takes an optional `war?: { favoured: OwnerId; priceFactor: number } | null` per good);
  - `src/sim/production.ts` (`retailDay` passes the active price war);
  - `src/sim/politics/elections.ts` (`voteShares` honours `CityPolitics.baronBacks`);
  - `src/sim/politics/types.ts` (`CityPolitics.baronBacks?: FactionId | null`).
- Test: `src/sim/nemesis/retaliation.test.ts`

**Interfaces:**
- `type RetaliationKind = 'price_war' | 'poach' | 'fund_opponent' | 'smear' | 'sabotage' | 'hostile_bid'`.
- `RetaliationEffect = { kind: 'price_war'; cityId: number; goodId: GoodId; untilDay: number } | { kind: 'fund_opponent'; cityId: number; faction: FactionId; untilDay: number }`. Effects are kept in `state.nemesis.effects` and dropped when `dateToDays(date) >= untilDay`.
- `retaliateMonth(ctx)`, called by `nemesisMonth`, runs only when all of these hold:
  - `grudgeTotal ≥ RETALIATE_AT = 6`;
  - `actionsThisYear < 6`;
  - the last action was at least 2 months ago;
  - `chance(state, min(0.6, grudgeTotal / 30))`.

  It picks a kind by `BARON_TRAITS` action weights plus a base weight of 1 each, skipping kinds whose precondition fails. It applies the kind, prints a `'rival'` news item naming the heaviest grudge's cause, and spends the heaviest grudge (its weight halves).
- Kinds:

  | Kind | Precondition | Effect | Baron pays (1900 $) |
  |---|---|---|---|
  | `price_war` | a city and good both sell | 90 days: in that city and good the Baron's stores get 2 units for each 1 a rival store gets, and the price is ×0.85 for everyone | 5,000 |
  | `poach` | the player hires from a city | that city's `workers` opinion −6, reason "Smogsworth poaches your men" | 3,000 |
  | `fund_opponent` | a city with an election in the next 12 months | `baronBacks` = the faction with the lowest opinion of the player, until the election; `voteShares` ×1.3 for it | 4,000 |
  | `smear` | none | national opinion −4 of the faction with the highest opinion of the player | 1,000 |
  | `sabotage` | the player has a working factory | its `haltedUntil` = +10–20 days (`randInt`); with `chance(0.25)` exposed: a second news item, national `reformers` +4 and `oldmoney` +2 for the player, `addGrudge(... 'sabotage_exposed')`, and no further sabotage for 5 years | 6,000 |
  | `hostile_bid` | Task 8; skipped until it exists | buys player shares | the share price |

- Each kind is charged with `spend(rival, 'events', atPrices(state, cost))`. A kind he cannot afford while keeping `rivalReserve` is skipped.
- Every effect lifts after its time. An election clears `baronBacks` for its city.
- Toast: retaliation emits `{ type: 'baronStrike'; kind: RetaliationKind; cityId: number | null }`, a new event appended to the `GameEvent` union. The UI turns it into a 'bad' toast in Task 3.

- [ ] **Step 1: Write the failing tests:**
  - There is no action below `RETALIATE_AT`.
  - There are never more than 6 actions in a year, or 2 in consecutive months, across 1,000 seeded months.
  - Each kind's effect holds, then expires, by a day count.
  - A price war shifts the sales split 2:1 in a two-store city and lowers the price by 15%.
  - `fund_opponent` changes `voteShares` by ×1.3 before normalising, and the election clears it.
  - Exposed sabotage blocks sabotage for 5 years.
  - Every action prints a news item.
  - The Baron never spends below his reserve.
- [ ] **Step 2:** Run `npx vitest run src/sim/nemesis`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then `npm run soak -- --seeds 7,42,1234 --years 101`, and report retaliations per kind per seed. Extend `scripts/soak.ts` with a `nemesis` line. Expected: at least 5 retaliations per seed, and still solvent.
- [ ] **Step 5: Commit** with `feat(nemesis): the Baron retaliates`.

### Task 3: Baron voice and portrait moods

**Files:**
- Modify:
  - `src/render/portrait.ts`: moods `'smug' | 'furious' | 'scheming' | 'gloating'`, and a `generation` parameter, where 2 draws Junior: no mutton chops, a pencil moustache, a homburg instead of the top hat, and darker hair;
  - `src/sim/rival/taunts.ts`: trait and grudge-aware lines;
  - `src/ui/panels/rival.ts`: portrait, traits, grudge list and retaliation history;
  - `src/game/controller.ts`: the `baronStrike` toast.
- Create: `src/data/baronLines.ts`
- Test: `src/sim/rival/taunts.test.ts`, `src/ui/panels/rival.test.ts`, `src/render/portrait.test.ts`

**Interfaces:**
- `baronMood(state): BaronMood` (in `src/sim/nemesis/grudges.ts`):
  - `'gloating'` within 2 months of an action;
  - `'furious'` when `grudgeTotal ≥ 12`;
  - `'scheming'` when `grudgeTotal ≥ RETALIATE_AT`;
  - else `'smug'`.
- `BARON_LINES: { trait: Record<BaronTrait, string[]>; retaliation: Record<RetaliationKind, string[]>; junior: string[] }`, with at least 4 lines each. Lines may contain `{player}` and `{city}`.
- `rivalTaunt` keeps `TAUNT_CHANCE`. Half of the taunts come from the head's traits, plus `junior` lines when generation is 2.
- The rival panel shows:
  - the portrait, in `baronMood` and generation;
  - the head's name and age;
  - trait chips with blurbs;
  - the top 5 grudges ("Undercut in Millbrook, 1923");
  - the last 5 retaliations, taken from news items of kind `'rival'` with a `[nemesis]` tag in `NewsItem.tag?: string` (an optional field appended to `NewsItem`).
- The `baronStrike` toast reads "Smogsworth strikes: <kind label>" with action "Rival", which opens `PANELS.rival`.

- [ ] **Step 1: Write the failing tests:**
  - Mood thresholds.
  - Every line set is non-empty and has no emoji.
  - Taunts use trait lines and only use junior lines in generation 2.
  - The panel lists traits and grudges.
  - The portrait draws all 4 moods × 2 generations on a mock context without throwing.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Run `bash scripts/shots.sh`, then screenshot `sprites-preview.html` with a portrait sheet added: 4 moods × 2 generations. Look at the shots.
- [ ] **Step 5: Commit** with `feat(nemesis): baron voice, moods and junior's portrait`.

### Task 4: Smogsworth Jr. succession

**Files:**
- Create: `src/sim/nemesis/succession.ts`
- Modify: `src/sim/nemesis/grudges.ts` (`nemesisMonth` calls `successionMonth`), `src/data/cards/triggered.ts` (one card, `baron_funeral`, `trigger: 'spring'`, `condition`: succession this year)
- Test: `src/sim/nemesis/succession.test.ts`

**Interfaces:**
- `successionMonth(ctx)`. From 1940, each December, the succession happens with `chance(state, (year − 1939) / 16)`. It is forced in December 1955, and happens exactly once.
- Succession:
  - head becomes `{ name: 'Reginald Smogsworth Jr.', born: 1898, generation: 2 }`;
  - a third trait is added (`pick` among those not held);
  - every grudge's weight is ×0.6;
  - `succession = { done: true, year }`;
  - `'rival'` news: "THE OLD BARON IS DEAD; LONG LIVE THE BARON" while the company is active. While it is inactive the succession is silent.
- `baron_funeral` card choices:
  - send a wreath (cost 2,000, `oldmoney` +4);
  - skip it (free, `church` −3);
  - dance at the wake (free, `workers` +3, `oldmoney` −6, and `addGrudge('city', null, 2)`).

- [ ] **Step 1: Write the failing tests:**
  - Succession happens exactly once, in [1940, 1955], over 50 seeds.
  - It is forced in 1955.
  - Grudges are ×0.6.
  - The third trait is distinct.
  - It is silent when the Baron is inactive.
  - The card is eligible only that year.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5: Commit** with `feat(nemesis): smogsworth jr. inherits`.

### Task 5: Player dynasty and heirs

**Files:**
- Create:
  - `src/sim/dynasty/types.ts`;
  - `src/sim/dynasty/family.ts`;
  - `src/data/dynasty.ts` (traits, given names);
  - `src/ui/panels/family.ts` (`PANELS.family`);
  - toolbar or dock entry "Family".
- Modify:
  - `src/sim/types.ts` (`GameState.dynasty`);
  - `src/sim/state.ts`;
  - `src/sim/migrations.ts`;
  - `src/sim/systems.ts` (append `{ id: 'dynasty', onMonth: dynastyMonth, onYear: dynastyYear }`);
  - `src/data/cards/early.ts` (card `marriage`, years [1905, 1910], spring);
  - `src/game/autoplay.ts` (`autoplayNameHeir`, so the soak keeps the line going);
  - `src/render/portrait.ts` (`drawFamilyPortrait(ctx, size, person)`).
- Test: `src/sim/dynasty/family.test.ts`, `src/ui/panels/family.test.ts`

**Interfaces:**
- Types:
  ```ts
  export type HeirTrait = 'shrewd' | 'charming' | 'reckless' | 'idealist' | 'brute';
  export interface Person { id: number; name: string; born: number; traits: HeirTrait[]; alive: boolean }
  export interface DynastyState {
    head: Person; spouse: Person | null; children: Person[]; heirId: number | null;
    generation: number; prestige: number; nextPersonId: number;
  }
  ```
- `DYNASTY_TRAITS: Record<HeirTrait, { label; blurb; modifiers: DynastyModifiers }>`, where `DynastyModifiers = { opinion?: Partial<Record<FactionId, number>>; edictCost?: number; cardCost?: number; scandal?: number }`:

  | Trait | Effects |
  |---|---|
  | shrewd | `cardCost` ×0.85, oldmoney +0.5/month |
  | charming | all factions +0.25/month |
  | reckless | `scandal` ×1.5, `cardCost` ×0.9 |
  | idealist | reformers and church +0.5/month, oldmoney −0.5/month |
  | brute | workers −0.5/month, `edictCost` ×0.8 |

- `dynastyModifier(state): Required<DynastyModifiers>` combines the head's traits multiplicatively, and additively for opinion. Its callers:
  - `cardScale` multiplies by `cardCost`;
  - `scandalMonth` multiplies risk by `scandal`;
  - the edict maintenance multiplier in `src/sim/politics/edicts.ts` (the product of the three edicts' costs) is multiplied by `edictCost`;
  - `dynastyMonth` applies the opinion drift through `adjustOpinion(..., 'national', d, 'The family name')`.
- Life:
  - The first head is `Josiah ${family}`, where `family` is the first word of the company name. He is born in 1862 with 1 rolled trait.
  - `marriage` card choices: marry for money (cash +20,000), marry for standing (oldmoney +8), or stay single. The default choice is marry for money. Marriage sets `spouse` and adds 5 prestige.
  - While married and the head is under 50, each year a child is born with `chance(0.35)`, up to 5 children, each with 1–2 rolled traits.
  - Each December the head dies with `chance(mortality(age))`, where mortality is 0 under 55, then `(age − 55) × 0.012`, and 1 at 90 or older.
- On death:
  - If `heirId` (or else the eldest living child) is 18 or older, the heir becomes head:
    - `generation + 1` and prestige +10;
    - the spouse is null and children are empty;
    - each passed-over sibling aged 18 or older rolls `chance(0.3)` to open a scandal card: `triggerCard(ctx, 'scandal', biggestCityId)`.
  - Otherwise the game is over: emit `gameOver` with "The family line has ended".
- `nameHeir(state, personId): Result`. The heir must be a living child.
- `autoplayNameHeir(ctx)` names the eldest child with the most traits in `['shrewd', 'charming']`, else the eldest. The soak calls it yearly.
- `PANELS.family` shows a portrait per person, ages, traits with blurbs, an "Name heir" button per child, prestige and generation.

- [ ] **Step 1: Write the failing tests:**
  - Mortality is 0 at 54 and 1 at 90.
  - A child is only born while married and the head is under 50.
  - The heir inherits with generation +1.
  - The default heir is the eldest when none is named.
  - Death with no heir aged 18 or older emits `gameOver`.
  - `nameHeir` refuses a dead person or a non-child.
  - Trait modifiers reach `cardScale`, scandal risk and opinion drift.
  - The marriage card default marries.
  - Over 50 seeds × 101 years with `autoplayNameHeir`, the line never ends.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the soak. Report generations reached per seed, which must be at least 2.
- [ ] **Step 5: Commit** with `feat(dynasty): family, heirs and succession`.

### Task 6: Regional firms

**Files:**
- Create: `src/sim/regional/firms.ts`, `src/sim/chainBuilder.ts`
- Modify:
  - `src/game/autoplay.ts` (use `buildChain` with owner `'player'`);
  - `src/sim/systems.ts` (append `{ id: 'regional', onMonth: regionalMonth }`);
  - `src/data/names.ts` (firm names);
  - `src/ui/panels/finance.ts` (the companies table lists every company);
  - `src/sim/politics/factions.ts` (regional sales ignored, as now).
- Test: `src/sim/regional/firms.test.ts`, `src/sim/chainBuilder.test.ts`

**Interfaces:**
- `buildChain(ctx, owner: OwnerId, city: City, chain: 'furniture' | 'clothes' | 'cheese', trucksPerLeg = 2): Result<Building[]>`. This is autoplay's lumber → sawmill → furniture → store builder, generalised over owner and recipe chain. The other chains are `r_cotton → r_fabric → r_clothes` and `r_milk → r_cheese`, each ending at a store in `city`; take the building type of each recipe from `src/data/buildings.ts`. It uses only `findPlacement`, `placeBuilding`, `buildRoad`, `createRoute` and `buyTruck`, and every call is charged to `owner`. Firm *n* builds `['furniture', 'clothes', 'cheese'][n − 1]`.
- `REGIONAL_FIRMS` founding schedule: 1905, 1920 and 1935. Each firm:
  - has id `regional_1`…`regional_3`, `kind: 'regional'`, and a name from `names.ts` ("Millbrook Mercantile" style, using its home city);
  - starts with `money = atPrices(state, 150_000)`;
  - is founded in the largest city without a regional firm, by `buildChain`;
  - is skipped (and retried yearly) when the chain cannot be built.
- `regionalMonth(ctx)`:
  - tops up one truck per route when the route's trucks are full more than 50% of the time (the same rule the Baron uses: reuse `topUpTrucks` logic, parameterised by owner);
  - takes and repays loans like the Baron (`manageLoans` parameterised);
  - goes inactive (`active = false`, assets sold through `demolishBuilding` and `sellVehicle`) after 6 months in the red.
- Finance closes every company's month already (`companyIds`).

- [ ] **Step 1: Write the failing tests:**
  - `buildChain` builds the same chain for `'player'` as autoplay did before, by snapshot of building types and money spent on seed 42.
  - A firm is founded in 1905 in the largest city, owning its buildings, routes and vehicles.
  - A firm that cannot build retries next year.
  - A bankrupt firm deactivates and leaves no buildings.
  - `companyIds` order is player, rival, regional_1…3.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Refactor autoplay onto `buildChain` first, with the existing autoplay tests green, then add firms.
- [ ] **Step 4:** Run `npm test` and the soak. Report each firm's net worth in 1950 and 2000; at least 2 firms must be active in 2000 per seed. Check the time budget.
- [ ] **Step 5: Commit** with `feat(regional): regional firms on generic ownership`.

### Task 7: Share prices

**Files:**
- Create: `src/sim/exchange/types.ts`, `src/sim/exchange/prices.ts`, `src/sim/exchange/shares.ts`
- Modify:
  - `src/sim/types.ts` (`GameState.exchange`);
  - `src/sim/state.ts`;
  - `src/sim/migrations.ts`;
  - `src/sim/systems.ts` (append `{ id: 'exchange', onDay: exchangeDay, onMonth: exchangeMonth }`);
  - `src/sim/invariants.ts`.
- Test: `src/sim/exchange/prices.test.ts`

**Interfaces:**
- Types:
  ```ts
  export interface Listing {
    shares: number;                       // SHARES_OUTSTANDING = 1000
    holders: Record<OwnerId, number>;     // includes 'public'; sums to shares
    price: number;                        // per share, nominal $, > 0
    fundamental: number;                  // monthly anchor
    sentiment: number;                    // multiplier, in [0.4, 1.6]
    history: number[];                    // month-end prices, last 120
    listed: boolean;
  }
  export interface ExchangeState { listings: Record<OwnerId, Listing> }
  ```
- Initial holders: the company itself 40% (the founding family, treasury stock), `'public'` 60%. A listing is created for each company on creation or founding (player, rival, regional).
- `fundamental(state, id) = max(atPrices(state, 20), (netWorth + 8 × trailing-12-month profit) / shares)`, where profit is `monthProfit` of the ledger, refreshed in `exchangeMonth`.
- Daily: `sentiment *= exp(0.02 × (random − 0.5) × 2)`, then mean-reverts with `sentiment += 0.01 × (1 − sentiment)` and is clamped to [0.4, 1.6]. Then `price = round2(fundamental × sentiment)`.
- News shocks: `exchangeShock(state, id | '*', factor)` multiplies sentiment, clamped. Task 10 and retaliation use it.
- `delist(state, id)` sets `listed = false` and returns every non-public holding's shares to `'public'`. Takeovers and deactivation call it. A delisted price stays frozen.
- `moveShares(state, id, from, to, n)` is the only holdings writer. It throws on a negative or overdrawn move (a sim bug, never player input).
- Invariants:
  - holders sum to `shares`;
  - every price is finite and > 0;
  - every sentiment is within its bounds.

- [ ] **Step 1: Write the failing tests:**
  - A new game has 2 listings, 40/60 split.
  - The fundamental tracks net worth and profit.
  - The price stays within [0.4, 1.6] × fundamental over 36,000 seeded days.
  - A company with negative net worth keeps price ≥ the floor.
  - `delist` freezes the price and returns holdings to the public.
  - A regional founding lists the firm.
  - The v6 fixture migrates with listings.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and check the time budget on the soak.
- [ ] **Step 5: Commit** with `feat(exchange): daily share prices`.

### Task 8: Trading, takeovers and hostile bids

**Files:**
- Create: `src/sim/exchange/trading.ts`, `src/ui/panels/exchange.ts` (`PANELS.exchange`), a dock or toolbar entry "Exchange"
- Modify:
  - `src/sim/rival/takeover.ts`: the share route replaces the 3× net worth rule. `takeover` becomes the completion step, keeping its news, flag and achievement;
  - `src/sim/nemesis/retaliation.ts`: the `hostile_bid` kind;
  - `src/ui/panels/rival.ts`: "Buy his shares" instead of the old takeover button;
  - `src/game/autoplay.ts`: `autoplayDefend`;
  - `src/core/events.ts`: `{ type: 'hostileBid'; stage: 'started' | 'repelled' | 'lost' }`.
- Test: `src/sim/exchange/trading.test.ts`, `src/ui/panels/exchange.test.ts`

**Interfaces:**
- `quote(state, buyer, target, n): { price: number; total: number }`. Each block of 50 shares bought raises the price by 2% for the next block (price impact), and selling lowers it the same way. The impact applies to `sentiment`, so it decays.
- `buyShares(ctx, buyer, target, n): Result` and `sellShares(ctx, seller, target, n): Result`:
  - shares come from `'public'`, never from another holder;
  - the money moves through `spend` and `earn` under a new ledger category `'shares'`, appended to `LedgerCategory`;
  - n is in blocks of 10;
  - buying your own company's shares moves them to the company's own holding.
- Takeover: when a buyer's holding reaches ≥ 510 of 1000 in a company other than itself:
  - **The player buys the Baron:** `takeover(ctx)`, which keeps the news, `flags.takeover` and the achievement, transfers ownership and delists.
  - **The player buys a regional firm:** the same path through `transferOwnership`, with a "<Firm> absorbed" news item.
  - **The Baron buys a regional firm:** the same, with the Baron as receiver.
  - **The Baron reaches ≥ 510 of the player:**
    - set `nemesis.bid = { since: monthIndex, deadline: monthIndex + 6 }` (add `bid: { since: number; deadline: number } | null` to `NemesisState`);
    - emit `hostileBid` `'started'`;
    - open a new card `hostile_bid_warning` with a new `CardTrigger` value `'bid'` (appended to the union). Its choices are buy back now (calls `buyShares` for exactly the shares needed to bring his stake below 510; the choice's `cost` is 0 because `buyShares` books the money) and wait (free, the default).

    At the deadline:
    - if he still holds ≥ 510, emit `gameOver` with "Smogsworth has taken your company";
    - otherwise emit `'repelled'`, clear the bid and `addGrudge('takeover_bid')`.
- `hostile_bid` retaliation: the precondition is the Baron's net worth ≥ 1.5× the player's and his cash ≥ the quote for 100 shares above his reserve. The effect buys 100 shares (or fewer, to his means).
- `autoplayDefend(ctx)`: while a bid is open, buys back with cash, taking loans if needed. The soak calls it monthly.
- The exchange panel has:
  - a row per listed company: price, a 12-month sparkline (`src/ui/charts.ts`), and holdings by the player, the Baron and the public;
  - Buy and Sell 10/50 buttons with the quote shown;
  - a red banner while a bid is open, with a countdown in months.

- [ ] **Step 1: Write the failing tests:**
  - A quote rises with block size.
  - Buy then sell round-trips at a loss of less than 5%.
  - Money is booked under `'shares'`.
  - Crossing 510 of the Baron calls `takeover`: his buildings transfer, `flags.takeover` is set and he is delisted.
  - A regional takeover transfers.
  - The Baron's bid opens a 6-month grace period that survives `serialize` and load.
  - Buying back below 510 repels the bid and adds a grudge.
  - Not buying back emits `gameOver` at the deadline.
  - `autoplayDefend` repels on seed 42 with an injected bid.
  - Holdings never go negative.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the `beat_the_baron` scenario goal (`flags.takeover`) working, and update its blurb to "buy a majority of his shares".
- [ ] **Step 4:** Run `npm test` and the soak with `autoplayDefend`. Report bids per seed, and the result must be no game over.
- [ ] **Step 5: Commit** with `feat(exchange): trading, takeovers and hostile bids`.

### Task 9: The 1929 crash and market panics

**Files:**
- Modify:
  - `src/sim/events.ts`: `crash1929.apply` also calls `exchangeShock(state, '*', 0.45)`, `triggerCard(ctx, 'crash', null)`, and sets `flags.crashYear = 1929`;
  - `src/data/cards/triggered.ts`: crash cards act on the exchange where they say so: "Buy back your shares" buys 50 own shares through `buyShares`, and "Prop the bank up" applies `exchangeShock('*', 1.1)`;
  - `src/data/cards/*`: two new spring cards, `market_rumour` and `bull_market` (1920–1999), whose choices shock one company's sentiment;
  - `src/sim/nemesis/retaliation.ts`: `smear` also shocks the player's sentiment by ×0.9.
- Test: `src/sim/exchange/crash.test.ts`, `src/data/catalog.test.ts`

**Interfaces:**
- `exchangeShock` is from Task 7.
- A crash card opens on the `crash1929` event; it can no longer be dormant. The catalog test checks that each crash card resolves without error on a 1929 state.
- The crash sentiment recovers by mean reversion. The test pins that after 36 months it is within 0.85–1.0.

- [ ] **Step 1: Write the failing tests:**
  - On 1929-10 every listed price falls about 55%.
  - A crash card is pending.
  - "Buy back your shares" moves 50 shares to the company.
  - Recovery holds by 1932-10.
  - The new cards pass the catalog rules.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5: Commit** with `feat(exchange): the great crash`.

### Task 10: Legacy score

**Files:**
- Create: `src/sim/legacy.ts`, `src/ui/panels/legacy.ts` (`PANELS.legacy`)
- Modify:
  - `src/ui/menu.ts`: `showEndScreen` shows the Legacy breakdown on victory and game over;
  - `src/sim/landmarks.ts`: a landmark built in a town where the player has the top retail revenue that month records `flags['landmarkCredit:<city>:<idx>'] = true`;
  - `src/ui/panels/goals.ts`: a Legacy line.
- Test: `src/sim/legacy.test.ts`

**Interfaces:**
- `legacyScore(state): { fortune: number; landmarks: number; reputation: number; dynasty: number; total: number }`. Each part is rounded to whole points:
  - **fortune** = `round(realMoney(netWorth(player)) / 10_000)`, in 1900 dollars, min 0;
  - **landmarks** = 50 × landmarks credited to the player;
  - **reputation** = `round(Σ over factions (nationalOpinion − 50) × 4)`, which may be negative;
  - **dynasty** = `prestige + 25 × (generation − 1)`, plus 100 when the Baron was taken over (`flags.takeover`);
  - **total** = the sum, min 0.
- The Legacy panel shows the four parts with a one-line explanation each, plus the total. The end screen shows the same table under the result line.

- [ ] **Step 1: Write the failing tests:**
  - Each part is computed from a fixture state with known numbers.
  - The takeover bonus counts.
  - Landmark credit is only recorded when the player leads the town's sales.
  - The end screen lists all four parts.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. The soak prints each seed's Legacy score in 2001.
- [ ] **Step 5: Commit** with `feat: legacy score`.

### Task 11: Phase 4 gate

**Files:**
- Create: `src/sim/__fixtures__/phase4.save.json`, made 50 years in (1950), so the nemesis, dynasty and exchange state are non-trivial: `npm run fixture -- --name phase4 --days 18000`
- Modify:
  - `scripts/soak.ts`, adding these assertions per seed:
    - at least 5 retaliations;
    - Baron succession done;
    - dynasty generation ≥ 2;
    - at least 2 regional firms active in 2000;
    - every listing price finite and > 0;
    - a crash card resolved in 1929;
    - victory (no game over);
    - Legacy printed.
  - `README.md`: a "What's new (Phase 4)" section.

- [ ] **Step 1:** Run `npm run fixture -- --name phase4 --days 18000 && npm test`. Expected: all five fixtures load.
- [ ] **Step 2:** Run `npm run soak -- --seeds 7,42,1234 --years 101`. Expected: exit 0, with timing within 1.25× of Phase 3.
- [ ] **Step 3:** Run `bash scripts/shots.sh`. Take showcase shots of the rival panel (Junior, furious), the family panel, the exchange panel with a bid banner, and the end screen Legacy table. Look at every shot.
- [ ] **Step 4:** Run `npm run build && docker compose build`. The `up` waits for the merge.
- [ ] **Step 5: Commit** with `test: phase 4 fixture and gate`, then run `chown`.
