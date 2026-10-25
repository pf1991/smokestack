# SMOKESTACK Next Level: Enthusiasm, Sense & Addiction

Status: **E1–E5 implemented** (2026-10-25). Analysis of the shipped 1.0 on
`main` (`11abb22` / R1–R5). Decisions marked *(decided)* guided the Next Level track;
E1–E5 are on `release/e5` ready to merge.

## 1. Intent

1.0 shipped a real game: Pages-ready build, Brass & Ledger UI, alerts + codex, 61 goods,
Trading House, and a working century sim with a rival. The bones of an addictive industrial
loop are there.

It does not yet feel like a game you stay up for. After the first ka-ching, Free Play shrugs
("Nothing to chase but your legacy"). Mid-game systems (Components, Trading House, hubs,
Exchange) stay expert-only. Several economy choices undermine the story we told players
("deep chains pay"). The Baron often fills empty niches instead of fighting you.

**Success criteria for Next Level**
1. **Ambition after first sale.** Free Play always has a short, medium and long thing to chase.
2. **Juice on every win.** Sales, inventions, contracts and rival clashes celebrate on the map
   and in the HUD — not only as SFX or newspaper text.
3. **The catalogue tells one story.** Deep chains beat shallow ones; orphans and broken
   incentives are fixed; empty decades get events.
4. **The Baron is a sparring partner.** Contested markets, visible grudges, session-scale
   challenges — not ambient filler.
5. **UI that invites, not audits.** The densest panels get progressive disclosure; the worst
   empty states become coaches.

**Out of scope here (keep on their tracks)**
- Phase 5 inventions / patents / alternate history (separate design).
- JEV Noul follow-ups (already planned in `2026-10-17-v2-jev-decisions.md`).
- Full audio / music score.
- Multiplayer, monetisation. (Mobile: map-first touch — drag pans, pinch zooms, tap acts, tap–tap roads — shipped 2026-10-25.)

## 2. Diagnosis (full analysis)

### 2.1 What already works (do not break)

| Strength | Why it matters |
|---|---|
| Tutorial → furniture → first sale | Clear craft loop with highlights and predicates |
| Alerts + statusAdvice + map badges | Actionable breakage; camera jump |
| Ka-ching, stamps, money milestones, contract toasts | Real dopamine exists |
| Scenario goals with meters | Short campaigns already feel purposeful |
| Rival personality (taunts, strikes, hostile bid) | Emotional stakes when systems fire |
| Codex + Components tab + kinds | 61 goods are *survivable* |
| Trading House economics | National dump is intentionally thinner than retail |
| Deep appliance / phone chains | Prove the R4 thesis when the player finds them |

### 2.2 What does not make sense

| Problem | Severity | Notes |
|---|---|---|
| **Computers stay shallow and ultra-profitable** (`plastic+steel+glass`, ~$86/wk-mo) while phones got the deep chip chain | P0 economy | Breaks "deep chains pay"; late meta skips logistics |
| **Bricks are orphan** — clay → bricks → Trading House only | P1 | Dead content; kiln with no story |
| **Tools underpay** (~$8/wk-mo) | P2 | Flavor chain nobody builds twice |
| **Only 3 product fades** (phonographs, radios, calculators) | P1 pacing | Catalogue accumulates; no "retool or die" |
| **1940s and most of 1960s are dead decades** | P1 pacing | No goods / weak events → waiting rooms |
| **Baron prefers towns where you are *not*** | P0 drama | Tie-break avoids conflict; nemesis is the only fight |
| **Radios: tube recipe exists but `firstRecipeFor` keeps the shallow one** | P2 | AI and planning ignore valves |
| Free Play victory = calendar rolls to 2001 | P1 emotion | Flat climax unless Legacy mattered |

### 2.3 Engagement / addiction holes

**P0 — Mid-game cliff.** Tutorial ends at alerts + codex. Free Play goals panel: empty shrug.
No guided path to Components, Trading House, contracts, rail, or "beat the Baron". Alerts
teach *breakage*, not *ambition*.

**P0 — Silent broken chains.** Building alerts wait 7 days. New players can think a starved
factory is fine while the tutorial has already moved on.

