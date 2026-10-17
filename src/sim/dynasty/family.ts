/**
 * Phase 4 player dynasty (spec §7.2): the family's life, one system (`dynasty` in SYSTEMS).
 *
 * - Monthly (`dynastyMonth`): the head's traits drift national opinion (`dynastyModifier`, through
 *   adjustOpinion with 'The family name', unlogged like the company edicts' drive); at the end of April, a single head under 50 is offered the
 *   `marriage` card (data/cards/early.ts) when the spring draw did not bring it, from 1905 on.
 * - Yearly (`dynastyYear`, December): while married and under 50, a child is born with chance 0.35 (up
 *   to 5, each with 1-2 traits); then the head dies with chance `mortality(age)`.
 * - On the head's death (`headDies`): the named heir, else the eldest living child, takes the chair if
 *   18 or older (generation +1, prestige +10, single and childless again); each passed-over adult
 *   sibling may open a scandal card. With no such heir the line ends: `gameOver`.
 *
 * Fair chances (plan Review Focus 1, Task 5 rulings):
 * - every head, not only the founder, is offered the marriage card each April while single and under
 *   50; its default choice marries;
 * - a head whose successor is still under 18 holds on (no death roll) until that heir comes of age or
 *   the head turns 90;
 * - a married head who reaches 50 childless, or an heir who inherits too old to be offered a match
 *   before 50, takes in a grown nephew or niece (aged 20) as a child.
 * So the line ends only when a head who chose to stay single reaches 90 childless (or a named heir is
 * still a minor then). Determinism: the state rng only (`chance`, `pick`, `randInt`).
 */
import { err, ok, type Result } from '../../core/result';
import { FACTION_IDS } from '../../data/factions';
import { publishNews } from '../news';
import { openCardById, triggerCard } from '../politics/cards';
import { adjustOpinion } from '../politics/factions';
import { chance } from '../rng';
import type { GameState, SimContext } from '../types';
import {
  age,
  canMarry,
  CHILDBEARING_AGE_LIMIT,
  freshGivenName,
  HEIR_MIN_AGE,
  isFemale,
  livingChildren,
  successor,
  dynastyModifier,
  MAX_CHILDREN,
  rollTraits,
  SUCCESSION_PRESTIGE,
  surname,
} from './types';

// the heir rule lives in the leaf types.ts (invariants and the panel read it); re-exported here
export { successor };

/** The marriage card's id (data/cards/early.ts). */
export const MARRIAGE_CARD_ID = 'marriage';
/** The first year the marriage card is offered (its spring window opens then). */
export const MARRIAGE_FIRST_YEAR = 1905;
/** The month whose end brings the marriage card when the 1 April draw did not. */
export const MARRIAGE_MONTH = 4;
/** Chance per December of a child while married and under 50. */
export const BIRTH_CHANCE = 0.35;
/** Chance per passed-over adult sibling of a scandal card at a succession. */
export const PASSED_OVER_SCANDAL_CHANCE = 0.3;
export const LINE_ENDED = 'The family line has ended';
/** The age of the nephew or niece a head who inherits at 50 or older takes in. */
export const ADOPTED_HEIR_AGE = 20;

/** The head's chance of dying in a December at `age`: 0 to 55, then +1.2% a year, and certain at 90. */
export function mortality(a: number): number {
  if (a >= 90) return 1;
  if (a <= 55) return 0;
  return (a - 55) * 0.012;
}

/** Names `personId` the heir. Refused unless it is a living child of the head. */
export function nameHeir(state: GameState, personId: number): Result {
  const d = state.dynasty;
  if (!d.head.alive) return err(LINE_ENDED);
  const kid = d.children.find((c) => c.id === personId);
  if (!kid) return err('Only a child of the head can be named heir');
  if (!kid.alive) return err(`${kid.name} has died`);
  d.heirId = personId;
  return ok();
}

function biggestCityId(state: GameState): number | null {
  let best: number | null = null;
  let pop = -1;
  for (const c of state.cities) {
    if (c.population > pop) {
      best = c.id;
      pop = c.population;
    }
  }
  return best;
}

