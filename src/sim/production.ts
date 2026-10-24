import { LANDMARK_LAYER } from './landmarkTiles';
import { recordSale } from './scenarios';
import { onSale } from './contracts';
import { notePoliticsSale } from './politics/factions';
import { playerBuildingUpkeep, SMOG_LIMIT_FACTOR, smogLimited } from './politics/mayorEdicts';
import { growthPenalty, PROTEST_FACTOR } from './society/tiers';
import { protestedBuildings } from './society/escalation';
import { SLOWDOWN_FACTOR, slowedBuildings, strikeActive } from './society/strikeState';
import { strikeOver } from './society/strikes';
import { priceWars } from './nemesis/retaliation';
import { BARON_ID, companyIds, PLAYER_ID } from './companies';
import { BUILDINGS } from '../data/buildings';
import { buildingStorage, levelRate } from './logistics/levels';
import { managerRate } from './logistics/managers';
import { RECIPES, type RecipeDef } from '../data/recipes';
import { compareDates, dateToDays, isSummer, isWinter } from './clock';
import { currentLedger, earn, spend } from './finance';
import { loadSource } from './inventory';
import { RAIL_UPKEEP } from './rail';
import { averageSatisfaction, computeDailySales, demandGoods, demandModifier, monthlyGrowth, updateMarketDay, urbanRadius, type StoreStock } from './market';
import { layCityStreets, refreshUrbanTiles, ROAD_UPKEEP } from './state';
import { assetEfficiency } from './society/aging';
import { atPrices, priceIndex } from './society/economy';
import { buildingMaintenance } from './society/upgrades';
import type { Building, City, GameState, GoodId, SimContext, Vec2 } from './types';
import { buildingList } from './spatial';

/** demandModifier and averageSatisfaction live in market.ts (a leaf for society/classes.ts); re-exported for existing importers. */
export { averageSatisfaction, demandModifier } from './market';

function extractorEfficiency(state: GameState, b: Building, outputs: readonly string[]): number {
  // counts over footprint(b)'s tiles, in loops instead of mapped and filtered lists (same counts)
  const def = BUILDINGS[b.typeId];
  const { w, h } = def.size;
  const { tiles, width } = state.map;
  const total = w * h;
  if (b.typeId === 'lumber_camp') {
    let forest = 0;
    for (let y = b.pos.y; y < b.pos.y + h; y++) for (let x = b.pos.x; x < b.pos.x + w; x++) if (tiles[y * width + x].terrain === 'forest') forest++;
    return forest / total;
  }
  if (def.requiresDeposit) {
    let n = 0;
    for (let y = b.pos.y; y < b.pos.y + h; y++) {
      for (let x = b.pos.x; x < b.pos.x + w; x++) {
        const d = tiles[y * width + x].deposit;
        if (d !== null && outputs.includes(d)) n++;
      }
    }
    return n > 0 ? Math.max(0.25, n / total) : 0;
  }
  if (b.typeId === 'farm') {
    const seasonal = outputs.some((g) => g === 'grain' || g === 'cotton' || g === 'fruit');
    if (seasonal) return isWinter(state.date.month) ? 0 : isSummer(state.date.month) ? 1.5 : 1;
  }
  return 1;
}

/** A recipe's output and input goods, as Object.keys gives them (RECIPES is static data). */
const recipeKeys = new WeakMap<RecipeDef, { outs: string[]; ins: string[] }>();

function keysOf(recipe: RecipeDef): { outs: string[]; ins: string[] } {
  let k = recipeKeys.get(recipe);
  if (!k) recipeKeys.set(recipe, (k = { outs: Object.keys(recipe.outputs), ins: Object.keys(recipe.inputs) }));
  return k;
}

function addOutput(b: Building, goodId: GoodId, amount: number, cap: number): void {
  const room = Math.max(0, cap - (b.output[goodId] ?? 0));
  const add = Math.min(room, amount);
  if (add <= 0) return;
  b.output[goodId] = (b.output[goodId] ?? 0) + add;
  b.producedThisMonth[goodId] = (b.producedThisMonth[goodId] ?? 0) + add;
}

/**
 * `state.unlocked` as a Set (has() answers as includes() does), cached per array and rebuilt when its
 * length changes: the sim only ever appends to it (eras.ts, events.ts) or replaces it.
 */
const unlockedSets = new WeakMap<string[], { length: number; set: Set<string> }>();

function unlockedSet(state: GameState): Set<string> {
  const ids = state.unlocked;
  let c = unlockedSets.get(ids);
  if (!c || c.length !== ids.length) unlockedSets.set(ids, (c = { length: ids.length, set: new Set(ids) }));
  return c.set;
}

