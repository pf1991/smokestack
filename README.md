# SMOKESTACK

A 2D industry tycoon for the browser, inspired by *Industry Giant*. It is 1900. You have $300,000, a map of forests and ore-rich hills, and five small towns that want furniture, bread and, soon, automobiles. Extract raw materials, refine them in factory chains, haul goods by truck and train, and sell finished goods in city stores across a century of invention (1900–2000) while a scheming rival, **Baron Cornelius Smogsworth** (top hat, monocle, no scruples), competes for the same markets.

Prices fall when you flood a market and rise when a town is starved. Towns grow when they are well supplied and shrink when they choke on your smog.

## Play online

The game is a static site. GitHub Actions (`.github/workflows/pages.yml`) runs `npm test`, `npm run build` and `npm run check-dist` (relative asset paths plus a gzip bundle budget) on every push to `main`, then deploys `dist/` to GitHub Pages.

Once the repository is public and Pages is enabled (Settings → Pages → Source: **GitHub Actions**), play at:

```
https://pf1991.github.io/smokestack/
```

Publish from this tree with:

```
git push -u origin main
```

**Smart events (JEV) are off on Pages** — they need the self-hosted proxy below. The game plays fully without them.

## Features (1.0)

- **61 goods** across raw, materials, **components** and consumer tiers, with a **Components** build-bar tab and a **Trading House** that sells surplus materials and components at a drifting national price.
- **Brass & Ledger UI:** walnut panels, brass trim, alerts tray (`T`) and a production-chain **codex** (`I`).
- **Rival AI:** Baron Smogsworth builds chains, undercuts markets and taunts you in print; take him over on the exchange with a Hostile Takeover.
- **Living century:** era colour grading, day/night and seasons, smog and smoke laws, factions and elections, dynasty and Legacy, stock exchange and the 1929 crash.
- **Logistics:** routes, truck models, warehouse hubs, managers, automatic routes and building levels.
- **Procedural sprites and sound** (no CDN at runtime). Saves live in the browser's local storage.

## Scenarios

| Scenario | Goal |
|---|---|
| Free Play | No deadlines. Build an empire from 1900 to the end of the century. |
| Lumber Baron | Reach $1,000,000 by 1920. |
| Motor City | Sell 500 automobiles by 1940. |
| Beat the Baron | Launch a Hostile Takeover by 1950. |
| Boomtown | Grow the population to 50,000 by 1960. |

## Controls

**Mouse**

- Left-drag pans the map in Inspect mode; a short click inspects what is under the cursor. In build, road and bulldoze tools a left click uses the tool.
- Right or middle drag pans the map in any mode.
- The mouse wheel or a trackpad pinch zooms at the cursor (eased).

**Keyboard** (the same list is in the in-game help)

| Key | Action |
|---|---|
| W A S D / arrows | Pan the map |
| Space | Pause or resume |
| 1, 2, 3, 4 | Normal, fast, faster, fastest speed |
| R / V / F / N / C | Routes / Fleet / Finance / Newspaper / Contracts |
| G / O / X | Goals / Politics / Rival |
| E / Y / L | Exchange / Family / Legacy |
| J | Managers |
| T | Alerts tray (works and stores that need you; click an alert to jump to it) |
| I | Production codex (every good: recipe, inputs, price and demand) |
| B | Show or hide the build bar |
| M / K | Smog map / Faction map |
| P | Photo mode |
| Del | Bulldoze |
| Esc | Cancel the tool, close the active tab or leave a mode |
| ? or H | Show the shortcut help |

**Interface**

- Panels open as tabs in one side panel; Esc closes the active tab.
- The alerts tray (`T`, or the bell) lists idle, starved and full works and empty stores; badges mark the same troubles on the map.
- The production codex (`I`) explains every good: what makes it, what it needs, and what it sells for.
- The top bar groups Company, Operations and World (including Codex). About and credits are on the main menu.
- Settings: UI scale, ticker mode, side-panel width, and Smart events (JEV).

## Self-host

### Development

Requires Node 18.19 or newer (CI and local release work use Node 24).

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

Useful query parameters:

- `seed=<n>` map seed
- `scenario=<id>` (`sandbox`, `lumber_baron`, `motor_city`, `beat_the_baron`, `boomtown`)
- `autoplay=1` script a furniture chain and fast-forward
- `tutorial=1` show the tutorial card
- `menu=1` force the main menu
- `panel=<id>` open a panel on load

### Tests and build

```bash
npm test              # Vitest suite
npm run typecheck     # tsc --noEmit
npm run build         # typecheck + production bundle in dist/
npm run check-dist    # relative paths, favicon/og, gzip budget
```

### Docker

```bash
docker compose up -d --build
```

Then open http://localhost:8080. The image builds with Node and serves `dist/` via nginx (gzip, long-cache `/assets/`, SPA fallback). Stop with `docker compose down`.

## Smart events (JEV)

Optional. Each spring, JEV (TypeSafe's decision model) is asked which eligible event card fits the moment. The game blends that preference with authored weights (no card over 60% of the odds), so dealing stays varied and deterministic for a given answer.

Enable it (Docker Compose 2.24+ for optional `env_file`):

1. Create a git-ignored `.env` at the repo root: `TYPESAFE_API_KEY=<your key>`.
2. Run `docker compose up -d --build`.
3. Check `curl localhost:8080/api/health` → `{"enabled":true}`.
4. Optional live check: `TYPESAFE_API_KEY=<your key> npm run jev-smoke`.

The key stays in the `ai-proxy` container and never reaches the browser bundle. Turn Smart events off under Settings any time. Without a key, proxy or timely answer, authored weights decide.

## Architecture

Everything in `src/` is one of seven layers. The simulation is pure and deterministic; the renderer and UI only read it, and issue commands through sim functions.

- **`src/core`**: shared primitives: `Result<T>` and the `EventBus` / `GameEvent` union.
- **`src/sim`**: deterministic tick-based simulation (1 tick = 1 game hour). Owns JSON-serializable `GameState`; no `Math.random` / wall clock. Randomness goes through `rng.ts` on `state.rngState`.
- **`src/data`**: goods, recipes, buildings, cards and name lists.
- **`src/render`**: Canvas 2D terrain, sprites, atmosphere and overlays. Never mutates state.
- **`src/ui`**: vanilla TypeScript DOM UI (HUD, toolbar, menu, tutorial, panels).
- **`src/game`**: app loop, controller, tools, saves, settings and sound wiring.
- **`src/audio`**: WebAudio synthesis (`sfx.ts`).

Tests sit beside the code as `*.test.ts`. DOM tests use jsdom. Balance tests run long headless simulations.
