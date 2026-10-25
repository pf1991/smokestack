# Hubs-first logistics, fishing & city life

Status: **hubs-first UX shipped** (2026-10-25). Warehouse ↔ warehouse train trunk **shipped** (2026-10-25). Fishing and city-appeal remain **proposed**.

## 1. Hubs-first local transport *(decided)*

Local goods move through **warehouse hubs** by default. Hand-drawn **routes** stay as the
power tool for long hauls, rail, contracts and overrides.

Player story:
1. Cluster works on road.
2. Drop a Warehouse in the middle → buy hub truck(s) → post a manager.
3. Open Routes only when you need a corridor between clusters or a dedicated line.

Manager logistics skill sets **how often** and **how smart** the hub plans (look-ahead,
balancing). **Range** comes from the warehouse level (the circle you see is the circle you get).

Today, logistics 4–5 can **balance** stock by hub truck only between hubs whose ranges
*overlap*. Distant clusters still need a player-drawn route.

## 2. Warehouse ↔ warehouse train link *(shipped 2026-10-25)*

Connect two warehouses with a **rail corridor** so surplus stock can move between regions when
local hubs need it — without drawing a truck route for every good.

Decisions:
1. **Station required** — trains still stop only at train stations; each station pairs with a
   warehouse hub within footprint gap ≤ 2 (`shedForStation` / `stationBesideHub`).
2. **`linkHubTrunk`** — ensures rail between the stations and creates an auto **hub trunk** train
   route (`Route.hubTrunk`); cargo loads/unloads the paired sheds, not the stations.
3. **Automatic** at logistics skill 4–5 (same balance gate as truck hub balance); scoring matches
   truck balance (keep 100, 30-day need, D2 routes win) with **rail-leg** distance.
4. Local hubs still do last-mile by truck; trunk skips **overlapping** hub pairs (trucks cover those).

Why it fits hubs-first:
- Players think in **sheds and corridors**, not dozens of good-specific truck lines.
- Complements overlapping-hub truck balance (short) with rail balance (long).
- Routes UI stays the power tool; this is the opinionated default for inter-city stock.

## 3. Fishing / water *(proposed)*

Explore water as a primary resource layer:
- Coastal / river tiles yield **fish** (raw good) via a fishing camp / pier / trawler.
- Feeds food chains (canned food, later restaurants / cold chain) and gives map shores a job.
- Needs mapgen deposits or a terrain rule, a building, recipes, and possibly boat pathing later.

Out of scope until a short design pins tile rules and whether boats are vehicles or abstract.

## 4. Workers, population & “cool” cities *(proposed)*

Factories already expect workers (`Building.staffing` from the town labour pool). Today the pool
is mostly `population × opinion × smog health`. Lean into that:

1. **Population as the main lever** — boring / smoggy / remote towns stay small → works understaffed.
2. **Player tools to make a city cool** — parks / trees (already cut smog), company housing, culture
   or amenity buildings, cleaner industry, maybe prestige goods in stores.
3. **Later factors** — wages, transit, pollution tier, rival presence, festivals.

Start by teaching the existing staffing loop (alerts + inspector), then add one amenity that
clearly grows or retains population before stacking more systems.

## 5. Taxes, factions & the business cycle

**Thin slice shipped 2026-10-25:** national **sales tax** (ledger `taxes`, rate from mayor
opinion + tax-break edicts) and a soft **boom / steady / recession** demand cycle (newspaper +
toast; clock tooltip shows phase and rate).

Everything should tug on everything else. Pieces already in the game:
- **Factions + opinion** (0–100) and **mayor edicts** (permits, tax break, truck tolls, wages…).
- **Inflation** (`economy.priceIndex`) — costs drift up; not yet a boom/bust cycle.
- **Labour** — population × workers’ opinion × smog → staffing → output.
- **Demand** — towns buy what they can afford; classes shift slowly.

### 5.1 Tighten the loop

| Pressure | Effect |
|---|---|
| Faction happiness | Softens or hardens **taxes / tolls / permits**; workers’ mood hits staffing |
| Corporate / sales tax | Monthly cash drain scaled by activity and political climate |
| Boom | Demand ×↑, easier credit, factions slightly forgiving |
| Recession | Demand ×↓, tax pressure up or relief politics, bankruptcies / empty stores |

A recession should feel bad for *business* (thin sales, idle trucks) without being an instant
game-over — the player’s job is to **tilt the odds**.

### 5.2 How the player stacks the deck

1. **Pick mayors / woo factions** — endorse, donate, house workers, cut smog, build what that
   faction likes; chase tax breaks and kill truck tolls in your hub towns.
2. **Clean & cool cities** (§4) — population and opinion feed labour and sales; scrubbers and
   trees are economic tools, not cosmetics.
3. **Diversify** — deep chains + Trading House dump + multiple towns so one recession town
   does not freeze the company.
4. **Cash buffer & frugal managers** — survive thin months; refinance before the crash.
5. **Counter-cyclical bets** — buy rivals’ distressed assets, lock long contracts before a
   downturn, stock warehouses when goods are cheap.
6. **National politics** (if extended) — lobby for industry-friendly national tax; risk backlash.

### 5.3 Design guardrails

- Taxes must be **readable** (one ledger line, one HUD tip: “Ashford workers levy 4%”).
- Boom/bust should be **telegraphed** (newspaper, Exchange, faction chatter) so skilled play
   is preparation, not surprise death.
- Baron / AI play the same rules — recessions hit them too (drama, not just player pain).
- Start thin: **one visible tax channel + a soft demand cycle**, wired to existing edicts and
  opinion, before a full macro model. *(Done for the thin slice above.)*

