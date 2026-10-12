/**
 * Faction opinion: the single writer of `City.opinion` (a funnel test pins this). Monthly drift and
 * drivers live here too. Drivers are derived from state diffs kept in `state.politics.track`
 * (ruling R-Q3), never from bus listeners, so the sim stays deterministic and save-safe.
 */
import { BUILDINGS, HOUSING_OPINION } from '../../data/buildings';
import { FACTION_IDS, type FactionId } from '../../data/factions';
import { BARON_ID, PLAYER_ID } from '../companies';
import { buildingsNear } from '../spatial';
import type { GameState, OwnerId, SimContext } from '../types';
import { housingCity } from './workforce';

/** Oldest entries are dropped beyond this. */
export const LOG_CAP = 200;
/** Changes smaller than this (in either direction) are applied but not logged. */
export const LOG_MIN_DELTA = 0.5;
/** The Baron's Circle's monthly loss where the player outsells the Baron; against DRIFT it settles at 30. */
export const BARON_LEAD_DELTA = -0.4;
/** Fraction of the gap to 50 that every opinion closes each month. */
export const DRIFT = 0.02;
/** How far beyond a town's urban radius a player building still counts as "in" that town. */
export const NEAR_MARGIN = 4;

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * The one way to change a faction's opinion of the player's company. `scope` is a city id or
 * 'national' (every city). Clamps to [0, 100] and logs changes of at least LOG_MIN_DELTA. Monthly
 * ambient drivers (smog, Baron sales) pass `{ log: false }`: only one-off causes reach the log.
 */
export function adjustOpinion(
  state: GameState,
  faction: FactionId,
  scope: number | 'national',
  delta: number,
  reason: string,
  opts: { log?: boolean } = {},
): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  // the logged delta is what was actually applied after clamping (nationally: the change in nationalOpinion)
  let applied: number;
  if (scope === 'national') {
    const before = nationalOpinion(state, faction);
    for (const c of state.cities) c.opinion[faction] = clamp(c.opinion[faction] + delta);
    applied = nationalOpinion(state, faction) - before;
  } else {
    const city = state.cities.find((c) => c.id === scope);
    if (!city) return;
    const before = city.opinion[faction];
    city.opinion[faction] = clamp(before + delta);
    applied = city.opinion[faction] - before;
  }
  if (opts.log === false || Math.abs(applied) < LOG_MIN_DELTA) return;
  const log = state.politics.log;
  log.push({ date: { ...state.date }, faction, scope, delta: applied, reason });
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
}

/** Population-weighted mean opinion across all towns (50 when there are none). */
export function nationalOpinion(state: GameState, faction: FactionId): number {
  let sum = 0;
  let pop = 0;
  for (const c of state.cities) {
    sum += c.opinion[faction] * c.population;
    pop += c.population;
  }
  return pop > 0 ? sum / pop : 50;
}

/** Called by retailDay for every sale: accumulates this month's player/Baron revenue per town. */
export function notePoliticsSale(state: GameState, ownerId: OwnerId, cityId: number, revenue: number): void {
  if (ownerId !== PLAYER_ID && ownerId !== BARON_ID) return;
  if (!(revenue > 0)) return;
  const sales = state.politics.track.sales;
  const k = String(cityId);
  const s = (sales[k] ??= { player: 0, baron: 0 });
  if (ownerId === PLAYER_ID) s.player += revenue;
  else s.baron += revenue;
}

function nearIds(state: GameState, cityId: number): number[] {
  const c = state.cities.find((x) => x.id === cityId)!;
  // only buildings that employ anyone: company housing brings homes, not jobs, and its demolition no layoffs
  return buildingsNear(state, c.center, c.urbanRadius + NEAR_MARGIN, PLAYER_ID)
    .filter((b) => BUILDINGS[b.typeId].workers > 0)
    .map((b) => b.id);
}

/**
 * Jobs and layoffs: player buildings placed or removed near each town since the last month.
 * `track.buildings` holds every building id whatever its owner, so an ownership change (a takeover
 * or an heir) is neither a placement nor a removal: only ids that appear or vanish count.
 */
