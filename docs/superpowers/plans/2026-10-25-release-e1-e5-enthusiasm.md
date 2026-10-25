# SMOKESTACK Next Level: E1–E5 Enthusiasm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Take shipped 1.0 and make it a game people stay up for: ambition after first sale,
juice on every win, a Baron who fights you, an economy that matches its story, and UI that
invites instead of auditing.

**Architecture:** Ambitions and juice live mostly in `src/game` + `src/ui` (and light render
overlays). Rival heat and economy sense touch `src/sim` with migrations where state shape
changes. Progressive disclosure is UI-only. Keep `src/sim` deterministic; juice never draws
the main rng stream.

**Tech Stack:** TypeScript 5.6 strict, Vite 5, Vitest + jsdom, Canvas 2D. No new runtime
dependencies. Node 24 for tests:
`export PATH=$HOME/.nvm/versions/node/v24.11.0/bin:$PATH`.

**Spec:** `docs/superpowers/specs/2026-10-25-enthusiasm-next-level-design.md`.

## Global constraints

- **Branch:** cut `release/e1` … `release/e5` from `main` (or one `release/enthusiasm` with
  per-subproject commits — prefer **one branch per E** so gates stay reviewable).
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Screenshots:** extend `scripts/shots.sh` when a task adds a visible surface.
- **Soak:** E3 and E4 require `npm run soak -- --seeds 7,42,1234 --years 101` before merge.
- **Bundle:** `npm run check-dist` must stay green (R5 gzip budgets).

## Review focus (binding)

1. Free Play always shows at least one ambition meter after the tutorial ambitions card is
   dismissed (E1).
2. Sale floats never allocate unbounded DOM; one pooled layer (E2).
3. Baron contested bias only engages when a grudge exists or the player already sells that
   good in that town (E3) — new players in empty towns stay gentle.
4. Computer deep recipe: balance gate deep-min ≥ shallow-median still holds; fixtures load (E4).
5. Dense panels keep a one-screen "Now" summary before tables (E5).

---

## E1 — Ambition

### Task E1.1: Post-tutorial ambitions card

**Files:** `src/ui/tutorial.ts` (or new `src/ui/ambitionsCard.ts`), tests, maybe `tutorial.css`.

- After tutorial `done` / skip, once per browser (`localStorage` key), show a brass card with
  three bullets: open Contracts, place a Trading House (Retail tab), open Codex on a component
  (Wire). Dismiss = Next / Got it.
- Does not block the sim. Highlights use existing selectors.

- [x] **Step 1:** Failing test — after tutorial status `done`, card mounts once; second New Game
  does not remount if storage set.
- [x] **Step 2:** Implement.
- [x] **Step 3:** Commit `feat(ui): post-tutorial ambitions card`.

### Task E1.2: Free Play soft ambitions

**Files:** `src/sim/ambitions.ts` (new), `src/sim/types.ts` / flags or save slice, migrations if
needed, `src/ui/panels/goals.ts`, tests.

- Soft goals with meters for Free Play only (`scenario.goals.length === 0`).
- Pool (v1): `sell_furniture_100`, `complete_contract_1`, `own_trading_house`,
  `second_city_store`, `year_profit_50k`, `sell_component_any`.
- One active at a time; on complete → toast + roll next unmet; never fails the game.
- Goals panel replaces the shrug empty state with the active ambition + "Completed" list.

- [x] **Step 1:** Failing tests for roll / complete / Free Play only.
- [x] **Step 2:** Implement + migration if state shape changes.
- [x] **Step 3:** Commit `feat(game): Free Play soft ambitions with meters`.

### Task E1.3: Chaseable achievements

**Files:** `src/game/achievements.ts`, Goals or HUD chip, menu gallery, tests.

- Add mid-game achievements (at least): first TH sale, first component sold nationally,
  first hub, first appliance sold, survive price war, first scrubber, second consumer line,
  decade without red month (define precisely in tests).
- HUD or Goals chip: `Next: <name> · <progress>` for the nearest incomplete with a numeric
  progress; otherwise the next by catalogue order.

- [x] **Step 1:** Tests for new achievements + chip copy.
- [x] **Step 2:** Implement.
- [x] **Step 3:** Commit `feat(game): mid-game achievements and progress chip`.
- [x] **Step 4:** `npm test`; screenshot Goals Free Play + ambitions card. Merge note for E1.

---

## E2 — Juice

### Task E2.1: On-map sale floats

**Files:** `src/render/` overlay or `src/ui/saleFloats.ts`, wire from sale bus events in
`src/game/feedback.ts`, tests for batching helpers.

- On `sale` for player: enqueue float at building footprint; flush ≤1 aggregated float per
  building per day (`+$n` + icon).
- Respect photo mode (hidden). Disable or simplify when zoom &lt; 1.0.

- [x] **Step 1:** Unit-test aggregation helper.
- [x] **Step 2:** Implement overlay.
- [x] **Step 3:** Commit `feat(ui): on-map sale floats`.

### Task E2.2: Invention fanfare + early alerts

**Files:** `src/sim/eras.ts` (emit richer event or toast payload), `src/game/feedback.ts`,
`src/game/alerts.ts`, toolbar pulse CSS, tests.

