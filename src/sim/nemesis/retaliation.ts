/**
 * The Baron's retaliation (Phase 4 Task 2). Once a month, after the month's grudges are in
 * (nemesisMonth), a Baron who holds enough grudges may strike back at the player with one of a menu
 * of moves, weighted by his traits (data/nemesis.ts). Each move is paid from his purse in 1900
 * dollars at today's prices, never below his reserve; each prints a 'rival' news item naming the
 * grudge it answers, spends that grudge (its weight halves) and emits `baronStrike`.
 *
 * Timed moves live in `state.nemesis.effects` until their `untilDay`: a price war (read by retailDay
 * through `priceWars`) and a funded election candidate (`CityPolitics.baronBacks`, read by voteShares
 * and cleared by the election). All randomness is the state rng; towns and factions are visited in
 * id / FACTION_IDS order.
 */
import { BUILDINGS } from '../../data/buildings';
import { FACTION_IDS, factionName, type FactionId } from '../../data/factions';
import { GOODS } from '../../data/goods';
import { BARON_TRAITS } from '../../data/nemesis';
import { addDays, compareDates, DAYS_PER_MONTH, MONTHS_PER_YEAR, dateToDays } from '../clock';
import { BARON_ID, PLAYER_ID } from '../companies';
import { spend } from '../finance';
import type { PriceWar } from '../market';
import { publishNews } from '../news';
import { monthIndex, playerHiresFrom } from '../politics/elections';
import { adjustOpinion, nationalOpinion } from '../politics/factions';
import { random, chance, pick, randInt } from '../rng';
import { rivalReserve } from '../rival/shared';
import { atPrices } from '../society/economy';
import { strikeActive } from '../society/strikeState';
import type { Building, City, GameState, GoodId, SimContext } from '../types';
import { addGrudge, grudgeTotal, heaviestGrudge, spendHeaviestGrudge } from './grudges';
import { RETALIATION_KINDS, type GrudgeKind, type RetaliationKind } from './types';

export { BARON_BACK_BONUS } from '../politics/elections';

/** the grudge weight below which the Baron never strikes */
export const RETALIATE_AT = 6;
export const MAX_ACTIONS_PER_YEAR = 6;
/** months that must pass between two strikes (2: never in consecutive months) */
export const MIN_ACTION_GAP = 2;
/** the monthly chance is grudgeTotal / CHANCE_DIVISOR, capped at MAX_CHANCE */
export const CHANCE_DIVISOR = 30;
export const MAX_CHANCE = 0.6;

export const PRICE_WAR_DAYS = 90;
export const PRICE_WAR_FACTOR = 0.85;
export const POACH_DELTA = -6;
export const SMEAR_DELTA = -4;
export const SABOTAGE_MIN_DAYS = 10;
export const SABOTAGE_MAX_DAYS = 20;
export const SABOTAGE_EXPOSE_CHANCE = 0.25;
export const SABOTAGE_BAN_YEARS = 5;

/** What each move costs the Baron, in 1900 dollars (charged at atPrices). hostile_bid pays the share price (Task 8). */
export const RETALIATION_COST: Record<RetaliationKind, number> = {
  price_war: 5000,
  poach: 3000,
  fund_opponent: 4000,
  smear: 1000,
  sabotage: 6000,
  hostile_bid: 0,
};

const baronActive = (state: GameState): boolean => state.companies[BARON_ID]?.active === true;

const halted = (state: GameState, b: Building, today: number): boolean =>
  (b.haltedUntil !== null && compareDates(b.haltedUntil, state.date) > 0) || strikeActive(b.strike, today);

/** The price wars on in town `cityId` today, by good, or null (allocation-free) when there are none. */
export function priceWars(state: GameState, cityId: number): Partial<Record<GoodId, PriceWar>> | null {
  const effects = state.nemesis.effects;
  if (effects.length === 0) return null;
  const today = dateToDays(state.date);
  let out: Partial<Record<GoodId, PriceWar>> | null = null;
  for (const e of effects) {
    if (e.kind !== 'price_war' || e.cityId !== cityId || today >= e.untilDay) continue;
    out ??= {};
    out[e.goodId] = { favoured: BARON_ID, priceFactor: PRICE_WAR_FACTOR };
  }
  return out;
}

