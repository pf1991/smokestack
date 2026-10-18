/**
 * Phase 4 share holdings. `moveShares` is the only writer of a listing's holdings (pinned in
 * funnels.test.ts); `listCompany` creates a listing and `delist` retires one.
 */
import { companyIds } from '../companies';
import { earn, spend } from '../finance';
import type { GameState, OwnerId } from '../types';
import { fundamental, listingPrice } from './prices';
import { FOUNDER_SHARES, PUBLIC_HOLDER, SHARES_OUTSTANDING, type Listing } from './types';

/**
 * Moves `n` shares of `id` from one holder to another. Throws on an unknown listing or a negative,
 * fractional or overdrawn move: those are sim bugs, never player input. A holding that reaches 0 is
 * removed.
 */
export function moveShares(state: GameState, id: OwnerId, from: OwnerId, to: OwnerId, n: number): void {
  const l = state.exchange.listings[id];
  if (!l) throw new Error(`moveShares: ${id} is not listed`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`moveShares: bad share count ${n}`);
  const have = l.holders[from] ?? 0;
  if (n > have) throw new Error(`moveShares: ${from} holds ${have} of ${id}, cannot move ${n}`);
  if (n === 0 || from === to) return;
  if (have === n) delete l.holders[from];
  else l.holders[from] = have - n;
  l.holders[to] = (l.holders[to] ?? 0) + n;
}

/**
 * Lists a company (on creation, founding or migration): FOUNDER_SHARES held by the company itself
 * (the founding family's treasury stock), the rest by the public, priced at its fundamental with
 * neutral sentiment. Keeps the listings keyed in companyIds order, so the daily draw follows it.
 */
export function listCompany(state: GameState, id: OwnerId): Listing {
  if (!state.companies[id]) throw new Error(`listCompany: unknown company ${id}`);
  if (state.exchange.listings[id]) throw new Error(`listCompany: ${id} is already listed`);
  const l: Listing = {
    shares: SHARES_OUTSTANDING,
    holders: { [id]: FOUNDER_SHARES, [PUBLIC_HOLDER]: SHARES_OUTSTANDING - FOUNDER_SHARES },
    price: 0,
    fundamental: 0,
    sentiment: 1,
    history: [],
    listed: true,
  };
  const old = state.exchange.listings;
  const listings: Record<OwnerId, Listing> = {};
  for (const k of companyIds(state)) {
    if (k === id) listings[k] = l;
    else if (old[k]) listings[k] = old[k];
  }
  state.exchange.listings = listings;
  l.fundamental = fundamental(state, id);
  l.price = listingPrice(l);
  return l;
}

/**
 * Delists a company (taken over, closed or never active): every non-public holding returns to the
 * public and the price freezes where it stands.
 */
export function delist(state: GameState, id: OwnerId): void {
  const l = state.exchange.listings[id];
  if (!l) return;
  l.listed = false;
  for (const holder of Object.keys(l.holders)) {
    if (holder !== PUBLIC_HOLDER) moveShares(state, id, holder, PUBLIC_HOLDER, l.holders[holder]);
  }
}

/**
 * A company taken over hands its portfolio to the buyer: every share it holds in another listing
 * moves to `to` (its holding in itself is left for `delist`). Listings are visited in key order.
 */
export function handOverHoldings(state: GameState, from: OwnerId, to: OwnerId): void {
  const listings = state.exchange.listings;
  for (const id in listings) {
    if (id === from) continue;
    const n = listings[id].holders[from] ?? 0;
    if (n > 0) moveShares(state, id, from, to, n);
  }
}

/**
 * Winds up the treasury of `target`, taken over by `buyer` (exchange/trading.ts absorb, rival/takeover.ts
 * takeover), before its assets pass whole through transferOwnership:
 * - its cash first settles its loan;
 * - the net cash left (money − loan, when positive) goes out as a liquidating distribution, booked on
 *   the target under 'dividends' (outside operating profit): each active company holding its shares,
 *   the buyer among them, receives its holding / shares part (the buyer under 'shares', a takeover
 *   settlement; any other holder under 'dividends'), in listing key order; the public's part and the
 *   target's own treasury part leave the economy;
 * - debts beyond its cash (money − loan below 0) are assumed by the buyer, who pays them off under
 *   'shares' (the creditors are paid in full).
 * The target ends with no money and no loan. Call it before handOverHoldings and delist.
 */
export function windUp(state: GameState, target: OwnerId, buyer: OwnerId): void {
  const t = state.companies[target];
  const to = state.companies[buyer];
  const net = t.money - t.loan;
  if (net > 0) {
    spend(t, 'dividends', net, state.date);
    const l = state.exchange.listings[target];
    if (l) {
      for (const holder in l.holders) {
        if (holder === target || holder === PUBLIC_HOLDER) continue;
        const c = state.companies[holder];
        if (!c || !c.active) continue;
        const part = Math.round((net * l.holders[holder]) / l.shares);
        if (part > 0) earn(c, holder === buyer ? 'shares' : 'dividends', part, state.date);
      }
    }
  } else if (net < 0) spend(to, 'shares', -net, state.date);
  // the loan is settled (from the cash left after the distribution, or by the buyer)
  t.money = 0;
  t.loan = 0;
}
