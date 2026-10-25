# SMOKESTACK 1.0: Release Design (GitHub Pages, design system, products)

Status: **R1–R5 implemented and merged to `main`** (2026-10-25). Approved by owner
pre-authorisation (2026-10-24) to plan and implement without stopping for permission. The
decisions marked *(decided)* below were made on the owner's behalf. Remaining for the owner:
make the repository public, enable Pages (Settings → Pages → Source: GitHub Actions), and push
`main` so `.github/workflows/pages.yml` deploys.

## 1. Intent

The owner's request, verbatim:

> I want to publish this game in a github page but it must become an awesome game! With many
> different products to build and sell, amazing UI and UX. You can take ideas from existing
> excelent games.

The owner's earlier verdict on the interface: "It looks like an UI done by a backend developer".

### Success criteria
1. **Publishing.** The game builds as a static site and deploys to GitHub Pages from a GitHub
   Actions workflow. It plays fully offline: JEV is off on Pages, because Pages has no proxy.
2. **A designed interface.** Every screen uses one design system: tokens for type, space, color
   roles and elevation, plus a small component kit. Each panel leads with what the player must
   decide, not with a raw table. Problems come to the player through alerts instead of hiding
   in tables.
3. **Many products.** About 34 new goods (6 raw, 8 materials, 7 components, 13 consumer goods)
   in about 16 new buildings, spread across the century. A production-chain codex keeps a
   catalogue of 60 goods understandable.
4. **No regressions.**
   - Saves from every fixture load.
   - The sim stays deterministic.
   - `npm test`, `npm run build` and the century soak pass.
   - 60 fps at 1366×768.

### Out of scope here
These stay on their own tracks: Phase 5 (inventions, patents, world events), the JEV follow-ups,
and audio or music work.

## 2. Ideas taken from excellent games

| Game | Idea | Where it lands |
|---|---|---|
| Anno 1800 | Production-chain tooltips. Needs per population class. Notifications that jump the camera to the problem. | Chain codex (R3), class demand per good (R4), alerts tray (R3) |
| Factorio | Status icons over a starved or blocked building. Rates per minute. A recipe browser. | Map status badges (R3), "/mo" rates everywhere, codex (R3) |
| Transport Fever 2 / OpenTTD | Line colors carried through every view. Line cards that show flow and problems. | Routes panel rework (R2) |
| Mini Metro | Restraint: few colors, each meaning one thing, generous spacing. | Design tokens (R2) |
| Frostpunk / Victoria 3 | A period voice in type and paper, while the data stays crisp and sans-serif. | Two-family type system (R2) |
| Capitalism Lab | A deep catalogue of products with parts made by other factories. | The component tier (R4) |

## 3. Sub-projects and order

Each sub-project gets its own plan, built on `main`, with a screenshot gate at its end.

| # | Sub-project | Why this order |
|---|---|---|
| R1 | **GitHub Pages build** | Small. It makes every later phase shareable at once. |
| R2 | **Design system "Brass & Ledger" and screen rework** | The owner's main complaint. Everything after builds on its components. |
| R3 | **Clarity layer**: alerts tray, map status badges, production-chain codex | Needed before the catalogue triples, or 60 goods become unreadable. |
| R4 | **Product expansion** (the Phase 4c brief, finalised in §7) | Needs R3's codex and R2's components for its new screens. |
| R5 | **Release polish** | Tutorial covers the new UI and products; landing and meta tags; a performance check on Pages; README. |

Plans: R1, R2 and R3 share one plan (`docs/superpowers/plans/2026-10-24-release-r1-r3.md`).
R4 and R5 get their own plans once R3 merges, because their details depend on R2's components.

## 4. R1: GitHub Pages

- **Base path:** `vite.config.ts` sets `base: './'`, so the build works under `/<repo>/`.
- **Deploy workflow:** `.github/workflows/pages.yml` runs `npm ci`, `npm test` and
  `npm run build` on pushes to `main`, uploads `dist/` with `actions/upload-pages-artifact`,
  and deploys with `actions/deploy-pages`.
