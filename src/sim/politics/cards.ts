/**
 * Event card engine. A card is drawn every 1 April from 1901 (`drawSpringCard`) or triggered by a
 * sim event (`triggerCard`, called from the sim itself, never from bus listeners), waits in
 * `state.politics.cards.pending` and is answered with `resolveCard`. Only `CardInstance` ids live
 * in state; the definitions (with their functions) live in data/cards.ts.
 *
 * Cards never trap the player: every card has a choice that costs nothing (catalog test), an
 * unaffordable choice is refused with 'Not enough money', and a card left open AUTO_RESOLVE_DAYS
 * (headless runs; the UI pauses while one is open) takes its default, or the first affordable, choice.
 *
 * Determinism: candidates are filtered in table order and one is picked by weight with a single
 * `random(state)` draw; the city of a city card is chosen without randomness.
 */
import { err, ok, type Result } from '../../core/result';
import { CARDS, CARDS_BY_ID, type CardChoice, type CardDef, type CardTrigger } from '../../data/cards';
import { FACTION_IDS, factionName, type FactionId } from '../../data/factions';
import { dateToDays } from '../clock';
import { PLAYER_ID } from '../companies';
import { canAfford, earn, spend } from '../finance';
import { publishNews } from '../news';
import { random } from '../rng';
import { assetValue, nextId } from '../state';
import type { GameState, SimContext } from '../types';
import { adjustOpinion } from './factions';
import type { CardInstance } from './types';

/** Days a card may stay unanswered before it resolves itself with its default choice. */
export const AUTO_RESOLVE_DAYS = 60;
/** The first spring with a card. */
export const FIRST_CARD_YEAR = 1901;
/** Oldest entries of `cards.history` are dropped beyond this. */
export const HISTORY_CAP = 200;
/** The scale of a starting company's net worth: authored costs are for a company this size. */
export const BASE_NET_WORTH = 300_000;
export const MAX_CARD_SCALE = 40;

type CardTable = Readonly<Record<string, CardDef>>;

/** Spring cards are drawn on this day (1 April). */
export const SPRING_MONTH = 4;
export const SPRING_DAY = 1;

/** The factions a card's choices touch, in FACTION_IDS order (every faction when none). */
function cardFactions(card: CardDef): FactionId[] {
  const used = new Set(card.choices.flatMap((c) => c.effects.map((e) => e.faction)));
  const list = FACTION_IDS.filter((f) => used.has(f));
  return list.length > 0 ? list : [...FACTION_IDS];
}

/**
 * The town a spring city card goes to: among the towns where the card's condition passes, the one
 * where the card's factions hold the most extreme opinion (farthest from 50), ties to the lowest id.
 * Null when no town qualifies. `ignoreCondition` ranks every town (forceCard).
 */
export function cardCity(state: GameState, card: CardDef, ignoreCondition = false): number | null {
  const factions = cardFactions(card);
  let best: number | null = null;
  let bestScore = -1;
  for (const c of [...state.cities].sort((a, b) => a.id - b.id)) {
    if (!ignoreCondition && card.condition && !card.condition(state, c.id)) continue;
    const score = Math.max(...factions.map((f) => Math.abs(c.opinion[f] - 50)));
    if (score > bestScore) {
      best = c.id;
      bestScore = score;
    }
  }
  return best;
}

function onCooldown(state: GameState, card: CardDef): boolean {
  const year = state.date.year;
  return state.politics.cards.history.some((h) => h.id === card.id && year < h.year + card.cooldownYears);
}

/**
 * The cards that could open now for `trigger`, in table order, each with its town. `cityId` is the
 * triggering town (used by city cards; spring city cards pick theirs with cardCity).
 */
export function eligibleCards(
  state: GameState,
  trigger: CardTrigger,
  cityId: number | null,
  table: readonly CardDef[] = CARDS,
): { card: CardDef; cityId: number | null }[] {
  const year = state.date.year;
  const out: { card: CardDef; cityId: number | null }[] = [];
  for (const card of table) {
    if (card.trigger !== trigger) continue;
    if (year < card.years[0] || year > card.years[1]) continue;
    if (onCooldown(state, card)) continue;
    if (state.politics.cards.pending.some((p) => p.cardId === card.id)) continue;
    let city: number | null = null;
    if (card.needsCity) {
      city = trigger === 'spring' ? cardCity(state, card) : cityId;
      if (city === null || !state.cities.some((c) => c.id === city)) continue;
    }
    if (card.condition && !card.condition(state, city)) continue;
    out.push({ card, cityId: city });
  }
  return out;
}

