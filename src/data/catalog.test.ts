import { describe, it, expect } from 'vitest';
import { GOODS, DEMAND_PER_1000, CLASS_DEMAND, BASELINE_GOODS, SEASONAL_CROPS } from './goods';
import { RECIPES, recipeEra } from './recipes';
import { BUILDINGS } from './buildings';
import { LANDMARK_IDS, LANDMARKS } from './landmarks';
import { defaultOpinion, FACTION_IDS, FACTIONS, factionName } from './factions';
import { ICON_IDS } from '../render/icons';
import { CARDS } from './cards';
import { resolveCard } from '../sim/politics/cards';
import { testCtx, testState } from '../sim/testkit';
import { LANDMARK_PAINTERS } from '../render/landmarks';
import { BARON_TRAITS, GRUDGE_WEIGHTS } from './nemesis';
import { BARON_LINES } from './baronLines';
import { BARON_TRAIT_IDS, RETALIATION_KINDS } from '../sim/nemesis/types';

describe('content catalog', () => {
  it('every recipe good exists', () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const id of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]) {
        expect(GOODS[id], `recipe ${recipe.id} uses unknown good ${id}`).toBeDefined();
      }
    }
  });

  it('every building recipe exists', () => {
    for (const building of Object.values(BUILDINGS)) {
      for (const recipeId of building.recipes) {
        expect(RECIPES[recipeId], `building ${building.id} uses unknown recipe ${recipeId}`).toBeDefined();
      }
    }
  });

  it('every consumer good is producible from raw goods', () => {
    const reachable = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const recipe of Object.values(RECIPES)) {
        if (!Object.keys(recipe.inputs).every((g) => reachable.has(g))) continue;
        for (const out of Object.keys(recipe.outputs)) {
          if (!reachable.has(out)) {
            reachable.add(out);
            changed = true;
          }
        }
      }
    }
    const consumer = Object.values(GOODS).filter((g) => g.kind === 'consumer');
    expect(consumer).toHaveLength(Object.keys(DEMAND_PER_1000).length);
    for (const good of consumer) {
      expect(reachable.has(good.id), `${good.id} not producible`).toBe(true);
    }
  });

  it('every good has a kind that agrees with its tier, and consumer goods are the demanded ones', () => {
    for (const g of Object.values(GOODS)) {
      expect(['raw', 'material', 'component', 'consumer'], g.id).toContain(g.kind);
      if (g.tier === 0) expect(g.kind, g.id).toBe('raw');
      else if (g.tier === 2) expect(g.kind, g.id).toBe('consumer');
      else expect(['material', 'component'], g.id).toContain(g.kind);
    }
    const consumers = Object.values(GOODS).filter((g) => g.kind === 'consumer').map((g) => g.id);
    expect(new Set(consumers)).toEqual(new Set(Object.keys(DEMAND_PER_1000)));
  });

  it('recipe era', () => {
    expect(recipeEra('r_toys_plastic')).toBe(1935);
    expect(recipeEra('r_cars')).toBe(1910);
    expect(recipeEra('r_fuel')).toBe(1910);
    expect(recipeEra('r_sugar_beet')).toBe(1900);
  });

  it('every building is invented no later than its earliest recipe', () => {
    for (const def of Object.values(BUILDINGS)) {
      if (def.recipes.length === 0) continue;
      expect(def.era, def.id).toBeLessThanOrEqual(Math.min(...def.recipes.map(recipeEra)));
    }
  });

  it('every building def employs workers (company housing only houses them)', () => {
    for (const def of Object.values(BUILDINGS)) {
      if (def.id === 'company_housing') {
        expect(def.workers).toBe(0);
        continue;
      }
      expect(Number.isFinite(def.workers) && def.workers > 0, `${def.id} workers ${def.workers}`).toBe(true);
    }
    const byCat = (cat: string) => Object.values(BUILDINGS).filter((d) => d.category === cat);
    const SPECIAL: Record<string, number> = { steel_mill: 120, car_plant: 120, tannery: 90, brickworks: 90, electronics_works: 30, gadget_assembly: 30 };
    for (const d of byCat('extractor')) expect(d.workers, d.id).toBe(SPECIAL[d.id] ?? 20);
    for (const d of byCat('factory')) expect(d.workers, d.id).toBe(SPECIAL[d.id] ?? 60);
    for (const d of byCat('retail')) expect(d.workers, d.id).toBe(12);
    for (const d of byCat('trade')) expect(d.workers, d.id).toBe(12);
    for (const d of byCat('logistics')) expect(d.workers, d.id).toBe(d.id === 'company_housing' ? 0 : 6);
  });

  it('exact values', () => {
    expect(GOODS.cars.basePrice).toBe(630);
    expect(GOODS.radios.fadeYear).toBe(1965);
    expect(BUILDINGS.car_plant.size).toEqual({ w: 4, h: 4 });
    expect(BUILDINGS.store.requiresCity).toBe(true);
    expect(DEMAND_PER_1000.bread).toBe(60);
  });

  it('every manufacturing recipe is profitable at base price', () => {
    const value = (inv: Record<string, number>) =>
      Object.entries(inv).reduce((sum, [id, qty]) => sum + qty * GOODS[id].basePrice, 0);
    const manufacturing = Object.values(RECIPES).filter((r) =>
      Object.keys(r.outputs).some((g) => GOODS[g].kind === 'consumer'),
    );
    expect(manufacturing.length).toBeGreaterThan(0);
    for (const recipe of manufacturing) {
      expect(value(recipe.outputs), `${recipe.id} not profitable`).toBeGreaterThan(value(recipe.inputs));
    }
  });

  it('requiresDeposit and requiresCity flags', () => {
    for (const b of Object.values(BUILDINGS)) {
      expect(b.requiresDeposit, b.id).toBe(b.id === 'mine' || b.id === 'oil_well');
      expect(b.requiresCity, b.id).toBe(b.id === 'store');
    }
  });

  it('every good and building has a distinct colour and a description', () => {
    const goodColors = Object.values(GOODS).map((g) => g.color);
    expect(new Set(goodColors).size).toBe(goodColors.length);
    for (const b of Object.values(BUILDINGS)) {
      expect(b.description.length).toBeGreaterThan(0);
    }
  });

  it('every landmark has a painter and an icon', () => {
    expect(LANDMARK_IDS).toEqual(Object.keys(LANDMARKS));
    for (const id of LANDMARK_IDS) {
      expect(typeof LANDMARK_PAINTERS[id], id).toBe('function');
      expect(ICON_IDS, id).toContain(id);
    }
  });
  it('factions: five, keyed by id, weights summing to 1, distinct colours, Reformers become Greens in 1960', () => {
    expect([...FACTION_IDS].sort()).toEqual(Object.keys(FACTIONS).sort());
    expect(FACTION_IDS).toEqual(['workers', 'oldmoney', 'reformers', 'church', 'baron']);
    expect(Object.fromEntries(FACTION_IDS.map((f) => [f, FACTIONS[f].weight]))).toEqual({ workers: 0.4, oldmoney: 0.18, reformers: 0.17, church: 0.2, baron: 0.05 });
    expect(FACTION_IDS.reduce((s, f) => s + FACTIONS[f].weight, 0)).toBeCloseTo(1, 10);
    for (const f of FACTION_IDS) {
      const d = FACTIONS[f];
      expect(d.id).toBe(f);
      expect(d.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(d.name.length && d.likes.length && d.hates.length).toBeGreaterThan(0);
    }
    expect(new Set(FACTION_IDS.map((f) => FACTIONS[f].color)).size).toBe(5);
    expect(FACTIONS.reformers.greenName).toBe('Greens');
    expect(factionName('reformers', 1959)).toBe('Reformers');
    expect(factionName('reformers', 1960)).toBe('Greens');
    expect(factionName('workers', 1990)).toBe('Workers');
    expect(defaultOpinion()).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
  });

  it('event cards: unique ids, sane fields, always answerable, city effects only on city cards', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.id, c.id).toMatch(/^[a-z0-9_]+$/);
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(c.body.length, c.id).toBeGreaterThan(0);
      expect(c.years[0], c.id).toBeLessThanOrEqual(c.years[1]);
      expect(c.weight, c.id).toBeGreaterThan(0);
      expect(c.cooldownYears, c.id).toBeGreaterThanOrEqual(0);
      expect(c.choices.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.choices[c.defaultChoice], `${c.id} defaultChoice`).toBeDefined();
      // never trap the player: some choice costs nothing (or pays)
      expect(c.choices.some((ch) => ch.cost <= 0), `${c.id} has no free choice`).toBe(true);
      for (const ch of c.choices) {
        expect(Number.isFinite(ch.cost), `${c.id}: ${ch.label}`).toBe(true);
        for (const e of ch.effects) {
          expect(FACTIONS[e.faction], `${c.id}: ${e.faction}`).toBeDefined();
          if (e.scope === 'city') expect(c.needsCity, `${c.id} has a city effect but needsCity false`).toBe(true);
        }
        if (ch.apply) expect(ch.note, `${c.id}: ${ch.label} has apply but no note`).toBeTruthy();
      }
      if (!c.needsCity) expect(c.body + c.title, `${c.id} uses {city} without a city`).not.toContain('{city}');
    }
  });

  it('event cards: one law card per national smoke law', () => {
    for (const id of ['smoke_abatement', 'clean_air', 'emission_caps']) {
      const c = CARDS.find((x) => x.id === `law_${id}`);
      expect(c?.trigger, id).toBe('law');
      expect(c!.choices.some((ch) => ch.label === 'Lobby for delay')).toBe(true);
    }
  });

  it('event cards: Task 8 counts, era spread, bounds and faction coverage', () => {
    const by = (t: string) => CARDS.filter((c) => c.trigger === t);
    expect(CARDS.length).toBeGreaterThanOrEqual(60);
    const spring = by('spring');
    expect(spring.length).toBeGreaterThanOrEqual(40);
    // era cards: at least 8 spring cards whose whole year range lies inside each quarter-century
    for (const [from, to] of [[1900, 1924], [1925, 1949], [1950, 1974], [1975, 2000]]) {
      const n = spring.filter((c) => c.years[0] >= from && c.years[1] <= to).length;
      expect(n, `spring cards in ${from}-${to}`).toBeGreaterThanOrEqual(8);
    }
    expect(by('election').length).toBeGreaterThanOrEqual(6);
    expect(by('scandal').length).toBeGreaterThanOrEqual(4);
    expect(by('disaster').length).toBeGreaterThanOrEqual(4);
    expect(by('crash').length).toBeGreaterThanOrEqual(4);
    expect(by('strike').length).toBeGreaterThanOrEqual(2);
    expect(by('invention').length).toBeGreaterThanOrEqual(2);
    for (const c of CARDS) {
      expect(c.choices.length, c.id).toBeLessThanOrEqual(3);
      // the manager raise card can come in 1900: a manager may be hired on the first day
      expect(c.years[0], c.id).toBeGreaterThanOrEqual(c.trigger === 'manager' ? 1900 : 1901);
      expect(c.years[1], c.id).toBeLessThanOrEqual(2000);
      expect(Number.isInteger(c.defaultChoice) && c.defaultChoice >= 0 && c.defaultChoice < c.choices.length, `${c.id} defaultChoice`).toBe(true);
      // ruling R-Q8: authored in 1900 dollars for a $300k company; the engine scales them
      // the marriage card's dowry (Phase 4 Task 5) is the one larger spring sum
      const maxCost = c.trigger === 'crash' || c.trigger === 'disaster' ? 60_000 : c.id === 'marriage' ? 20_000 : 15_000;
      for (const ch of c.choices) {
        expect(Math.abs(ch.cost), `${c.id}: ${ch.label} cost`).toBeLessThanOrEqual(maxCost);
        expect(ch.label.length, `${c.id}: ${ch.label}`).toBeLessThan(40);
        const net: Record<string, number> = {};
        for (const e of ch.effects) {
          expect(Math.abs(e.delta), `${c.id}: ${ch.label} ${e.faction}`).toBeLessThanOrEqual(15);
          const k = `${e.faction}:${e.scope}`;
          net[k] = (net[k] ?? 0) + e.delta;
        }
        for (const [k, v] of Object.entries(net)) expect(Math.abs(v), `${c.id}: ${ch.label} ${k}`).toBeLessThanOrEqual(15);
      }
    }
    const used = new Set(CARDS.flatMap((c) => c.choices.flatMap((ch) => ch.effects.map((e) => e.faction))));
    for (const f of FACTION_IDS) expect(used.has(f), `no card touches ${f}`).toBe(true);
    const baronCards = CARDS.filter((c) => c.choices.some((ch) => ch.effects.some((e) => e.faction === 'baron')));
    expect(baronCards.length).toBeGreaterThanOrEqual(6);
  });

  it('the manager raise card: triggered by managers, free default, bonus 1,500', () => {
    const c = CARDS.find((x) => x.id === 'manager_raise')!;
    expect(c.trigger).toBe('manager');
    expect(c.years).toEqual([1900, 2000]);
    expect(c.choices.map((ch) => ch.cost)).toEqual([0, 1500, 0]);
    expect(c.defaultChoice).toBe(0);
    expect(c.title).toContain('{manager}');
  });

  it('every crash card resolves, in each choice, on a 1929 state', () => {
    const crash = CARDS.filter((c) => c.trigger === 'crash');
    expect(crash.length).toBeGreaterThanOrEqual(4);
    for (const c of crash) {
      c.choices.forEach((ch, i) => {
        const state = testState({ cities: [{ x: 10, y: 10 }], year: 1929, seed: 3, money: 1e9 });
        const ctx = testCtx(state);
        state.politics.cards.pending.push({ uid: 1, cardId: c.id, cityId: null, openedDay: 0 });
        const r = resolveCard(ctx, 1, i);
        expect(r.ok, `${c.id}: ${ch.label}`).toBe(true);
        expect(state.politics.cards.pending).toHaveLength(0);
      });
    }
  });

  it('every Baron trait has a label, a blurb and action weights of 1 to 3 over known retaliations', () => {
    expect(Object.keys(BARON_TRAITS).sort()).toEqual([...BARON_TRAIT_IDS].sort());
    for (const id of BARON_TRAIT_IDS) {
      const t = BARON_TRAITS[id];
      expect(t.label.length, id).toBeGreaterThan(0);
      expect(t.blurb.length, id).toBeGreaterThan(0);
      const weights = Object.entries(t.actionWeights);
      expect(weights.length, id).toBeGreaterThan(0);
      for (const [kind, w] of weights) {
        expect(RETALIATION_KINDS, `${id}: ${kind}`).toContain(kind);
        expect(Number.isInteger(w) && w! >= 1 && w! <= 3, `${id}: ${kind} weight ${w}`).toBe(true);
      }
    }
  });

  it('poach_manager: cunning +3, greedy +1, and 4+ Baron lines without emoji, one naming no town', () => {
    expect(BARON_TRAITS.cunning.actionWeights.poach_manager).toBe(3);
    expect(BARON_TRAITS.greedy.actionWeights.poach_manager).toBe(1);
    const lines = BARON_LINES.retaliation.poach_manager;
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(lines.some((l) => !l.includes('{city}'))).toBe(true);
  });

  it('grudge weights', () => {
    expect(GRUDGE_WEIGHTS).toEqual({ undercut: 2, contract: 3, shares: 4, city: 5, sabotage_exposed: 6, takeover_bid: 8, rivalry: 3, wake: 10 });
  });
});

