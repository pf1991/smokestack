import { contractsSystem } from './contracts';
import { checkUnlocks, eraBanner, fadeWarnings } from './eras';
import { eventsDay, eventsMonth } from './events';
import { BANKRUPT_MONTHS, closeMonth, currentLedger } from './finance';
import { pollutionSystem } from './pollution';
import { growthMonth, maintenanceMonth, productionDay, retailDay } from './production';
import { assetValue } from './state';
import { rivalMonth, rivalTaunt } from './rival';
import type { OwnerId, SimContext } from './types';
import { vehicleMaintenanceMonth, vehiclesTick } from './vehicles';

/**
 * A simulation system. Hooks run in SYSTEMS order. `onDay`/`onMonth`/`onYear` run for the period
 * that is ending, while `state.date` is still inside it (see `stepTick` in simulation.ts).
 */
export interface SimSystem {
  id: string;
  onTick?(ctx: SimContext): void;
  onDay?(ctx: SimContext): void;
  onMonth?(ctx: SimContext): void;
  onYear?(ctx: SimContext): void;
}

export const FINANCE_SYSTEM_ID = 'finance';

const finance: SimSystem = {
  id: FINANCE_SYSTEM_ID,
  onMonth(ctx) {
    const { state, bus } = ctx;
    for (const id of Object.keys(state.companies) as OwnerId[]) {
      const c = state.companies[id];
      const { bankrupt } = closeMonth(c, state.date);
      // after closeMonth so the month's interest is included
      currentLedger(c, state.date).netWorthEnd = c.money - c.loan + assetValue(state, id);
      // fire once, on the month that crosses the threshold
      if (id === 'player' && bankrupt && c.monthsInRed === BANKRUPT_MONTHS) {
        bus.emit({ type: 'gameOver', reason: 'Bankrupt' });
        state.speed = 0;
      }
    }
  },
};

/**
 * Append-only registry (later tasks append their systems; keep both sides on merge conflicts).
 * The `finance` system closes the month's books, so `stepTick` always runs its `onMonth` after every
 * other system's `onMonth`, wherever later systems are appended.
 */
export const SYSTEMS: SimSystem[] = [
  { id: 'vehicles', onTick: vehiclesTick, onMonth: vehicleMaintenanceMonth },
  { id: 'production', onDay: productionDay },
  { id: 'retail', onDay: retailDay },
  {
    id: 'upkeep',
    onMonth(ctx) {
      maintenanceMonth(ctx);
      growthMonth(ctx);
    },
  },
  finance,
  { id: 'rival', onMonth: (ctx) => { rivalMonth(ctx); rivalTaunt(ctx); } },
  contractsSystem,
  { id: 'events', onDay: eventsDay, onMonth: eventsMonth },
  // after upkeep: onDay refreshes city.pollution on the month's last day (before growthMonth reads it),
  // onMonth then owns the final happiness value
  pollutionSystem,
  {
    id: 'eras',
    onDay(ctx) {
      checkUnlocks(ctx);
      eraBanner(ctx);
    },
    onYear: fadeWarnings,
  },
];
