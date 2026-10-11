import { recordSale } from './scenarios';
import { onSale } from './contracts';
import { BUILDINGS } from '../data/buildings';
import { DEMAND_PER_1000 } from '../data/goods';
import { RECIPES } from '../data/recipes';
import { compareDates, dateToDays, isSummer, isWinter } from './clock';
import { currentLedger, earn, spend } from './finance';
import { loadSource } from './inventory';
import { RAIL_UPKEEP } from './rail';
import { computeDailySales, monthlyDemand, monthlyGrowth, satisfaction, updateMarketDay, urbanRadius, type StoreStock } from './market';
import { footprint, refreshUrbanTiles } from './state';
import type { Building, GameState, GoodId, SimContext } from './types';

/** Product of active (unexpired) modifiers matching the good (or '*') and the city (or null). */
export function demandModifier(state: GameState, cityId: number, goodId: GoodId): number {
  let f = 1;
  for (const m of state.modifiers) {
    if (compareDates(m.until, state.date) <= 0) continue;
    if (m.goodId !== '*' && m.goodId !== goodId) continue;
    if (m.cityId !== null && m.cityId !== cityId) continue;
    f *= m.factor;
  }
  return f;
}

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
  for (const b of Object.values(state.buildings)) {
    const def = BUILDINGS[b.typeId];
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
    if (def.category === 'extractor') {
      const eff = extractorEfficiency(state, b, outs);
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
    b.progress += 1 / recipe.days;
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
  for (const owner of ['player', 'rival'] as const) {
    const company = state.companies[owner];
    let total = 0;
    for (const b of Object.values(state.buildings)) if (b.ownerId === owner) total += BUILDINGS[b.typeId].maintenance;
    total += company.roadTiles * 5 + company.railTiles * RAIL_UPKEEP;
    if (total > 0) spend(company, 'maintenance', total, state.date);
  }
}

export function growthMonth(ctx: SimContext): void {
  const { state } = ctx;
  // urban tiles depend only on each city's radius: re-mark them only when some radius changes
  let radiusChanged = false;
  for (const city of state.cities) {
    const sats = Object.keys(DEMAND_PER_1000)
      .filter((g) => monthlyDemand(city, g, state.date.year, demandModifier(state, city.id, g)) > 0)
      .map((g) => satisfaction(city, g));
    const avg = sats.length > 0 ? sats.reduce((a, b) => a + b, 0) / sats.length : 0.4;
    city.prevPopulation = city.population;
    city.population = monthlyGrowth(city.population, avg, city.pollution);
    city.happiness = avg;
    if (urbanRadius(city.population) !== city.urbanRadius) radiusChanged = true;
  }
  if (radiusChanged) refreshUrbanTiles(state);
  for (const b of Object.values(state.buildings)) b.producedThisMonth = {};
}
