/**
 * City mayors and staggered elections. Every city has one mayor, from one faction, re-elected every
 * four years; the council is the same faction in this phase. All randomness is the state rng.
 *
 * Founding: cities exist only from mapgen/createGame (nothing founds one mid-game), so a city's
 * politics is always built by `newCityPolitics` at creation or by the save migration.
 */
import { err, ok, type Result } from '../../core/result';
import { FACTION_IDS, FACTIONS, factionName, type FactionId } from '../../data/factions';
import { POLITICIANS } from '../../data/politicians';
import { MONTHS_PER_YEAR } from '../clock';
import { publishNews } from '../news';
import { pick, random } from '../rng';
import type { City, GameState, SimContext } from '../types';
import { adjustOpinion } from './factions';
import type { CityPolitics } from './types';

export const ELECTION_TERM = 48;
export const ENDORSE_WINDOW = 12;
/** Earliest a migrated or new city's first election may fall, in months from now. */
export const MIN_LEAD = 6;
export const ENDORSE_SHARE_BONUS = 1.3;
export const MAX_SLUSH = 3;
const DEFAULT_FACTION: FactionId = FACTION_IDS.reduce((a, b) => (FACTIONS[b].weight > FACTIONS[a].weight ? b : a));

export const monthIndex = (d: { year: number; month: number }) => d.year * MONTHS_PER_YEAR + (d.month - 1);

export function firstElection(cityIndex: number, startYear: number): number {
  return (startYear + 2 + (cityIndex % 4)) * MONTHS_PER_YEAR + ((cityIndex * 5) % 9) + 2;
}

/** The deterministic default mayor's name: the first parts of the default faction. */
export function defaultMayorName(faction: FactionId = DEFAULT_FACTION): string {
  const p = POLITICIANS[faction];
  return `${p.first[0]} ${p.last[0]}`;
}

export function mayorName(state: GameState, faction: FactionId): string {
  const p = POLITICIANS[faction];
  return `${pick(state, p.first)} ${pick(state, p.last)}`;
}

/** Politics for a new or migrated city: the top-weight faction's default mayor, first election staggered. */
export function newCityPolitics(cityIndex: number, startYear: number, nowIndex: number): CityPolitics {
  return {
    mayor: { name: defaultMayorName(), faction: DEFAULT_FACTION, since: nowIndex },
    council: DEFAULT_FACTION,
    nextElection: Math.max(firstElection(cityIndex, startYear), nowIndex + MIN_LEAD),
    endorsed: null,
    slush: 0,
    scandalRisk: 0,
    edicts: [],
  };
}

export function voteShares(city: City): Record<FactionId, number> {
  const p = city.politics;
  const scores = {} as Record<FactionId, number>;
  let total = 0;
  for (const f of FACTION_IDS) {
    let s = FACTIONS[f].weight * (0.6 + (0.8 * Math.abs(city.opinion[f] - 50)) / 50);
    if (p.endorsed === f) {
      s *= ENDORSE_SHARE_BONUS;
      s *= 1 + 0.25 * Math.min(MAX_SLUSH, Math.max(0, p.slush));
    }
    scores[f] = s;
    total += s;
  }
  const shares = {} as Record<FactionId, number>;
  for (const f of FACTION_IDS) shares[f] = scores[f] / total;
  return shares;
}

/** Draws a winner over the shares; always returns a faction (float shortfall falls to the last one). */
export function drawWinner(state: GameState, shares: Record<FactionId, number>): FactionId {
  let r = random(state);
  for (const f of FACTION_IDS) {
    r -= shares[f];
    if (r < 0) return f;
  }
  return FACTION_IDS[FACTION_IDS.length - 1];
}

export function holdElection(ctx: SimContext, city: City): FactionId {
  const { state } = ctx;
  const p = city.politics;
  const shares = voteShares(city);
  const winner = drawWinner(state, shares);
  const now = monthIndex(state.date);
  p.mayor = { name: mayorName(state, winner), faction: winner, since: now };
  p.council = winner;
  p.nextElection += ELECTION_TERM;
  while (p.nextElection <= now) p.nextElection += ELECTION_TERM;
  p.endorsed = null;
  p.slush = 0;
  const year = state.date.year;
  const body = FACTION_IDS.map((f) => `${factionName(f, year)} ${Math.round(shares[f] * 100)}%`).join(', ');
  publishNews(ctx, 'politics', `${factionName(winner, year).toUpperCase()} CANDIDATE ${p.mayor.name.toUpperCase()} WINS ${city.name.toUpperCase()}`, `Vote shares: ${body}.`);
  ctx.bus.emit({ type: 'election', cityId: city.id, winner });
  return winner;
}

export function electionsMonth(ctx: SimContext): void {
  const now = monthIndex(ctx.state.date);
  for (const city of ctx.state.cities) {
    if (city.politics.nextElection <= now) holdElection(ctx, city);
  }
}

/**
 * The player backs a faction in a city's coming election. Allowed only within ENDORSE_WINDOW months
 * of it, and once per cycle (no switching: the first endorsement stands until the election resets it).
 */
export function endorse(ctx: SimContext, cityId: number, faction: FactionId): Result {
  const { state } = ctx;
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return err('Unknown city');
  if (!FACTIONS[faction]) return err('Unknown faction');
  const p = city.politics;
  if (p.nextElection - monthIndex(state.date) > ENDORSE_WINDOW) return err(`Too early to endorse: ${city.name} votes more than a year from now`);
  if (p.endorsed !== null) return err(`You have already endorsed ${factionName(p.endorsed, state.date.year)} in ${city.name}`);
  p.endorsed = faction;
  for (const f of FACTION_IDS) adjustOpinion(state, f, cityId, f === faction ? 5 : -3, 'Election endorsement');
  return ok();
}
