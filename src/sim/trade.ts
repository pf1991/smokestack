/**
 * R4 the Trading House and the national market. A Trading House sells the materials and components
 * routed to it at a national price: 0.8 × base, a drifting factor in [0.75, 1.25], a saturation term
 * shared by every house in the country, and the price index. Nothing can be bought here, so the best
 * a hoarder can do is sell at base × 0.8 × 1.25, the base price.
 *
 * Drift draws come from `state.trade.rngState` (seeded from the game seed), never the main stream.
 */
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { compareDates, dateToDays } from './clock';
import { onTradeSale } from './contracts';
import { bookSale } from './production';
import { random } from './rng';
import { recordNationalSale } from './scenarios';
import { priceIndex } from './society/economy';
import { strikeActive } from './society/strikeState';
import { buildingList } from './spatial';
import { ABSORB_VALUE, DRIFT_PULL, DRIFT_STEP, FACTOR_MAX, FACTOR_MIN, SATURATION_FLOOR, TRADE_DAILY_UNITS, TRADE_FACTOR } from './tradeState';
import type { Building, GameState, GoodId, SimContext } from './types';

/** The goods a Trading House buys: every material and component, in catalogue order. */
export const TRADE_GOODS: readonly GoodId[] = Object.freeze(
  Object.keys(GOODS).filter((g) => GOODS[g].kind === 'material' || GOODS[g].kind === 'component'),
);
const IS_TRADE_GOOD = new Set(TRADE_GOODS);

export {
  ABSORB_VALUE,
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

/** Today's national price of `g` (0 for a good no Trading House buys). */
export function tradePrice(state: GameState, g: GoodId): number {
  if (!IS_TRADE_GOOD.has(g)) return 0;
  const f = state.trade.factor[g] ?? 1;
  const sold = state.trade.sold30[g] ?? 0;
  const sat = Math.max(SATURATION_FLOOR, 1 - (0.5 * sold) / absorb(g));
  return Math.max(1, Math.round(GOODS[g].basePrice * TRADE_FACTOR * f * sat * priceIndex(state)));
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