// --- targets: what each move would hit now, or nothing when its precondition fails ---------------

/** contested town/good pairs (last month both sold it there) not already under a price war */
function warTargets(state: GameState): { cityId: number; goodId: GoodId }[] {
  const out: { cityId: number; goodId: GoodId }[] = [];
  // `?? []`: a save written during Phase 4 Task 1 (already v7) has no contested list until its first month end
  for (const key of state.nemesis.track.contested ?? []) {
    const i = key.indexOf(':');
    const cityId = Number(key.slice(0, i));
    const goodId = key.slice(i + 1);
    if (!state.cities.some((c) => c.id === cityId) || !GOODS[goodId]) continue;
    if (state.nemesis.effects.some((e) => e.kind === 'price_war' && e.cityId === cityId && e.goodId === goodId)) continue;
    out.push({ cityId, goodId });
  }
  return out;
}

const poachTargets = (state: GameState): City[] => state.cities.filter((c) => playerHiresFrom(state, c.id));

/** towns voting within the next 12 months that the Baron is not already funding in */
function fundTargets(state: GameState): City[] {
  const now = monthIndex(state.date);
  return state.cities.filter((c) => {
    const ahead = c.politics.nextElection - now;
    return ahead >= 0 && ahead <= MONTHS_PER_YEAR && !c.politics.baronBacks;
  });
}

/** the player's factories that are working (not halted, not on strike); none while sabotage is banned */
function sabotageTargets(state: GameState): Building[] {
  const today = dateToDays(state.date);
  if (today < state.nemesis.sabotageBanUntil) return [];
  return Object.values(state.buildings).filter((b) => b.ownerId === PLAYER_ID && BUILDINGS[b.typeId].category === 'factory' && !halted(state, b, today));
}

function hasTarget(state: GameState, kind: RetaliationKind): boolean {
  switch (kind) {
    case 'price_war':
      return warTargets(state).length > 0;
    case 'poach':
      return state.cities.some((c) => playerHiresFrom(state, c.id));
    case 'fund_opponent':
      return fundTargets(state).length > 0;
    case 'smear':
      return state.cities.length > 0;
    case 'sabotage':
      return sabotageTargets(state).length > 0;
    case 'hostile_bid':
      // Task 8 (hostile bids for the player's shares) does not exist yet: never chosen
      return false;
  }
}

const costNow = (state: GameState, kind: RetaliationKind): number => Math.round(atPrices(state, RETALIATION_COST[kind]));

/** Moves the Baron could make now: a target exists and he can pay while keeping his reserve. In RETALIATION_KINDS order. */
export function eligibleKinds(ctx: SimContext): RetaliationKind[] {
  const { state } = ctx;
  if (!baronActive(state)) return [];
  const rival = state.companies[BARON_ID];
  const reserve = rivalReserve(state);
  return RETALIATION_KINDS.filter((k) => rival.money - costNow(state, k) >= reserve && hasTarget(state, k));
}

/** A move's weight: 1 plus what each of his traits adds for it. */
export function kindWeight(state: GameState, kind: RetaliationKind): number {
  let w = 1;
  for (const t of state.nemesis.traits) w += BARON_TRAITS[t].actionWeights[kind] ?? 0;
  return w;
}

function cause(state: GameState, kind: GrudgeKind | null, cityId: number | null): string {
  const town = state.cities.find((c) => c.id === cityId)?.name ?? 'town';
  switch (kind) {
    case 'undercut':
      return `your undercutting of his prices in ${town}`;
    case 'contract':
      return `the contract you took from under his nose in ${town}`;
    case 'shares':
      return 'your dealings in his shares';
    case 'city':
      return `the rout of his stores in ${town}`;
    case 'sabotage_exposed':
      return 'the exposure of his saboteurs';
    case 'takeover_bid':
      return 'your bid for his company';
    default:
      return 'old slights';
  }
}

