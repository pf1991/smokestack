# Product Expansion: Design Brief (backlog)

Status: **backlog brief**. Written 2026-10-17 from the owner's request. It still needs a short
design review, then its own plan. The proposal is to build it as **Phase 4c**, right after
Phase 4b (logistics, upgrades and managers: `2026-10-17-logistics-and-upgrades-brief.md`). Deep
chains are only fun once warehouse hubs and automatic routes can feed them, so 4b comes first.
Its era unlocks then plug into the Phase 5 invention tree.

## 1. The owner's request

> the game lacks more products and more complex ones.

## 2. What exists today

The goods are in `src/data/goods.ts` and the recipes in `src/data/recipes.ts`:

| Tier | Goods |
|---|---|
| 0, raw (9) | wood, grain, cotton, fruit, milk, iron ore, coal, sand, crude oil |
| 1, processed (7) | lumber, flour, steel, fabric, glass, fuel, plastic |
| 2, consumer (11) | furniture, bread, tools, clothes, cheese, juice, toys, cars, radios, TVs, computers |

- **Depth:** every chain is at most raw → processed → product.
- **Inputs:** only cars, radios, TVs and computers combine 2–3 processed inputs.
- **No parts tier:** nothing is sold to other industries, so there are no intermediate parts.
- **No variety:** each consumer good has one recipe, except toys, which can be made from wood
  or plastic.
- **Class demand and fading:** class demand (Phase 3) and product lifecycle fading (radios fade
  in 1965) already exist, so new goods slot into those systems for free.

## 3. Proposal: a components tier and about 22 new goods

### 3.1 The new tier
Add `component` as a category, not a renumbered tier.

- **Code impact:** a lot of code uses `tier === 2` to mean "a consumer good the city buys"
  (rival market selection, the toolbar tab, demand tables). So keep the tier values and add
  `GoodDef.kind: 'raw' | 'material' | 'component' | 'consumer'`, migrating the callers to it.
- **Who buys components:** other factories, not towns.
- **Selling surplus:** a surplus can be sold through a new *Trading House* building, which
  sells to an abstract national industrial market at a fluctuating price. Mayor's contracts
  can also ask for components ("200 rail parts for the new line").

### 3.2 Candidate goods by era (draft)

| Era | New raw | New material | New component | New consumer |
|---|---|---|---|---|
| 1900 | copper ore, cattle, sugar beet, clay | copper, leather, sugar, bricks, pulp/paper | wire, wheels | shoes, candy, books & newspapers, canned food (tin from ore), soap |
| 1910s | rubber (plantation, import) | — | tyres, engines (steel + fuel) | bicycles → motorcycles |
| 1920s–30s | bauxite | aluminium, chemicals (coal + oil) | vacuum tubes, electric motors | refrigerators, washing machines, phonographs |
| 1950s | — | synthetic fabric (oil) | transistors | appliances wave, nylon clothing, cosmetics |
| 1970s–90s | silicon (from sand) | — | microchips, displays | calculators → video games, mobile phones (1990s), home computers |

### 3.3 Example deep chain
A late-century computer:

- sand → silicon → microchips;
- oil → plastic → case;
- copper ore → copper → wire;
- glass → display;
- assembly: microchips + wire + display + plastic → computer.

That is four to five levels and four raw sources. The value added is large, but one broken
link stalls the line, so warehouses, managers and the Baron's sabotage all matter more.

### 3.4 Variety without bloat
- **Alternative recipes:** some products have two recipes with different inputs. Wood toys
  versus plastic toys already work this way; cotton clothes versus nylon clothes after 1950
  would be another. That gives substitution when an input is scarce.
- **Quality tiers:** maybe later, not in this phase.
- **Factory buildings:** recipes are grouped into about 8 new building types, so the build
  menu grows by a page, not by 22 cards. Examples:
  - a machine shop makes wheels, engines and motors;
  - an electronics works makes tubes, transistors and chips;
  - an appliance plant makes refrigerators and washing machines.

### 3.5 Hooks into existing systems
- **Class demand:**
  - the working class buys shoes, canned food and bicycles;
  - the middle class buys appliances, books and radios;
  - the upper class buys motorcars, cosmetics and pianos.
- **Smoke:** chemicals, aluminium and bricks are heavy polluters, so new trade-offs arise
  under the smoke laws.
- **Workers:** electronics needs few hands; the brick works and the tannery need many.
- **The Baron and regional firms:** they pick projects from the same catalog, and the Baron's
  planner already reasons over chains (`rival/chains.ts`).
- **Inventions (Phase 5):** the patent race decides *when* each new good arrives: transistor,
  aluminium smelting, synthetic fibres, microchip.

## 4. Proposed task breakdown (Phase 4c, about 7 tasks)

| # | Task | Notes |
|---|---|---|
| 1 | `GoodDef.kind` and call-site migration | no new goods yet; behaviour identical, pinned by snapshot tests |
| 2 | Industrial market and Trading House | sells components and materials nationally; price drift; contracts for components |
| 3 | 1900–1910s goods | about 9 goods, 4 buildings, icons in the atlas, class demand |
| 4 | 1920s–50s goods | about 7 goods, 2 buildings |
| 5 | 1970s–90s goods | about 6 goods, 2 buildings, alternative recipes |
| 6 | AI adoption | the Baron's and regional firms' planners handle multi-input chains |
| 7 | Balance and gate | chain-report script (`scripts/chain-report.ts` exists), soak, perf, catalog tests |

## 5. Open questions for the owner
1. Should the tier be called components, or parts?
2. Should there be an import market (buying raw materials you cannot mine) or only selling?
3. Should old goods fade more, so the catalogue rotates through the century?
4. How many new goods: about 22 as drafted, or fewer and deeper?
5. Is quality (cheap or premium versions) wanted, now or later?

## 6. Risks
- **Build-menu overload:** mitigated by grouping recipes into multi-recipe buildings and by the
  slim flyout build bar from the UI overhaul.
- **Icon art:** every new good needs an atlas icon, procedural as today, which is one task's
  worth of work.
- **Balance:** deeper chains must pay more than shallow ones without making 1900 chains
  pointless. Use `chain-report.ts` margins per era as the gate.