export function productionDay(ctx: SimContext): void {
  const { state } = ctx;
  // mayors' smog limits hold some of the player's dirty works back (politics/mayorEdicts.ts)
  const limited = smogLimited(state);
  // smog protests (tier 3+) slow the player's polluters in the town's zone (society/escalation.ts)
  const protested = protestedBuildings(state);
  // a go-slow (workers' opinion below 30) in the town a works hires from (society/strikeState.ts)
  const slowed = slowedBuildings(state);
  const today = dateToDays(state.date);
  const unlocked = unlockedSet(state);
  for (const b of buildingList(state)) {
    const def = BUILDINGS[b.typeId];
    // a striking works produces nothing; on the day it ends the strike is cleared and an unanswered
    // strike card withdrawn (society/strikes.ts), even while an upgrade's works is under way
    if (b.strike) {
      if (strikeActive(b.strike, today)) {
        b.status = b.works ? 'upgrading' : 'halted';
        continue;
      }
      strikeOver(ctx, b);
    }
    if (b.haltedUntil) {
      if (compareDates(b.haltedUntil, state.date) > 0) {
        b.status = b.works ? 'upgrading' : 'halted';
        continue;
      }
      b.haltedUntil = null;
    }
    // an upgrade's works halts the building; the strike and halt timers above keep running (sim/logistics/levels.ts)
    if (b.works) {
      b.status = 'upgrading';
      continue;
    }
    const recipe = b.recipeId && unlocked.has(b.recipeId) ? RECIPES[b.recipeId] : undefined;
    if (!recipe || (def.category !== 'extractor' && def.category !== 'factory')) {
      b.status = 'idle';
      continue;
    }
    const { outs, ins } = keysOf(recipe);
    // staffing and age (society/aging.ts) scale every works' rate alike
    const storage = buildingStorage(b);
    const rate = levelRate(b) * managerRate(state, b) * b.staffing * assetEfficiency(state, b) * (limited.has(b.id) ? SMOG_LIMIT_FACTOR : 1) * (protested.has(b.id) ? PROTEST_FACTOR : 1) * (slowed.has(b.id) ? SLOWDOWN_FACTOR : 1);
    if (def.category === 'extractor') {
      // staffing (sim/politics/workforce.ts) scales the day's yield like terrain efficiency does
      const eff = extractorEfficiency(state, b, outs) * rate;
      for (const g of outs) addOutput(b, g, recipe.outputs[g] * eff, storage);
      let full = false;
      for (const g of outs) if ((b.output[g] ?? 0) >= storage) full = true;
      b.status = full ? 'output_full' : 'ok';
      continue;
    }
    let full = false;
    for (const g of outs) if ((b.output[g] ?? 0) + recipe.outputs[g] > storage) full = true;
    if (full) {
      b.status = 'output_full';
      continue;
    }
    let fed = true;
    for (const g of ins) if (!((b.input[g] ?? 0) >= recipe.inputs[g])) fed = false;
    if (!fed) {
      b.status = 'no_input';
      continue;
    }
    b.status = 'ok';
    // the rate multiplies the day's recipe progress (spec §4.1): a levelled or managed works may
    // finish several batches in a day, each while its inputs cover a batch and its outputs have room
    b.progress += rate / recipe.days;
    while (b.progress >= 1 - 1e-9 && fed && !full) {
      for (const g of ins) b.input[g] -= recipe.inputs[g];
      for (const g of outs) addOutput(b, g, recipe.outputs[g], storage);
      b.progress = Math.max(0, b.progress - 1);
      for (const g of ins) if (!((b.input[g] ?? 0) >= recipe.inputs[g])) fed = false;
      for (const g of outs) if ((b.output[g] ?? 0) + recipe.outputs[g] > storage) full = true;
    }
    // starved or full: at most one ready batch carries over to the next day
    if (b.progress > 1) b.progress = 1;
  }
}

let monthlyScratch: Float64Array | null = null;