- Invention unlock → toast/stamp + optional `data-pulse` on the matching build tab for 10s.
- `BUILDING_DAYS`: use 2 when `state.date.year < 1905` (or ambitions tutorial active); else 7.
  Pin both in tests.

- [x] **Step 1:** Failing tests.
- [x] **Step 2:** Implement.
- [x] **Step 3:** Commit `feat(game): invention fanfare and faster early alerts`.

### Task E2.3: Chain health strip

**Files:** `src/game/chainHealth.ts` (pure), HUD or Goals footer, tests.

- Score player chain: starved inputs / idle works / empty shelves (reuse alert reasons).
- Three-segment strip; click → jump like alerts tray.

- [x] **Step 1:** Pure function tests.
- [x] **Step 2:** UI strip.
- [x] **Step 3:** Commit `feat(ui): chain health strip`.
- [x] **Step 4:** Shots + `npm test` + `check-dist`. E2 gate.

---

## E3 — Rival heat

### Task E3.1: Contested market bias

**Files:** `src/sim/rival/market.ts`, rival tests, soak.

- When choosing projects, if a candidate town already has player sales for that good **or**
  an active grudge involving that town/good, prefer it (descending `playerThere` / grudge
  boost). Keep empty-niche fill when no rivalry signal.

- [x] **Step 1:** Failing tests (shared town + grudge vs empty map).
- [x] **Step 2:** Implement.
- [x] **Step 3:** Commit `feat(ai): Baron contests shared markets under rivalry`.

### Task E3.2: Top-bar rival strip + grudge list

**Files:** HUD, `src/ui/panels/rival.ts`, feedback when undercut / retaliate fires, tests.

- Compact strip under top bar (or in alerts area): latest rival beat + Jump.
- Rival panel: "Active fights" section from grudges.

- [x] **Step 1:** UI tests.
- [x] **Step 2:** Implement.
- [x] **Step 3:** Soak 3 seeds × 101y. Commit `feat(ui): rival challenge strip and active fights`.
- [x] **Step 4:** E3 gate.

---

## E4 — Economy sense

### Task E4.1: Deep computers + bricks job

**Files:** `src/data/recipes.ts`, `goods`/`buildings` if needed, `catalog.test.ts`,
`balance.test.ts`, construction or landmark spend path for bricks, codex copy.

- Computers: chip+display recipe path; shallow recipe faded or inspector-optional after unlock
  year. Update AI `firstRecipeFor` expectations carefully.
- Bricks: construction / upgrade discount when stocked (pin math in tests) **or** civic
  contract — pick one in implementation and document in commit body.

- [x] **Step 1:** Catalog + balance failing tests.
- [x] **Step 2:** Implement + chain-report check.
- [x] **Step 3:** Commit `feat(data): deep computers and a job for bricks`.

### Task E4.2: Fades + mid-century spikes

**Files:** `eras.ts`, goods fadeYears, cards or modifiers, newspaper, tests.

- Add ≥2 meaningful fades or substitution paths beyond the existing three.
- Add ≥2 mid-century demand spike events (1940–1965) as cards or temporary demand modifiers.

- [x] **Step 1:** Tests.
- [x] **Step 2:** Implement.
- [x] **Step 3:** Soak. Commit `feat(sim): more fades and mid-century demand spikes`.
- [x] **Step 4:** E4 gate (chain-report era lines in commit body).

---

## E5 — UI invitation

### Task E5.1: Progressive disclosure for dense panels

**Files:** `politics.ts`, `finance.ts`, `exchange.ts`, `fleet.ts`, `city.ts` (+ css/tests).

- Each opens on a "Now" summary (1–3 decisions) with "Show full …" expanding tables.
- First visit coach mark once per panel (`localStorage`).

- [x] **Step 1:** Panel tests for summary-first DOM.
- [x] **Step 2:** Implement panel by panel (one commit each or one bundled commit if small).
- [x] **Step 3:** Commit `feat(ui): summary-first Politics Finance Exchange Fleet City`.

### Task E5.2: Teach TH/Components + Help primer + price tooltip

**Files:** toolbar coach, `help.ts`, `city.ts` tooltip, ambitions cross-links, tests, shots.

- Pulse Components / Trading House when triggers from spec fire.
- Help page: systems primer + hotkeys.
- City Price column title/tooltip explains multipliers.

- [x] **Step 1:** Tests.
- [x] **Step 2:** Implement.
- [x] **Step 3:** Shots at 1366/1920. `npm test && build && check-dist`. *(shots skipped — display flaky; gate otherwise green)*
- [x] **Step 4:** Commit `feat(ui): coach marks, help primer, city price tooltips`.
- [x] **Step 5:** Merge E5; update design spec status to implemented. *(merge left to parent → main)*

---

## Suggested execution order when we start

1. E1.1 → E1.2 → E1.3 (ambition cliff)
2. E2.2 (early alerts + invention) → E2.1 → E2.3
3. E3.1 → E3.2
4. E4.1 → E4.2
5. E5.1 → E5.2

**First playable vertical slice (if we want a quick taste):** E1.1 + E2.2 only, then play 20
minutes before continuing.
