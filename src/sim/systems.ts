import { contractsSystem } from './contracts';
import { checkUnlocks, eraBanner, fadeWarnings } from './eras';
import { eventsDay, eventsMonth } from './events';
import { BANKRUPT_MONTHS, closeMonth, currentLedger } from './finance';
import { pollutionSystem } from './pollution';
import { escalationMonth } from './society/escalation';
import { classesMonth } from './society/classes';
import { regulationMonth } from './society/regulation';
import { strikesMonth } from './society/strikes';
import { cycleLabel, economyMonth } from './society/economy';
import { taxesMonth } from './society/taxes';
import { publishNews } from './news';
import { growthMonth, maintenanceMonth, productionDay, retailDay } from './production';
import { wealth } from './state';
import { rivalMonth, rivalTaunt } from './rival';
import { recordBaronEarnings } from './rival/insolvency';
import { landmarksMonth } from './landmarks';
import { politicsSystem } from './politics';
import { companyLoanRate } from './politics/mayorEdicts';
import { goalsMonth } from './scenarios';
import { grudgesYear, nemesisDay, nemesisMonth } from './nemesis/grudges';
import { dynastyMonth, dynastyYear } from './dynasty/family';
import { companyIds } from './companies';
import { regionalMonth } from './regional/firms';
import { exchangeDay, exchangeMonth } from './exchange/prices';
import { logisticsDay, logisticsMonth, logisticsYear } from './logistics';
import { tradeDay } from './trade';
import type { SimContext } from './types';
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
    for (const id of companyIds(state)) {
      const c = state.companies[id];
      // the player's rate follows Old Money; every other company pays LOAN_RATE
      const { bankrupt } = closeMonth(c, state.date, companyLoanRate(state, id));
      // after closeMonth so the month's interest is included; shares held count (state.ts wealth)
      currentLedger(c, state.date).netWorthEnd = wealth(state, id);
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
      // before growthMonth clears producedThisMonth (R-S13)
      recordBaronEarnings(ctx);
      growthMonth(ctx);
    },
  },
  finance,
  { id: 'rival', onMonth: (ctx) => { rivalMonth(ctx); rivalTaunt(ctx); } },
  contractsSystem,
  { id: 'events', onDay: eventsDay, onMonth: eventsMonth },
  // after upkeep: onDay refreshes city.pollution on the month's last day (before growthMonth reads it),
  // onMonth then owns the final happiness value. Smog escalation (society/escalation.ts) steps right
  // after it: after growthMonth (which reads last month's tier) and before politics, so this month's
  // tier reaches workforceMonth and any election held this month (tier-4 reformers ×1.5). The class
  // shift (society/classes.ts) follows escalation: it reads the month's final satisfaction and smog
  // level, and politics (later) votes with the new mix
  {
    ...pollutionSystem,
    onMonth(ctx) {
      pollutionSystem.onMonth(ctx);
      escalationMonth(ctx);
      classesMonth(ctx);
      regulationMonth(ctx);
    },
  },
  {
    id: 'eras',
    onDay(ctx) {
      checkUnlocks(ctx);
      eraBanner(ctx);
    },
    onYear: fadeWarnings,
  },
  { id: 'goals', onMonth: goalsMonth },
  // after upkeep's growthMonth, so a town that just spread builds on its new land
  { id: 'landmarks', onMonth: landmarksMonth },
  // Phase 2 politics (cards daily; workforce, edicts, opinion, housing, elections monthly); reads the month's pollution and sales
  politicsSystem,
  // Phase 3 strikes: after politics, so this month's workers' opinion decides who walks out
  { id: 'strikes', onMonth: strikesMonth },
  // Sales tax on this month's booked sales (after retail days have run); same rules for every company
  { id: 'taxes', onMonth: taxesMonth },
  // Phase 3 inflation + soft cycle: late, so every price charged this month used the month's index;
  // finance (always run last) then values the month-end net worth at the new index next month uses
  {
    id: 'economy',
    onMonth(ctx) {
      const flipped = economyMonth(ctx);
      if (flipped === 'boom') {
        publishNews(
          ctx,
          'historic',
          'FACTORIES HUM! SHOPKEEPERS REPORT QUEUES AT THE DOOR',
          'Orders are brisk from coast to coast. Stock the shelves while the public still has coin.',
          'cycle:boom',
        );
        ctx.bus.emit({ type: 'toast', message: cycleLabel('boom'), tone: 'good' });
      } else if (flipped === 'recession') {
        publishNews(
          ctx,
          'historic',
          'TRADE SLACKENS! WAGONS WAIT IDLE FOR ORDERS',
          'Tills ring thin and warehouses fill. Cut costs, woo the mayors, and keep a cash cushion.',
          'cycle:recession',
        );
        ctx.bus.emit({ type: 'toast', message: cycleLabel('recession'), tone: 'bad' });
      }
    },
  },
  // Phase 4 the Baron's grudge ledger. onDay reads the month's sales on its last day (goalsMonth and
  // factionsMonth clear them during onMonth); onMonth adds contract grudges, then retaliates
  { id: 'nemesis', onDay: nemesisDay, onMonth: nemesisMonth, onYear: grudgesYear },
  // Phase 4 the player's family: opinion drift and the marriage card monthly; births and deaths each December
  { id: 'dynasty', onMonth: dynastyMonth, onYear: dynastyYear },
  // Phase 4 regional firms: founded in January on schedule; trucks, renewals and loans monthly; closed after 6 months in the red
  { id: 'regional', onMonth: regionalMonth },
  // Phase 4 share prices: sentiment daily; the fundamental monthly, after every system that books
  // this month's income and spending (finance, always last, adds only the month's interest)
  { id: 'exchange', onDay: exchangeDay, onMonth: exchangeMonth },
  // Phase 4b logistics (hubs, automatic routes, managers); each hook early-outs when no company uses the feature
  { id: 'logistics', onDay: logisticsDay, onMonth: logisticsMonth, onYear: logisticsYear },
  // R4 the Trading House: sales at the national price, then saturation and drift (own rng stream)
  { id: 'trade', onDay: tradeDay },
];