**P1 — Weak sale celebration.** Sale = throttled SFX only. No floating money, no on-map
product callout, no combo / streak for profitable months.

**P1 — Achievements are sparse and unchaseable.** 12 defs, many opaque (`monopoly`,
`clean_hands`). Menu gallery only; no "Next: Contract Killer 3/10" in-game.

**P1 — Discoverability.** Components tab and Trading House never taught. Component contracts
require owning a Trading House first (chicken-and-egg). Invention unlocks are newspaper-only
(no stamp / build-bar pulse).

**P2 — Dense admin panels.** Worst offenders: Politics, Finance ledger, Exchange, City
inspector, Fleet table. Brass & Ledger helped; hierarchy and progressive disclosure did not
finish the job.

### 2.4 Systems that deserve spotlight vs hide

| Spotlight | Hide / soft-pedal |
|---|---|
| Nemesis + contested markets | Photo mode (keep as easter egg) |
| Deep component chains | JEV (self-host / off on Pages) |
| Dynasty + hostile bid moments | Regional firm panel noise |
| Logistics when depth ≥ 4 appears | Manager skill triad until hubs matter |
| Class / luxury demand (already coded) | Late shallow catalogue clutter |

## 3. Ideas from excellent games (engagement edition)

| Game | Idea | Where it lands |
|---|---|---|
| **Anno 1800** | Session quests / "influence" ambitions that always give a next objective | Ambitions layer (E1) |
| **Factorio** | Production graph + "something is broken" as the core itch; celebrate when the belt flows | Chain health HUD (E2) |
| **RollerCoaster Tycoon / OpenTTD** | Floating cash on every transaction; park/value tick up | On-map sale juice (E2) |
| **Civilization** | Eureka / unlock fanfare that makes you open the tech panel | Invention stamps + toolbar pulse (E2) |
| **Slay the Spire / Hades** | Short run goals + long meta (achievements, rivals) | Soft Free Play goals + denser achievements (E1) |
| **Frostpunk** | Hope/discontent as always-visible stakes | Rival challenge strip in the top bar (E3) |
| **Capitalism Lab / Industry Giant** | Retooling when products die | More fades + mid-century demand spikes (E4) |
| **Mini Metro** | Progressive disclosure; complexity arrives when earned | Panel simplification (E5) |

## 4. Sub-projects (order)

Each builds on `main`, own branch `release/e<N>`, screenshot / soak gate at the end.

| # | Name | Why this order |
|---|---|---|
| **E1** | **Ambition** — Free Play soft goals, post-tutorial ambitions, chaseable achievements | Fixes the cliff; everything else needs a "why" |
| **E2** | **Juice** — on-map sales, invention fanfare, faster early alerts, chain-health strip | Makes every win feel good; low sim risk |
| **E3** | **Rival heat** — Baron contests you, top-bar challenge, grudge visibility | Turns personality into a session driver |
| **E4** | **Economy sense** — deep computers, bricks job, fades, mid-century events | Fixes nonsense; needs balance soak |
| **E5** | **UI invitation** — progressive disclosure for Politics/Finance/Exchange/Fleet/City; teach TH/Components | Polish once the loop pulls |

**Phase 5 / JEV / music** stay separate. Do not block E1–E5 on them.

## 5. Design (decided directions)

### E1 — Ambition *(decided)*

1. **Post-tutorial "Next ambitions" card** (same brass card pattern as the tutorial). Three
   soft bullets after first sale, e.g. open Contracts, place a Trading House, open the Codex
   on Wire. Manual dismiss; remembered once per browser like the tutorial.
2. **Free Play ambitions** (no hard fail): a small rotating set of soft goals with meters
   (reuse `goals.ts` UI). Examples: sell 100 furniture, complete 1 contract, own a Trading
   House, earn $50k profit in a year, open a second city store. Completing one rolls the next.
   Century clock and Legacy remain; ambitions are the short loop.
3. **Achievement progress in Goals / HUD chip**: "Next: Contract Killer · 3/10". Add ~8
   mid-game achievements (first Trading House sale, first component sold, first hub, first
   appliance sold, survive a price war, first scrubber, second product line, decade without
   a red month).

### E2 — Juice *(decided)*

