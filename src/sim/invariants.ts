import { FACTION_IDS } from '../data/factions';
import { companyIds } from './companies';
import { POP_CAP } from './market';
import { POLLUTION_CAP } from './pollution';
import { footprint } from './state';
import { STRIKE_MAX_DAYS } from './society/strikeState';
import { classesValid } from './society/classes';
import { GRUDGE_CAP } from './nemesis/grudges';
import { HEIR_MIN_AGE, HEIR_TRAITS, MAX_CHILDREN, successor } from './dynasty/types';
import { PRICE_HISTORY_MONTHS, SENTIMENT_MAX, SENTIMENT_MIN } from './exchange/types';
import type { GameState } from './types';

/** Messages for every violated state invariant; empty when the state is healthy. */
export function checkInvariants(state: GameState): string[] {
  const out: string[] = [];
  const { map } = state;

  for (const id of companyIds(state)) {
    const c = state.companies[id];
    if (!Number.isFinite(c.money)) out.push(`company ${id}: money is ${c.money}`);
    if (!Number.isFinite(c.loan)) out.push(`company ${id}: loan is ${c.loan}`);
    // an emergency bid loan may take the balance above maxLoan (finance.ts takeBidLoan); it is part of it
    if (c.bidLoan !== undefined && !(Number.isFinite(c.bidLoan) && c.bidLoan > 0 && c.bidLoan <= c.loan)) out.push(`company ${id}: bidLoan ${c.bidLoan} not in (0, loan]`);
  }

  for (const city of state.cities) {
    const p = city.population;
    if (!Number.isInteger(p) || p < 500 || p > POP_CAP) out.push(`city ${city.id} (${city.name}): population ${p} outside [500, ${POP_CAP}]`);
    for (const f of FACTION_IDS) {
      const op = city.opinion?.[f];
      if (typeof op !== 'number' || !Number.isFinite(op) || op < 0 || op > 100) out.push(`city ${city.id} (${city.name}): ${f} opinion ${op} outside [0, 100]`);
    }
    const s = city.smog;
    if (!s || ![0, 1, 2, 3, 4].includes(s.tier) || !Number.isInteger(s.months) || !Number.isInteger(s.blackLung) || s.blackLung < 0 || !Number.isFinite(s.level) || s.level < 0 || s.level > 1) {
      out.push(`city ${city.id} (${city.name}): bad smog ${JSON.stringify(s)}`);
    }
    if (!classesValid(city.classes)) out.push(`city ${city.id} (${city.name}): bad classes ${JSON.stringify(city.classes)}`);
  }

  for (const v of Object.values(state.vehicles)) {
    if (v.routeId !== null && !state.routes[v.routeId]) out.push(`vehicle ${v.id}: route ${v.routeId} does not exist`);
    if (!Number.isInteger(v.builtYear) || v.builtYear > state.date.year) out.push(`vehicle ${v.id}: builtYear ${v.builtYear} is not a past year`);
  }

  for (const r of Object.values(state.routes)) {
    for (const s of r.stops) {
      if (!state.buildings[s.buildingId]) out.push(`route ${r.id}: stop building ${s.buildingId} does not exist`);
    }
  }

  /** strike card uid → the building whose strike it is bound to */
  const strikeCards = new Map<number, number>();
  for (const b of Object.values(state.buildings)) {
    const s = b.staffing;
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1) out.push(`building ${b.id}: staffing ${s} outside [0, 1]`);
    if (!Number.isInteger(b.builtYear) || b.builtYear > state.date.year) out.push(`building ${b.id}: builtYear ${b.builtYear} is not a past year`);
    const k = b.strike;
    if (k) {
      const ok = Number.isInteger(k.until) && Number.isInteger(k.since) && k.until > k.since && k.until - k.since <= STRIKE_MAX_DAYS
        && typeof k.reason === 'string' && k.reason.length > 0 && state.cities.some((c) => c.id === k.cityId);
      if (!ok) out.push(`building ${b.id}: bad strike ${JSON.stringify(k)}`);
      // a bound card is a pending card, and no other strike is bound to it
      if (k.cardUid !== null && k.cardUid !== undefined) {
        if (!Number.isInteger(k.cardUid) || !state.politics.cards.pending.some((p) => p.uid === k.cardUid)) {
          out.push(`building ${b.id}: strike card ${k.cardUid} is not pending`);
        }
        if (strikeCards.has(k.cardUid)) out.push(`building ${b.id}: strike card ${k.cardUid} also bound to building ${strikeCards.get(k.cardUid)}`);
        strikeCards.set(k.cardUid, b.id);
      }
    }
    for (const t of footprint(b)) {
      if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) {
        out.push(`building ${b.id}: footprint tile (${t.x},${t.y}) out of bounds`);
        continue;
      }
      const tile = map.tiles[t.y * map.width + t.x];
      if (tile.buildingId !== b.id) out.push(`building ${b.id}: tile (${t.x},${t.y}) has buildingId ${tile.buildingId}`);
    }
  }

  for (let i = 0; i < map.tiles.length; i++) {
    const p = map.tiles[i].pollution;
    if (!Number.isFinite(p) || p < 0 || p > POLLUTION_CAP) {
      out.push(`tile (${i % map.width},${Math.floor(i / map.width)}): pollution ${p} outside [0, ${POLLUTION_CAP}]`);
    }
  }

  const w = state.weather;
  for (const [k, v] of [['windX', w?.windX], ['windY', w?.windY]] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -1 || v > 1) out.push(`weather: wind ${k} ${v} outside [-1, 1]`);
  }
  const pi = state.economy?.priceIndex;
  if (typeof pi !== 'number' || !Number.isFinite(pi) || pi <= 0) out.push(`economy: priceIndex ${pi} is not a finite number > 0`);
  if (typeof w?.rain !== 'boolean') out.push(`weather: rain ${w?.rain} is not a boolean`);
  const rd = w?.rainDays;
  if (typeof rd !== 'number' || !Number.isFinite(rd) || rd < 0) out.push(`weather: rainDays ${rd} is not a finite number >= 0`);

  const grudges = state.nemesis?.grudges;
  if (!Array.isArray(grudges)) out.push('nemesis: grudges missing');
  else {
    if (grudges.length > GRUDGE_CAP) out.push(`nemesis: ${grudges.length} grudges, more than ${GRUDGE_CAP}`);
    for (const g of grudges) {
      if (typeof g.weight !== 'number' || !Number.isFinite(g.weight) || g.weight <= 0) out.push(`nemesis: ${g.kind} grudge weight ${g.weight} is not a finite number > 0`);
    }
  }

  // a save from before Task 8 has no bid field: read as none
  const bid = state.nemesis?.bid ?? null;
  if (bid !== null && !(Number.isInteger(bid.since) && Number.isInteger(bid.deadline) && bid.deadline >= bid.since)) {
    out.push(`nemesis: bad hostile bid ${JSON.stringify(bid)}`);
  }

  out.push(...dynastyProblems(state));
  out.push(...exchangeProblems(state));

  const n = map.width * map.height;
  for (const [id, l] of Object.entries(state.layers)) {
    if (l.length !== n) out.push(`layer ${id}: length ${l.length}, expected ${n}`);
  }
  return out;
}

