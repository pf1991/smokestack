/**
 * Phase 4 player dynasty (spec §7.2): the head of the family, the spouse, the children and the named
 * heir, stored as plain JSON on `GameState.dynasty`. This module is a leaf (data and rng only), so
 * card data and the politics code can read `dynastyModifier` and `marry` without import cycles; the
 * yearly life of the family (births, deaths, succession) lives in dynasty/family.ts.
 */
import { DYNASTY_TRAITS, FEMALE_GIVEN_NAMES, MALE_GIVEN_NAMES, type DynastyModifiers } from '../../data/dynasty';
import { FACTION_IDS, type FactionId } from '../../data/factions';
import { pick, randInt, type RngHolder } from '../rng';

export const HEIR_TRAITS = ['shrewd', 'charming', 'reckless', 'idealist', 'brute'] as const;
export type HeirTrait = (typeof HEIR_TRAITS)[number];

export interface Person {
  id: number;
  name: string;
  /** birth year */
  born: number;
  traits: HeirTrait[];
  alive: boolean;
  /** the year of death (absent while alive, and for the dead of states from before this field) */
  died?: number;
}

export interface DynastyState {
  head: Person;
  spouse: Person | null;
  /** the head's children, eldest first */
  children: Person[];
  /** the named heir (a living child), or null: then the eldest living child inherits */
  heirId: number | null;
  /** 1 for the founder; +1 at each succession */
  generation: number;
  prestige: number;
  nextPersonId: number;
}

/** The founder's given name. */
export const FOUNDER_GIVEN_NAME = 'Josiah';
/**
 * The founder's age at the start of the game (born 1872 in a 1900 start). Ruling (Task 5): the plan's
 * 1862 left him 43 at the first marriage card, so at most 7 years of children before 50 and a ~5%
 * chance per game of no heir at all; at 28 he has 17.
 */
export const FOUNDER_AGE = 28;
/** No children are born to a head this age or older. */
export const CHILDBEARING_AGE_LIMIT = 50;
/** Most children a head can have. */
export const MAX_CHILDREN = 5;
/** An heir must be this old to take the chair. */
export const HEIR_MIN_AGE = 18;
export const MARRIAGE_PRESTIGE = 5;
/** A spouse is at least this old at the wedding. */
export const MIN_SPOUSE_AGE = 18;
export const SUCCESSION_PRESTIGE = 10;

/** Age in `year`; the dead stop ageing at the year they died. */
export const age = (p: Person, year: number): number => (p.died ?? year) - p.born;

/** The family name: the first word of the company name ("Gilded Gear & Co." gives "Gilded"). */
export function familyName(companyName: string): string {
  const word = companyName.trim().split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, '') ?? '';
  return word.length > 0 ? word : 'Smith';
}

/** The surname a person carries (the last word of their name). */
export const surname = (p: Person): string => p.name.split(' ').slice(-1)[0];

/** Whether a given name is a daughter's (or a wife's): drives the portrait and the spouse's sex. */
export const isFemale = (p: Person): boolean => FEMALE_GIVEN_NAMES.includes(p.name.split(' ')[0]);

/** 1–`max` distinct traits, rolled from the state rng (one draw for the count when max > 1, one per trait). */
export function rollTraits(rng: RngHolder, max: number): HeirTrait[] {
  const n = max > 1 ? randInt(rng, 1, max) : 1;
  const out: HeirTrait[] = [];
  while (out.length < n) out.push(pick(rng, HEIR_TRAITS.filter((t) => !out.includes(t))));
  return out;
}

/** A fresh dynasty: the founder Josiah, single and childless, with 1 rolled trait. Draws from `rng`. */
export function newDynasty(rng: RngHolder, companyName: string, startYear: number): DynastyState {
  const head: Person = {
    id: 1,
    name: `${FOUNDER_GIVEN_NAME} ${familyName(companyName)}`,
    born: startYear - FOUNDER_AGE,
    traits: rollTraits(rng, 1),
    alive: true,
  };
  return { head, spouse: null, children: [], heirId: null, generation: 1, prestige: 0, nextPersonId: 2 };
}

/** Whether the head may still marry (and so be offered the marriage card): single and under 50. */
export function canMarry(d: DynastyState, year: number): boolean {
  return d.head.alive && d.spouse === null && age(d.head, year) < CHILDBEARING_AGE_LIMIT;
}

/** A given name of the requested sex not already worn by anyone in the family (falls back to any). */
export function freshGivenName(rng: RngHolder, d: DynastyState, female: boolean): string {
  const pool = female ? FEMALE_GIVEN_NAMES : MALE_GIVEN_NAMES;
  const used = new Set([d.head, d.spouse, ...d.children].filter((p): p is Person => p !== null).map((p) => p.name.split(' ')[0]));
  const free = pool.filter((n) => !used.has(n));
  return pick(rng, free.length > 0 ? free : pool);
}

/**
 * The head marries (the marriage card's "marry for money" and "marry for standing"): a spouse of the
 * other sex a few years younger, taking the family name, and +MARRIAGE_PRESTIGE. No-op when already
 * married. Draws from `rng` (the name and the age gap).
 */
export function marry(state: RngHolder & { dynasty: DynastyState; date: { year: number } }): void {
  const d = state.dynasty;
  if (d.spouse !== null || !d.head.alive) return;
  const female = !isFemale(d.head);
  const given = freshGivenName(state, d, female);
  // a few years younger than the head, but never under MIN_SPOUSE_AGE at the wedding
  const born = Math.min(d.head.born + randInt(state, 0, 6), state.date.year - MIN_SPOUSE_AGE);
  d.spouse = { id: d.nextPersonId++, name: `${given} ${surname(d.head)}`, born, traits: [], alive: true };
  d.prestige += MARRIAGE_PRESTIGE;
}

/** The head's traits combined: multipliers multiply, opinion drift adds. Every field present. */
export function dynastyModifier(state: { dynasty?: DynastyState }): Required<DynastyModifiers> & { opinion: Record<FactionId, number> } {
  const opinion = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<FactionId, number>;
  const out = { opinion, edictCost: 1, cardCost: 1, scandal: 1 };
  const head = state.dynasty?.head;
  if (!head) return out;
  for (const t of head.traits) {
    const m = DYNASTY_TRAITS[t]?.modifiers;
    if (!m) continue;
    out.edictCost *= m.edictCost ?? 1;
    out.cardCost *= m.cardCost ?? 1;
    out.scandal *= m.scandal ?? 1;
    for (const [f, v] of Object.entries(m.opinion ?? {}) as [FactionId, number][]) opinion[f] += v;
  }
  return out;
}

/** The living children, eldest first (ties by id). */
export const livingChildren = (d: DynastyState): Person[] =>
  d.children.filter((c) => c.alive).sort((a, b) => a.born - b.born || a.id - b.id);

/** Who takes the chair now: the named heir if a living child, else the eldest living child; null when childless. */
export function successor(d: DynastyState): Person | null {
  const kids = livingChildren(d);
  return kids.find((c) => c.id === d.heirId) ?? kids[0] ?? null;
}
