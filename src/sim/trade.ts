/**
 * R4 the Trading House and the national commodity market. A Trading House auto-sells materials and
 * components routed to it at the national bid: 0.8 × base, a drifting factor in [0.75, 1.25], a
 * saturation term shared by every house, and the price index. The live market also lets the player
 * buy (ask = bid × BUY_PREMIUM) or sell instantly into a Trading House or Warehouse.
 *
 * Drift draws come from `state.trade.rngState` (seeded from the game seed), never the main stream.
 */
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { err, ok, type Result } from '../core/result';
import { compareDates, dateToDays } from './clock';
import { onTradeSale } from './contracts';
import { spend } from './finance';
import { acceptsGood, storageLeft } from './inventory';
import { bookSale } from './production';
import { random } from './rng';
import { recordNationalSale } from './scenarios';
import { priceIndex } from './society/economy';
import { strikeActive } from './society/strikeState';
import { buildingList } from './spatial';
import {
  ABSORB_VALUE,
  BUY_PREMIUM,
  DRIFT_PULL,
  DRIFT_STEP,
  FACTOR_MAX,
  FACTOR_MIN,
  SATURATION_FLOOR,
  TRADE_DAILY_UNITS,
  TRADE_FACTOR,
} from './tradeState';
import type { Building, GameState, GoodId, OwnerId, SimContext } from './types';

/** The goods a Trading House buys: every material and component, in catalogue order. */
export const TRADE_GOODS: readonly GoodId[] = Object.freeze(
  Object.keys(GOODS).filter((g) => GOODS[g].kind === 'material' || GOODS[g].kind === 'component'),
);
const IS_TRADE_GOOD = new Set(TRADE_GOODS);

export {
  ABSORB_VALUE,
  BUY_PREMIUM,
  DRIFT_PULL,
  DRIFT_STEP,
  FACTOR_MAX,
  FACTOR_MIN,
  newTrade,
  SATURATION_FLOOR,
  TRADE_DAILY_UNITS,
  TRADE_FACTOR,
} from './tradeState';

/** Units of `g` the nation absorbs in 30 days. */
export function absorb(g: GoodId): number {
  return ABSORB_VALUE / GOODS[g].basePrice;
}

/** Today's national bid of `g` — what a Trading House pays when it sells (0 if not traded). */
export function tradePrice(state: GameState, g: GoodId): number {
  if (!IS_TRADE_GOOD.has(g)) return 0;
  const f = state.trade.factor[g] ?? 1;
  const sold = state.trade.sold30[g] ?? 0;
  const sat = Math.max(SATURATION_FLOOR, 1 - (0.5 * sold) / absorb(g));
  return Math.max(1, Math.round(GOODS[g].basePrice * TRADE_FACTOR * f * sat * priceIndex(state)));
}

/** Today's national ask of `g` — what the player pays to import one unit (0 if not traded). */
export function buyPrice(state: GameState, g: GoodId): number {
  const bid = tradePrice(state, g);
  return bid > 0 ? Math.max(1, Math.round(bid * BUY_PREMIUM)) : 0;
}

/** A player Trading House or Warehouse that can hold national-market goods. */
export function isMarketDepot(b: Building): boolean {
  const def = BUILDINGS[b.typeId];
  if (!def) return false;
  if (def.category === 'trade') return true;
  return def.category === 'logistics' && def.storage > 0;
}

/** Player depots that can receive or dispatch live market trades, in id order. */
export function marketDepots(state: GameState, owner: OwnerId = 'player'): Building[] {
  const out: Building[] = [];
  for (const b of buildingList(state)) {
    if (b.ownerId !== owner) continue;
    if (!isMarketDepot(b)) continue;
    out.push(b);
  }
  return out;
}

function noteSold(state: GameState, g: GoodId, qty: number): void {
  const prev = state.trade.sold30[g] ?? 0;
  state.trade.sold30[g] = prev + qty;
}

/** Import `qty` of `g` from the nation into a player depot at today's ask. */
export function buyFromMarket(ctx: SimContext, buildingId: number, g: GoodId, qty: number): Result<{ paid: number; qty: number }> {
  const n = Math.floor(qty);
  if (n < 1) return err('Buy at least one unit');
  if (!IS_TRADE_GOOD.has(g)) return err('The nation does not trade that good');
  const b = ctx.state.buildings[buildingId];
  if (!b) return err('Building gone');
  if (b.ownerId !== 'player') return err('Not yours');
  if (!isMarketDepot(b)) return err('Only a Trading House or Warehouse can trade');
  if (!acceptsGood(b, g)) return err('This building cannot store that');
  const room = storageLeft(b, g);
  if (room < 1) return err('No storage room');
  const take = Math.min(n, room);
  const unit = buyPrice(ctx.state, g);
  if (unit <= 0) return err('No quote today');
  const paid = take * unit;
  const company = ctx.state.companies.player;
  if (company.money < paid) return err('Not enough cash');
  spend(company, 'goods', paid, ctx.state.date);
  b.input[g] = (b.input[g] ?? 0) + take;
  // imports tighten the market a little: undo glut so bids do not keep falling while you buy
  const prev = ctx.state.trade.sold30[g] ?? 0;
  if (prev > 0) ctx.state.trade.sold30[g] = Math.max(0, prev - take);
  ctx.bus.emit({ type: 'toast', message: `Bought ${take} ${GOODS[g].name} for $${paid.toLocaleString('en-US')}`, tone: 'good' });
  return ok({ paid, qty: take });
}

