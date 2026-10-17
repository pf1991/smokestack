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
import { GRUDGE_WEIGHTS, WAKE_FLAG } from '../../data/nemesis';
import { GOODS } from '../../data/goods';
import { advanceHour } from '../clock';
import { BARON_ID, PLAYER_ID } from '../companies';
import { netWorth } from '../rival/takeover';
import { sellersInclude } from '../scenarios';
import { buildingsInCity } from '../state';
import type { GameState, SimContext } from '../types';
import { retaliateMonth } from './retaliation';
import { successionMonth } from './succession';
import { CONTRACTS_SEEN_CAP, RETALIATE_AT, type BaronMood, type Grudge, type GrudgeKind } from './types';

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

/** Multiplies every grudge's weight by `factor` (a new Baron inherits the ledger at a discount). */
export function scaleGrudges(state: GameState, factor: number): void {
  for (const g of state.nemesis.grudges) g.weight *= factor;
}

/** The weight of every grudge the Baron holds. */
export function grudgeTotal(state: GameState): number {
  let sum = 0;
  for (const g of state.nemesis.grudges) sum += g.weight;
  return sum;
}

/** grudges weighing at least this make the Baron furious */
export const FURIOUS_AT = 12;
/** months after a strike (inclusive) that the Baron gloats */
export const GLOAT_MONTHS = 2;

/**
 * The Baron's mood for his portrait: gloating within GLOAT_MONTHS months of his last strike,
 * otherwise furious at FURIOUS_AT grudge weight, scheming at RETALIATE_AT, else smug.
 */
export function baronMood(state: GameState): BaronMood {
  const last = state.nemesis.lastAction;
  if (last) {
    const since = state.date.year * 12 + state.date.month - (last.year * 12 + last.month);
    if (since >= 0 && since <= GLOAT_MONTHS) return 'gloating';
  }
  const total = grudgeTotal(state);
  if (total >= FURIOUS_AT) return 'furious';
  if (total >= RETALIATE_AT) return 'scheming';
  return 'smug';
}

/** The heaviest grudge (the oldest among equals), or null for an empty ledger. Read-only. */
export function heaviestGrudge(state: GameState): Grudge | null {
  let best: Grudge | null = null;
  for (const g of state.nemesis.grudges) if (!best || g.weight > best.weight) best = g;
  return best;
}

/** A retaliation spends the heaviest grudge: its weight halves (nemesis/retaliation.ts). */
export function spendHeaviestGrudge(state: GameState): void {
  const g = heaviestGrudge(state);
  if (g) g.weight /= 2;
}

/** a player worth at least this share of the Baron's net worth earns a December rivalry grudge */
export const RIVALRY_SHARE = 0.5;

/**
 * December's rivalry grudge, needing no shared town: the player's net worth is at least RIVALRY_SHARE
 * of the Baron's (scale 2 once it is above his). Only while he is active and worth more than 0 (addGrudge ignores him otherwise).
 */
export function rivalryGrudge(state: GameState): void {
  if (!baronActive(state)) return;
  const mine = netWorth(state, PLAYER_ID);
  const his = netWorth(state, BARON_ID);
  // a Baron worth nothing (or less) has no fortune to feel threatened in
  if (!(his > 0) || !(mine >= RIVALRY_SHARE * his)) return;
  addGrudge(state, 'rivalry', null, mine > his ? 2 : 1);
}

/**
 * Yearly (December, the nemesis year hook): every grudge fades by GRUDGE_DECAY and those under
 * GRUDGE_FORGET are forgotten; then the rivalry grudge is added after the decay, so it enters at full
 * weight. The year's retaliation count starts again.
 */
export function grudgesYear(ctx: SimContext): void {
  const n = ctx.state.nemesis;
  n.actionsThisYear = 0;
  for (const g of n.grudges) g.weight *= GRUDGE_DECAY;
  n.grudges = n.grudges.filter((g) => g.weight >= GRUDGE_FORGET);
  rivalryGrudge(ctx.state);
}

/**
 * The month's sales grudges, from the seller flags and sales tallies the month has gathered:
 * - undercut: the player and the Baron both sold some good in a town (at most one per town);
 * - city: the player's retail revenue in a town is more than twice the Baron's, while he sells there
 *   (at most one per town per year).
 * The seller flag must list both the player and the Baron (a regional firm selling beside either is
 * no undercut), and the town's tallies must show sales by both of them.
 */
export function salesGrudges(state: GameState): void {
  if (!baronActive(state)) return;
  const { year } = state.date;
  const goods = Object.keys(GOODS);
  const n = state.nemesis;
  for (const city of state.cities) {
    const s = state.politics.track.sales[city.id];
    if (!s || !(s.baron > 0)) continue;
    if (s.player > 0 && goods.some((g) => sellersInclude(state, city.id, g, PLAYER_ID, BARON_ID))) addGrudge(state, 'undercut', city.id);
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

/**
 * The month's contested `<cityId>:<goodId>` pairs (both the player and the Baron sold the good in the
 * town), the price war's targets (nemesis/retaliation.ts). Empty while the Baron is out of the game.
 */
export function noteContested(state: GameState): void {
  const out: string[] = [];
  if (baronActive(state)) {
    const goods = Object.keys(GOODS);
    for (const city of state.cities) {
      const s = state.politics.track.sales[city.id];
      if (!s || !(s.baron > 0) || !(s.player > 0)) continue;
      for (const g of goods) if (sellersInclude(state, city.id, g, PLAYER_ID, BARON_ID)) out.push(`${city.id}:${g}`);
    }
  }
  state.nemesis.track.contested = out;
}

/** Daily hook: on the month's last day (after its retail), the sales grudges and the contested goods. */
export function nemesisDay(ctx: SimContext): void {
  if (!advanceHour(ctx.state.date).newMonth) return;
  salesGrudges(ctx.state);
  noteContested(ctx.state);
}

/** The funeral card's wake choice leaves a flag; the Baron takes it as a double city grudge (none if he is out of the game). */
function wakeGrudge(state: GameState): void {
  if (!state.flags[WAKE_FLAG]) return;
  delete state.flags[WAKE_FLAG];
  addGrudge(state, 'city', null, 2);
}

/** Monthly: the contract grudges, the succession (December), then the Baron's retaliation (Task 2). */
export function nemesisMonth(ctx: SimContext): void {
  contractGrudges(ctx.state);
  wakeGrudge(ctx.state);
  successionMonth(ctx);
  retaliateMonth(ctx);
}
