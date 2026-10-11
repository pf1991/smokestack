# SMOKESTACK

A 2D industry tycoon for the browser, inspired by *Industry Giant*. It is 1900. You have $300,000, a map of forests and ore-rich hills, and five small towns that want furniture, bread and, soon, automobiles. Extract raw materials, refine them in factory chains, haul goods by truck and train, and sell finished goods in city stores across a century of invention (1900–2000) while a scheming rival, **Baron Cornelius Smogsworth** (top hat, monocle, no scruples), competes for the same markets.

Prices fall when you flood a market and rise when a town is starved. Towns grow when they are well supplied and shrink when they choke on your smog.

## Features

- **Era colour grading:** the world renders in sepia in 1900 and gains saturation decade by decade until it is near-technicolor by the mid-1960s.
- **Living world:** day/night cycle with lit windows and street lamps, seasons (snowy winters; farms fallow in winter and bumper in summer), and chimney smoke that follows real production.
- **Houses evolve by era:** wooden cottages, brick rowhouses, art-deco blocks, then modern towers.
- **The Daily Smokestack:** a monthly newspaper plus a scrolling headline ticker covering historic events (the 1914 war boom, the 1929 crash, the 1969 moon landing toy craze, the 1973 oil crisis) and random ones (strikes, fires, festivals, gold rushes, visiting inventors).
- **Rival AI:** Baron Smogsworth builds his own chains, undercuts your markets and taunts you in print. Reach 3× his net worth to launch a **Hostile Takeover**.
- **Mayor's Contracts:** time-limited delivery contracts paid in cash and population growth.
- **Product lifecycle:** inventions arrive by year (automobiles and oil 1910, radios 1925, plastic 1935, television 1950, computers 1980); radios fade after 1965 and the newspaper warns you first.
- **Fleet and routes:** trucks on routes, trains on rail, a Fleet window to manage vehicles, and route editing that is easier to build and change.
- **Finance:** loans in $50,000 steps, monthly charges, and charts of the ledger.
- **Main menu, scenarios, achievements and save slots:** New Game, Load Game (Autosave plus three manual slots), Achievements and Settings. Progress is saved in the browser's local storage.
- **Procedural everything:** no image or audio files. Sprites are painted on canvas and sound (cash-register "ka-ching", steam whistles, factory hum) is synthesized with WebAudio.

## Scenarios

| Scenario | Goal |
|---|---|
| Free Play | No deadlines. Build an empire from 1900 to the end of the century. |
| Lumber Baron | Reach $1,000,000 by 1920. |
| Motor City | Sell 500 automobiles by 1940. |
| Beat the Baron | Launch a Hostile Takeover by 1950. |
| Boomtown | Grow the population to 50,000 by 1960. |

## Controls

| Input | Action |
|---|---|
| Left click | Use the current tool (build, road, select, bulldoze) |
| Right or middle drag | Pan the map |
| Mouse wheel | Zoom at the cursor |
| W A S D / arrow keys | Pan the map |
| Space | Pause / resume |
| 1, 2, 3, 4 | Speed 1×, 2×, 4×, 8× |
| B | Show or hide the toolbar |
| R | Routes window |
| F | Finance window |
| N | The Daily Smokestack (newspaper) |
| V | Fleet window |
| Delete | Bulldoze tool (refunds 25% of the building's cost) |
| Esc | Cancel the tool or close the open window |

## Run it

### Development

Requires Node 18.19 or newer.

```bash
npm install
npm run dev
```

Then open the URL that Vite prints (usually http://localhost:5173).

Development URL parameters skip the main menu and start a game directly:

- `seed=<n>` map seed
- `scenario=<id>` start a scenario (`sandbox`, `lumber_baron`, `motor_city`, `beat_the_baron`, `boomtown`)
- `autoplay=1` script a furniture chain by the biggest city and fast-forward 20 days at speed 8
- `hour=<0-23>` advance the clock to that hour on load
- `speed=<0|1|2|4|8>` starting speed
- `panel=<id>` open a panel on load (e.g. `routes`, `finance`, `newspaper`, `fleet`, `rival`)
- `tutorial=1` show the tutorial card
- `menu=1` force the main menu even when other parameters are present

### Tests and build

```bash
npm test              # Vitest suite (sim, data, render, UI, save/load)
npm run typecheck     # tsc --noEmit
npm run build         # typecheck + production bundle in dist/
```

### Docker

```bash
docker compose up -d --build
```

Then open http://localhost:8080. The image is built in two stages: `node:18-alpine` runs `npm ci && npm run build`, and `nginx:1.27-alpine` serves `dist/` with gzip for text assets, a one-year immutable cache for `/assets/`, `no-cache` for `index.html`, and an SPA fallback. Stop it with `docker compose down`.

## Architecture

Everything in `src/` is one of seven layers. The simulation is pure and deterministic; the renderer and UI only read it, and issue commands through sim functions.

- **`src/core`**: shared primitives: `Result<T>` for fallible operations and the `EventBus` with the `GameEvent` union.
- **`src/sim`**: the deterministic, tick-based simulation (1 tick = 1 game hour). It owns one JSON-serializable `GameState` (`types.ts`) and never touches `window`, `document`, `Math.random`, `Date.now` or `performance`. Randomness goes through `rng.ts` on `state.rngState`. It covers the clock, map generation, placement, roads, pathfinding, production, the market (demand, prices, growth), finance and loans, vehicles and routes, rail, the rival AI, pollution, eras, events and news, contracts, scenarios, and serialization (`simulation.ts`). Systems are registered append-only in `systems.ts`.
- **`src/data`**: static content: goods, recipes, buildings and the name lists used for companies and towns.
- **`src/render`**: the Canvas 2D renderer. It paints terrain, sprites, atmosphere (day/night, seasons, smoke, era grading), particles and overlays (`overlays.ts` registry). It never mutates state.
- **`src/ui`**: vanilla-TypeScript DOM UI: the HUD, toolbar, ticker, toasts, the main menu and tutorial, and the panels (`src/ui/panels`, registered in `panels/index.ts`) for buildings, cities, vehicles, routes, the fleet, finance, the newspaper, the rival and contracts.
- **`src/game`**: wiring: the app and game loop, the controller and tools, keyboard and mouse input, autoplay, save slots and autosave, achievements, settings and sound feedback.
- **`src/audio`**: WebAudio synthesis of the sound effects (`sfx.ts`).

Tests sit beside the code as `*.test.ts`. DOM tests use the jsdom environment. The `balance` tests run long headless simulations to check the economy.