function buildingDrivers(state: GameState): void {
  const track = state.politics.track;
  const current = Object.keys(state.buildings).map(Number);
  const prevAll = new Set(track.buildings);
  const curAll = new Set(current);
  const near: Record<string, number[]> = {};
  for (const city of state.cities) {
    const ids = nearIds(state, city.id);
    near[city.id] = ids;
    if (!track.primed) continue;
    let placed = 0;
    let dirty = 0;
    for (const id of ids) {
      if (prevAll.has(id)) continue;
      placed++;
      if (BUILDINGS[state.buildings[id].typeId].pollution > 0) dirty++;
    }
    let removed = 0;
    for (const id of track.near[city.id] ?? []) if (!curAll.has(id)) removed++;
    if (placed > 0) adjustOpinion(state, 'workers', city.id, 2 * placed, 'New jobs');
    if (dirty > 0) adjustOpinion(state, 'reformers', city.id, -dirty, 'A smoking new works');
    if (removed > 0) adjustOpinion(state, 'workers', city.id, -4 * removed, 'Layoffs');
  }
  // company housing raised since the last month: grateful workers in its factory's town, once
  if (track.primed) {
    for (const id of current.sort((a, b) => a - b)) {
      const b = state.buildings[id];
      if (prevAll.has(id) || b.ownerId !== PLAYER_ID || b.typeId !== 'company_housing') continue;
      const city = housingCity(state, b);
      if (city) adjustOpinion(state, 'workers', city.id, HOUSING_OPINION, 'Company housing');
    }
  }
  track.buildings = current.sort((a, b) => a - b);
  track.near = near;
}

/** Contracts that finished since the last month: done pleases workers and church, failed annoys Old Money. */
function contractDrivers(state: GameState): void {
  const track = state.politics.track;
  const seen = new Set(track.contractsSeen);
  const finished: number[] = [];
  for (const c of state.contracts) {
    if (c.status !== 'done' && c.status !== 'failed') continue;
    finished.push(c.id);
    if (seen.has(c.id) || !track.primed) continue;
    if (c.status === 'done') {
      adjustOpinion(state, 'workers', c.cityId, 1, 'Contract delivered');
      adjustOpinion(state, 'church', c.cityId, 1, 'Contract delivered');
    } else {
      adjustOpinion(state, 'oldmoney', c.cityId, -2, 'Contract failed');
    }
  }
  // only ids still present can show up again, so the list stays as short as the contract history
  track.contractsSeen = finished;
}

/** Monthly: drift toward 50, then smog, the Baron's Circle, and the state-diff drivers. Only the last are logged. */
export function factionsMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const c of state.cities) {
    for (const f of FACTION_IDS) adjustOpinion(state, f, c.id, (50 - c.opinion[f]) * DRIFT, 'Drift', { log: false });
  }
  for (const c of state.cities) {
    if (c.pollution > 0) {
      adjustOpinion(state, 'reformers', c.id, -4 * c.pollution, 'Smog', { log: false });
      adjustOpinion(state, 'workers', c.id, -2 * c.pollution, 'Smog', { log: false });
    }
    const s = state.politics.track.sales[c.id];
    if (s && s.player > s.baron) adjustOpinion(state, 'baron', c.id, BARON_LEAD_DELTA, 'Outselling the Baron', { log: false });
  }
  state.politics.track.sales = {};
  buildingDrivers(state);
  contractDrivers(state);
  state.politics.track.primed = true;
}

/** Yearly samples kept in `state.politics.history`; the oldest are dropped beyond this. */
export const HISTORY_CAP = 120;

/** Yearly (onYear, while the date is still in the ending year): samples every faction's national opinion. */
export function opinionHistoryYear(ctx: SimContext): void {
  const { state } = ctx;
  const national = {} as Record<FactionId, number>;
  for (const f of FACTION_IDS) national[f] = nationalOpinion(state, f);
  const history = (state.politics.history ??= []);
  history.push({ year: state.date.year, national });
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
}

/**
 * National opinion of `faction` now minus the latest yearly sample (taken at most 12 months ago),
 * or null before the first year has ended.
 */
export function opinionTrend(state: GameState, faction: FactionId): number | null {
  const last = state.politics.history?.at(-1);
  return last ? nationalOpinion(state, faction) - last.national[faction] : null;
}