- **JEV on Pages:** the client already falls back to `offline` when `/api/health` fails. The
  settings row then reads "Smart events need the self-hosted server (see README)" instead of a
  bare "offline".
- **Paths:** no absolute `/` asset URLs. A test scans `dist/index.html` for `src="/` and `href="/`.
- **Docker and nginx** stay as they are; self-hosting keeps JEV.
- *(decided)* Creating the GitHub repository and pushing to it is left to the owner. It makes
  the code public, which can't be undone. The README gets a "Publish to GitHub Pages"
  section with the exact commands.

## 5. R2: Design system "Brass & Ledger"

### 5.1 Tokens (`src/ui/theme.css`)

**Type** *(decided)*:
- **Two families,** shipped as woff2 font files and loaded with `@font-face` (no CDN, so it works
  offline):
  - *Playfair Display* for display text: titles, panel headings, money in the top bar;
  - *Source Sans 3* for UI text and data, with `font-variant-numeric: tabular-nums` for numbers.
- **The newspaper** keeps its own masthead faces per era.
- **Scale:** 5 steps, `--fs-xs: 11px`, `--fs-sm: 12.5px`, `--fs-md: 14px`, `--fs-lg: 18px`,
  `--fs-xl: 26px`. No other font sizes in UI CSS; a test enforces this.
- **Case:** uppercase letter-spaced text only for small overlines (`--fs-xs`, 0.08em). Headings
  are in title case.

**Space:** `--sp-1: 4px` up to `--sp-6: 32px` (4, 8, 12, 16, 24, 32). Radius tokens:
`--r-sm: 3px`, `--r-md: 6px`.

**Color roles.** Each brass color does one job:
- `--surface-0`: the walnut canvas behind the panels;
- `--surface-1`: a panel;
- `--surface-2`: a card inside a panel;
- `--paper`: documents (cards, newspaper);
- `--text`, `--text-muted`, `--text-faint`;
- `--accent`: brass, used only for the primary action and the selected state;
- `--accent-quiet`: brass outlines and dividers;
- `--positive`, `--negative`, `--warning` (amber), `--info` (teal), each with a
  `-bg` tint for pills;
- `--player`, `--rival`.

**Elevation:** `--shadow-1` for cards and `--shadow-2` for popovers and modals.

### 5.2 Components (`src/ui/kit.ts`, one module, pure DOM via `h`)

| Component | Use |
|---|---|
| `button(label, { variant: 'primary' \| 'secondary' \| 'quiet' \| 'danger', icon?, shortcut? })` | One primary per view at most |
| `panelHeader({ title, summary, status? })` | Every side-panel tab: the title plus one line saying what matters ("Losing $12k a month: vehicles are your biggest cost") |
| `statTile({ label, value, delta?, tone? })` and `statRow(tiles)` | KPIs at the top of panels |
| `pill(text, tone)` | Status: ok, warning, negative, info, neutral |
| `meter(value, max, tone)` | Stock, staffing and opinion bars |
| `dataTable({ columns, rows, emptyText })` | Every table: numbers right-aligned and tabular. *(As built: no zebra rows; rows are divided by a hairline. The header is made sticky only where a panel scrolls a long table, such as the codex list.)* |
| `emptyState({ icon, title, body, action? })` | Replaces bare "No managers hired" and "No history yet" |
| `card({ title?, children, actions? })` | Grouped content inside a panel |
| `section(title, children, { collapsible?, open? })` | Replaces the `p-section` and `p-head` pairs |
| `tooltip(el, content)` | One styled tooltip in place of native `title` popups for rich content; plain titles stay for accessibility |

Existing class names that tests and the tutorial depend on (`.window*`, `.hud-panel-btn`,
`.tb-tab`, `.tool-card`, `.btn`) stay as aliases on the new elements.

### 5.3 Screens (reworked in this order)

1. **Top bar:**
   - **Left:** the crest, then the company name in display type with the era as a muted
     subtitle.
   - **Centre:** the money in display type at `--fs-lg`, with a delta pill for this month's
     profit so far ("▲ $4,077" or "▼ $12k"). After it, the date, the weather and a
     segmented speed control (pause, 1×, 2×, 4×, 8×) with clear selected states.
   - **Right:** grouped menus, then the alerts button (bell and count, see R3), then settings.
   - Icon-only buttons get a styled tooltip that shows their shortcut.