describe('R4 1900 content (Tables G, D, R and B)', () => {
  // id, name, kind, basePrice, color (Table G; every 1900 row has era 1900 and no fade year)
  it.each([
    ['copper_ore', 'Copper Ore', 'raw', 6, '#4f8a6e'],
    ['cattle', 'Cattle', 'raw', 10, '#7a4b3a'],
    ['sugar_beet', 'Sugar Beet', 'raw', 3, '#c77d9b'],
    ['clay', 'Clay', 'raw', 2, '#b5653d'],
    ['copper', 'Copper', 'material', 24, '#c46f3b'],
    ['leather', 'Leather', 'material', 14, '#b08060'],
    ['sugar', 'Sugar', 'material', 9, '#f5efe0'],
    ['bricks', 'Bricks', 'material', 8, '#a63d2a'],
    ['paper', 'Paper', 'material', 10, '#efe6c8'],
    ['wire', 'Wire', 'component', 32, '#d4a017'],
    ['shoes', 'Shoes', 'consumer', 52, '#4a2c1a'],
    ['candy', 'Candy', 'consumer', 16, '#ff7eb6'],
    ['books', 'Books', 'consumer', 36, '#7d2e46'],
    ['canned_food', 'Canned Food', 'consumer', 18, '#b0413e'],
  ] as const)('good %s', (id, name, kind, basePrice, color) => {
    const tier = kind === 'raw' ? 0 : kind === 'consumer' ? 2 : 1;
    expect(GOODS[id]).toEqual({ id, name, tier, kind, basePrice, era: 1900, fadeYear: null, color });
  });

  const MIDDLE = { working: 0.8, middle: 1.5, upper: 1.2 };
  const STAPLE = { working: 1.2, middle: 1.0, upper: 0.7 };
  const PLAIN = { working: 1, middle: 1, upper: 1 };
  it.each([
    ['shoes', 14, STAPLE],
    ['candy', 30, PLAIN],
    ['books', 10, MIDDLE],
    ['canned_food', 40, STAPLE],
  ] as const)('demand %s', (id, per1000, cls) => {
    expect(DEMAND_PER_1000[id]).toBe(per1000);
    expect(CLASS_DEMAND[id]).toEqual(cls);
  });

  it('new demand entries come after the v1 goods, in Table D order', () => {
    const v1 = ['furniture', 'bread', 'tools', 'clothes', 'cheese', 'juice', 'toys', 'cars', 'radios', 'tvs', 'computers'];
    expect(Object.keys(DEMAND_PER_1000).slice(0, 15)).toEqual([...v1, 'shoes', 'candy', 'books', 'canned_food']);
    expect(Object.keys(CLASS_DEMAND)).toEqual(Object.keys(DEMAND_PER_1000));
    expect([...BASELINE_GOODS]).toEqual(v1);
    expect(SEASONAL_CROPS).toEqual(['grain', 'cotton', 'fruit', 'sugar_beet']);
  });

  it.each([
    ['r_copper_ore', {}, { copper_ore: 10 }],
    ['r_cattle', {}, { cattle: 4 }],
    ['r_sugar_beet', {}, { sugar_beet: 12 }],
    ['r_clay', {}, { clay: 12 }],
    ['r_copper', { copper_ore: 8, coal: 2 }, { copper: 4 }],
    ['r_leather', { cattle: 2 }, { leather: 4 }],
    ['r_sugar', { sugar_beet: 12 }, { sugar: 6 }],
    ['r_bricks', { clay: 10, coal: 2 }, { bricks: 8 }],
    ['r_paper', { wood: 10 }, { paper: 6 }],
    ['r_wire', { copper: 4 }, { wire: 4 }],
    ['r_shoes', { leather: 4 }, { shoes: 2 }],
    ['r_candy', { sugar: 3, milk: 2 }, { candy: 6 }],
    ['r_books', { paper: 6 }, { books: 3 }],
    ['r_canned_food', { cattle: 2, steel: 1 }, { canned_food: 6 }],
  ] as const)('recipe %s', (id, inputs, outputs) => {
    expect(RECIPES[id]).toEqual({ id, inputs, outputs, days: 1 });
    expect(recipeEra(id)).toBe(1900);
  });

  it('new recipes come after every older recipe for the same good', () => {
    const ids = Object.keys(RECIPES);
    expect(ids.indexOf('r_sugar_beet')).toBeGreaterThan(ids.indexOf('r_computers'));
    expect(BUILDINGS.farm.recipes).toEqual(['r_grain', 'r_cotton', 'r_fruit', 'r_sugar_beet']);
  });

  // id, name, category, size, cost, maintenance, terrain, recipes, storage, pollution, workers, color, description
  it.each([
    ['ranch', 'Cattle Ranch', 'extractor', [3, 3], 14000, 200, ['grass'], ['r_cattle'], 120, 1, 20, '#9c6b3f', 'Longhorns on the open range, driven to the railhead.'],
    ['clay_pit', 'Clay Pit', 'extractor', [2, 2], 8000, 125, ['grass', 'hills'], ['r_clay'], 160, 1, 20, '#b86b45', 'Stiff red clay, dug wet for the brick kilns.'],
    ['copper_mine', 'Copper Mine', 'extractor', [2, 2], 22000, 350, ['hills', 'mountain'], ['r_copper_ore'], 160, 3, 20, '#5f7a68', 'Green-stained adits worked for copper ore.'],
    ['smelter', 'Smelter', 'factory', [3, 3], 45000, 600, ['grass', 'sand', 'hills'], ['r_copper'], 120, 6, 60, '#7a4e3a', 'Roaring furnaces that win copper, and later aluminium, from ore.'],
    ['tannery', 'Tannery', 'factory', [2, 2], 18000, 250, ['grass', 'sand'], ['r_leather'], 120, 3, 90, '#8c6d4f', 'Pits of bark liquor; the smell carries for a mile.'],
    ['sugar_refinery', 'Sugar Refinery', 'factory', [3, 3], 25000, 300, ['grass', 'sand'], ['r_sugar'], 120, 2, 60, '#e9d9d0', 'Beet sliced, boiled and crystallised into white sugar.'],
    ['brickworks', 'Brickworks', 'factory', [3, 3], 20000, 250, ['grass', 'sand', 'hills'], ['r_bricks'], 160, 5, 90, '#9e3b2b', 'Kilns fired day and night; the town is built of their bricks.'],
    ['paper_mill', 'Paper Mill', 'factory', [3, 3], 28000, 350, ['grass', 'sand'], ['r_paper'], 120, 3, 60, '#d9cfb0', 'Pulp and rollers turn timber into reams of paper.'],
    ['machine_shop', 'Machine Shop', 'factory', [3, 3], 40000, 500, ['grass', 'sand', 'hills'], ['r_wire'], 100, 3, 60, '#56606b', 'Lathes and drop hammers making parts for other works.'],
    ['shoe_factory', 'Shoe Factory', 'factory', [2, 2], 20000, 250, ['grass', 'sand'], ['r_shoes'], 80, 1, 60, '#5a3a26', 'Lasts, awls and stitching machines: boots for the nation.'],
    ['confectionery', 'Confectionery', 'factory', [2, 2], 16000, 200, ['grass', 'sand'], ['r_candy'], 80, 1, 60, '#f29bc0', 'Copper pans of boiling sugar, wrapped by the penny.'],
    ['print_works', 'Print Works', 'factory', [3, 3], 25000, 300, ['grass', 'sand'], ['r_books'], 80, 1, 60, '#6e2f40', 'Presses thunder out books and almanacs.'],
    ['cannery', 'Cannery', 'factory', [2, 2], 20000, 250, ['grass', 'sand'], ['r_canned_food'], 80, 2, 60, '#a8473f', 'Sealed tins of meat that keep a winter or a war.'],
  ] as const)('building %s', (id, name, category, [w, hgt], cost, maintenance, allowedTerrain, recipes, storage, pollution, workers, color, description) => {
    expect(BUILDINGS[id]).toEqual({
      id, name, category, size: { w, h: hgt }, cost, maintenance, allowedTerrain, requiresDeposit: false, requiresCity: false,
      recipes, storage, era: 1900, pollution, color, description, workers,
    });
  });

  it('new works stand before the store', () => {
    const ids = Object.keys(BUILDINGS);
    for (const id of ['ranch', 'clay_pit', 'copper_mine', 'smelter', 'cannery']) expect(ids.indexOf(id), id).toBeLessThan(ids.indexOf('store'));
  });
});
