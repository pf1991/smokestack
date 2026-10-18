import type { SimContext } from '../types';
import { autoRoutesDay } from './autoRoutes';
import { autoSizeRoutesMonth } from './autoSize';
import { worksDay } from './levels';

/** Phase 4b logistics system hooks (each early-outs when no company uses the feature). */
export function logisticsDay(ctx: SimContext): void {
  worksDay(ctx);
  autoRoutesDay(ctx);
}
export function logisticsMonth(ctx: SimContext): void {
  autoSizeRoutesMonth(ctx);
}
export function logisticsYear(_ctx: SimContext): void {}
