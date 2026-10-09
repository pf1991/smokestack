import { DEMAND_PER_1000, GOODS } from '../data/goods';
import type { City, GoodId, Inventory, MarketEntry, OwnerId } from './types';

export interface StoreStock {
  buildingId: number;
  ownerId: OwnerId;
  stock: Inventory;
}

export interface Sale {
  buildingId: number;
  ownerId: OwnerId;
  goodId: GoodId;
  qty: number;
  revenue: number;
}

const EPS = 1e-9;

export function lifecycleFactor(goodId: GoodId, year: number): number {
  const g = GOODS[goodId];
  if (!g) return 0;
  if (year < g.era) return 0;
  if (g.fadeYear === null || year <= g.fadeYear) return 1;
  const t = Math.min(1, (year - g.fadeYear) / 10);
  return 1 - 0.8 * t;
}

export function monthlyDemand(city: City, goodId: GoodId, year: number, modifier = 1): number {
  const per = DEMAND_PER_1000[goodId];
  if (per === undefined) return 0;
  return (city.population / 1000) * per * lifecycleFactor(goodId, year) * modifier;
}

export function salePrice(goodId: GoodId, ratio: number): number {
  const base = GOODS[goodId]?.basePrice ?? 0;
  const f = Math.min(1.5, Math.max(0.5, 1.5 - 0.75 * ratio));
  return Math.max(1, Math.round(base * f));
}

export function supplyRatio(entry: MarketEntry | undefined): number {
  if (!entry || entry.demand30 <= 0) return 0;
  return entry.sold30 / entry.demand30;
}

export function computeDailySales(
  city: City,
  stores: StoreStock[],
  year: number,
  demandMod: (goodId: GoodId) => number,
): Sale[] {
  const out: Sale[] = [];
  for (const goodId of Object.keys(DEMAND_PER_1000)) {
    const monthly = monthlyDemand(city, goodId, year, demandMod(goodId));
    const entry = (city.market[goodId] ??= { sold30: 0, demand30: 0, pending: 0 });
    if (monthly <= 0) {
      entry.pending = 0;
      continue;
    }
    const daily = monthly / 30;
    // cap is floored at 1 so very low-demand goods can still accumulate a whole unit
    entry.pending = Math.min(entry.pending + daily, Math.max(daily * 3, 1));
    let units = Math.floor(entry.pending + EPS);
    if (units <= 0) continue;
    const avail = stores.map((s) => Math.floor(s.stock[goodId] ?? 0));
    const got = stores.map(() => 0);
    // equal split; shares a store cannot fill go to stores that still have stock
    let active = avail.map((_, i) => i).filter((i) => avail[i] > 0);
    while (units > 0 && active.length > 0) {
      for (const i of active) {
        if (units <= 0) break;
        got[i]++;
        units--;
      }
      active = active.filter((i) => got[i] < avail[i]);
    }
    const price = salePrice(goodId, supplyRatio(entry));
    let soldTotal = 0;
    stores.forEach((s, i) => {
      if (got[i] > 0) {
        out.push({ buildingId: s.buildingId, ownerId: s.ownerId, goodId, qty: got[i], revenue: got[i] * price });
        soldTotal += got[i];
      }
    });
    entry.pending = Math.max(0, entry.pending - soldTotal);
  }
  return out;
}

export function updateMarketDay(city: City, goodId: GoodId, sold: number, demandToday: number): void {
  const e = (city.market[goodId] ??= { sold30: 0, demand30: 0, pending: 0 });
  e.sold30 = (e.sold30 * 29) / 30 + sold;
  e.demand30 = (e.demand30 * 29) / 30 + demandToday;
}

export function satisfaction(city: City, goodId: GoodId): number {
  const e = city.market[goodId];
  if (!e || e.demand30 <= 0) return 0;
  return Math.min(1, Math.max(0, e.sold30 / e.demand30));
}

export function monthlyGrowth(population: number, avgSatisfaction: number, pollution: number): number {
  const next = population * (1 + 0.02 * (avgSatisfaction - 0.4) - 0.01 * pollution);
  return Math.max(500, Math.round(next));
}

export function urbanRadius(population: number): number {
  return 3 + Math.floor(population / 3000);
}
