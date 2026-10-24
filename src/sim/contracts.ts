import { recordContractDone } from './scenarios';
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { GOODS } from '../data/goods';
import { addDays, compareDates, dateToDays } from './clock';
import { earn } from './finance';
import { monthlyDemand, POP_CAP, satisfaction } from './market';
import { publishNews } from './news';
import { random } from './rng';
import { nextId } from './state';
import { atPrices } from './society/economy';
// a pure, DOM-free leaf: inflated rewards read "$1.2M" like every other figure in the game
import { formatMoney } from '../core/money';
import type { Contract, GameState, GoodId, OwnerId, SimContext } from './types';

export const MAX_ACTIVE = 3;
export const MAX_OFFERED = 3;
export const MAX_FINISHED = 30;
export const OFFER_EXPIRY_DAYS = 60;
export const CONTRACT_DAYS = 120;

/** Phrases per good for the mayor's plea headline. */
const PLEAS: Record<string, string> = { bread: 'bread' };

export interface SaleLike {
  cityId: number;
  goodId: GoodId;
  qty: number;
  ownerId: OwnerId;
}

/** Counts a player sale toward every active contract for that city and good. */
export function onSale(state: GameState, sale: SaleLike): void {
  if (sale.ownerId !== 'player') return;
  for (const c of state.contracts) {
    if (c.status === 'active' && c.cityId === sale.cityId && c.goodId === sale.goodId) c.delivered += sale.qty;
  }
}

function offeredCount(state: GameState): number {
  return state.contracts.filter((c) => c.status === 'offered').length;
}

/** Offers one new contract (when fewer than 3 are on the board): a low-satisfaction tier-2 good in some city. */
export function offerContracts(ctx: SimContext): Contract | null {
  const { state } = ctx;
  if (offeredCount(state) >= MAX_OFFERED) return null;
  const open = new Set(
    state.contracts.filter((c) => c.status === 'offered' || c.status === 'active').map((c) => `${c.cityId}:${c.goodId}`),
  );
  const options: { cityId: number; goodId: GoodId; monthly: number }[] = [];
  for (const city of state.cities) {
    for (const g of Object.values(GOODS)) {
      if (g.kind !== 'consumer' || !state.unlocked.includes(g.id)) continue;
      if (open.has(`${city.id}:${g.id}`)) continue;
      const monthly = monthlyDemand(city, g.id, state.date.year);
      if (monthly > 0 && satisfaction(city, g.id) < 0.6) options.push({ cityId: city.id, goodId: g.id, monthly });
    }
  }
  if (options.length === 0) return null;
  const o = options[Math.min(options.length - 1, Math.floor(random(state) * options.length))];
  const good = GOODS[o.goodId];
  const city = state.cities[o.cityId];
  const qty = Math.max(1, Math.round(o.monthly * 1.5));
  const contract: Contract = {
    id: nextId(state),
    cityId: o.cityId,
    goodId: o.goodId,
    qty,
    delivered: 0,
    deadline: addDays(state.date, CONTRACT_DAYS),
    reward: Math.round(atPrices(state, qty * good.basePrice * 1.5)),
    status: 'offered',
  };
  state.contracts.push(contract);
  const what = PLEAS[o.goodId] ?? good.name.toLowerCase();
  publishNews(
    ctx,
    'contract',
    `Mayor of ${city.name} pleads for ${what}!`,
    `${city.name} is short of ${what}. The mayor offers ${formatMoney(contract.reward)} for ${qty} delivered within four months.`,
  );
  ctx.bus.emit({ type: 'contract', contractId: contract.id, status: 'offered' });
  return contract;
}

export function acceptContract(ctx: SimContext, id: number): Result {
  const c = ctx.state.contracts.find((x) => x.id === id);
  if (!c) return err('No such contract');
  if (c.status !== 'offered') return err('Contract is not on offer');
  if (ctx.state.contracts.filter((x) => x.status === 'active').length >= MAX_ACTIVE) return err('Too many active contracts');
  c.status = 'active';
  ctx.bus.emit({ type: 'contract', contractId: c.id, status: 'active' });
  return ok();
}

/** Daily: completes/fails active contracts, expires stale offers, trims history, and offers on odd months' day 1. */
export function contractsDay(ctx: SimContext): void {
  const { state, bus } = ctx;
  const today = dateToDays(state.date);
  for (const c of state.contracts) {
    if (c.status !== 'active') continue;
    const city = state.cities[c.cityId];
    const name = GOODS[c.goodId]?.name ?? c.goodId;
    if (c.delivered >= c.qty) {
      c.status = 'done';
      earn(state.companies.player, 'contracts', c.reward, state.date);
      if (city) city.population = Math.min(POP_CAP, Math.round(city.population * 1.05));
      recordContractDone(state);
      bus.emit({ type: 'contract', contractId: c.id, status: 'done' });
      bus.emit({ type: 'toast', message: `Contract complete: ${city?.name} thanks you for the ${name}! +${formatMoney(c.reward)}`, tone: 'good' });
    } else if (compareDates(state.date, c.deadline) > 0) {
      c.status = 'failed';
      if (city) city.happiness = Math.max(0, city.happiness - 0.1);
      bus.emit({ type: 'contract', contractId: c.id, status: 'failed' });
      bus.emit({ type: 'toast', message: `Contract failed: ${city?.name} is disappointed about the ${name}`, tone: 'bad' });
    }
  }
  // unaccepted offers lapse 60 days after they were made (deadline = offer date + 120 days)
  state.contracts = state.contracts.filter(
    (c) => !(c.status === 'offered' && dateToDays(c.deadline) - today < CONTRACT_DAYS - OFFER_EXPIRY_DAYS),
  );
  // keep at most MAX_FINISHED finished contracts (drop oldest first; array order is creation order)
  const finished = state.contracts.filter((c) => c.status === 'done' || c.status === 'failed');
  if (finished.length > MAX_FINISHED) {
    const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED));
    state.contracts = state.contracts.filter((c) => !drop.has(c));
  }
  if (state.date.day === 1 && state.date.month % 2 === 1) offerContracts(ctx);
}

export const contractsSystem = {
  id: 'contracts',
  // deliveries are counted by retailDay calling onSale directly, so no bus listener is needed
  onDay(ctx: SimContext): void {
    contractsDay(ctx);
  },
};
