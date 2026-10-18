/**
 * National smoke laws (Phase 3 Task 5). `regulationMonth` runs after escalationMonth, so the smog
 * level is current. Per law: the streak counts months in the window with the national
 * population-weighted `smog.level` above the trigger (ruling R-S3); the law passes at LAW_STREAK, or
 * at the start of its latest year. Passing publishes news and opens the law card. From the
 * enforcement month each player polluter below the law's scrubber tier pays
 * `def.pollution * 400 * priceIndex` a month, all fines capped at 25% of last month's sales.
 */
import { levelSmoke } from '../logistics/levels';
import { BUILDINGS } from '../../data/buildings';
import { FINE_CAP_SHARE, FINE_RATE, LAWS, LAW_IDS, LAW_STREAK, type LawId } from '../../data/laws';
import { PLAYER_ID } from '../companies';
import { spend } from '../finance';
import { publishNews } from '../news';
import { monthIndex } from '../politics/elections';
import { openCardById } from '../politics/cards';
import type { GameState, SimContext } from '../types';
import { priceIndex } from './economy';
import { enforcedLaws, nonCompliant } from './lawState';

export * from './lawState';

/** Population-weighted mean of the towns' smog level (0 with no population). */
export function nationalSmogLevel(state: GameState): number {
  let sum = 0;
  let pop = 0;
  for (const c of state.cities) {
    sum += c.smog.level * c.population;
    pop += c.population;
  }
  return pop > 0 ? sum / pop : 0;
}

function passLaw(ctx: SimContext, id: LawId): void {
  const { state } = ctx;
  const law = state.society.laws[id];
  law.passed = state.date.year;
  // a month's grace: the first fine falls after the player has seen the card and could fit a scrubber
  law.enforcedFrom = monthIndex(state.date) + 1;
  const def = LAWS[id];
  publishNews(
    ctx,
    'historic',
    `${def.title.toUpperCase()} PASSES`,
    `Parliament has passed the ${def.title}. Works that burn dirty must fit tier ${def.tier} scrubbers or pay a fine every month.`,
  );
  openCardById(ctx, def.cardId, null);
}

/** Last month's sales revenue of the player (0 when there is no ledger for it). */
function lastMonthSales(state: GameState): number {
  const prev = monthIndex(state.date) - 1;
  const m = state.companies[PLAYER_ID].ledger.find((l) => monthIndex(l) === prev);
  return m?.income.sales ?? 0;
}

/** The fines owed this month before the cap, per the laws in force. */
export function monthlyFines(state: GameState): number {
  let total = 0;
  const index = priceIndex(state);
  // R-S7: one fine per non-compliant building, for the strictest enforced law it fails
  const enforced = enforcedLaws(state, monthIndex(state.date)).sort((a, b) => LAWS[b].tier - LAWS[a].tier);
  const fined = new Set<number>();
  for (const id of enforced) {
    for (const b of nonCompliant(state, id)) {
      if (fined.has(b.id)) continue;
      fined.add(b.id);
      total += BUILDINGS[b.typeId].pollution * levelSmoke(b) * FINE_RATE * index;
    }
  }
  return Math.min(total, FINE_CAP_SHARE * lastMonthSales(state));
}

export function regulationMonth(ctx: SimContext): void {
  const { state } = ctx;
  const year = state.date.year;
  const level = nationalSmogLevel(state);
  for (const id of LAW_IDS) {
    const def = LAWS[id];
    const law = state.society.laws[id];
    if (law.passed !== null) continue;
    if (year > def.latest) {
      // a game or save that starts after the law's year: already in force (no card), fined from next month
      law.passed = def.latest;
      law.enforcedFrom = monthIndex(state.date) + 1;
      publishNews(ctx, 'historic', `${def.title.toUpperCase()} IN FORCE`, `The ${def.title} is the law of the land. Works below tier ${def.tier} scrubbers pay a fine every month.`);
      continue;
    }
    const inWindow = year >= def.earliest && year <= def.latest;
    state.society.streak[id] = inWindow && level > def.trigger ? state.society.streak[id] + 1 : 0;
    if (state.society.streak[id] >= LAW_STREAK || year >= def.latest) passLaw(ctx, id);
  }
  const fine = Math.round(monthlyFines(state));
  if (fine > 0) spend(state.companies[PLAYER_ID], 'fines', fine, state.date);
}
