# SMOKESTACK II Interface Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the map the screen back and make the menus easy to use. Left-drag pans the map. One tabbed side panel replaces the floating windows. A one-row top bar, a slimmer build bar, visible shortcuts, an optional news ticker and a UI scale setting.

**Architecture:**
- `createWindow` keeps its exported API (`WindowOptions`, `GameWindow`, `closeAllWindows`), so the ~15 panels in `src/ui/panels/` and the Phase 4 panels being built in parallel need no changes. Behind that API, windows become tabs of one side panel (`src/ui/sidePanel.ts`).
- One shortcut registry (`src/ui/shortcuts.ts`) feeds `src/game/input.ts`, every button tooltip and the help overlay, so keys and labels cannot drift apart.
- Interface size follows one CSS variable, `--ui-scale`, on `#ui` and the side panel, set from settings.

**Tech Stack:** TypeScript 5.6 strict, DOM + CSS, Canvas 2D, Vitest + jsdom.

**Spec:** this plan is its own spec. It comes from the owner's playtest feedback on 2026-10-17: "game menus are not very user friendly. they need lots of space. multiple windows are open. drag the map does not work very well. Lots of improvement needed." The owner chose:
- one side panel with tabs;
- left-drag pans in Inspect;
- a compact top bar;
- keyboard shortcuts shown;
- the news ticker hidden or shrunk;
- a UI scale setting;
- "UI in terms of menus needs a really good upgrade".

The parent spec's interface section is `docs/superpowers/specs/2026-10-11-smokestack-v2-design.md` §4.4.

## Global Constraints

- No runtime dependencies or asset files. Icons come from the atlas (`src/ui/icon.ts` `iconEl`). No emoji in `src`.
- `src/sim` is untouched by this plan.
- Must work at 1366×768 (the target laptop) and 1920×1080. At 1366×768, with one panel open, at least 60% of the screen width shows the map.
- Keep the brass-and-sepia look (`src/ui/theme.css` tokens). Reuse its color and font variables; add none that duplicate them.
- `PANELS` registry ids and `openPanel(id, arg)` behavior are unchanged. The tutorial (`src/ui/tutorial.ts`) highlights `.hud-panel-btn[data-panel="routes"]`, so keep that class and attribute on the top bar's Routes button or update the tutorial selector in the same task.
- Settings persist through `src/game/settings.ts` (`localStorage`, wrapped in try/catch, defaults when blocked).
- Accessibility: every icon-only button has `aria-label` and a `title` that includes its shortcut ("Finance (F)"). The side panel tabs use `role="tablist"` and `role="tab"`, and Esc closes the active tab.
- Use `docker compose`. Run `chown -R freire:freire /home/freire/projects/industry` after merges. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Phase 4 is being built in parallel on `v2/phase4`. It adds `PANELS.family` and `PANELS.exchange` and edits `src/ui/panels/rival.ts` content. This plan must not edit panel content files beyond CSS classes, except where a task says so.

## Review Focus

1. **A click is still a click.** In Inspect, a left press that moves less than 6 px before release must inspect exactly as before. A press that moves more must pan and never inspect. The same holds for touchpads and pen input (pointer events). Pinned in Task 1.
2. **Build tools keep their drags.** Road, rail, tree and bulldoze drags still work with the left button. Right and middle drag pan in every mode. Photo mode still pans with the left button. Pinned in Task 1.
3. **Panels never cover the whole map or lose content.** At 1366×768 the panel is at most 40% of the width. Content scrolls inside the panel. Resizing below 320 px or above 60% of the viewport is clamped, and the width survives a reload. Pinned in Task 2.
4. **Old tests and tutorial selectors keep working.** `.window`, `.window-title`, `.window-body` and `.window-close` still exist on the active tab's element, so the existing panel tests pass unchanged. Pinned in Task 2.
5. **Scale never breaks hit-testing.** At 80% and 130% scale, map clicks land on the tile under the cursor: the canvas is not scaled, only `#ui` and the side panel. Pinned in Task 6.

---

