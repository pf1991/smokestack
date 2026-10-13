/**
 * Company edicts and philanthropy (Phase 2 Task 3).
 *
 * Edicts are the player's standing orders on wages, safety and unions. They are read only by
 * monthly hooks, so a change made with `setEdict` takes effect from the next month-end: the
 * maintenance bill (`maintenanceFactor`, sim/production.ts maintenanceMonth) and the national
 * opinion effects (`edictsMonth`).
 *
 * Philanthropy lets the player endow a park, library or hospital in a town: a landmark on a free
 * site near the centre, paid from the 'events' ledger, with one-off opinion gains in that town.
 */
import { err, ok, type Result } from '../../core/result';
import { FACTION_IDS, type FactionId } from '../../data/factions';
import { LANDMARKS, PHILANTHROPY_IDS, type PhilanthropyId } from '../../data/landmarks';
import { PLAYER_ID } from '../companies';
import { canAfford, spend } from '../finance';
import { findLandmarkSite, raiseLandmark } from '../landmarks';
import { publishNews } from '../news';
import type { GameState, SimContext } from '../types';
import { adjustOpinion } from './factions';
import type { CompanyEdicts, SafetyLevel, UnionStance, WageLevel } from './types';

export interface EdictOption {
  label: string;
  /** multiplier on the player's building maintenance */
  cost: number;
  /** national opinion change each month */
  effects: Partial<Record<FactionId, number>>;
  /** the one-line headline published when the player switches to this option */
  headline: string;
}

export interface EdictDef<V extends string> {
  title: string;
  /** option ids in display order */
  values: readonly V[];
  options: Record<V, EdictOption>;
}

export const EDICTS: { wage: EdictDef<WageLevel>; safety: EdictDef<SafetyLevel>; union: EdictDef<UnionStance> } = {
  wage: {
    title: 'Wages',
    values: ['low', 'fair', 'generous'],
    options: {
      low: { label: 'Low', cost: 0.85, effects: { workers: -2, oldmoney: 1 }, headline: '{company} CUTS WAGES; SHAREHOLDERS PLEASED' },
      fair: { label: 'Fair', cost: 1, effects: {}, headline: '{company} SETTLES ON A FAIR DAY\'S PAY' },
      generous: { label: 'Generous', cost: 1.25, effects: { workers: 2, oldmoney: -1 }, headline: '{company} RAISES WAGES ACROSS ITS WORKS' },
    },
  },
  safety: {
    title: 'Safety',
    values: ['minimal', 'standard', 'high'],
    options: {
      minimal: { label: 'Minimal', cost: 0.95, effects: { workers: -1, reformers: -1 }, headline: '{company} STRIPS BACK SAFETY ON THE SHOP FLOOR' },
      standard: { label: 'Standard', cost: 1, effects: {}, headline: '{company} KEEPS TO STANDARD SAFETY RULES' },
      high: { label: 'High', cost: 1.12, effects: { workers: 1 }, headline: '{company} GUARDS AND GOGGLES FOR EVERY HAND' },
    },
  },
  union: {
    title: 'Unions',
    values: ['crush', 'tolerate', 'recognise'],
    options: {
      crush: { label: 'Crush', cost: 1, effects: { workers: -2, oldmoney: 1 }, headline: '{company} VOWS TO BREAK THE UNION' },
      tolerate: { label: 'Tolerate', cost: 1, effects: {}, headline: '{company} WILL TOLERATE THE UNION, NO MORE' },
      recognise: { label: 'Recognise', cost: 1.05, effects: { workers: 1.5, oldmoney: -1 }, headline: '{company} RECOGNISES THE UNION AT LAST' },
    },
  },
};

export const EDICT_KEYS: readonly (keyof CompanyEdicts)[] = ['wage', 'safety', 'union'];

function option(key: keyof CompanyEdicts, value: string): EdictOption | undefined {
  const def = EDICTS[key] as EdictDef<string> | undefined;
  return def && Object.prototype.hasOwnProperty.call(def.options, value) ? def.options[value] : undefined;
}

/** Multiplier on the player's building maintenance: the product of the three edicts' costs. */
export function maintenanceFactor(edicts: CompanyEdicts): number {
  let f = 1;
  for (const k of EDICT_KEYS) f *= option(k, edicts[k])?.cost ?? 1;
  return f;
}

/**
 * Sets one edict. Read by the monthly hooks only, so it takes effect from the next month-end.
 * Publishes a one-line politics headline. Refuses unknown keys or values, and no-ops (ok) when
 * the edict already has that value.
 */
export function setEdict<K extends keyof CompanyEdicts>(ctx: SimContext, key: K, value: CompanyEdicts[K]): Result {
  const opt = EDICT_KEYS.includes(key) ? option(key, value) : undefined;
  if (!opt) return err('Unknown edict');
  const edicts = ctx.state.politics.edicts;
  if (edicts[key] === value) return ok();
  edicts[key] = value;
  const company = ctx.state.companies[PLAYER_ID].name.toUpperCase();
  publishNews(ctx, 'politics', opt.headline.replace('{company}', company), `${EDICTS[key].title}: ${opt.label.toLowerCase()}, from next month.`);
  return ok();
}

/** Monthly: each edict's national opinion effects. Ambient, so not logged (like drift and smog). */
export function edictsMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const k of EDICT_KEYS) {
    const opt = option(k, state.politics.edicts[k]);
    if (!opt) continue;
    for (const f of FACTION_IDS) {
      const d = opt.effects[f];
      if (d) adjustOpinion(state, f, 'national', d, `${EDICTS[k].title}: ${opt.label.toLowerCase()}`, { log: false });
    }
  }
}

/** Why the player cannot endow `id` in town `cityId` right now, or null when they can. */
export function philanthropyBlocker(state: GameState, cityId: number, id: PhilanthropyId): string | null {
  const def = LANDMARKS[id];
  if (!PHILANTHROPY_IDS.includes(id) || !def?.philanthropy) return 'Unknown landmark';
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return 'Unknown town';
  if (city.landmarks.some((l) => l.id === id)) return `${city.name} already has a ${def.name.toLowerCase()}`;
  if (state.date.year < def.minYear) return `Not before ${def.minYear}`;
  if (!canAfford(state.companies[PLAYER_ID], def.philanthropy.cost)) return 'Not enough money';
  if (!findLandmarkSite(state, city)) return `No free site in ${city.name}`;
  return null;
}

/**
 * The player endows landmark `id` in town `cityId`: once per town per landmark. Spends its cost
 * under 'events', raises it on the town's landmark site (news and `landmarkBuilt` included), and
 * applies its one-off opinion changes in that town.
 */
export function buyPhilanthropy(ctx: SimContext, cityId: number, id: PhilanthropyId): Result {
  const { state } = ctx;
  const blocked = philanthropyBlocker(state, cityId, id);
  if (blocked) return err(blocked);
  const city = state.cities.find((c) => c.id === cityId)!;
  const def = LANDMARKS[id];
  const { cost, effects } = def.philanthropy!;
  const pos = findLandmarkSite(state, city)!;
  const player = state.companies[PLAYER_ID];
  spend(player, 'events', cost, state.date);
  const name = def.name.toLowerCase();
  raiseLandmark(ctx, city, id, pos, `A gift from ${player.name}: ${city.name} gains a ${name}, open to every citizen.`);
  for (const f of FACTION_IDS) {
    const d = effects[f];
    if (d) adjustOpinion(state, f, city.id, d, `Endowed a ${name}`);
  }
  return ok();
}