interface Strike {
  cityId: number | null;
  headline: string;
  body: string;
  exposed?: boolean;
}

function apply(ctx: SimContext, kind: RetaliationKind): Strike | null {
  const { state } = ctx;
  const year = state.date.year;
  const today = dateToDays(state.date);
  const baron = state.nemesis.head.name;
  const firm = state.companies[PLAYER_ID].name;
  switch (kind) {
    case 'price_war': {
      const t = pick(state, warTargets(state));
      const city = state.cities.find((c) => c.id === t.cityId)!;
      // war starts tomorrow and runs PRICE_WAR_DAYS retail days
      state.nemesis.effects.push({ kind: 'price_war', cityId: t.cityId, goodId: t.goodId, untilDay: today + PRICE_WAR_DAYS + 1 });
      const good = GOODS[t.goodId].name;
      return {
        cityId: t.cityId,
        headline: `SMOGSWORTH SLASHES ${good.toUpperCase()} PRICES IN ${city.name.toUpperCase()}`,
        body: `${baron} floods ${city.name} with cut-rate ${good.toLowerCase()} for ${PRICE_WAR_DAYS} days, out to starve ${firm}.`,
      };
    }
    case 'poach': {
      const city = pick(state, poachTargets(state));
      adjustOpinion(state, 'workers', city.id, POACH_DELTA, 'Smogsworth poaches your men');
      return {
        cityId: city.id,
        headline: `SMOGSWORTH AGENTS POACH ${firm.toUpperCase()} MEN IN ${city.name.toUpperCase()}`,
        body: `${baron}'s foremen work the ${city.name} gates with promises of better pay.`,
      };
    }
    case 'fund_opponent': {
      const city = pick(state, fundTargets(state));
      let faction: FactionId = FACTION_IDS[0];
      for (const f of FACTION_IDS) if (city.opinion[f] < city.opinion[faction]) faction = f;
      city.politics.baronBacks = faction;
      const e = city.politics.nextElection;
      const untilDay = dateToDays({ year: Math.floor(e / MONTHS_PER_YEAR), month: (e % MONTHS_PER_YEAR) + 1, day: DAYS_PER_MONTH, hour: 0 });
      state.nemesis.effects.push({ kind: 'fund_opponent', cityId: city.id, faction, untilDay });
      const name = factionName(faction, year);
      return {
        cityId: city.id,
        headline: `SMOGSWORTH BANKROLLS ${name.toUpperCase()} IN ${city.name.toUpperCase()}`,
        body: `${baron}'s money pours into the ${name} campaign ahead of the ${city.name} election.`,
      };
    }
    case 'smear': {
      let faction: FactionId = FACTION_IDS[0];
      for (const f of FACTION_IDS) if (nationalOpinion(state, f) > nationalOpinion(state, faction)) faction = f;
      adjustOpinion(state, faction, 'national', SMEAR_DELTA, 'Smogsworth smears your name');
      return {
        cityId: null,
        headline: `SMEAR CAMPAIGN AGAINST ${firm.toUpperCase()}`,
        body: `Papers in ${baron}'s pocket tell the ${factionName(faction, year)} what ${firm} is really like.`,
      };
    }
    case 'sabotage': {
      const b = pick(state, sabotageTargets(state));
      b.haltedUntil = addDays(state.date, randInt(state, SABOTAGE_MIN_DAYS, SABOTAGE_MAX_DAYS));
      const city = state.cities.find((c) => c.id === b.cityId) ?? null;
      const where = city ? ` near ${city.name}` : '';
      return {
        cityId: city?.id ?? null,
        headline: `FIRE STOPS ${firm.toUpperCase()} ${BUILDINGS[b.typeId].name.toUpperCase()}`,
        body: `A night fire halts the ${BUILDINGS[b.typeId].name.toLowerCase()}${where}. Some whisper of ${baron}'s men.`,
        exposed: chance(state, SABOTAGE_EXPOSE_CHANCE),
      };
    }
    case 'hostile_bid':
      return null;
  }
}

