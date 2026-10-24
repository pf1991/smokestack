# Logistics, Upgrades and Managers: Design Brief (backlog)

Status: **backlog brief**. Written 2026-10-17 from the owner's request. It still needs a short
design review (brainstorming), then its own plan. It is not scheduled yet. The proposal is to
build it as **Phase 4b**, after the Phase 4 nemesis/dynasty merge and the UI overhaul, and
before Phase 5 (alternate history).

## 1. The owner's request

> buildings should support upgrades to increase production. fleet should be smarter and be more
> automatic. warehouse could have a range and product distribution would be done automatically in
> the best efficient way. we could hire managers from open market. The better the manager the
> better the product distribution. Trucks should also be upgradable.

## 2. What exists today

- **Buildings** have one fixed recipe rate. The only per-building upgrades are smoke scrubbers
  and tall chimneys (`society/upgrades.ts`). Aging lowers efficiency after 15 years, and renewal
  resets it.
- **Routes are fully manual.** The player picks stops, load and unload goods, and a truck count.
  `routeHelpers.ts` only suggests stops. A truck runs its stop list in order whether or not
  there is cargo.
- **Warehouses** (`warehouse`, 3×3, $20k) are just a stop that stores goods. They have no range
  and no behaviour of their own.
- **There is one truck model:** capacity 20, speed 0.5, cost $8,000. Trains have their own spec.
  Vehicles age.
- **The Baron and the regional firms** (Phase 4) use the same route API, so any automation
  must work for every company.

## 3. The ideas, made concrete

### 3.1 Building upgrades (production levels)
- **Levels:** each works (extractor or factory) gets levels 1 to 3, possibly 4 later in the
  century.
- **What a level does:** it raises the recipe rate (proposed ×1.0 / ×1.4 / ×1.8 / ×2.2), the
  workers needed, upkeep, storage and smoke.
- **Interactions:** smoke ties into Phase 3 regulation. Workers tie into Phase 2 workforce
  and strikes, because a bigger works needs more hands from its town.
- **Price and timing:** an upgrade costs a share of the build price at today's index and takes
  build time (the construction animation exists).
- **Era gating:** some levels unlock with eras now, and with Phase 5 inventions later (the
  assembly line unlocks level 3 factories, for example).
- **Aging:** an upgrade can also count as a renewal, which resets the age.
- **Upgrade cards:** the inspector shows the next level's output, cost, workers and smoke side
  by side, so the trade-off is visible.

### 3.2 Smarter, more automatic fleet
- **Route modes:**
  - *manual*: today's behaviour;
  - *automatic*: the route's stops become a pool. Each truck picks its next job, which is the
    pickup with the most waiting cargo for a destination that accepts it, weighted by distance.
    It never runs a leg empty if a loaded leg exists.
- **Auto-sizing:** an optional rule adds or sells trucks to hold a target utilisation, for
  example 60–85% of trips loaded, within a money cap the player sets.
- **Smart waits:** "wait for full load" or "leave at X%" per stop, a classic tycoon control.
- **Breakdowns and servicing** could hook into aging, but that is out of scope unless the
  owner wants it.

### 3.3 Warehouses with range and automatic distribution
- **Service range:** a warehouse gets a radius (proposed 12 tiles, growing with upgrade level)
  drawn as a circle when selected.
- **The hub:** every player building inside the range is attached to the warehouse
  automatically. Producers push output to it, and consumers (factories and stores) pull inputs
  from it. The warehouse runs its own small fleet: trucks bought for the warehouse, not for a
  route.
- **Dispatch:** each day the warehouse dispatcher solves a small assignment problem. It sends
  loads to whoever needs them most, scored by shortage × value / distance. Stores in towns with
  unmet demand rank first, and inputs that would stall a factory rank next.
- **Between warehouses:** two warehouses whose ranges overlap, or that are joined by a long
  route or train line, can balance stock between them. That gives a hub-and-spoke network
  without micromanagement.
- **Determinism:** the dispatch is a greedy assignment with id tie-breaks, so it is cheap and
  deterministic.
- **Performance:** dispatch runs daily, not per tick, which matters for the 300-vehicle budget.

### 3.4 Managers hired from an open market
- **The pool:** a labour market for managers is refreshed yearly. It holds 4–6 candidates, each
  with a name, an age, a salary and skills from 1 to 5 in:
  - *logistics*, which sets dispatch quality;
  - *production*, which sets works output and breakdown resistance;
  - *frugality*, which cuts upkeep;
  - optionally *people*, which affects strikes and opinion.
- **Assignment:** a manager is assigned to a warehouse (a hub) or to a works.
- **Skill as quality:** logistics skill sets how good the dispatch is.
  - Skill 1 dispatches greedily over the nearest third of the range and replans weekly.
  - Skill 5 sees the full range and inter-warehouse balancing, replans daily and looks ahead
    at incoming production.
  - In short, a better manager means better distribution.
- **Costs and risks:** salaries rise with skill and inflation. Managers age, retire, can be
  poached by the Baron (a new retaliation kind: it ties into the nemesis), and can ask for
  raises through an event card.
- **The dynasty:** a family member with the *shrewd* trait could serve as a free manager.

### 3.5 Truck upgrades and models
- **Models by era:** for example a 1900 Steam Lorry, a 1920 Motor Truck, a 1950 Diesel
  Truck and a 1975 Articulated Lorry, each with more capacity and speed. The capacity and
  speed upgrades are partly these new models.
- **Upgrade kits:** bought per vehicle for a price, for example a bigger body (+25% capacity)
  or a tuned engine (+15% speed).
- **Replacement:** Replace (Phase 3) can switch to the newest model. A fleet window bulk
  action, "upgrade all trucks on this route", saves clicks.
- **Trains** follow the same pattern later.

## 4. Proposed task breakdown (Phase 4b, about 8 tasks)

| # | Task | Notes |
|---|---|---|
| 1 | Vehicle models and upgrade kits | data table by era, per-vehicle `model` and `kits`, save migration, fleet and vehicle UI |
| 2 | Building production levels | level 1–4 data, upgrade action, inspector comparison card, workers, smoke and upkeep scaling |
| 3 | Automatic route mode | job-picking trucks and per-stop load rules; manual stays the default |
| 4 | Fleet auto-sizing | utilisation target and budget cap per route; fleet window controls |
| 5 | Warehouse hubs with range | attach in range, a hub fleet, a daily greedy dispatcher, range circle in the renderer |
| 6 | Managers market | candidate generation, hire and fire, salary, skills, inspector slot |
| 7 | Manager skill drives dispatch quality | range share, replan cadence, look-ahead, inter-hub balancing at skill 4+ |
| 8 | Baron and AI adoption, balance, gate | the Baron and regional firms use levels and hubs, poach-a-manager retaliation, soak and perf gates |

## 5. Open questions for the owner (to settle in the design review)

1. Should hubs replace manual routes in the long run, or sit beside them? Proposal: beside
   them, with manual routes still best for long single-good lines.
2. Do managers die and retire like family members, and can they defect to the Baron?
3. Should upgrades take construction time with output paused, or apply instantly?
4. Truck breakdowns and servicing: in or out?
5. Should automation be unlocked or bought (a "logistics department" building), or available
   from 1900?

## 6. Risks
- **Performance:** dispatch and job picking must stay daily and greedy to hold 60 fps with
  300 vehicles and the soak time budget.
- **Balance:** automation can make the game play itself, which is the problem v2 set out to
  solve. Managers cost salary, hubs need range planning and upgrades cost smoke and workers, so
  every gain has a price.
- **Save churn:** one migration adds levels, models, kits, hubs and managers.