/**
 * Sell `qty` of `g` from a player depot to the nation at today's bid (instant; the house's daily
 * auto-sell still runs as well).
 */
export function sellToMarket(ctx: SimContext, buildingId: number, g: GoodId, qty: number): Result<{ revenue: number; qty: number }> {
  const n = Math.floor(qty);
  if (n < 1) return err('Sell at least one unit');
  if (!IS_TRADE_GOOD.has(g)) return err('The nation does not trade that good');
  const b = ctx.state.buildings[buildingId];
  if (!b) return err('Building gone');
  if (b.ownerId !== 'player') return err('Not yours');
  if (!isMarketDepot(b)) return err('Only a Trading House or Warehouse can trade');
  const have = Math.floor(b.input[g] ?? 0);
  if (have < 1) return err('Nothing in stock');
  const take = Math.min(n, have);
  const unit = tradePrice(ctx.state, g);
  if (unit <= 0) return err('No quote today');
  b.input[g] = have - take;
  if (b.input[g]! <= 0) delete b.input[g];
  const revenue = take * unit;
  bookSale(ctx.state, b, g, revenue);
  recordNationalSale(ctx.state, { ownerId: b.ownerId, goodId: g, qty: take });
  onTradeSale(ctx.state, { ownerId: b.ownerId, goodId: g, qty: take });
  noteSold(ctx.state, g, take);
  ctx.bus.emit({
    type: 'sale',
    cityId: b.cityId ?? -1,
    goodId: g,
    qty: take,
    revenue,
    ownerId: b.ownerId,
    buildingId: b.id,
  });
  ctx.bus.emit({ type: 'toast', message: `Sold ${take} ${GOODS[g].name} for $${revenue.toLocaleString('en-US')}`, tone: 'good' });
  return ok({ revenue, qty: take });
}

/** A house that cannot trade today: halted, upgrading or on strike. */
function closed(state: GameState, b: Building, today: number): boolean {
  if (b.status === 'halted' || b.status === 'upgrading') return true;
  if (b.works) return true;
  if (b.haltedUntil && compareDates(b.haltedUntil, state.date) > 0) return true;
  return strikeActive(b.strike, today);
}

/** Daily: every Trading House sells, then saturation decays and every price factor drifts. */
export function tradeDay(ctx: SimContext): void {
  const { state, bus } = ctx;
  const trade = state.trade;
  const today = dateToDays(state.date);
  // 1. sales, every unit at the price the day opened with
  const price: Record<GoodId, number> = {};
  const soldToday: Record<GoodId, number> = {};
  let priced = false;
  for (const b of buildingList(state)) {
    if (BUILDINGS[b.typeId]?.category !== 'trade') continue;
    if (closed(state, b, today)) continue;
    if (!priced) {
      for (const g of TRADE_GOODS) price[g] = tradePrice(state, g);
      priced = true;
    }
    const cap = Math.floor(TRADE_DAILY_UNITS * b.staffing);
    const held = TRADE_GOODS.filter((g) => (b.input[g] ?? 0) >= 1);
    const sold: Record<GoodId, number> = {};
    let total = 0;
    // one unit of each held good per round, in catalogue order, until the cap or the stock runs out
    for (let more = true; more && total < cap; ) {
      more = false;
      for (const g of held) {
        if (total >= cap) break;
        if ((b.input[g] ?? 0) - (sold[g] ?? 0) < 1) continue;
        sold[g] = (sold[g] ?? 0) + 1;
        total++;
        more = true;
      }
    }
    for (const g of held) {
      const qty = sold[g] ?? 0;
      if (qty <= 0) continue;
      b.input[g] -= qty;
      const revenue = qty * price[g];
      bookSale(state, b, g, revenue);
      recordNationalSale(state, { ownerId: b.ownerId, goodId: g, qty });
      onTradeSale(state, { ownerId: b.ownerId, goodId: g, qty });
      bus.emit({ type: 'sale', cityId: b.cityId ?? -1, goodId: g, qty, revenue, ownerId: b.ownerId, buildingId: b.id });
      soldToday[g] = (soldToday[g] ?? 0) + qty;
    }
    b.status = total > 0 ? 'ok' : 'idle';
  }
  // 2. saturation: about a month's national sales
  for (const g of TRADE_GOODS) {
    const prev = trade.sold30[g];
    const now = soldToday[g] ?? 0;
    if (prev === undefined && now === 0) continue;
    trade.sold30[g] = ((prev ?? 0) * 29) / 30 + now;
  }
  // 3. drift: exactly one draw per good, in catalogue order
  for (const g of TRADE_GOODS) {
    const f = trade.factor[g] ?? 1;
    const next = f + (random(trade) - 0.5) * DRIFT_STEP + DRIFT_PULL * (1 - f);
    trade.factor[g] = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, next));
  }
}
