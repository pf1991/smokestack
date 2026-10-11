import type { Result } from '../../core/result';
import { err, ok } from '../../core/result';
import { transferOwnership } from '../companies';
import { earn, spend } from '../finance';
import { publishNews } from '../news';
import { assetValue } from '../state';
import type { GameState, OwnerId, SimContext } from '../types';
import { clearProjectFlags } from './projects';

const TAKEOVER_MULTIPLE = 3;
const TAKEOVER_MIN_WORTH = 1_000_000;
const TAKEOVER_PREMIUM = 1.2;

export function netWorth(state: GameState, owner: OwnerId): number {
  const c = state.companies[owner];
  return c.money - c.loan + assetValue(state, owner);
}

export function canTakeover(state: GameState): boolean {
  if (!state.companies.rival.active) return false;
  const mine = netWorth(state, 'player');
  return mine >= TAKEOVER_MIN_WORTH && mine >= TAKEOVER_MULTIPLE * netWorth(state, 'rival');
}

export function takeoverPrice(state: GameState): number {
  return Math.max(0, Math.round(TAKEOVER_PREMIUM * netWorth(state, 'rival')));
}

/** Buys out the Baron: every rival building, route, vehicle and road passes to the player. */
export function takeover(ctx: SimContext): Result<{ price: number }> {
  const { state } = ctx;
  if (!canTakeover(state)) return err('Your net worth must be 3× the Baron’s and at least $1,000,000');
  const price = takeoverPrice(state);
  const player = state.companies.player;
  const rival = state.companies.rival;
  if (player.money < price) return err('Not enough money');
  spend(player, 'events', price, state.date);
  // the deal includes the Baron's treasury and his debts: his cash minus his loan goes to the buyer
  const cash = rival.money - rival.loan;
  if (cash >= 0) earn(player, 'events', cash, state.date);
  else spend(player, 'events', -cash, state.date);
  rival.money = 0;
  rival.loan = 0;
  transferOwnership(ctx, 'rival', 'player');
  rival.active = false;
  state.rivalProject = null;
  state.rivalRail = null;
  clearProjectFlags(state);
  state.flags.takeover = true;
  ctx.bus.emit({ type: 'achievement', id: 'baron_busted' });
  publishNews(
    ctx,
    'rival',
    'SMOGSWORTH OUSTED!',
    `${player.name} completes a hostile takeover of Smogsworth Consolidated for ${price.toLocaleString('en-US')} dollars. ` +
      'The Baron was last seen shaking his cane at the board and hailing a cab, monocle dangling.',
  );
  return ok({ price });
}

