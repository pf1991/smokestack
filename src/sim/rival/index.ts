/**
 * Baron Cornelius Smogsworth: the rival tycoon. He plays by the same rules as the player (same
 * placement, road, route and truck API, paying with `'rival'` money) and never cheats: no free
 * buildings, no hidden income. One project at a time, one building per month.
 */
import type { SimContext } from '../types';
import { chooseProject } from './market';
import {
  advanceProject, clearProjectFlags, manageLoans, maxRivalChains, renewOldAssets, repayLoans, rivalChainCount, topUpTrucks,
} from './projects';
import { advanceRail, retryScrap, startRailProject } from './railways';

/** The Baron's monthly turn (no-op once he is inactive). */
export function rivalMonth(ctx: SimContext): void {
  const { state } = ctx;
  const rival = state.companies.rival;
  if (!rival.active) return;
  manageLoans(ctx);
  retryScrap(ctx);
  if (!state.rivalProject && !state.rivalRail && rivalChainCount(state) < maxRivalChains(state.date.year)) {
    const pick = chooseProject(state);
    if (pick) {
      state.rivalProject = { cityId: pick.city.id, goodId: pick.goodId, stage: 0 };
      clearProjectFlags(state);
    }
  }
  if (state.rivalProject) advanceProject(ctx);
  if (!state.rivalProject && !state.rivalRail) startRailProject(ctx);
  if (state.rivalRail) advanceRail(ctx);
  topUpTrucks(ctx);
  renewOldAssets(ctx);
  repayLoans(ctx);
}


export { chainFor } from './chains';
export { canTakeover, netWorth, takeover, takeoverPrice } from './takeover';
export { rivalSupply, chooseProject } from './market';
export { maxRivalChains, rivalChainCount } from './projects';
export { MAX_STALL_MONTHS, RIVAL_RESERVE } from './shared';
export { RAIL_MIN_LEG, maxRivalRailLines, rivalRailLines } from './railways';
export { TAUNTS, TAUNT_CHANCE, rivalTaunt } from './taunts';
