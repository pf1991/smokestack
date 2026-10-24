# SMOKESTACK

A 2D industry tycoon for the browser, inspired by *Industry Giant*. It is 1900. You have $300,000, a map of forests and ore-rich hills, and five small towns that want furniture, bread and, soon, automobiles. Extract raw materials, refine them in factory chains, haul goods by truck and train, and sell finished goods in city stores across a century of invention (1900–2000) while a scheming rival, **Baron Cornelius Smogsworth** (top hat, monocle, no scruples), competes for the same markets.

Prices fall when you flood a market and rise when a town is starved. Towns grow when they are well supplied and shrink when they choke on your smog.

## Features

- **Era colour grading:** the world renders in sepia in 1900 and gains saturation decade by decade until it is near-technicolor by the mid-1960s.
- **Living world:** day/night cycle with lit windows and street lamps, seasons (snowy winters; farms fallow in winter and bumper in summer), and chimney smoke that follows real production.
- **Houses evolve by era:** wooden cottages, brick rowhouses, art-deco blocks, then modern towers.
- **The Daily Smokestack:** a monthly newspaper plus a scrolling headline ticker covering historic events (the 1914 war boom, the 1929 crash, the 1969 moon landing toy craze, the 1973 oil crisis) and random ones (strikes, fires, festivals, gold rushes, visiting inventors).
- **Rival AI:** Baron Smogsworth builds his own chains, undercuts your markets and taunts you in print. Buy 510 of his 1000 shares on the exchange for a **Hostile Takeover**: you need 1.5× his wealth to take control, and the lot that takes it costs a control premium as large again as 510 shares at its price.
- **Mayor's Contracts:** time-limited delivery contracts paid in cash and population growth.
- **Product lifecycle:** inventions arrive by year (automobiles and oil 1910, radios 1925, plastic 1935, television 1950, computers 1980); radios fade after 1965 and the newspaper warns you first.
- **Fleet and routes:** trucks on routes, trains on rail, a Fleet window to manage vehicles, and route editing that is easier to build and change.
- **Finance:** loans in $50,000 steps, monthly charges, and charts of the ledger.
- **Main menu, scenarios, achievements and save slots:** New Game, Load Game (Autosave plus three manual slots), Achievements and Settings. Progress is saved in the browser's local storage.
- **Procedural everything:** no image or audio files. Sprites are painted on canvas and sound (cash-register "ka-ching", steam whistles, factory hum) is synthesized with WebAudio.

## What's new in SMOKESTACK II (Phase 1)

- **Cold-open intro:** it plays on New Game. Skip it with Esc, a click or any key, or turn it off with the "Skip intro" setting. Games start in April 1900 and open zoomed in.
- **Photo mode:** press P or use the HUD camera button to hide the interface and frame a shot. Esc exits, and Export saves a captioned PNG.
- **Engraved survey map:** zoom out below about 1.5 and the world becomes an engraved survey map with labelled towns. Zoom back in for the diorama, with terrain walls, tilt-shift and sun shadows.
- **City growth and landmarks:** cities visibly spread over the decades, and they gain landmarks (a town hall, a church, a stadium, a library and more) as they grow.

## What's new in SMOKESTACK II (Phase 2)

- **Factions and opinion:** every city has four factions (Workers, Old Money, Reformers, the Church) plus the Baron's camp, and each holds an opinion of your company from 0 to 100. Your wages, safety record, smog, sales and deeds move it, and a faction that turns on you makes your life harder.
- **Workforce:** buildings need staff. Understaffed plants run slower, and wages, safety and the local labour market decide who turns up.
- **Company edicts and the Politics window:** set company policy on wages, safety and unions, then watch the factions react in the Politics window.
- **Philanthropy and company housing:** donate to win hearts, or build company housing to keep your workers close, grateful and in your debt.
- **Mayors and elections:** each city elects a mayor every few years. Endorse a candidate, or quietly feed the slush fund and hope nobody asks where the money went.
- **Mayor edicts:** the mayor in office can issue edicts (taxes, regulations, favours) that help or hurt your business.
- **Event cards:** dilemmas arrive as cards with choices and consequences. Leave one unanswered and it resolves itself after 60 days.
- **Faction overlay:** switch the map to the faction mood overlay to see, city by city, who loves you and who does not.
- **The newspaper front page:** the Daily Smokestack is now the political front page, with election results, endorsements and scandals.

## What's new in SMOKESTACK II (Phase 3)

- **Drifting smog, wind and rain:** your chimneys now smoke for real. Smog drifts downwind across the map, rain washes it out of the air, and a visible haze settles over polluted districts. The Smog button shows the heat map and its legend.
- **Smog tiers and the toll on the towns:** a town that breathes too much smog climbs through four tiers. Its people fall ill with Black Lung, its workers grow restless, and at the worst tiers it protests and finally revolts against you.
- **Strikes:** when workers' patience runs out they walk out. A struck building produces nothing until you settle, wait it out or break it.
- **National smoke laws and fines:** as smog worsens, the country passes smoke laws (abatement, clean air, emission caps). Once a law is in force, breaking its limits costs you fines every month.
- **Scrubbers, tall chimneys and trees:** buy scrubbers and tall chimneys for your plants, or plant trees, to cut and spread your smoke and keep the fines and the protesters away.
- **Social classes, demand and villas:** each town splits into working, middle and upper classes. Their wealth changes what they buy, and prosperous, clean towns grow villas and semis.
- **Inflation, aging, renew and replace:** prices rise across the century and your buildings age and wear. Renew an old building to restore it, or replace it with something new.

