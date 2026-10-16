/**
 * The Baron's grudge ledger (Phase 4). `addGrudge` is the only writer of `state.nemesis.grudges`
 * (pinned by funnels.test.ts); `grudgesYear` decays it once a year.
 *
 * Causes are detected from state diffs, once a month, only while the Baron is active:
 * - undercut and city read the month's seller flags (`flags['seller:<city>:<good>']`) and sales
 *   tallies (`politics.track.sales`). Both are cleared during the month's onMonth hooks (goalsMonth and
 *   factionsMonth run before this system), so they are read by `nemesisDay` on the month's last day,
 *   after that day's retail: the flags then cover the whole month;
 * - contract reads `state.contracts` in `nemesisMonth` (contracts finish in contractsDay and stay
 *   listed, so a seen-id list finds the new ones).
 */
import { GRUDGE_WEIGHTS } from '../../data/nemesis';
import { GOODS } from '../../data/goods';
import { advanceHour } from '../clock';
import { BARON_ID } from '../companies';
import { buildingsInCity } from '../state';
import type { GameState, SimContext } from '../types';
import { retaliateMonth } from './retaliation';
import { CONTRACTS_SEEN_CAP, type GrudgeKind } from './types';

export const GRUDGE_CAP = 40;
export const GRUDGE_DECAY = 0.8;
/** decayed grudges lighter than this are forgotten */
export const GRUDGE_FORGET = 0.5;

const baronActive = (state: GameState): boolean => state.companies[BARON_ID]?.active === true;

/**
 * Records a grudge of `kind` (weight GRUDGE_WEIGHTS[kind] × scale) dated this year. A Baron who is
 * out of the game keeps none. Over GRUDGE_CAP the lightest grudge (the oldest among equals) is dropped.
 */
export function addGrudge(state: GameState, kind: GrudgeKind, cityId: number | null, scale = 1): void {
  if (!baronActive(state)) return;
  const weight = GRUDGE_WEIGHTS[kind] * scale;
  if (!Number.isFinite(weight) || weight <= 0) return;
  const grudges = state.nemesis.grudges;
  grudges.push({ kind, weight, year: state.date.year, cityId });
  while (grudges.length > GRUDGE_CAP) {
    let lightest = 0;
    for (let i = 1; i < grudges.length; i++) if (grudges[i].weight < grudges[lightest].weight) lightest = i;
    grudges.splice(lightest, 1);
  }
}

/** The weight of every grudge the Baron holds. */
export function grudgeTotal(state: GameState): number {
  let sum = 0;
  for (const g of state.nemesis.grudges) sum += g.weight;
  return sum;
}

/** Yearly: every grudge fades by GRUDGE_DECAY; those under GRUDGE_FORGET are forgotten. */
export function grudgesYear(ctx: SimContext): void {
  const n = ctx.state.nemesis;
  for (const g of n.grudges) g.weight *= GRUDGE_DECAY;
  n.grudges = n.grudges.filter((g) => g.weight >= GRUDGE_FORGET);
}

/**
 * The month's sales grudges, from the seller flags and sales tallies the month has gathered:
 * - undercut: the player and the Baron both sold some good in a town (at most one per town);
 * - city: the player's retail revenue in a town is more than twice the Baron's, while he sells there
 *   (at most one per town per year).
 * `'both'` only says two companies sold, so the town's tallies must show sales by both of them.
 */
export function salesGrudges(state: GameState): void {
  if (!baronActive(state)) return;
  const { year } = state.date;
  const goods = Object.keys(GOODS);
  const n = state.nemesis;
  for (const city of state.cities) {
    const s = state.politics.track.sales[city.id];
    if (!s || !(s.baron > 0)) continue;
    if (s.player > 0 && goods.some((g) => state.flags[`seller:${city.id}:${g}`] === 'both')) addGrudge(state, 'undercut', city.id);
    if (s.player > 2 * s.baron && n.track.cityYear[city.id] !== year) {
      n.track.cityYear[city.id] = year;
      addGrudge(state, 'city', city.id);
    }
  }
}

/**
 * Contracts the player finished since the last look, in towns where the Baron keeps a store. The seen
 * list is kept up to date whether or not the Baron is active (addGrudge ignores an inactive Baron).
 */
function contractGrudges(state: GameState): void {
  const track = state.nemesis.track;
  const seen = new Set(track.contractsSeen);
  const finished: number[] = [];
  for (const c of state.contracts) {
    if (c.status !== 'done' && c.status !== 'failed') continue;
    finished.push(c.id);
    if (seen.has(c.id) || c.status !== 'done') continue;
    if (buildingsInCity(state, c.cityId, 'store').some((b) => b.ownerId === BARON_ID)) addGrudge(state, 'contract', c.cityId);
  }
  // only ids still listed can show up again, so the list stays as short as the contract history
  track.contractsSeen = finished.slice(-CONTRACTS_SEEN_CAP);
}

/** Daily hook: on the month's last day (after its retail), the sales grudges. */
export function nemesisDay(ctx: SimContext): void {
  if (advanceHour(ctx.state.date).newMonth) salesGrudges(ctx.state);
}

/** Monthly: the contract grudges, then the Baron's retaliation (Task 2). */
export function nemesisMonth(ctx: SimContext): void {
  contractGrudges(ctx.state);
  retaliateMonth(ctx);
}
