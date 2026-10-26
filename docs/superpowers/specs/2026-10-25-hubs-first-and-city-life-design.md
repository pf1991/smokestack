# Hubs-first logistics, fishing & city life

Status: **hubs-first UX shipped** (2026-10-25). Warehouse ↔ warehouse train trunk **shipped** (2026-10-25).
Fishing thin slice **shipped** (2026-10-25). City-appeal (§4) thin slice **shipped** (2026-10-26).
Sales tax + soft cycle (§5) **shipped** (2026-10-25). Cycle↔tax tug (§5 deepen) **shipped** (2026-10-26).

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

## 3. Fishing / water *(shipped 2026-10-25)*

Shores earn their keep: a land **Fishing Pier** harvests **fish**, which towns buy fresh and
canneries can tin. No boats, no fish deposits, no §4 amenities.

### Decisions

1. **Building, not boat** — `fishing_pier` extractor on land (`grass` / `sand`), size 2×2. Boats /
   trawlers / water pathing stay future work.
2. **Tile rule** — footprint must have ≥1 **orthogonal** water neighbour. Refuse with
   “Must touch water”. No mapgen fish deposits; water terrain is the resource.
3. **Efficiency** — `min(1, orthogonal_shore_water / 8)`, lumber-camp style. A pier with one
   water tile limps; a river bend or bay runs near full rate.
4. **Good** — `fish` is a **consumer** staple (tier 2) so stores accept it, with small demand
   (`DEMAND_PER_1000` 20, class staple). Canneries also take it as an industrial input
   (dual use: fresh market or tin).
5. **Recipes** — `r_fish` (pier → fish, empty inputs, ~ranch rate). Cannery gains alt
   `r_canned_fish` (fish + steel → canned_food, same yields as cattle cans). Cattle path stays
   first so AI / `firstRecipeFor` keep the old default.
6. **Logistics** — hub trucks move fish like any other good; no special vehicle.

### Out of scope (this slice)

Boat vehicles, fish deposits, restaurants / cold chain, city-appeal bonuses from waterfront.

## 4. Workers, population & “cool” cities *(thin slice shipped 2026-10-26)*

Factories already expect workers (`Building.staffing` from the town labour pool). The pool is
`population × workers’ opinion × smog health`, plus company-housing hands. Lean into that.

### Decisions

1. **“Cool” this slice** = people move in / stay. Population is the primary lever; opinion and
   staffing follow through the existing labour-pool formula. No prestige score, culture stack, or
   amenity catalogue.
2. **Teach the staffing loop** — inspector already shows “Staff N% — short of hands in \<town\>”.
   Add an **understaffed works alert** (same delay as other building faults) for player extractors /
   factories with `staffing < 1`. Detail points at the town and the tools: grow the town, company
   housing, cut smog. Strikes keep their own alert; no new inspector chrome.
3. **One amenity: Park** — endow the existing philanthropy **Park** landmark (once per town). While
   a town has a park, apply a lasting **`PARK_GROWTH_BONUS` (+0.5%/mo)** on `monthlyGrowth` (keeps
   more people under bad conditions; grows faster when satisfied). Keep the one-shot opinion gift.
   City panel / endow tip call out that the park retains townsfolk. No new buildable amenity type.
4. **How it hits the three** — park → population (primary); existing park opinion bump
   (secondary); larger population → larger `laborPool` → staffing over time. Company housing stays
   the direct hands tool, not a population amenity.

### Out of scope (this slice)

Library / hospital prestige, placeable parks, company-housing redesign, wages / transit /
festivals, fishing or waterfront appeal bonuses.

## 5. Taxes, factions & the business cycle

**Thin slice shipped 2026-10-25:** national **sales tax** (ledger `taxes`, rate from mayor
opinion + tax-break edicts) and a soft **boom / steady / recession** demand cycle (newspaper +
toast; clock tooltip shows phase and rate).

**Deepen shipped 2026-10-26:** **cycle tax tug** — boom softens / recession stiffens the same
national sales-tax rate for every company (±1pp, clamped to the existing min/max). One readable
pressure on top of thin demand; no lobby, bankruptcies, or empty-store drama in this slice.

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
| Boom | Demand ×↑; **sales tax −1pp** (clamped); (later: easier credit, factions forgiving) |
| Recession | Demand ×↓; **sales tax +1pp** (clamped); (later: relief politics, bankruptcies / empty stores) |

A recession should feel bad for *business* (thin sales, idle trucks) without being an instant
game-over — the player’s job is to **tilt the odds**.

### 5.1a Cycle tax tug *(decided / shipped)*

1. **Same rate for everyone** — `nationalTaxRate` (after opinion + edict weighting) plus
   `CYCLE_TAX_TUG[phase]` (−0.01 / 0 / +0.01). Player, Baron, and AI pay through the same
   `taxesMonth` path.
2. **Clamp** — still `TAX_RATE_MIN`…`TAX_RATE_MAX`; tax-break and friendly mayors keep meaning.
3. **Readable** — HUD clock tip: `Sales tax X.X% (national)` in steady; append `, boom` or
   `, recession` when the phase is swinging. Ledger stays one `taxes` line.
4. **Out of this slice** — national lobby, credit easing, idle-truck telegraph, empty stores.

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
- Deepen with **one** clear pressure at a time — cycle↔tax tug first; do not stack lobby,
  bankruptcies, and empty-store drama in the same slice.

