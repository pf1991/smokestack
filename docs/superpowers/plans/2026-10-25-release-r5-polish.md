# SMOKESTACK 1.0 R5: Release Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship the last 1.0 slice: First Season teaches the alerts tray and the production
codex; the static landing has meta tags, a favicon and an About screen; a bundle-size budget
gates the Pages build; the README leads with Play Online, controls and self-host + JEV.

**Architecture:**
- Tutorial steps stay predicate-driven; the two new UI steps are **manual** (Next), so they cannot
  brick the furniture first-sale flow. Highlights use existing HUD selectors.
- Landing assets live in `public/` (Vite copies them into `dist/`). About is a main-menu screen
  on the Brass & Ledger kit, same pattern as Achievements / Settings.
- Bundle budget is a small Node script that gzips the built entry JS/CSS and fails over a hard
  ceiling; `check-dist` runs it after the path scan so CI stays one command.

**Tech Stack:** TypeScript 5.6 strict, Vite 5, Vitest + jsdom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-smokestack-1.0-release-design.md` (§8 R5, §9 global
constraints).

## Global Constraints

- **Branch:** `release/r5`, cut from `main` after R4 (`2fc5210`). Node 24:
  `export PATH=$HOME/.nvm/versions/node/v24.11.0/bin:$PATH`. Prefer `vitest --pool=forks`.
- **Determinism:** no `src/sim` changes required. Tutorial predicates stay pure over `GameState`.
- **No runtime CDN, no emoji in `src`.** Icons from the atlas / kit.
- **UI:** About and any new CSS use R2 tokens and `src/ui/kit.ts` only.
- **Leave untracked** `docs/superpowers/specs/2026-10-17-product-expansion-brief.md` alone.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One commit per
  task unless a step says otherwise.

## Review Focus

1. **Tutorial progress after first sale.** A player who already sold furniture must still see the
   alerts and codex cards; `done` on those steps must stay false until Next (or never auto-fire
   from unrelated state). Pinned in Task 1.
2. **Highlight selectors.** `.alerts-bell` is only present after `mountAlerts`; the tutorial
   highlight must also match `#hud-alerts` so the Hud-only highlight test and a real game both
   glow. Codex is a World menu item: `.hud-menu-item[data-panel="codex"]` (and the World group
   button). Pinned in Task 1 highlight test.
3. **Pages subpath + meta assets.** `dist/index.html` must keep relative asset URLs; favicon and
   `og` image must exist under `dist/`. Pinned in Task 2 / Task 3 via `check-dist`.
4. **Bundle creep.** A gzip budget slightly above today's measured entry JS (~243 KB) and CSS
   (~17 KB) fails CI before Pages ships a ballooned build. Pinned in Task 3.
5. **About reachable.** Home quiet row includes About; `menuscreen=about` works in DEV for
   shots. Pinned in Task 2 menu tests.

---

### Task 1: Tutorial — alerts tray and codex

**Files:**
- Modify: `src/ui/tutorial.ts`
- Modify: `src/ui/tutorial.test.ts`

**Interfaces:**
- Consumes: existing `TutorialStep` (`manual`, `highlight`, `done`, `doneText`); Hud mounts
  `#hud-alerts` and `.hud-menu-item[data-panel="codex"]`.
- Produces: two new step ids after `first_sale`: `alerts`, `codex`. `doneText` moves to `codex`.

- [x] **Step 1: Write the failing expectations**

In `tutorial.test.ts`:
- `IDS` becomes
  `['welcome', 'lumber_camp', 'sawmill', 'furniture_factory', 'store', 'roads', 'route', 'truck', 'first_sale', 'alerts', 'codex']`.
- After a real first sale, `progress(state)` is `9` (alerts), not finished.
- Card counter text uses `/ 11`.
- Celebrate / finish copy still contains `"Ka-ching! You're in business."` (now on the last step).
- Alerts / codex steps are `manual: true`; their `done()` stays false on a post-sale state.
- Highlight test still finds matches for every step with `highlight` (including the new ones).

- [x] **Step 2: Run the tutorial tests (expect fail)**

Run: `npx vitest run --pool=forks src/ui/tutorial.test.ts`
Expected: FAIL on step count / IDS.

- [x] **Step 3: Implement the two steps in `tutorial.ts`**

After `first_sale` (keep its sale `done`; remove its `doneText`):

```ts
{
  id: 'alerts',
  text: 'When a works starves or a store runs empty, the bell in the top bar lists the trouble. Press T (or click the bell) to open the alerts tray, then click a row to jump to it.',
  highlight: '#hud-alerts, .alerts-bell',
  manual: true,
  done: () => false,
},
{
  id: 'codex',
  text: 'Press I (or World → Codex) to open the production-chain codex: every good, what makes it, what it needs, and what towns want. Browse a chain, then carry on.',
  highlight: '.hud-group-btn, .hud-menu-item[data-panel="codex"]',
  manual: true,
  done: () => false,
  doneText: "Ka-ching! You're in business.",
},
```

(Adjust highlight selectors if the World button class differs; they must match a real Hud mount.)

- [x] **Step 4: Run tutorial tests**