/** A grown relative (aged ADOPTED_HEIR_AGE) joins the head's children, with 1-2 traits. */
function adoptHeir(ctx: SimContext): void {
  const { state } = ctx;
  const d = state.dynasty;
  const female = chance(state, 0.5);
  const name = `${freshGivenName(state, d, female)} ${surname(d.head)}`;
  d.children.push({ id: d.nextPersonId++, name, born: state.date.year - ADOPTED_HEIR_AGE, traits: rollTraits(state, 2), alive: true });
  publishNews(ctx, 'civic', `${d.head.name.toUpperCase()} TAKES IN AN HEIR`, `Too late in life for children of ${isFemale(d.head) ? 'her' : 'his'} own, ${d.head.name} names ${female ? 'a niece' : 'a nephew'}, ${name}, to carry on the family firm.`);
}

/** The head dies now: the successor inherits if 18 or older, else the family line ends (game over). */
export function headDies(ctx: SimContext): void {
  const { state } = ctx;
  const d = state.dynasty;
  const year = state.date.year;
  const old = d.head;
  if (!old.alive) return;
  old.alive = false;
  old.died = year;
  const heir = successor(d);
  if (!heir || age(heir, year) < HEIR_MIN_AGE) {
    publishNews(ctx, 'civic', `${old.name.toUpperCase()} DIES WITHOUT AN HEIR`, `${old.name} has died aged ${age(old, year)}. ${LINE_ENDED}.`);
    ctx.bus.emit({ type: 'gameOver', reason: LINE_ENDED });
    state.speed = 0;
    return;
  }
  const passedOver = livingChildren(d).filter((c) => c.id !== heir.id && age(c, year) >= HEIR_MIN_AGE);
  d.head = heir;
  d.spouse = null;
  d.children = [];
  d.heirId = null;
  d.generation += 1;
  d.prestige += SUCCESSION_PRESTIGE;
  publishNews(ctx, 'civic', `${old.name.toUpperCase()} IS DEAD; ${heir.name.toUpperCase()} TAKES THE CHAIR`,
    `${old.name} has died aged ${age(old, year)}. ${heir.name}, ${age(heir, year)}, now heads the family firm.`);
  // a head who inherits too old to be offered a match before 50 (next April) would never get a chance
  // at an heir: the family takes in a grown nephew or niece instead
  if (age(heir, year + 1) >= CHILDBEARING_AGE_LIMIT) adoptHeir(ctx);
  const city = biggestCityId(state);
  for (let i = 0; i < passedOver.length; i++) {
    if (chance(state, PASSED_OVER_SCANDAL_CHANCE) && city !== null) triggerCard(ctx, 'scandal', city);
  }
}

/** Monthly: the head's opinion drift, and the marriage card at the end of April for a single head. */
export function dynastyMonth(ctx: SimContext): void {
  const { state } = ctx;
  const d = state.dynasty;
  if (!d.head.alive) return;
  const { opinion } = dynastyModifier(state);
  for (const f of FACTION_IDS) if (opinion[f] !== 0) adjustOpinion(state, f, 'national', opinion[f], 'The family name', { log: false });
  const { year, month } = state.date;
  if (month === MARRIAGE_MONTH && year >= MARRIAGE_FIRST_YEAR && canMarry(d, year)) openCardById(ctx, MARRIAGE_CARD_ID, null);
}

/** Yearly (December): maybe a child, then maybe the head's death. */
export function dynastyYear(ctx: SimContext): void {
  const { state } = ctx;
  const d = state.dynasty;
  const year = state.date.year;
  if (!d.head.alive) return;
  const headAge = age(d.head, year);
  if (d.spouse !== null && headAge < CHILDBEARING_AGE_LIMIT && d.children.length < MAX_CHILDREN && chance(state, BIRTH_CHANCE)) {
    const female = chance(state, 0.5);
    const name = `${freshGivenName(state, d, female)} ${surname(d.head)}`;
    d.children.push({ id: d.nextPersonId++, name, born: year, traits: rollTraits(state, 2), alive: true });
    publishNews(ctx, 'civic', `AN HEIR FOR THE ${surname(d.head).toUpperCase()}S`, `${d.head.name} announces the birth of ${name}.`);
  }
  // a married head past childbearing with no child takes in a grown nephew or niece (a single head does not)
  if (d.spouse !== null && headAge >= CHILDBEARING_AGE_LIMIT && livingChildren(d).length === 0) adoptHeir(ctx);
  // the head holds on until his successor comes of age (or he turns 90): no unfair deaths
  const heir = successor(d);
  const p = heir && age(heir, year) >= HEIR_MIN_AGE ? mortality(headAge) : headAge >= 90 ? 1 : 0;
  if (p > 0 && chance(state, p)) headDies(ctx);
}
