import type { SimContext } from '../types';
import { worksDay } from './levels';

/** Phase 4b logistics system hooks. Empty for now; later tasks fill them (each must early-out when no company uses the feature). */
export function logisticsDay(ctx: SimContext): void {
  worksDay(ctx);
}
export function logisticsMonth(_ctx: SimContext): void {}
export function logisticsYear(_ctx: SimContext): void {}
