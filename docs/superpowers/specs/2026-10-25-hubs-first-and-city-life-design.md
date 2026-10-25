# Hubs-first logistics, fishing & city life

Status: **hubs-first UX shipped** (2026-10-25). Fishing, city-appeal, and warehouse rail links are **proposed** next.

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

## 2. Warehouse ↔ warehouse train link *(proposed)*

Connect two (or more) warehouses with a **rail corridor** so surplus stock can move between
regions when local hubs need it — without drawing a truck route for every good.

Sketch:
1. Each warehouse (or a linked Train Station beside it) is a rail stop.
2. Player lays track and creates one **hub trunk** (train route) between warehouses — or a
   “Link hubs” action that builds the auto train job board for those stops.
3. Dispatch: when hub A holds surplus and hub B’s attached consumers need it (same scoring
   spirit as truck balance, but distance is rail-leg not road), a train moves a batch.
4. Local hubs still do last-mile by truck; the train only shuttles warehouse ↔ warehouse.

Why it fits hubs-first:
- Players think in **sheds and corridors**, not dozens of good-specific truck lines.
- Complements overlapping-hub truck balance (short) with rail balance (long).
- Routes UI stays the power tool; this is the opinionated default for inter-city stock.

Open questions: station required vs warehouse-on-rail; one shared trunk vs per-pair;
manual “send surplus” vs fully automatic; interaction with D2 (routes still win for
goods they already carry).

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
