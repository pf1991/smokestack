/**
 * Demand modifiers: a leaf module (clock and types only), so the event card helpers
 * (data/cards/helpers.ts) can push one without importing sim/events.ts, whose import of state.ts
 * reaches back into the card tables (state → politics/elections → data/cards).
 */
import { addDays } from './clock';
import type { GoodId, SimContext } from './types';

/** Pushes a demand modifier on `goodId` ('*': every good) in town `cityId` (null: everywhere) for `days`. */
export function pushModifier(ctx: SimContext, tag: string, goodId: GoodId | '*', cityId: number | null, factor: number, days: number): void {
  const { state } = ctx;
  // state.nextId++ is nextId(state) (sim/state.ts), inlined to keep this module a leaf
  state.modifiers.push({ id: `${tag}:${state.nextId++}`, goodId, cityId, factor, until: addDays(state.date, days) });
}