## What's new in SMOKESTACK II (Phase 4)

- **The Baron as a nemesis:** Smogsworth keeps a ledger of grudges against you (undercutting him, taking his towns and contracts, a fortune that rivals his). Once they weigh enough he strikes back with smear campaigns, sabotage, poached workers, money for your opponents' candidates, price wars and share raids. The Rival window shows his character traits, his grudges, his last strikes and his mood: smug, scheming, gloating or furious.
- **Smogsworth Jr.:** the old Baron dies in the 1940s. His son Reginald inherits the firm, part of the grudge ledger and a temper of his own.
- **Your dynasty:** your company is a family. The head has traits that change how they do business, marries, has children and grows old. Name an heir in the Family window. When the head dies, the heir takes the chair. If the line ends with no heir, so does the game. Prestige and generations count towards your Legacy.
- **Regional firms:** three independent companies are founded in 1905, 1920 and 1935, each in a town where nobody yet sells its goods. They build their own chains, compete for customers and close if they go broke.
- **The stock exchange:** every company is listed with 1,000 shares and a daily price that follows its fundamentals and the market mood. Buy and sell in lots of 10 in the Exchange window. Holding 510 shares of a company takes it over.
- **Hostile bids:** if the Baron gets 510 of your shares, he bids for your company. You have six months to buy back enough shares at their fair price, and a loan covers any shortfall. If he still holds a majority at the deadline, the company is his and the game is over.
- **The 1929 crash:** in October 1929 the exchange collapses and demand falls for a year and a half. Crash cards ask whether to buy back your shares, outbid the Baron at a fire sale of bankrupt works (or hire their sacked men), take a bailout or ride out a run on the bank.
- **Legacy score:** the end screen and the Legacy window total your fortune (in 1900 dollars), landmarks raised where you lead the retail trade, your reputation with the factions, and your dynasty's prestige and generations.

## What's new in SMOKESTACK II (Phase 4b)

- **Building levels:** upgrade a works through levels for more output, with a scaffold while the work is under way.
- **Truck models:** steam lorries give way to motor trucks and diesel trucks, which are faster and carry more.
- **Automatic routes:** let a route plan itself instead of fixing every leg by hand.
- **Warehouse hubs:** a warehouse can run as a hub with its own trucks and a range circle, balancing stock to the works around it.
- **Managers:** hire logistics managers from a yearly market and post them to hubs. Press J for the Managers window.

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

- Panels open as tabs in one side panel; the tab bar switches between the open windows and Esc closes the active tab.
- The alerts tray (T, or the bell in the top bar) lists idle, starved and full works and empty stores; the same troubles show as badges over the buildings on the map.
- The production codex (I) explains every good: what makes it, what it needs, and what it sells for.
- The top bar groups the panels: Company (Finance, Goals, Exchange, Family, Legacy), Operations (Routes, Fleet, Contracts) and World (Newspaper, Politics, Rival).
- Settings include a UI scale (makes the whole interface larger or smaller), a ticker mode (scrolling, single headline or off), the side panel width (drag the panel's edge; Reset in Settings) and Smart events (JEV).

## Play online / Publish to GitHub Pages

The game is a static site, so GitHub Pages can host it. The workflow in `.github/workflows/pages.yml` runs the tests, builds, checks that `dist` has no absolute asset paths (`npm run check-dist`) and deploys on every push to `main`.

```
gh repo create <name> --public --source . --push
```

Then open Settings -> Pages and set Source to "GitHub Actions". The site appears at `https://<user>.github.io/<name>/`.

Note: Smart events (JEV) are off on Pages, because they need the self-hosted proxy (see below). The game plays normally without them.

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
- `panel=<id>` open a panel on load (e.g. `routes`, `finance`, `newspaper`, `fleet`, `rival`, `family`, `exchange`, `legacy`)
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

## Smart events (JEV)

Optional. Each spring, JEV (TypeSafe's decision model) is asked which of the eligible event cards fits the moment best. The game blends its preference with the authored card weights and never lets one card hold more than 60% of the odds, so the dealing stays varied and deterministic for a given answer.

Enable it (needs Docker Compose 2.24 or newer, for the optional `env_file`):

1. Create a `.env` file at the repo root (it is git-ignored) containing `TYPESAFE_API_KEY=<your key>`.
2. Run `docker compose up -d --build`.
3. Check `curl localhost:8080/api/health`, which should return `{"enabled":true}`.
4. Optionally run one live check: `TYPESAFE_API_KEY=<your key> npm run jev-smoke` (it prints the chosen card, the probabilities, the latency and the token usage; without a key it skips).

The key stays in the `ai-proxy` container and never reaches the browser bundle. Turn it off any time under Settings, Smart events. The game works identically without it: with no key, no proxy or no answer in time, the authored weights decide.

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
