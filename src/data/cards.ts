/**
 * Event cards (spec §5): the century's player-caused stories. A card is drawn each spring or
 * triggered by a sim event, waits in `state.politics.cards.pending` and is answered with one of its
 * choices (sim/politics/cards.ts). Definitions hold functions (`condition`, `apply`), so state keeps
 * only `CardInstance` ids and saves stay plain JSON.
 *
 * Adding a card: append one entry to CARDS (ids are save data: never rename or remove one). Every
 * card needs a choice with `cost <= 0`, so the player can always answer it, and `needsCity: true`
 * whenever any effect has `scope: 'city'` (the catalog test checks both).
 */
import type { GameState, SimContext } from '../sim/types';
import { adjustOpinion } from '../sim/politics/factions';
import type { FactionId } from './factions';

export interface CardEffect {
  faction: FactionId;
  scope: 'city' | 'national';
  delta: number;
}

export interface CardChoice {
  label: string;
  /** money spent (positive) or received (negative), booked under 'events' */
  cost: number;
  effects: CardEffect[];
  /** extra consequences beyond the effects; describe them in `note` */
  apply?: (ctx: SimContext, cityId: number | null) => void;
  /** extra effect text shown to the player */
  note?: string;
}

export type CardTrigger = 'spring' | 'election' | 'scandal' | 'strike' | 'disaster' | 'invention' | 'crash';

export interface CardDef {
  id: string;
  title: string;
  /** may contain `{city}` (the card's town) and `{faction}` (the town mayor's faction, else the first effect's) */
  body: string;
  trigger: CardTrigger;
  /** first and last year the card can appear, both inclusive */
  years: [number, number];
  /** relative draw weight among the cards eligible at the same moment */
  weight: number;
  /** years after it was last answered before the card can appear again (0: any time) */
  cooldownYears: number;
  needsCity: boolean;
  condition?: (state: GameState, cityId: number | null) => boolean;
  choices: CardChoice[];
  /** index of the choice taken when the card is left unanswered for AUTO_RESOLVE_DAYS */
  defaultChoice: number;
}

const cityOf = (state: GameState, cityId: number | null) => state.cities.find((c) => c.id === cityId);

/** Table order is the draw order (determinism): append new cards at the end. */
export const CARDS: readonly CardDef[] = [
  {
    id: 'letter_to_editor',
    title: 'A Letter to the Editor',
    body: 'A physician writes to the papers: the smoke from your works, he says, is shortening lives across the valley. The Reformers are reading it aloud at every meeting.',
    trigger: 'spring',
    years: [1901, 2000],
    weight: 3,
    cooldownYears: 6,
    needsCity: false,
    choices: [
      { label: 'Fund a smoke study', cost: 5000, effects: [{ faction: 'reformers', scope: 'national', delta: 4 }] },
      { label: 'Let it blow over', cost: 0, effects: [{ faction: 'reformers', scope: 'national', delta: -2 }] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'founders_parade',
    title: "{city} Founders' Day",
    body: '{city} is planning its Founders\' Day parade and the committee would like a float from the town\'s biggest employer. The printers would also pay well to hang their bills along the route.',
    trigger: 'spring',
    years: [1901, 2000],
    weight: 3,
    cooldownYears: 4,
    needsCity: true,
    choices: [
      {
        label: 'Sponsor a float',
        cost: 3000,
        effects: [
          { faction: 'workers', scope: 'city', delta: 4 },
          { faction: 'church', scope: 'city', delta: 2 },
        ],
      },
      { label: 'Sell advertising on the route', cost: -2000, effects: [{ faction: 'church', scope: 'city', delta: -3 }] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'shop_floor_grumbling',
    title: 'Grumbling on the Shop Floor',
    body: 'Your foremen in {city} report hard words at the gates. The men want more for their labour, and talk of a walkout is getting louder.',
    trigger: 'spring',
    years: [1901, 2000],
    weight: 4,
    cooldownYears: 3,
    needsCity: true,
    condition: (state, cityId) => (cityOf(state, cityId)?.opinion.workers ?? 50) < 40,
    choices: [
      {
        label: 'Pay a spring bonus',
        cost: 4000,
        effects: [
          { faction: 'workers', scope: 'city', delta: 6 },
          { faction: 'oldmoney', scope: 'city', delta: -2 },
        ],
      },
      {
        label: 'Hire private guards',
        cost: 2000,
        effects: [
          { faction: 'workers', scope: 'city', delta: -6 },
          { faction: 'oldmoney', scope: 'city', delta: 3 },
        ],
      },
      { label: 'Say nothing', cost: 0, effects: [{ faction: 'workers', scope: 'city', delta: -3 }] },
    ],
    defaultChoice: 2,
  },
  {
    id: 'new_mayor',
    title: 'A New Mayor for {city}',
    body: 'The {faction} candidate has taken City Hall in {city}. The victory party is tonight, and everyone of note is expected to show their face.',
    trigger: 'election',
    years: [1901, 2000],
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      {
        label: 'Host the victory banquet',
        cost: 2500,
        effects: [],
        apply: (ctx, cityId) => {
          const city = cityOf(ctx.state, cityId);
          if (city) adjustOpinion(ctx.state, city.politics.mayor.faction, city.id, 5, 'Victory banquet');
        },
        note: "The mayor's faction +5 here",
      },
      { label: 'Send a telegram', cost: 0, effects: [], note: 'No effect' },
    ],
    defaultChoice: 1,
  },
  {
    id: 'reporters_at_gates',
    title: 'Reporters at the Gates',
    body: 'Newsmen are camped outside your {city} offices asking about the campaign payments. An editor lets it be known that his silence has a price.',
    trigger: 'scandal',
    years: [1901, 2000],
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      {
        label: 'Pay the editor to bury it',
        cost: 6000,
        effects: [{ faction: 'reformers', scope: 'city', delta: -2 }],
        apply: (ctx, cityId) => {
          const city = cityOf(ctx.state, cityId);
          if (city) city.politics.scandalRisk += 0.1;
        },
        note: 'Scandal risk rises here',
      },
      {
        label: 'Make a public apology',
        cost: 0,
        effects: [
          { faction: 'church', scope: 'city', delta: 4 },
          { faction: 'oldmoney', scope: 'city', delta: -3 },
        ],
      },
    ],
    defaultChoice: 1,
  },
  {
    id: 'war_office',
    title: 'The War Office Calls',
    body: 'With the nation at war, a ministry man arrives with orders for steel and an appeal to buy war bonds. Patriots and profiteers alike are watching.',
    trigger: 'spring',
    years: [1915, 1918],
    weight: 5,
    cooldownYears: 2,
    needsCity: false,
    choices: [
      {
        label: 'Sell steel to the ministry',
        cost: -8000,
        effects: [
          { faction: 'workers', scope: 'national', delta: 2 },
          { faction: 'reformers', scope: 'national', delta: -2 },
        ],
      },
      {
        label: 'Buy war bonds',
        cost: 5000,
        effects: [
          { faction: 'oldmoney', scope: 'national', delta: 3 },
          { faction: 'church', scope: 'national', delta: 2 },
        ],
      },
    ],
    defaultChoice: 0,
  },
];

export const CARDS_BY_ID: Readonly<Record<string, CardDef>> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
