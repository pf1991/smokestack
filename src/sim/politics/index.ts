/**
 * The politics system (Phase 2): event cards daily; workforce, company edicts, faction opinion,
 * housing, elections and scandals monthly; the opinion history yearly. Never per tick.
 */
import type { SimSystem } from '../systems';
import { cardsDayHook } from './cards';
import { edictsMonth } from './edicts';
import { electionsMonth, scandalMonth } from './elections';
import { factionsMonth, opinionHistoryYear } from './factions';
import { housingMonth } from './housing';
import { workforceMonth } from './workforce';

export const politicsSystem: SimSystem = {
  id: 'politics',
  // event cards: the spring draw on 1 April, then auto-resolve of cards left open AUTO_RESOLVE_DAYS
  onDay: cardsDayHook,
  onMonth(ctx) {
    workforceMonth(ctx.state);
    edictsMonth(ctx);
    factionsMonth(ctx);
    housingMonth(ctx);
    electionsMonth(ctx);
    scandalMonth(ctx);
  },
  onYear: opinionHistoryYear,
};
