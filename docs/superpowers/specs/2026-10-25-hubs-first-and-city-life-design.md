# Hubs-first logistics, fishing & city life

Status: **hubs-first UX shipped** (2026-10-25). Fishing and city-appeal are **proposed** next.

## 1. Hubs-first local transport *(decided)*

Local goods move through **warehouse hubs** by default. Hand-drawn **routes** stay as the
power tool for long hauls, rail, contracts and overrides.

Player story:
1. Cluster works on road.
2. Drop a Warehouse in the middle → buy hub truck(s) → post a manager.
3. Open Routes only when you need a corridor between clusters or a dedicated line.

Manager logistics skill sets **how often** and **how smart** the hub plans (look-ahead,
balancing). **Range** comes from the warehouse level (the circle you see is the circle you get).

## 2. Fishing / water *(proposed)*

Explore water as a primary resource layer:
- Coastal / river tiles yield **fish** (raw good) via a fishing camp / pier / trawler.
- Feeds food chains (canned food, later restaurants / cold chain) and gives map shores a job.
- Needs mapgen deposits or a terrain rule, a building, recipes, and possibly boat pathing later.

Out of scope until a short design pins tile rules and whether boats are vehicles or abstract.

## 3. Workers, population & “cool” cities *(proposed)*

Factories already expect workers (`Building.staffing` from the town labour pool). Today the pool
is mostly `population × opinion × smog health`. Lean into that:

1. **Population as the main lever** — boring / smoggy / remote towns stay small → works understaffed.
2. **Player tools to make a city cool** — parks / trees (already cut smog), company housing, culture
   or amenity buildings, cleaner industry, maybe prestige goods in stores.
3. **Later factors** — wages, transit, pollution tier, rival presence, festivals.

Start by teaching the existing staffing loop (alerts + inspector), then add one amenity that
clearly grows or retains population before stacking more systems.
