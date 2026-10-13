import { LANDMARK_LAYER } from './landmarkTiles';
import { recordSale } from './scenarios';
import { onSale } from './contracts';
import { notePoliticsSale } from './politics/factions';
import { playerBuildingUpkeep, SMOG_LIMIT_FACTOR, smogLimited } from './politics/mayorEdicts';
import { growthPenalty, PROTEST_FACTOR } from './society/tiers';
import { protestedBuildings } from './society/escalation';
import { SLOWDOWN_FACTOR, slowedBuildings, strikeActive } from './society/strikeState';
import { strikeOver } from './society/strikes';
import { companyIds, PLAYER_ID } from './companies';
import { BUILDINGS } from '../data/buildings';
import { DEMAND_PER_1000 } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { compareDates, dateToDays, isSummer, isWinter } from './clock';
import { currentLedger, earn, spend } from './finance';
import { loadSource } from './inventory';
import { RAIL_UPKEEP } from './rail';
import { averageSatisfaction, computeDailySales, demandModifier, monthlyDemand, monthlyGrowth, updateMarketDay, urbanRadius, type StoreStock } from './market';
import { footprint, layCityStreets, refreshUrbanTiles } from './state';
import type { Building, City, GameState, GoodId, SimContext, Vec2 } from './types';

/** demandModifier and averageSatisfaction live in market.ts (a leaf for society/classes.ts); re-exported for existing importers. */
export { averageSatisfaction, demandModifier } from './market';

function extractorEfficiency(state: GameState, b: Building, outputs: string[]): number {
  const tiles = footprint(b).map((p) => state.map.tiles[p.y * state.map.width + p.x]);
  if (b.typeId === 'lumber_camp') return tiles.filter((t) => t.terrain === 'forest').length / tiles.length;
  const def = BUILDINGS[b.typeId];
  if (def.requiresDeposit) {
    const n = tiles.filter((t) => t.deposit !== null && outputs.includes(t.deposit)).length;
    return n > 0 ? Math.max(0.25, n / tiles.length) : 0;
  }
  if (b.typeId === 'farm') {
    const seasonal = outputs.some((g) => g === 'grain' || g === 'cotton' || g === 'fruit');
    if (seasonal) return isWinter(state.date.month) ? 0 : isSummer(state.date.month) ? 1.5 : 1;
  }
  return 1;
}

function addOutput(b: Building, goodId: GoodId, amount: number, cap: number): void {
  const room = Math.max(0, cap - (b.output[goodId] ?? 0));
  const add = Math.min(room, amount);
  if (add <= 0) return;
  b.output[goodId] = (b.output[goodId] ?? 0) + add;
  b.producedThisMonth[goodId] = (b.producedThisMonth[goodId] ?? 0) + add;
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
  for (const b of Object.values(state.buildings)) {
    const def = BUILDINGS[b.typeId];
    // a striking works produces nothing; on the day it ends the strike is cleared and an unanswered
    // strike card withdrawn (society/strikes.ts)
    if (b.strike) {
      if (strikeActive(b.strike, today)) {
        b.status = 'halted';
        continue;
      }
      strikeOver(ctx, b);
    }
    if (b.haltedUntil) {
      if (compareDates(b.haltedUntil, state.date) > 0) {
        b.status = 'halted';
        continue;
      }
      b.haltedUntil = null;
    }
    const recipe = b.recipeId && state.unlocked.includes(b.recipeId) ? RECIPES[b.recipeId] : undefined;
    if (!recipe || (def.category !== 'extractor' && def.category !== 'factory')) {
      b.status = 'idle';
      continue;
    }
    const outs = Object.keys(recipe.outputs);
    const rate = b.staffing * (limited.has(b.id) ? SMOG_LIMIT_FACTOR : 1) * (protested.has(b.id) ? PROTEST_FACTOR : 1) * (slowed.has(b.id) ? SLOWDOWN_FACTOR : 1);
    if (def.category === 'extractor') {
      // staffing (sim/politics/workforce.ts) scales the day's yield like terrain efficiency does
      const eff = extractorEfficiency(state, b, outs) * rate;
      for (const g of outs) addOutput(b, g, recipe.outputs[g] * eff, def.storage);
      b.status = outs.some((g) => (b.output[g] ?? 0) >= def.storage) ? 'output_full' : 'ok';
      continue;
    }
    if (outs.some((g) => (b.output[g] ?? 0) + recipe.outputs[g] > def.storage)) {
      b.status = 'output_full';
      continue;
    }
    if (!Object.entries(recipe.inputs).every(([g, q]) => (b.input[g] ?? 0) >= q)) {
      b.status = 'no_input';
      continue;
    }
    b.status = 'ok';
    b.progress += rate / recipe.days;
    if (b.progress >= 1 - 1e-9) {
      for (const [g, q] of Object.entries(recipe.inputs)) b.input[g] -= q;
      for (const g of outs) addOutput(b, g, recipe.outputs[g], def.storage);
      b.progress = Math.max(0, b.progress - 1);
    }
  }
}

export function retailDay(ctx: SimContext): void {
  const { state, bus } = ctx;
  const dayOffset = dateToDays(state.date);
  const goodIds = Object.keys(DEMAND_PER_1000);
  // stores grouped by city in one pass (id order, as a per-city filter would give)
  const storesByCity = new Map<number, Building[]>();
  for (const b of Object.values(state.buildings)) {
    if (b.cityId === null || BUILDINGS[b.typeId].category !== 'retail') continue;
    const list = storesByCity.get(b.cityId);
    if (list) list.push(b);
    else storesByCity.set(b.cityId, [b]);
  }
  for (const city of state.cities) {
    const stores = storesByCity.get(city.id) ?? [];
    const stocks: StoreStock[] = stores.map((b) => ({ buildingId: b.id, ownerId: b.ownerId, stock: loadSource(b) }));
    const mod = (g: GoodId) => demandModifier(state, city.id, g);
    const sales = computeDailySales(city, stocks, state.date.year, mod, dayOffset);
    const soldByGood: Record<GoodId, number> = {};
    const soldStores = new Set<number>();
    for (const s of sales) {
      if (s.qty > 0) soldStores.add(s.buildingId);
      const src = loadSource(state.buildings[s.buildingId]);
      src[s.goodId] = (src[s.goodId] ?? 0) - s.qty;
      const company = state.companies[s.ownerId];
      earn(company, 'sales', s.revenue, state.date);
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
    for (const g of goodIds) {
      const demandToday = monthlyDemand(city, g, state.date.year, mod(g)) / 30;
      if (demandToday > 0) updateMarketDay(city, g, soldByGood[g] ?? 0, demandToday);
    }
  }
}

export function maintenanceMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const owner of companyIds(state)) {
    const company = state.companies[owner];
    let total = 0;
    // company edicts (wages, safety, unions) and mayors' minimum wage scale the player's building upkeep only
    if (owner === PLAYER_ID) total = playerBuildingUpkeep(state);
    else for (const b of Object.values(state.buildings)) if (b.ownerId === owner) total += BUILDINGS[b.typeId].maintenance;
    total += company.roadTiles * 5 + company.railTiles * RAIL_UPKEEP;
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
