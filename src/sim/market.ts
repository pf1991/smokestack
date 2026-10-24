import { BASELINE_GOODS, CLASS_DEMAND, DEMAND_PER_1000, GOODS, type GoodDef } from '../data/goods';
import { compareDates } from './clock';
import type { City, CityClasses, GameState, GoodId, Inventory, MarketEntry, OwnerId } from './types';

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
  return lifecycleOf(GOODS[goodId], year);
}

function lifecycleOf(g: GoodDef | undefined, year: number): number {
  if (!g) return 0;
  if (year < g.era) return 0;
  if (g.fadeYear === null || year <= g.fadeYear) return 1;
  const t = Math.min(1, (year - g.fadeYear) / 10);
  return 1 - 0.8 * t;
}

/** The class mix every town starts with (Phase 3 Task 7, sim/society/classes.ts). */
export const INITIAL_CLASSES: Readonly<CityClasses> = Object.freeze({ working: 0.75, middle: 0.2, upper: 0.05 });

const classMix = (c: Readonly<CityClasses>, m: Readonly<CityClasses>): number => c.working * m.working + c.middle * m.middle + c.upper * m.upper;

/** Each demand good's class normaliser sum(initial share × multiplier), precomputed once. */
const CLASS_NORM: Record<GoodId, number> = {};
for (const g of DEMAND_GOODS) CLASS_NORM[g] = classMix(INITIAL_CLASSES, CLASS_DEMAND[g]);

/**
 * Demand scale of `goodId` for a town with class mix `c`: sum(share × multiplier) over
 * sum(initial share × multiplier), so exactly 1 at the initial mix (a 1900 town keeps its v1
 * demand). Pure and allocation-free; 1 for a good without class multipliers.
 */
export function classDemandFactor(c: Readonly<CityClasses>, goodId: GoodId): number {
  const m = CLASS_DEMAND[goodId];
  const norm = CLASS_NORM[goodId];
  if (m === undefined || norm === undefined || norm <= 0) return 1;
  return classMix(c, m) / norm;
}

export function monthlyDemand(city: City, goodId: GoodId, year: number, modifier = 1): number {
  const per = DEMAND_PER_1000[goodId];
  if (per === undefined) return 0;
  return (city.population / 1000) * per * lifecycleFactor(goodId, year) * modifier * classDemandFactor(city.classes, goodId);
}

/**
 * The static per-good tables by index into DEMAND_GOODS, so the daily market loops read arrays
 * instead of looking each good up by name in four catalogues (the data modules are not mutated).
 */
const PER_1000_AT = DEMAND_GOODS.map((g) => DEMAND_PER_1000[g]);
const GOOD_AT = DEMAND_GOODS.map((g) => GOODS[g]);
const CLASS_DEMAND_AT = DEMAND_GOODS.map((g) => CLASS_DEMAND[g]);
const CLASS_NORM_AT = DEMAND_GOODS.map((g) => CLASS_NORM[g]);
const INDEX_OF = new Map<GoodId, number>(DEMAND_GOODS.map((g, gi) => [g, gi]));

/** The goods with city demand, in catalog order (`Object.keys(DEMAND_PER_1000)`). */
export function demandGoods(): readonly GoodId[] {
  return DEMAND_GOODS;
}

/** monthlyDemand of `demandGoods()[gi]`: the same figure, computed in the same order. */
export function monthlyDemandAt(city: City, gi: number, year: number, modifier = 1): number {
  const per = PER_1000_AT[gi];
  if (per === undefined) return 0;
  const m = CLASS_DEMAND_AT[gi];
  const norm = CLASS_NORM_AT[gi];
  const cls = m === undefined || norm === undefined || norm <= 0 ? 1 : classMix(city.classes, m) / norm;
  return (city.population / 1000) * per * lifecycleOf(GOOD_AT[gi], year) * modifier * cls;
}

/** Scratch marks for computeDailySales: 1 at a good's index when some store holds a whole unit. */
const stocked = new Uint8Array(DEMAND_GOODS.length);

/** Price of one unit at supply ratio `ratio`, at price index `index` (society/economy.ts), rounded. */
export function salePrice(goodId: GoodId, ratio: number, index = 1): number {
  const base = GOODS[goodId]?.basePrice ?? 0;
  const f = Math.min(1.5, Math.max(0.5, 1.5 - 0.75 * ratio));
  return Math.max(1, Math.round(base * f * index));
}

export function supplyRatio(entry: MarketEntry | undefined): number {
  if (!entry || entry.demand30 <= 0) return 0;
  return entry.sold30 / entry.demand30;
}

