/** Task 7's seed cards. Ids are save data: never rename or remove one. */
import { adjustOpinion } from '../../sim/politics/factions';
import { cityOf, type CardDef } from './types';

/** The six Task 7 cards, first in the table (draw order: see index.ts). */
export const SEED_CARDS: readonly CardDef[] = [
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
