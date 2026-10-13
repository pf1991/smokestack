/**
 * Slowdowns and strikes (Phase 3 Task 4).
 *
 * - Go-slow: while a town's `opinion.workers` is below 30, the player's works staffed from it
 *   (workCity) run at ×0.9 (`slowedBuildings`, applied in productionDay with staffing, the smog limit
 *   and protests).
 * - Strikes: monthly, each player factory or extractor staffed from a town with `opinion.workers`
 *   below 25 strikes with `chance(state, p)`, p = 0.04 × union stance (crush ×1.5, tolerate ×1,
 *   recognise ×0.4) × wage (low ×1.5, fair ×1, generous ×0.5). Towns roll in id order and their
 *   works in id order; a town's first strike ends its rolls for the month, so at most one new strike
 *   starts per town per month.
 * - A strike lasts randInt(30, 90) days (hard cap 120: `strikeEnd`). The works produces nothing and
 *   shows 'halted'. It opens a strike card for the town (data/cards/triggered.ts) whose choices
 *   concede, wait it out or break it (strikeState.ts).
 *
 * Deterministic: only the state rng (`chance`, `randInt`).
 */
import { BUILDINGS } from '../../data/buildings';
import { dateToDays } from '../clock';
import { publishNews } from '../news';
import { triggerCard } from '../politics/cards';
import { workCity } from '../politics/workforce';
import { chance, randInt } from '../rng';
import type { Building, City, GameState, SimContext } from '../types';
import { isWorks, STRIKE_OPINION, strikeActive } from './strikeState';

/** Monthly strike chance of a works before the company edicts scale it. */
export const STRIKE_BASE_CHANCE = 0.04;
export const UNION_STRIKE_FACTOR = { crush: 1.5, tolerate: 1, recognise: 0.4 } as const;
export const WAGE_STRIKE_FACTOR = { low: 1.5, fair: 1, generous: 0.5 } as const;
export const STRIKE_MIN_DAYS = 30;
export const STRIKE_MAX_ROLL_DAYS = 90;

/** The monthly strike chance of one works in a town below STRIKE_OPINION, under the company's edicts. */
export function strikeChance(state: GameState): number {
  const e = state.politics.edicts;
  return STRIKE_BASE_CHANCE * UNION_STRIKE_FACTOR[e.union] * WAGE_STRIKE_FACTOR[e.wage];
}

/** Why the men came out: the harshest company edict, else the town's smog, else pay and hours. */
export function strikeReason(state: GameState, city: City): string {
  const e = state.politics.edicts;
  if (e.union === 'crush') return 'Union men sacked at the gate';
  if (e.wage === 'low') return 'Wages cut below the going rate';
  if (e.safety === 'minimal') return 'Another man hurt on the line';
  if (city.smog.tier >= 2) return 'Black lung in the shop';
  return 'Pay and hours';
}

/** Starts a strike at `b` (staffed from `city`) today: news, a 'strike' event and a strike card. */
export function startStrike(ctx: SimContext, b: Building, city: City): void {
  const { state } = ctx;
  const today = dateToDays(state.date);
  const days = randInt(state, STRIKE_MIN_DAYS, STRIKE_MAX_ROLL_DAYS);
  const reason = strikeReason(state, city);
  b.strike = { until: today + days, reason, since: today, cityId: city.id, open: false };
  b.status = 'halted';
  const name = BUILDINGS[b.typeId].name;
  publishNews(
    ctx,
    'protest',
    `STRIKE AT THE ${city.name.toUpperCase()} ${name.toUpperCase()}`,
    `The men have downed tools and a picket stands at the gate. Their grievance: ${reason.toLowerCase()}.`,
  );
  ctx.bus.emit({ type: 'strike', buildingId: b.id, cityId: city.id });
  const pending = state.politics.cards.pending;
  const before = pending.length;
  triggerCard(ctx, 'strike', city.id);
  // only a strike whose card opened is that card's target (both strike cards may already be open)
  b.strike.open = pending.length > before;
}

/** Monthly: rolls strikes in towns below STRIKE_OPINION (towns, then works, in id order). */
export function strikesMonth(ctx: SimContext): void {
  const { state } = ctx;
  const unhappy = state.cities.filter((c) => c.opinion.workers < STRIKE_OPINION).sort((a, b) => a.id - b.id);
  if (unhappy.length === 0) return;
  const today = dateToDays(state.date);
  const p = strikeChance(state);
  const byCity = new Map<number, Building[]>();
  const ids = Object.keys(state.buildings).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const b = state.buildings[id];
    if (!isWorks(b) || strikeActive(b.strike, today)) continue;
    const city = workCity(state, b);
    if (!city || city.opinion.workers >= STRIKE_OPINION) continue;
    const list = byCity.get(city.id);
    if (list) list.push(b);
    else byCity.set(city.id, [b]);
  }
  for (const city of unhappy) {
    for (const b of byCity.get(city.id) ?? []) {
      if (chance(state, p)) {
        startStrike(ctx, b, city);
        break;
      }
    }
  }
}