/** Opens one card for `trigger`, picked by weight with one rng draw; nothing when none is eligible. */
function openCard(ctx: SimContext, trigger: CardTrigger, cityId: number | null): void {
  const { state } = ctx;
  const list = eligibleCards(state, trigger, cityId);
  if (list.length === 0) return;
  const total = list.reduce((s, e) => s + Math.max(0, e.card.weight), 0);
  let r = random(state) * total;
  let chosen = list[list.length - 1];
  for (const e of list) {
    r -= Math.max(0, e.card.weight);
    if (r < 0) {
      chosen = e;
      break;
    }
  }
  const inst: CardInstance = { uid: nextId(state), cardId: chosen.card.id, cityId: chosen.cityId, openedDay: dateToDays(state.date) };
  state.politics.cards.pending.push(inst);
}

/**
 * Opens card `cardId` for a sim event that names its card (a law passing), unless that card is
 * already pending. Returns whether it opened. No rng, no cooldown or era checks.
 */
export function openCardById(ctx: SimContext, cardId: string, cityId: number | null): boolean {
  const { state } = ctx;
  if (!CARDS_BY_ID[cardId] || state.politics.cards.pending.some((p) => p.cardId === cardId)) return false;
  state.politics.cards.pending.push({ uid: nextId(state), cardId, cityId, openedDay: dateToDays(state.date) });
  return true;
}

/** 1 April, once a year from FIRST_CARD_YEAR (`nextCardYear` guards against a second draw). */
export function drawSpringCard(ctx: SimContext): void {
  const { state } = ctx;
  const year = state.date.year;
  if (year < FIRST_CARD_YEAR || year < state.politics.nextCardYear) return;
  state.politics.nextCardYear = year + 1;
  openCard(ctx, 'spring', null);
}

/** Opens a card for a sim event (election, scandal; Phase 3+: strike, disaster, invention, crash). */
export function triggerCard(ctx: SimContext, trigger: CardDef['trigger'], cityId: number | null): void {
  openCard(ctx, trigger, cityId);
}

/**
 * Ruling R-Q8: card money grows with the century and with the player. The larger of the era scale
 * (1 in 1900, 3 in 1950) and the wealth scale (player net worth / $300,000), clamped to 1..40.
 */
export function cardScale(state: GameState): number {
  const era = 1 + (state.date.year - 1900) / 25;
  // net worth as rival/takeover.ts's netWorth (not imported: it would close an import cycle)
  const c = state.companies[PLAYER_ID];
  const wealth = (c.money - c.loan + assetValue(state, PLAYER_ID)) / BASE_NET_WORTH;
  return Math.min(MAX_CARD_SCALE, Math.max(1, era, wealth));
}

/** A choice's cost now, in today's dollars, rounded to $100 (negative: money received). */
export function choiceCost(state: GameState, choice: CardChoice): number {
  return Math.round((choice.cost * cardScale(state)) / 100) * 100;
}

export function canAffordChoice(state: GameState, choice: CardChoice): boolean {
  const cost = choiceCost(state, choice);
  return cost <= 0 || canAfford(state.companies[PLAYER_ID], cost);
}

/** The card's title and body with `{city}` and `{faction}` filled in. */
export function cardText(state: GameState, inst: CardInstance, defs: CardTable = CARDS_BY_ID): { title: string; body: string } {
  const card = defs[inst.cardId];
  if (!card) return { title: '', body: '' };
  const city = state.cities.find((c) => c.id === inst.cityId);
  const year = state.date.year;
  const faction = city ? city.politics.mayor.faction : cardFactions(card)[0];
  const fill = (s: string) => s.replaceAll('{city}', city?.name ?? 'the valley').replaceAll('{faction}', factionName(faction, year));
  return { title: fill(card.title), body: fill(card.body) };
}

