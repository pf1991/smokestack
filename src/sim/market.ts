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
/** the goods with city demand, in catalog order (static) */
const DEMAND_GOODS = Object.keys(DEMAND_PER_1000);

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
  dayOffset = 0,
): Sale[] {
  const out: Sale[] = [];
  const goodIds = DEMAND_GOODS;
  for (let gi = 0; gi < goodIds.length; gi++) {
    const goodId = goodIds[gi];
    const monthly = monthlyDemand(city, goodId, year, demandMod(goodId));
    if (monthly <= 0) {
      const existing = city.market[goodId];
      if (existing) existing.pending = 0;
      continue;
    }
    const entry = (city.market[goodId] ??= { sold30: 0, demand30: 0, pending: 0 });
    const daily = monthly / 30;
    // cap is floored at 1 so very low-demand goods can still accumulate a whole unit
    entry.pending = Math.min(entry.pending + daily, Math.max(daily * 3, 1));
    let units = Math.floor(entry.pending + EPS);
    if (units <= 0) continue;
    // fast path: no store has a whole unit of this good (the common case), so nothing sells
    let anyStock = false;
    for (const s of stores) {
      if ((s.stock[goodId] ?? 0) >= 1) {
        anyStock = true;
        break;
      }
    }
    if (!anyStock) continue;
    const avail = stores.map((s) => Math.floor(s.stock[goodId] ?? 0));
    const got = stores.map(() => 0);
    // equal split; shares a store cannot fill go to stores that still have stock
    let active = avail.map((_, i) => i).filter((i) => avail[i] > 0);
    // rotate the starting store so odd units do not always favour store 0
    if (active.length > 0) {
      const start = (((dayOffset + gi) % active.length) + active.length) % active.length;
      active = [...active.slice(start), ...active.slice(0, start)];
    }
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

/** Cities stop growing here; supply-driven growth slows logistically as they approach it. */
export const POP_CAP = 80_000;
/** Largest urban radius, so big late-game cities don't swallow the map. */
export const MAX_URBAN_RADIUS = 16;

/** `penalty` is taken off the monthly rate (the smog tier-2 health penalty, society/tiers.ts). */
export function monthlyGrowth(population: number, avgSatisfaction: number, pollution: number, penalty = 0): number {
  const room = Math.max(0, 1 - population / POP_CAP);
  const next = population * (1 + 0.015 * avgSatisfaction * room - 0.01 * pollution - penalty);
  return Math.min(POP_CAP, Math.max(500, Math.round(next)));
}

export function urbanRadius(population: number): number {
  return Math.min(MAX_URBAN_RADIUS, 3 + Math.floor(Math.sqrt(population / 250)));
}
