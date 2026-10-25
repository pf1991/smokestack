import type { SimContext } from '../types';
import { aiLogisticsMonth, hubReserveOf } from './ai';
import { autoRoutesDay } from './autoRoutes';
import { autoSizeRoutesMonth } from './autoSize';
import { hubAutoSizeMonth, hubsDay } from './hubs';
import { hubTrunkDay } from './hubTrunk';
import { worksDay } from './levels';
import { refreshMarket, retireYear, salariesMonth } from './managers';
import { raiseYear } from './raises';

/** Phase 4b logistics system hooks (each early-outs when no company uses the feature). */
export function logisticsDay(ctx: SimContext): void {
  worksDay(ctx);
  autoRoutesDay(ctx);
  hubsDay(ctx);
  hubTrunkDay(ctx);
}
export function logisticsMonth(ctx: SimContext): void {
  autoSizeRoutesMonth(ctx);
  hubAutoSizeMonth(ctx, hubReserveOf);
  salariesMonth(ctx);
  aiLogisticsMonth(ctx);
}
/** Year end (the date is still December): retire, then raise requests, then the next year's market. */
export function logisticsYear(ctx: SimContext): void {
  retireYear(ctx);
  raiseYear(ctx);
  refreshMarket(ctx.state, ctx.state.date.year + 1);
}