/**
 * A price war on one good in one town (nemesis/retaliation.ts): each round of the split, stores of
 * `favoured` take 2 units where any other store takes 1, and every unit sells at `priceFactor` × price.
 */
export interface PriceWar {
  favoured: OwnerId;
  priceFactor: number;
}

/**
 * `wars` holds the town's price wars by good (null, the common case, for none). `monthlyOut`, when
 * given, receives each demand good's monthly demand by index into `demandGoods()` (retailDay reuses it
 * for the day's market update instead of computing it again).
 */
export function computeDailySales(
  city: City,
  stores: StoreStock[],
  year: number,
  demandMod: (goodId: GoodId) => number,
  dayOffset = 0,
  index = 1,
  wars: Readonly<Partial<Record<GoodId, PriceWar>>> | null = null,
  monthlyOut: Float64Array | null = null,
): Sale[] {
  const out: Sale[] = [];
  const goodIds = DEMAND_GOODS;
  // which goods any store holds a whole unit of: one pass over each store's few stocked goods
  // instead of asking every store for every good
  stocked.fill(0);
  for (const s of stores) {
    for (const g in s.stock) {
      if (s.stock[g] >= 1) {
        const gi = INDEX_OF.get(g);
        if (gi !== undefined) stocked[gi] = 1;
      }
    }
  }
  for (let gi = 0; gi < goodIds.length; gi++) {
    const goodId = goodIds[gi];
    const monthly = monthlyDemandAt(city, gi, year, demandMod(goodId));
    if (monthlyOut) monthlyOut[gi] = monthly;
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
    if (stocked[gi] === 0) continue;
    // plain loops over the stores (no per-good closures or spread copies), in the same orders
    const ns = stores.length;
    const avail: number[] = [];
    const got: number[] = [];
    // equal split; shares a store cannot fill go to stores that still have stock
    let active: number[] = [];
    for (let i = 0; i < ns; i++) {
      avail.push(Math.floor(stores[i].stock[goodId] ?? 0));
      got.push(0);
      if (avail[i] > 0) active.push(i);
    }
    // rotate the starting store so odd units do not always favour store 0
    if (active.length > 0) {
      const start = (((dayOffset + gi) % active.length) + active.length) % active.length;
      if (start > 0) active = active.slice(start).concat(active.slice(0, start));
    }
    const war = wars?.[goodId];
    // active[0, live) are the stores still in the split
    let live = active.length;
    while (units > 0 && live > 0) {
      for (let k = 0; k < live; k++) {
        if (units <= 0) break;
        const i = active[k];
        const take = war && stores[i].ownerId === war.favoured ? Math.min(2, units, avail[i] - got[i]) : 1;
        got[i] += take;
        units -= take;
      }
      // keep the stores that still have stock, in order
      let m = 0;
      for (let k = 0; k < live; k++) if (got[active[k]] < avail[active[k]]) active[m++] = active[k];
      live = m;
    }
    const price = salePrice(goodId, supplyRatio(entry), war ? index * war.priceFactor : index);
    let soldTotal = 0;
    for (let i = 0; i < ns; i++) {
      if (got[i] > 0) {
        const s = stores[i];
        out.push({ buildingId: s.buildingId, ownerId: s.ownerId, goodId, qty: got[i], revenue: got[i] * price });
        soldTotal += got[i];
      }
    }
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

/**
 * Mean market satisfaction over the goods `city` wants this month (0.4 when it wants none), under the
 * baseline rule (R4, P4): `base` is the mean over the wanted v1 goods (`BASELINE_GOODS`, 0.4 when none
 * is wanted), and every other wanted good counts as max(its satisfaction, base). A town sold none of
 * the newer goods gets exactly its v1 figure; selling one can only raise it.
 */
export function averageSatisfaction(state: GameState, city: City): number {
  const year = state.date.year;
  let baseSum = 0;
  let baseN = 0;
  const others: number[] = [];
  for (const g of DEMAND_GOODS) {
    if (monthlyDemand(city, g, year, demandModifier(state, city.id, g)) <= 0) continue;
    const s = satisfaction(city, g);
    if (BASELINE_GOODS.has(g)) {
      baseSum += s;
      baseN++;
    } else others.push(s);
  }
  const base = baseN > 0 ? baseSum / baseN : 0.4;
  // mean of (base for each baseline good's share, max(s, base) for the others) = base + excess / n,
  // written so that no excess returns base bit for bit
  let excess = 0;
  for (const s of others) if (s > base) excess += s - base;
  return excess > 0 ? base + excess / (baseN + others.length) : base;
}

