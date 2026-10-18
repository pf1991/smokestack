import type { Result } from '../../core/result';
import { err, ok } from '../../core/result';
import { transferOwnership } from '../companies';
import { delist, handOverHoldings, windUp } from '../exchange/shares';
import { publishNews } from '../news';
import type { SimContext } from '../types';
import { clearProjectFlags } from './shared';

/** Book net worth and wealth live in state.ts (a leaf for the exchange); re-exported for older callers. */
export { netWorth, wealth } from '../state';

/**
 * Completes the takeover of the Baron once the player holds a majority of his shares
 * (exchange/trading.ts buyShares calls it; the shares were the price, so nothing more is charged).
 * His treasury is wound up first (exchange/shares.ts windUp): his loan is settled, and the player gets
 * only its holding's share of his net cash (the other holders are paid out, the rest leaves the
 * economy); debts beyond his cash fall to the player. Every rival building, route, vehicle and road
 * passes to the player whole, his share holdings too, and his company is delisted. An open hostile bid of his ends
 * with him (exchange/trading.ts drops it; nemesis/bid.ts bidMonth too, for a direct call).
 */
export function takeover(ctx: SimContext): Result {
  const { state } = ctx;
  const player = state.companies.player;
  const rival = state.companies.rival;
  if (!rival?.active) return err('Smogsworth is already out of business');
  windUp(state, 'rival', 'player');
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
