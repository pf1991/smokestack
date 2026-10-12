/**
 * The politics system (Phase 2). Appended to SYSTEMS; later politics tasks extend its hooks.
 * Everything runs monthly or slower, never per tick.
 */
import type { SimSystem } from '../systems';
import { edictsMonth } from './edicts';
import { factionsMonth, opinionHistoryYear } from './factions';
import { workforceMonth } from './workforce';

export const politicsSystem: SimSystem = {
  id: 'politics',
  onMonth(ctx) {
    workforceMonth(ctx.state);
    edictsMonth(ctx);
    factionsMonth(ctx);
  },
  onYear: opinionHistoryYear,
};