2. **Side panel frame:** a header from `panelHeader`, a scrolling body and a sticky footer for
   actions. Tabs stay, restyled as quiet chips.
3. **Finance:**
   - a KPI row: cash, profit this month with a trend, net worth, and the loan with its rate;
   - a "Where the money goes" bar of this year's costs by category;
   - the cash chart;
   - a collapsible income statement showing only categories with any value;
   - the loans card, using secondary buttons.
4. **Routes:**
   - **Line cards:** each has a color bar, then "A → B" with good icons, then a status pill
     (Flowing, Starved or Backed up, derived from the end buildings' status), then the vehicles
     and the monthly rate.
   - **Empty state:** a "How routes work" line with a primary "New route" action.
5. **Managers:** candidate cards with their three skills as labelled meters (spelled out in
   full, with a tooltip explaining each), the salary, and a secondary Hire button. Hired staff
   show their post.
6. **Building inspector:**
   - The production card shows inputs, then the recipe arrow, then outputs, with stock meters
     and a status pill that reads like an instruction ("Starved of lumber: connect a route from
     a sawmill").
   - Upgrade and level controls sit in a card.
   - Demolish is a danger button.
7. **City, vehicle, fleet, politics, rival, exchange, family, contracts, goals and legacy
   panels:** these get the kit (header, tiles, tables, empty states). Each panel's content
   stays the same.
8. **Build bar:**
   - **Tool cards:** each shows the icon, the name, the cost and its inputs and outputs as
     small good icons.
   - **Locked tools:** a tool for a later era shows a lock and its unlock year.
   - **Category tabs:** restyled.
9. **Event card modal:** a paper card with a clear title, the body, and choices as full-width
   buttons, each showing its effects as pills.
10. **Main menu and settings:**
    - **Main menu:** the title lockup in display type, a readable subtitle and primary and
      secondary buttons. Continue is a secondary button when a save exists, and hidden
      otherwise.
    - **Settings:** grouped into cards.
11. **Toasts:** restyled with a role color edge and an icon.

### 5.4 Gates
- **CSS lint test:** UI CSS has no raw `font-size` outside the tokens, and no hex colors outside
  `theme.css` (with an allow-list for sprite and canvas code).
- **Screenshots:** `scripts/shots.sh` takes a shot of each reworked screen at 1366 and 1920.
  Every shot is read before merge.
- **Accessibility:** WCAG AA contrast for text tokens on their surfaces. A unit test computes the
  ratios from the token values.

## 6. R3: Clarity layer

- **Alerts (`src/game/alerts.ts`).** A pure function `collectAlerts(state)` returns
  `{ id, tone, icon, title, detail, target }[]`, for these cases:
  - player buildings that are `no_input`, `output_full`, `halted` (strike) or `idle` for more
    than 7 days;
  - vehicles idle for more than 14 days;
  - a month that closed at a loss;
  - an event card waiting;
  - a Baron strike this month;
  - an expiring contract.

  It is game-layer code, read-only, with no rng. The top bar's bell shows the count and the
  worst tone. A dropdown tray lists the alerts, and clicking one centres the camera on its
  target and opens its inspector. *(As built: the bell's shortcut is `T`. A stateful
  `AlertTracker.collect(state)` replaces `collectAlerts`, so it can date each condition's first sighting.)*
- **Map status badges.** A small icon over each player building whose status isn't `ok`
  (Factorio style). The renderer draws them in the overlay pass, using the icon atlas. They
  hide in photo mode and at survey zoom below 0.9.
- **Production codex (`PANELS.codex`, shortcut `I`).** *(As built: `I`, not the earlier `K`.)*
  - **Contents:** every unlocked good with its icon, kind, base price and current town
    demand, the building that makes it and its recipe.
  - **Navigation:** the recipe tree upstream is clickable. "Used in" lists the downstream
    goods.
  - **Filters:** kind and "I make this". *(As built: the era filter was dropped; goods from a later
    era show their unlock year in the detail instead.)*
  - **Tooltips:** the good icons in the build bar and the inspectors open a tooltip with the
    codex's short form (Anno style).

## 7. R4: Product expansion (finalises the Phase 4c brief)

**Answers to the brief's open questions** *(decided)*:

| Question | Answer |
|---|---|
| The tier's name | **components** |
| An import market | **Later (shipped):** live Commodity Market panel — bid/ask on materials and components into a Warehouse or Trading House; auto-sell at the house still runs daily. |
| Stronger fading | **Yes, gently.** Phonographs fade in 1955 and calculators in 1995. |
| How many goods | **About 34** (below) |
| Quality tiers | **Later** |

**New goods:**

| Kind | Goods (era) |
|---|---|
| raw | copper ore (1900, mine deposit), cattle (1900, ranch), sugar beet (1900, farm), clay (1900, clay pit), rubber (1910, plantation), bauxite (1920, mine deposit) |
| material | copper (1900), leather (1900), sugar (1900), bricks (1900), paper (1900), chemicals (1920), aluminium (1925), silicon (1965) |
| component | wire (1900), tyres (1910), engines (1910), electric motors (1920), vacuum tubes (1920), microchips (1972), displays (1975) |
| consumer | shoes, candy, books, canned food (1900); bicycles, phonographs (1905–1910); motorcycles (1915); refrigerators (1930); washing machines (1935); cosmetics (1950); calculators (1970); video games (1978); mobile phones (1990) |

**New buildings (about 16):**
- **Raw:** ranch, clay pit, rubber plantation.
- **Materials:** smelter (copper, aluminium), tannery, sugar refinery, brickworks, paper mill,
  chemical works (chemicals, silicon, cosmetics).
- **Components:** machine shop (wire, tyres, engines, electric motors), electronics works
  (vacuum tubes, microchips, displays).
- **Consumer:** shoe factory, confectionery, print works, cannery, cycle works (bicycles,
  motorcycles), appliance plant (phonographs, refrigerators, washing machines), gadget
  assembly (calculators, video games, mobile phones).
- **Trading:** the Trading House, which sells materials and components at a drifting
  national price.

The existing recipes are unchanged, to keep the balance and the saves stable.

`GoodDef.kind` takes over from `tier === 2` at every call site (39 of them). The R4 plan
details this together with the mapgen deposits (copper and bauxite), the class demand table,
icon painters, AI chain adoption and the chain-report balance gate.

## 8. R5: Release polish

- **Tutorial:** the First Season tutorial is updated for the new UI, using the alerts tray and
  the codex.
- **Landing:** an `og:` image and description, the favicon, and an "About" screen with
  credits.
- **Performance:** a perf check of the Pages build, with the bundle-size budget recorded.
- **README:** play online, controls, self-hosting with JEV.

## 9. Global constraints (all sub-projects)

- **Determinism:** `src/sim` stays deterministic. The game-layer alerts are read-only.
- **Saves:** fixture saves load. A new fixture is added for R4.
- **Dependencies:**
  - no runtime JS dependencies;
  - the two font packages are build-time only and ship as woff2 assets;
  - no CDN calls at runtime, because Pages players may be offline after the first load.
- **Content:** no emoji in `src`; icons come from the atlas.
- **Commits:** they end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run
  `chown -R freire:freire /home/freire/projects/industry` after merges.
- **Branches:** each sub-project is built on a `release/r<N>` branch, merged into `main` after
  its gate.

## 10. Risks

- **Test churn from the UI rework.** Mitigated by keeping the legacy class aliases and changing
  test selectors only when a task says so.
- **Too many goods for players to read.** Mitigated by R3 shipping before R4, and by grouping
  recipes into multi-recipe buildings.
- **Font weight on Pages.** Two families of two weights each, latin subset only: about 200 KB.
- **No owner playtest between phases** (owner chose non-stop). Mitigated by screenshot gates and
  the soak at every phase end, and by a summary to the owner at each gate.