### Task 1: Map input: left-drag pans in Inspect, smoother zoom

**Files:**
- Modify: `src/game/input.ts`, `src/render/camera.ts` (zoom animation)
- Test: `src/game/input.test.ts`, `src/render/camera.test.ts`

**Interfaces:**
- **Inspect gesture.** When `host.activeToolKind === 'inspect'`, a left press starts a pending gesture instead of calling `tools.pointerDown`.
  - If the pointer moves ≥ `DRAG_THRESHOLD_PX = 6` (Manhattan, in screen px) before release, the gesture becomes a pan. It acts exactly like the right-button pan, including `onManualPan` and the canvas cursor `grabbing`.
  - Otherwise, on release, call `tools.pointerDown(tile, world)` then `tools.pointerUp(tile)` at the press position.
  - While hovering in Inspect, the canvas cursor is `grab`.
- **Other tools:** the left button goes to the tool as today.
- **Right click:** a right press without movement still cancels pick mode.
- **Wheel zoom:**
  - The wheel sets a zoom target. `stepZoom(cam, dtMs)` eases the zoom toward it each frame (time constant 80 ms), keeping the world point under the cursor fixed.
  - `ctrlKey` wheel events (trackpad pinch) zoom by `exp(-deltaY × 0.01)`.
  - Both clamp to the existing zoom bounds.
- **Inertia:** none. Release stops the pan.

- [ ] **Step 1: Write the failing tests** in `src/game/input.test.ts`, with a fake host recording tool calls:
  - In Inspect, down, move 3 px, up → exactly one `pointerDown` and one `pointerUp` at the press tile, and the camera unchanged.
  - In Inspect, down, move 40 px, up → no tool calls, and the camera moved by 40/zoom world units.
  - With the road tool, a left drag calls `pointerDown`, `pointerMove` and `pointerUp` as before.
  - A right drag pans with the road tool active.
  - A right click with no movement cancels pick mode.
  - In photo mode a left drag pans.
  - In `camera.test.ts`: after a wheel tick and 500 ms of `stepZoom` the zoom equals the target within 1e-3, and the world point under the cursor moves by less than 0.01 tile.
- [ ] **Step 2:** Run `npx vitest run src/game/input.test.ts src/render/camera.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Call `stepZoom` from the frame loop where `input.update(dt)` is called today (`src/game/controller.ts`).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(input): left-drag pans in inspect; eased zoom and pinch`.

### Task 2: One side panel with tabs

**Files:**
- Create: `src/ui/sidePanel.ts`, `src/ui/sidePanel.css`
- Modify:
  - `src/ui/window.ts`: `createWindow` delegates to the side panel; the floating slots, `MAX_FLOATING`, `placeWindow` and the dock go;
  - `src/ui/dock.ts`: delete it, along with its imports;
  - `src/ui/window.test.ts`: rewritten for the new behavior;
  - `src/game/settings.ts`: `panelWidth`.
- Test: `src/ui/sidePanel.test.ts`, `src/ui/window.test.ts`

**Interfaces:**
- **Layout.** The side panel is a fixed element on the right edge. It runs from the top bar's bottom to the build bar's top (measured as `measure()` does today).
- **Width:**
  - default `min(420, 34vw)`;
  - resizable by dragging a 6 px grip on its left edge, clamped to `[320, 0.6 × innerWidth]`;
  - persisted as `settings.panelWidth` (number or null; null means default).
