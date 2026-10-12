/**
 * The politics system (Phase 2). Appended to SYSTEMS; later politics tasks extend its hooks.
 * Everything runs monthly or slower, never per tick.
 */
import type { SimSystem } from '../systems';
import { factionsMonth } from './factions';

export const politicsSystem: SimSystem = {
  id: 'politics',
  onMonth: factionsMonth,
};
