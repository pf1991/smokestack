import type { Result } from '../../core/result';
import { err, ok } from '../../core/result';
import { transferOwnership } from '../companies';
import { earn, spend } from '../finance';
import { delist, handOverHoldings } from '../exchange/shares';
import { publishNews } from '../news';
import { assetValue } from '../state';
import type { GameState, OwnerId, SimContext } from '../types';
import { clearProjectFlags } from './shared';

export function netWorth(state: GameState, owner: OwnerId): number {
  const c = state.companies[owner];
  return c.money - c.loan + assetValue(state, owner);
}

/**
 * Completes the takeover of the Baron once the player holds a majority of his shares
 * (exchange/trading.ts buyShares calls it; the shares were the price, so nothing more is charged).
 * The deal brings his treasury net of his debts; every rival building, route, vehicle and road passes
 * to the player, his share holdings too, and his company is delisted. An open hostile bid of his ends
 * with him (exchange/trading.ts drops it; nemesis/bid.ts bidMonth too, for a direct call).
 */
export function takeover(ctx: SimContext): Result {
  const { state } = ctx;
  const player = state.companies.player;
  const rival = state.companies.rival;
  if (!rival?.active) return err('Smogsworth is already out of business');
  // the deal includes the Baron's treasury and his debts: his cash minus his loan goes to the buyer
  const cash = rival.money - rival.loan;
  if (cash >= 0) earn(player, 'shares', cash, state.date);
  else spend(player, 'shares', -cash, state.date);
  rival.money = 0;
  rival.loan = 0;
  transferOwnership(ctx, 'rival', 'player');
  rival.active = false;
  handOverHoldings(state, 'rival', 'player');
  delist(state, 'rival');
  state.rivalProject = null;
  state.rivalRail = null;
  clearProjectFlags(state);
  state.flags.takeover = true;
  ctx.bus.emit({ type: 'achievement', id: 'baron_busted' });
  publishNews(
    ctx,
    'rival',
    'SMOGSWORTH OUSTED!',
    `${player.name} completes a hostile takeover of Smogsworth Consolidated, having bought a majority of his shares. ` +
      'The Baron was last seen shaking his cane at the board and hailing a cab, monocle dangling.',
  );
  return ok();
}