/** The stock exchange (sim/exchange): a listing per company, whole holdings, finite positive prices. */
function exchangeProblems(state: GameState): string[] {
  const listings = state.exchange?.listings;
  if (!listings || typeof listings !== 'object') return ['exchange: listings missing'];
  const out: string[] = [];
  const r = state.exchange.rngState;
  if (typeof r !== 'number' || !Number.isInteger(r)) out.push(`exchange: rngState ${r} is not an integer`);
  for (const id of companyIds(state)) if (!listings[id]) out.push(`exchange: company ${id} has no listing`);
  for (const [id, l] of Object.entries(listings)) {
    if (!state.companies[id]) out.push(`exchange: listing ${id} has no company`);
    let sum = 0;
    let whole = true;
    for (const n of Object.values(l.holders ?? {})) {
      sum += n;
      if (!Number.isInteger(n) || n <= 0) whole = false;
    }
    if (!whole || sum !== l.shares) out.push(`exchange: ${id} holders ${JSON.stringify(l.holders)} do not sum to ${l.shares} whole shares`);
    if (typeof l.price !== 'number' || !Number.isFinite(l.price) || l.price <= 0) out.push(`exchange: ${id} price ${l.price} is not a finite number > 0`);
    if (typeof l.fundamental !== 'number' || !Number.isFinite(l.fundamental) || l.fundamental <= 0) out.push(`exchange: ${id} fundamental ${l.fundamental} is not a finite number > 0`);
    if (typeof l.sentiment !== 'number' || !(l.sentiment >= SENTIMENT_MIN && l.sentiment <= SENTIMENT_MAX)) out.push(`exchange: ${id} sentiment ${l.sentiment} outside [${SENTIMENT_MIN}, ${SENTIMENT_MAX}]`);
    if (!Array.isArray(l.history) || l.history.length > PRICE_HISTORY_MONTHS) out.push(`exchange: ${id} bad price history`);
    if (l.listed && state.companies[id] && !state.companies[id].active) out.push(`exchange: ${id} is inactive but still listed`);
  }
  return out;
}

/** The player's family (sim/dynasty): unique ids, a valid heir, a living head unless the line ended. */
function dynastyProblems(state: GameState): string[] {
  const out: string[] = [];
  const d = state.dynasty;
  if (!d || typeof d !== 'object' || !d.head) return ['dynasty: missing'];
  if (!Number.isFinite(d.prestige)) out.push(`dynasty: prestige ${d.prestige} is not finite`);
  if (!Number.isInteger(d.generation) || d.generation < 1) out.push(`dynasty: generation ${d.generation} is not an integer >= 1`);
  if (!Array.isArray(d.children)) return [...out, 'dynasty: children missing'];
  if (d.children.length > MAX_CHILDREN) out.push(`dynasty: ${d.children.length} children, more than ${MAX_CHILDREN}`);
  const people = [d.head, ...(d.spouse ? [d.spouse] : []), ...d.children];
  const ids = new Set<number>();
  for (const p of people) {
    if (ids.has(p.id)) out.push(`dynasty: person id ${p.id} used twice`);
    ids.add(p.id);
    if (!Number.isInteger(p.id) || p.id >= d.nextPersonId) out.push(`dynasty: person id ${p.id} not below nextPersonId ${d.nextPersonId}`);
    if (!Number.isFinite(p.born)) out.push(`dynasty: ${p.name} born ${p.born} is not finite`);
    if (p.alive && p.died !== undefined) out.push(`dynasty: ${p.name} is alive but died in ${p.died}`);
    for (const t of p.traits) if (!HEIR_TRAITS.includes(t)) out.push(`dynasty: ${p.name} has unknown trait ${t}`);
  }
  if (d.heirId !== null && !d.children.some((c) => c.id === d.heirId && c.alive)) out.push(`dynasty: heir ${d.heirId} is not a living child`);
  if (!d.head.alive) {
    // only a line that ended may have a dead head: an adult successor would have taken the chair
    const heir = successor(d);
    if (heir && state.date.year - heir.born >= HEIR_MIN_AGE) out.push(`dynasty: ${d.head.name} is dead but ${heir.name} never took the chair`);
  }
  return out;
}
