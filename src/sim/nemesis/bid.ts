/**
 * The Baron's hostile bid for the player's company (Phase 4 Task 8, plan Review Focus 2). When his
 * holding of the player's shares reaches CONTROL_SHARES (exchange/trading.ts), a bid opens: the
 * player has BID_GRACE_MONTHS months of grace, a warning card (`hostile_bid_warning`) and, at any time,
 * a buy-back at the quote (exchange/trading.ts buyBack, which can borrow the shortfall). Bought back
 * below the line, the bid is repelled and the Baron takes it as a grudge; still above it at the
 * deadline, the game is over.
 *
 * `state.nemesis.bid` is written only here. It is plain JSON (two month indexes), so the grace period
 * survives save and load; saves from before Task 8 have no bid (read as null).
 */
import { BARON_ID, PLAYER_ID } from '../companies';
import { CONTROL_SHARES } from '../exchange/types';
import { publishNews } from '../news';
import { openCardById } from '../politics/cards';
import { monthIndex } from '../politics/elections';
import type { GameState, SimContext } from '../types';
import { addGrudge } from './grudges';

/** Months between a bid opening and its deadline. */
export const BID_GRACE_MONTHS = 6;
/** The warning card a bid opens (data/cards/bid.ts). */
export const HOSTILE_BID_CARD_ID = 'hostile_bid_warning';
/** The game-over reason when the deadline passes with the Baron still in control. */
export const BARON_TAKES_YOU = 'Smogsworth has taken your company';

const baronStake = (state: GameState): number => state.exchange.listings[PLAYER_ID]?.holders[BARON_ID] ?? 0;

/** Whether the Baron's bid for the player's company is open. */
export function bidOpen(state: GameState): boolean {
  return (state.nemesis.bid ?? null) !== null;
}

/** Months left before the open bid's deadline (0 with none open). */
export function bidMonthsLeft(state: GameState): number {
  const bid = state.nemesis.bid ?? null;
  return bid ? Math.max(0, bid.deadline - monthIndex(state.date)) : 0;
}

/** Opens the bid (no-op while one is open): the grace period, the `started` event, news and the warning card. */
export function startBid(ctx: SimContext): void {
  const { state } = ctx;
  if (bidOpen(state)) return;
  const now = monthIndex(state.date);
  state.nemesis.bid = { since: now, deadline: now + BID_GRACE_MONTHS };
  ctx.bus.emit({ type: 'hostileBid', stage: 'started' });
  const firm = state.companies[PLAYER_ID].name;
  publishNews(
    ctx,
    'rival',
    `SMOGSWORTH BIDS FOR ${firm.toUpperCase()}`,
    `${state.nemesis.head.name} now holds a majority of ${firm}'s shares. Unless they are bought back within ${BID_GRACE_MONTHS} months, the company is his.`,
  );
  openCardById(ctx, HOSTILE_BID_CARD_ID, null);
}

/** Ends the open bid in the player's favour: `repelled`, news, and a `takeover_bid` grudge. */
function repel(ctx: SimContext): void {
  const { state } = ctx;
  state.nemesis.bid = null;
  ctx.bus.emit({ type: 'hostileBid', stage: 'repelled' });
  publishNews(ctx, 'rival', 'SMOGSWORTH BID REPELLED', `${state.companies[PLAYER_ID].name} has bought back its shares. ${state.nemesis.head.name} is said to be livid.`);
  addGrudge(state, 'takeover_bid', null);
}

/** After a trade in the player's shares: repels the open bid once the Baron holds less than a majority. */
export function checkBid(ctx: SimContext): void {
  if (bidOpen(ctx.state) && baronStake(ctx.state) < CONTROL_SHARES) repel(ctx);
}

/** The Baron is gone (taken over): his bid ends with him, the player's way. */
export function dropBid(ctx: SimContext): void {
  if (!bidOpen(ctx.state)) return;
  ctx.state.nemesis.bid = null;
  ctx.bus.emit({ type: 'hostileBid', stage: 'repelled' });
}

/**
 * Monthly (nemesisMonth, before he can strike again): at the end of the deadline month, the bid is
 * repelled if he holds less than a majority, otherwise lost: `gameOver`.
 */
export function bidMonth(ctx: SimContext): void {
  const { state } = ctx;
  const bid = state.nemesis.bid ?? null;
  if (!bid) return;
  if (!state.companies[BARON_ID]?.active) {
    dropBid(ctx);
    return;
  }
  if (baronStake(state) < CONTROL_SHARES) {
    repel(ctx);
    return;
  }
  if (monthIndex(state.date) < bid.deadline) return;
  state.nemesis.bid = null;
  ctx.bus.emit({ type: 'hostileBid', stage: 'lost' });
  publishNews(ctx, 'rival', `SMOGSWORTH SEIZES ${state.companies[PLAYER_ID].name.toUpperCase()}`, `${BARON_TAKES_YOU}.`);
  ctx.bus.emit({ type: 'gameOver', reason: BARON_TAKES_YOU });
  state.speed = 0;
}