/** Sabotage traced back to the Baron: the player gains sympathy, the Baron a grudge and a SABOTAGE_BAN_YEARS ban. */
function exposeSabotage(ctx: SimContext): void {
  const { state } = ctx;
  publishNews(
    ctx,
    'rival',
    'SMOGSWORTH MEN CAUGHT RED-HANDED',
    `The fire was set by men in ${state.nemesis.head.name}'s pay. The public rallies to ${state.companies[PLAYER_ID].name}.`,
  );
  adjustOpinion(state, 'reformers', 'national', 4, 'Smogsworth sabotage exposed');
  adjustOpinion(state, 'oldmoney', 'national', 2, 'Smogsworth sabotage exposed');
  addGrudge(state, 'sabotage_exposed', null);
  state.nemesis.sabotageBanUntil = dateToDays(state.date) + SABOTAGE_BAN_YEARS * MONTHS_PER_YEAR * DAYS_PER_MONTH;
}

/**
 * Makes move `kind` now if it is eligible (false, untouched, if not): charges the Baron, spends his
 * heaviest grudge, applies the move, prints its news (naming the grudge) and emits `baronStrike`.
 * Ignores the monthly gates (retaliateMonth applies those).
 */
export function retaliate(ctx: SimContext, kind: RetaliationKind): boolean {
  const { state } = ctx;
  if (!eligibleKinds(ctx).includes(kind)) return false;
  spend(state.companies[BARON_ID], 'events', costNow(state, kind), state.date);
  const g = heaviestGrudge(state);
  const why = cause(state, g?.kind ?? null, g?.cityId ?? null);
  spendHeaviestGrudge(state);
  const s = apply(ctx, kind);
  if (!s) return false;
  publishNews(ctx, 'rival', s.headline, `${s.body} Smogsworth has not forgotten ${why}.`);
  if (s.exposed) exposeSabotage(ctx);
  const n = state.nemesis;
  n.lastAction = { kind, year: state.date.year, month: state.date.month };
  n.actionsThisYear++;
  ctx.bus.emit({ type: 'baronStrike', kind, cityId: s.cityId });
  return true;
}

/** Drops effects whose time is up (all of them once the Baron is out), withdrawing lapsed election money. */
function pruneEffects(state: GameState): void {
  const n = state.nemesis;
  if (n.effects.length === 0) return;
  const today = dateToDays(state.date);
  const active = baronActive(state);
  const kept = n.effects.filter((e) => active && today < e.untilDay);
  for (const e of n.effects) {
    if (kept.includes(e) || e.kind !== 'fund_opponent') continue;
    const city = state.cities.find((c) => c.id === e.cityId);
    if (city && city.politics.baronBacks === e.faction) city.politics.baronBacks = null;
  }
  n.effects = kept;
}

/**
 * Monthly (from nemesisMonth): lifts lapsed effects, then strikes back when every gate holds: grudges
 * weigh at least RETALIATE_AT, fewer than MAX_ACTIONS_PER_YEAR moves this year, MIN_ACTION_GAP months
 * since the last, and a chance of min(MAX_CHANCE, grudgeTotal / CHANCE_DIVISOR). The move is drawn by
 * kindWeight among the eligible ones.
 */
export function retaliateMonth(ctx: SimContext): void {
  const { state } = ctx;
  pruneEffects(state);
  if (!baronActive(state)) return;
  const n = state.nemesis;
  const total = grudgeTotal(state);
  if (total < RETALIATE_AT || n.actionsThisYear >= MAX_ACTIONS_PER_YEAR) return;
  if (n.lastAction && monthIndex(state.date) - monthIndex(n.lastAction) < MIN_ACTION_GAP) return;
  if (!chance(state, Math.min(MAX_CHANCE, total / CHANCE_DIVISOR))) return;
  const kinds = eligibleKinds(ctx);
  if (kinds.length === 0) return;
  let sum = 0;
  for (const k of kinds) sum += kindWeight(state, k);
  let r = random(state) * sum;
  let kind = kinds[kinds.length - 1];
  for (const k of kinds) {
    r -= kindWeight(state, k);
    if (r < 0) {
      kind = k;
      break;
    }
  }
  retaliate(ctx, kind);
}