1. **On-map sale juice**: batched floating `+$n` + good icon at the store / Trading House
   (cap spam: one float per building per day, or aggregate). Keeps ka-ching; adds eyes.
2. **Invention / era fanfare**: stamp or toast with "Open Manufacture / Components" action
   when an invention unlocks; pulse the relevant toolbar tab for ~10s.
3. **Early alert delay**: `BUILDING_DAYS` 7 → 2 while year &lt; 1905 or while tutorial /
   ambitions active; restore 7 later so late-game trays stay calm.
4. **Chain health strip** (compact HUD or Goals footer): Inputs → Works → Shelves, click
   jumps to the worst break. Turns alerts from pure negative into a proactive itch.

### E3 — Rival heat *(decided)*

1. **Contested bias**: when the player has a grudge or shares a good in a town, Baron
   scoring *prefers* that town (flip today's `playerThere` ascending tie-break under rivalry).
2. **Top-bar rival strip**: latest taunt / "Undercutting you in Rivermouth — Furniture"
   with a Jump / Respond affordance (open rival or city panel).
3. **Surface active grudges** in the Rival panel as a short fight list, not only history.

### E4 — Economy sense *(implemented on release/e4)*

1. **Computers go deep**: retarget `r_computers` (and/or add `r_computers_chip`) to use
   microchips + displays (and keep a legacy shallow recipe faded or player-optional). Balance
   gate must still pass; ppwm should sit near phones/video games, not above them as a depth-3
   cheat.
2. **Bricks get a job**: preferred option — landmark / road / upgrade construction cost
   discount when the player holds bricks in a warehouse or Trading House; fallback — civic
   contract good. Do not leave kiln as TH-only dump.
3. **More fades** (at least radios→solid-state path already half-exists; add 1–2 mid-century
   fades such as early appliances or tube gear). Newspaper already warns; line-closer stays.
4. **Mid-century demand spikes** for empty decades: wartime contracts / suburban appliance
   boom events (cards or news modifiers) so 1940–1965 are not waiting rooms.
5. **Tools**: either buff to near furniture or demote to a tutorial/scenario flavor with
   honest codex copy. No silent dogs.

### E5 — UI invitation *(implemented on release/e5)*

1. **Progressive disclosure**: Politics / Finance / Exchange open on a "Now" summary card;
   advanced tables behind "Full ledger" / "All factions". First-time coach marks.
2. **Teach Components + Trading House**: toolbar coach marks when first consumer chain is
   profitable / first component unlocks; ambition bullets from E1 reinforce.
3. **City price tooltip**: "Base × supply × price index" on the Price column.
4. **Help primer**: one page beyond hotkeys — Extract → Refine → Components → Manufacture →
   Retail / Trade, with links to Codex and Alerts.
5. **Fleet / City**: keep data, lead with the decision (stuck trucks, empty shelves, top
   unmet demand) not the full grid.

## 6. Global constraints

- Determinism of `src/sim` stays sacred. Juice is game-layer / render; ambitions may use
  flags but must not change rng draw counts unless a migration and soak say so.
- Saves: bump version only if state shape changes (ambitions, brick discount flags, computer
  recipes). Fixtures must load.
- No runtime CDN, no emoji in `src`, Brass & Ledger tokens only.
- Commits: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Soak + screenshot gates at E2, E3, E4, E5 merges. E1 can be lighter (UI + soft goals).
- Pages bundle budget from R5 still holds; juice sprites must stay procedural / CSS.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Ambitions feel like chores | Soft, optional, always completable; no fail state; witty copy |
| Sale floats spam / tank FPS | Batch per building-day; pool DOM nodes; disable below zoom |
| Deep computers break old saves / AI | Migration unlocks new recipe; keep shallow as faded alternate or inspector choice |
| Baron heat frustrates new players | Contested bias only after first sale year or when a grudge exists |
| Scope creep into Phase 5 | Explicit out-of-scope list; mid-century spikes are modifiers, not a patent tree |

## 8. Suggested first vertical slice

When implementation starts, ship **E1 Task 1 + E2 early alerts + invention toast** first:
ambition card + faster early alerts + invention fanfare. Play for 20 minutes. If the cliff
is gone and unlocks feel exciting, continue the track in order.