Run: `npx vitest run --pool=forks src/ui/tutorial.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/ui/tutorial.ts src/ui/tutorial.test.ts
git commit -m "$(cat <<'EOF'
feat(tutorial): teach alerts tray and production codex after first sale

EOF
)"
# trailer: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

### Task 2: Landing meta, favicon, About screen

**Files:**
- Modify: `index.html` (description, `og:*`, Twitter card, favicon link)
- Create: `public/favicon.svg`, `public/og.png` (1200×630 brass-on-walnut wordmark)
- Modify: `src/ui/menu.ts`, `src/ui/menu.css`, `src/ui/menu.test.ts`
- Modify: `src/main.ts` (DEV `menuscreen=about`)
- Optional: `scripts/shots.sh` showcase `about` via `menu=1&menuscreen=about`

**Interfaces:**
- Consumes: `MainMenu.show`, kit `button` / typography tokens.
- Produces: `Screen` includes `'about'`; home quiet row has About; About lists short credits
  (SMOKESTACK, Brass & Ledger UI, fonts Playfair Display + Source Sans 3, optional JEV note).

- [x] **Step 1: Failing menu test**

Assert home has a quiet About button; clicking it shows heading `About` and credit copy that
mentions fonts / Brass & Ledger; Back returns home.

- [x] **Step 2: Run `npx vitest run --pool=forks src/ui/menu.test.ts` — expect FAIL**

- [x] **Step 3: Implement About + meta**

- `index.html` head: meta description (~160 chars), `og:title`, `og:description`, `og:image`
  (`./og.png`), `og:type` website, Twitter `summary_large_image`, `link rel="icon"` →
  `./favicon.svg`.
- SVG favicon: simple stack / chimney silhouette, brass fill on dark — no emoji.
- `og.png`: generate once (ImageMagick or Node canvas); commit the binary under `public/`.
- Menu About screen + quiet-row button; extend DEV `menuscreen` allow-list.

- [x] **Step 4: Tests + build smoke**

Run: `npx vitest run --pool=forks src/ui/menu.test.ts && npm run build`
Expected: PASS; `dist/favicon.svg` and `dist/og.png` exist; `dist/index.html` contains `og:image`
and relative favicon href (no `href="/`).

- [x] **Step 5: Commit**

```bash
git add index.html public/favicon.svg public/og.png src/ui/menu.ts src/ui/menu.css src/ui/menu.test.ts src/main.ts scripts/shots.sh
git commit -m "$(cat <<'EOF'
feat(landing): Open Graph meta, favicon, and About credits screen

EOF
)"
```

---

### Task 3: Bundle-size budget

**Files:**
- Create: `scripts/check-bundle.mjs` (or fold into `scripts/check-dist.mjs`)
- Modify: `scripts/check-dist.mjs` to also require `dist/favicon.svg` + `dist/og.png` and invoke
  the budget check
- Modify: `package.json` only if a separate `check-bundle` script is useful; Pages already runs
  `check-dist`

**Budgets (gzip, hard fail):** measure after Task 2 build, then set ceilings with ~20% headroom.
Baseline pre-R5: entry JS ~243 KB gzip, CSS ~17 KB gzip. Proposed ceilings unless measurement
moves them:

| Asset | Max gzip |
|---|---|
| Entry `dist/assets/index-*.js` | 320 KiB |
| Entry `dist/assets/index-*.css` | 40 KiB |

Also print raw + gzip sizes on success for the README / gate log.

- [x] **Step 1: Implement checker; run against current `dist/`**

Run: `npm run build && node scripts/check-bundle.mjs` (or `npm run check-dist`)
Expected: PASS and print sizes; temporarily lower a ceiling to prove FAIL, then restore.

- [x] **Step 2: Wire into `check-dist` / confirm `.github/workflows/pages.yml` still calls it**

- [x] **Step 3: Commit**

```bash
git add scripts/check-bundle.mjs scripts/check-dist.mjs package.json
git commit -m "$(cat <<'EOF'
chore(ci): hard gzip budget for Pages entry JS and CSS

EOF
)"
```

---

### Task 4: README — Play Online, controls, self-host + JEV

**Files:**
- Modify: `README.md`

- [x] **Step 1: Rewrite the top of the README**

Order:
1. One-paragraph pitch.
2. **Play online** — Pages deploys from `main` via `.github/workflows/pages.yml`; URL
   `https://<user>.github.io/<repo>/` after the owner publishes (placeholder until public);
   note JEV is off on Pages.
3. **Features** — keep the era/rival flavour; add a short 1.0 line: 61 goods, Components tab,
   Trading House, alerts tray, production codex, Brass & Ledger UI.
4. **Controls** — keep the table (already includes T / I).
5. **Self-host** — `npm` / Docker; **Smart events (JEV)** section stays accurate.
6. Drop or fold redundant “What's new in Phase N” walls into a shorter changelog blurb if the
   top becomes unwieldy — prefer lead with Play Online; do not delete useful controls/JEV detail.

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): lead with Play Online, 1.0 features, controls and JEV

EOF
)"
```

---

### Task 5: Gate

**Files:**
- Modify: `docs/superpowers/plans/2026-10-25-release-r5-polish.md` (checkboxes)
- Optional: `scripts/shots.sh` About + tutorial showcase if not done in Task 2

- [x] **Step 1: Full gate**

Run:
```bash
export PATH=$HOME/.nvm/versions/node/v24.11.0/bin:$PATH
npm test -- --pool=forks
npm run build
npm run check-dist
```

Expected: all PASS; check-dist prints path OK + bundle sizes under budget; favicon/og present.

- [x] **Step 2: Commit gate note**

```bash
git add docs/superpowers/plans/2026-10-25-release-r5-polish.md scripts/shots.sh
git commit -m "$(cat <<'EOF'
test: release r5 gate (tutorial, landing, bundle budget, README)

EOF
)"
```

---

## Spec coverage

| Spec §8 item | Task |
|---|---|
| Tutorial uses alerts tray and codex | 1 |
| og: image + description, favicon, About credits | 2 |
| Perf / bundle-size budget on Pages build | 3 |
| README play online, controls, self-host + JEV | 4 |
| Gate | 5 |