- **Tab strip.** The top of the panel holds one tab per open window, in open order. Each tab has a title and a close button (`iconEl('close', 12)`).
  - At most `MAX_TABS = 6` tabs: opening a seventh closes the least recently focused one.
  - Clicking a tab shows it.
  - Opening an id that is already open focuses its tab (today's "raise").
- **Window contract.** Each window keeps its `.window` element, with `.window-title` (the title text plus close button) and `.window-body`. Only the active one is displayed; the others have `display: none`, keep their content and keep receiving `setContent`.
- **`GameWindow` methods:**
  - `close()` removes the tab and its element. The next most recent tab becomes active. The panel hides when none are left.
  - `dock()` collapses the whole panel to its rail.
  - `undock()` focuses this tab and expands the panel.
  - `docked` is true when this window is not the visible active tab.
- **Collapse.** A collapse button (`iconEl('chevron-right')`, or the nearest atlas icon) shrinks the panel to a 28 px rail showing the tab count. Clicking the rail expands it.
- **Keys:** Esc closes the active tab when no tool is active. Today's `closeDrawer` path calls `closeActiveTab()`, exported from `sidePanel.ts`.
- `closeAllWindows()` is unchanged.
- **z-index:** the panel sits at `Z_BASE` 100, below the card modal and menus.

- [ ] **Step 1: Write the failing tests:**
  - Opening finance then politics shows politics active and finance hidden, with 2 tabs.
  - Opening finance again focuses it and keeps 2 tabs.
  - Seven opens leave 6 tabs and close the oldest.
  - Closing the active tab activates the most recent remaining one.
  - Closing the last tab hides the panel.
  - The width clamps to 320 and to 60% of the viewport, and persists through settings.
  - Collapse, then the rail click, expands it.
  - Esc closes the active tab.
  - `.window-title`, `.window-body` and `.window-close` work on the active window: the existing `dom.test.ts`, `fleet.test.ts` and `routes.test.ts` pass unchanged.
- [ ] **Step 2:** Run `npx vitest run src/ui`. Expected: the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Run `bash scripts/shots.sh`, plus shots with `&panel=finance` and `&panel=politics` at 1366×768 and 1920×1080. Read them: the map must show ≥ 60% of the width at 1366.
- [ ] **Step 5: Commit** with `feat(ui): one tabbed side panel replaces floating windows`.

### Task 3: Shortcut registry and help overlay

**Files:**
- Create: `src/ui/shortcuts.ts`, `src/ui/help.ts`, `src/ui/help.css`
- Modify: `src/game/input.ts` (reads the registry instead of `SPEED_KEYS` and `PANEL_KEYS`)
- Test: `src/ui/shortcuts.test.ts`

**Interfaces:**
- `export interface Shortcut { key: string; label: string; group: 'Time' | 'Panels' | 'Map' | 'Tools' }`.
- `SHORTCUTS: readonly (Shortcut & { action: ShortcutAction })[]`, where `ShortcutAction` is one of:
  - `{ kind: 'speed'; speed: Speed }`;
  - `{ kind: 'panel'; id: string }`;
  - `{ kind: 'pause' }`;
  - `{ kind: 'toolbar' }`;
  - `{ kind: 'bulldoze' }`;
  - `{ kind: 'photo' }`;
  - `{ kind: 'help' }`;
  - `{ kind: 'overlay'; id: 'pollution' | 'factions' }`.
- Keys:
  - Time: Space pause; 1, 2, 3 and 4 for the speeds.
  - Panels: R routes, V fleet, F finance, N newspaper, C contracts, B toolbar, G goals, O politics, X rival.
  - Map: M smog, K factions, P photo.
  - Tools: Delete bulldoze, Esc cancel or close.
  - Help: `?` and H.
  - When Phase 4 merges, it adds Family Y and Exchange E here.
- `shortcutFor(kind, id?): string | null` and `withShortcut(label, kind, id?)` return `"Finance (F)"`. Every HUD and toolbar button title uses them.
- **Help overlay.** `?` or H opens a modal at z 4500 listing the shortcuts by group, plus the mouse controls: left-drag pan in Inspect, right or middle drag pan, wheel or pinch zoom. Esc or a click outside closes it.
- A test asserts that no two shortcuts share a key.

- [ ] **Step 1: Write the failing tests:**
  - Keys are unique.
  - `withShortcut('Finance', 'panel', 'finance') === 'Finance (F)'`.
  - Pressing G opens goals through the host.
  - Pressing ? opens the help overlay, and Esc closes it.
  - Shortcuts never fire while typing in an input.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5: Commit** with `feat(ui): shortcut registry, tooltips and help overlay`.

### Task 4: Compact one-row top bar

**Files:**
- Modify: `src/ui/hud.ts`, `src/ui/hud.css`, `src/ui/tutorial.ts` (selector, only if needed)
- Test: `src/ui/hud.test.ts`

**Interfaces:**
- **One row**, height 48 px at scale 1, laid out left to right:
  - company name with the era under it (two small lines);
  - treasury (the rolling counter);
  - date, then the weather vane;
  - speed buttons;
  - spacer;
  - menu groups;
  - overlay toggles;
  - a "More" button.
- **Menu groups.** Each group is a button that opens a small dropdown menu (`role="menu"`, closed by Esc, a click outside, or choosing an item). Single-panel actions are direct buttons:
  - **Company:** Finance, Goals.
  - **Operations:** Routes (a direct button, keeping `.hud-panel-btn[data-panel="routes"]`), Fleet, Contracts.
  - **World:** Newspaper, Politics, Rival.
  - **Map layers:** toggle buttons for Smog and Factions, with the faction-mode select inside the Factions dropdown.
  - **More:** Photo mode, Help, Settings (opens the existing settings menu, if the in-game menu exposes one), and Save/Load (if the menu exposes it today).
- Every button has an atlas icon. A label shows when the viewport is ≥ 1600 px wide; below that the button is icon-only, with `title` and `aria-label` from `withShortcut`.
- `data-panel` stays on each direct panel button and dropdown item.
- Phase 4 will add Family and Exchange to the Company group. Keep the group lists data-driven: `const GROUPS: { id; label; icon; items: { panel: string; label: string; icon: string }[] }[]`.
- **Newspaper unread badge.** A count of news items since the newspaper was last opened, shown on the World group and on the Newspaper item.

- [ ] **Step 1: Write the failing tests:**
  - The bar renders one `.hud-bar` row containing the treasury, the date, the speeds and the groups.
  - Clicking Company, then Finance, calls `onOpenPanel('finance')` and closes the dropdown.
  - Esc closes an open dropdown.
  - Routes is a direct button with `data-panel="routes"`.
  - Titles include shortcuts.
  - The unread badge counts news since the last newspaper open, and resets on open.
  - Overlay toggles still flip `setOverlay`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Check that the tutorial still highlights Routes: its test passes.
- [ ] **Step 4:** Run `npm test` and the shots at 1366 and 1920. Read them.
- [ ] **Step 5: Commit** with `feat(ui): one-row top bar with grouped menus`.

### Task 5: Slim build bar and news ticker setting

**Files:**
- Modify:
  - `src/ui/toolbar.ts`, `src/ui/hud.css` (toolbar rules);
  - `src/ui/ticker.ts`;
  - `src/game/settings.ts`;
  - `src/ui/menu.ts` (settings screen: ticker and, in Task 6, scale).
- Test: `src/ui/toolbar.test.ts`, `src/ui/ticker.test.ts` (create)

**Interfaces:**
- **Build bar:**
  - A single 40 px row of category buttons, each with an icon, a label and a shortcut hint, plus Inspect.
  - Clicking a category opens its cards as a flyout panel above the bar: one row of cards with horizontal scroll, max height 132 px. Clicking the same category again, Esc or picking a tool closes it.
  - Cards shrink to 112 px wide, keeping icon, name, price and the in→out flow.
  - The bar is centered and only as wide as its content (no full-width strip).
  - B still toggles it.
- **Ticker.** `settings.ticker: 'scroll' | 'headline' | 'off'`, default `'headline'`:
  - `'scroll'` is today's behavior;
  - `'headline'` shows only the latest headline, static, in a 22 px strip, and clicking it opens the newspaper;
  - `'off'` removes the strip, leaving the top bar badge from Task 4.

  The setting is in the settings menu and applies live.

- [ ] **Step 1: Write the failing tests:**
  - A category click opens its flyout, and a second click closes it.
  - Picking a card selects its tool and closes the flyout.
  - Esc closes the flyout.
  - Ticker `'headline'` shows the latest headline, and clicking it opens the newspaper.
  - `'off'` hides the strip.
  - The setting round-trips through `loadSettings` and `saveSettings`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the shots. Read them.
- [ ] **Step 5: Commit** with `feat(ui): slim build bar with flyouts; ticker modes`.

### Task 6: UI scale setting

**Files:**
- Modify: `src/game/settings.ts`, `src/ui/theme.css`, `src/ui/menu.ts`, `src/game/app.ts` (apply on start and on change)
- Test: `src/game/settings.test.ts` (create or extend), `src/ui/scale.test.ts`

**Interfaces:**
- `settings.uiScale: 'auto' | 0.8 | 0.9 | 1 | 1.15 | 1.3`, default `'auto'`. Auto is 0.9 below 1440 px viewport width, 1 up to 2200 px, and 1.15 above.
- `applyUiScale(scale: number)` sets `--ui-scale` on `document.documentElement`. `#ui`, the side panel, the build bar, modals and the help overlay use `zoom: var(--ui-scale)`. Measure layout positions (`measure()` in the side panel) with `getBoundingClientRect`, which already returns post-zoom pixels.
- The map canvas is never scaled.
- Auto mode re-applies on window resize.

- [ ] **Step 1: Write the failing tests:**
  - `'auto'` resolves to 0.9 at 1366 and 1 at 1920.
  - The setting round-trips.
  - `applyUiScale` sets the variable.
  - The canvas element has no zoom style.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Take shots at scale 0.8 and 1.3 at 1366×768 by adding a dev URL param `uiscale=`, read them, and check that map clicks still pick the right tile. That is pinned by `input.test.ts` using canvas-relative coordinates.
- [ ] **Step 5: Commit** with `feat(ui): interface scale setting`.

### Task 7: Panel content density pass

**Files:**
- Modify:
  - `src/ui/panels/panels.css` and the panel CSS files (`finance.css`, `politics.css`, `routes.css`, `fleet.css`, `newspaper.css`);
  - `src/ui/theme.css`.

  CSS only, plus class names added in panel files where a shared class replaces inline styles.
- Test: existing panel tests stay green; add `src/ui/panels/density.test.ts` (computed class presence only).

**Interfaces:**
- Shared panel classes in `panels.css`:
  - `.p-section` with a 12 px uppercase header and 8 px spacing;
  - `.p-row`, a 24 px key–value row;
  - `.p-table`, with sticky headers inside the panel scroll;
  - `.p-actions`, a sticky footer row for a panel's primary buttons;
  - `.p-chips` for segmented controls (edicts).
- Body text 13 px, headings 14 px, at scale 1.
- Each panel's sections use these classes. Values, labels and logic stay unchanged. Phase 4 edits `rival.ts` content: in `rival.ts`, only add classes to existing elements.

- [ ] **Step 1:** Take before-shots of every panel at 1366×768: finance, politics, routes, fleet, contracts, newspaper, rival, goals, city, building and vehicle, using `panel=`, `inspect`, `openroute` and the existing dev params.
- [ ] **Step 2:** Write `density.test.ts`: each panel's root has `.p-section` children, and no panel sets inline `font-size`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Take after-shots and compare them pairwise. Each panel must show more of its content above the fold, with nothing clipped. Put the before and after shot paths in the report.
- [ ] **Step 5: Commit** with `style(ui): denser, consistent panel layout`.

### Task 8: Gate

**Files:**
- Modify: `scripts/shots.sh`, which adds `panel=finance` shots at 1366 and 1920; `README.md`, which gets a "Controls" section (left-drag, right-drag, wheel, shortcuts, `?` help).

- [ ] **Step 1:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 2:** Run `bash scripts/shots.sh`. Read every shot at 1366 and 1920: one panel open, a dropdown open, the help overlay, the build flyout, and the ticker modes.
- [ ] **Step 3:** Run `docker compose build`. The `up` waits for the merge.
- [ ] **Step 4: Commit** with `test: ui overhaul gate`.