export function retailDay(ctx: SimContext): void {
  const { state, bus } = ctx;
  const dayOffset = dateToDays(state.date);
  const goodIds = demandGoods();
  // each town's monthly demand by good, written by computeDailySales (every entry, every town)
  const monthly = (monthlyScratch ??= new Float64Array(goodIds.length));
  // stores grouped by city in one pass (id order, as a per-city filter would give)
  const storesByCity = new Map<number, Building[]>();
  for (const b of buildingList(state)) {
    if (b.cityId === null || BUILDINGS[b.typeId].category !== 'retail') continue;
    const list = storesByCity.get(b.cityId);
    if (list) list.push(b);
    else storesByCity.set(b.cityId, [b]);
  }
  for (const city of state.cities) {
    const stores = storesByCity.get(city.id) ?? [];
    const stocks: StoreStock[] = stores.map((b) => ({ buildingId: b.id, ownerId: b.ownerId, stock: loadSource(b) }));
    const mod = (g: GoodId) => demandModifier(state, city.id, g);
    // the Baron's price wars in this town (nemesis/retaliation.ts); null, allocation-free, when none
    const sales = computeDailySales(city, stocks, state.date.year, mod, dayOffset, priceIndex(state), priceWars(state, city.id), monthly);
    const soldByGood: Record<GoodId, number> = {};
    const soldStores = new Set<number>();
    for (const s of sales) {
      if (s.qty > 0) soldStores.add(s.buildingId);
      const src = loadSource(state.buildings[s.buildingId]);
      src[s.goodId] = (src[s.goodId] ?? 0) - s.qty;
      const company = state.companies[s.ownerId];
      earn(company, 'sales', s.revenue, state.date);
      // the Baron's per-store takings feed his insolvency guard (rival/insolvency.ts)
      if (s.ownerId === BARON_ID) {
        const store = state.buildings[s.buildingId];
        store.salesThisMonth = (store.salesThisMonth ?? 0) + s.revenue;
      }
      const sbg = currentLedger(company, state.date).salesByGood;
      sbg[s.goodId] = (sbg[s.goodId] ?? 0) + s.revenue;
      soldByGood[s.goodId] = (soldByGood[s.goodId] ?? 0) + s.qty;
      recordSale(state, { ownerId: s.ownerId, cityId: city.id, goodId: s.goodId, qty: s.qty });
      notePoliticsSale(state, s.ownerId, city.id, s.revenue);
      onSale(state, { ownerId: s.ownerId, cityId: city.id, goodId: s.goodId, qty: s.qty });
      bus.emit({
        type: 'sale',
        cityId: city.id,
        goodId: s.goodId,
        qty: s.qty,
        revenue: s.revenue,
        ownerId: s.ownerId,
        buildingId: s.buildingId,
      });
    }
    // a store is 'ok' on a day it sold anything, otherwise 'idle' (productionDay leaves it 'idle')
    for (const b of stores) if (b.status !== 'halted') b.status = soldStores.has(b.id) ? 'ok' : 'idle';
    // the same monthly demand computeDailySales just used: the sales above change neither the town's
    // population and classes nor the modifiers or the date
    for (let gi = 0; gi < goodIds.length; gi++) {
      const g = goodIds[gi];
      const demandToday = monthly[gi] / 30;
      if (demandToday > 0) updateMarketDay(city, g, soldByGood[g] ?? 0, demandToday);
    }
  }
}

export function maintenanceMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const owner of companyIds(state)) {
    const company = state.companies[owner];
    // a closed company (a regional firm gone under, the Baron out of the game) holds nothing to keep up
    if (!company.active) continue;
    let total = 0;
    // every building's upkeep is at today's prices × its age factor (society/upgrades.ts buildingMaintenance);
    // company edicts (wages, safety, unions) and mayors' minimum wage scale the player's only
    if (owner === PLAYER_ID) total = playerBuildingUpkeep(state);
    else for (const b of Object.values(state.buildings)) if (b.ownerId === owner) total += buildingMaintenance(state, b);
    total += atPrices(state, company.roadTiles * ROAD_UPKEEP + company.railTiles * RAIL_UPKEEP);
    if (total > 0) spend(company, 'maintenance', total, state.date);
  }
}

export function growthMonth(ctx: SimContext): void {
  const { state } = ctx;
  // urban tiles depend only on each city's radius: re-mark them only when some radius changes
  let radiusChanged = false;
  const grown: City[] = [];
  const newStreets: Vec2[] = [];
  for (const city of state.cities) {
    const avg = averageSatisfaction(state, city);
    city.prevPopulation = city.population;
    city.population = monthlyGrowth(city.population, avg, city.pollution, growthPenalty(city));
    city.happiness = avg;
    const r = urbanRadius(city.population);
    if (r !== city.urbanRadius) radiusChanged = true;
    if (r > city.urbanRadius) grown.push(city);
  }
  if (radiusChanged) refreshUrbanTiles(state);
  // a city that spreads lays streets in its new ring (in city order, so deterministic), after the
  // urban tiles are re-marked so overlapping discs keep to their own land
  for (const city of grown) newStreets.push(...layCityStreets(state.map, city, state.layers[LANDMARK_LAYER]));
  if (newStreets.length > 0) ctx.bus.emit({ type: 'roadChanged', tiles: newStreets });
  for (const b of Object.values(state.buildings)) b.producedThisMonth = {};
}
