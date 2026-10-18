/**
 * Smogsworth Jr. (Phase 4): the founding Baron dies some December between 1940 and 1955 and his son
 * takes the chair. Rolled once a year with the state rng; forced in December 1955; happens once.
 * An inactive Baron (taken over, bankrupt) still passes the title on, silently.
 */
import { BARON_ID } from '../companies';
import { openCardById } from '../politics/cards';
import { publishNews } from '../news';
import { chance, pick } from '../rng';
import type { SimContext } from '../types';
import { scaleGrudges } from './grudges';
import { BARON_TRAIT_IDS, FOUNDER, type BaronHead } from './types';

export const SUCCESSION_FIRST_YEAR = 1940;
export const SUCCESSION_FORCED_YEAR = 1955;
/** Junior's inherited grudges keep this share of their weight */
export const SUCCESSION_GRUDGE_FACTOR = 0.6;

export const JUNIOR: Readonly<BaronHead> = { name: 'Reginald Smogsworth Jr.', born: 1898, generation: 2 };

/** December's chance of the old Baron's death: (year - 1939) / 16, certain in 1955. */
export const successionChance = (year: number): number => (year - (SUCCESSION_FIRST_YEAR - 1)) / 16;

/** Monthly (nemesisMonth): in December from 1940, maybe the succession. */
export function successionMonth(ctx: SimContext): void {
  const { state } = ctx;
  const n = state.nemesis;
  const { year, month } = state.date;
  if (n.succession.done || month !== 12 || year < SUCCESSION_FIRST_YEAR) return;
  if (year < SUCCESSION_FORCED_YEAR && !chance(state, successionChance(year))) return;

  n.head = { ...JUNIOR };
  const free = BARON_TRAIT_IDS.filter((t) => !n.traits.includes(t));
  if (free.length > 0) n.traits.push(pick(state, free));
  scaleGrudges(state, SUCCESSION_GRUDGE_FACTOR);
  n.succession = { done: true, year };
  if (state.companies[BARON_ID]?.active === true) {
    publishNews(
      ctx,
      'rival',
      'THE OLD BARON IS DEAD; LONG LIVE THE BARON',
      `${FOUNDER.name} has passed away. His son, Reginald Jr., takes the chair, and the ledger of old grudges with it.`,
    );
    openCardById(ctx, 'baron_funeral', null);
  }
}