/**
 * Answers pending card `uid` with choice `choice`: checks affordability, books the cost under
 * 'events', applies the effects through adjustOpinion, runs `apply`, records the card in history
 * and prints the decision in the papers.
 */
export function resolveCard(ctx: SimContext, uid: number, choice: number, defs: CardTable = CARDS_BY_ID): Result {
  const { state } = ctx;
  const cards = state.politics.cards;
  const idx = cards.pending.findIndex((p) => p.uid === uid);
  if (idx < 0) return err('No such card');
  const inst = cards.pending[idx];
  const card = defs[inst.cardId];
  if (!card) return err('No such card');
  const c = card.choices[choice];
  if (!c) return err('No such choice');
  if (!canAffordChoice(state, c)) return err('Not enough money');
  const player = state.companies[PLAYER_ID];
  const cost = choiceCost(state, c);
  if (cost > 0) spend(player, 'events', cost, state.date);
  else if (cost < 0) earn(player, 'events', -cost, state.date);
  const { title } = cardText(state, inst, defs);
  for (const e of c.effects) {
    const scope = e.scope === 'national' ? 'national' : inst.cityId;
    if (scope === null) continue;
    adjustOpinion(state, e.faction, scope, e.delta, title);
  }
  c.apply?.(ctx, inst.cityId, inst);
  cards.pending.splice(cards.pending.indexOf(inst), 1);
  cards.history.push({ id: card.id, year: state.date.year, choice });
  if (cards.history.length > HISTORY_CAP) cards.history.splice(0, cards.history.length - HISTORY_CAP);
  publishNews(ctx, 'politics', title.toUpperCase(), `${player.name} chose: ${c.label}.`);
  ctx.bus.emit({ type: 'cardResolved', cardId: card.id, uid });
  return ok();
}

/** Resolves every card pending AUTO_RESOLVE_DAYS or more: default choice, else the first affordable one. */
export function cardsDay(ctx: SimContext, defs: CardTable = CARDS_BY_ID): void {
  const { state } = ctx;
  const cards = state.politics.cards;
  // registries are append-only, but a save could still name a card this build does not know
  // (in place: the controller holds the array to notice new cards)
  for (let i = cards.pending.length - 1; i >= 0; i--) if (!defs[cards.pending[i].cardId]) cards.pending.splice(i, 1);
  const today = dateToDays(state.date);
  for (const inst of [...cards.pending]) {
    if (today - inst.openedDay >= AUTO_RESOLVE_DAYS) autoResolve(ctx, inst.uid, defs);
  }
}

/** Answers pending card `uid` as a headless run would: its default choice, else the first affordable one. */
export function autoResolve(ctx: SimContext, uid: number, defs: CardTable = CARDS_BY_ID): Result {
  const { state } = ctx;
  const inst = state.politics.cards.pending.find((p) => p.uid === uid);
  const card = inst && defs[inst.cardId];
  if (!card) return err('No such card');
  const def = card.choices[card.defaultChoice];
  const choice = def && canAffordChoice(state, def) ? card.defaultChoice : card.choices.findIndex((c) => canAffordChoice(state, c));
  return resolveCard(ctx, uid, choice, defs);
}

/** Opens card `cardId` now, whatever its trigger, era, cooldown or condition (dev and tests); false if unknown or no town for a city card. */
export function forceCard(ctx: SimContext, cardId: string): boolean {
  const { state } = ctx;
  const card = CARDS_BY_ID[cardId];
  if (!card) return false;
  const cityId = card.needsCity ? cardCity(state, card, true) : null;
  if (card.needsCity && cityId === null) return false;
  state.politics.cards.pending.push({ uid: nextId(state), cardId, cityId, openedDay: dateToDays(state.date) });
  return true;
}

/** The politics system's daily hook: the spring draw on 1 April, then auto-resolve. */
export function cardsDayHook(ctx: SimContext): void {
  const d = ctx.state.date;
  if (d.month === SPRING_MONTH && d.day === SPRING_DAY) drawSpringCard(ctx);
  cardsDay(ctx);
}
