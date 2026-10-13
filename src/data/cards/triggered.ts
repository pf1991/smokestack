/**
 * Cards opened by sim events rather than the spring draw. Election and scandal cards fire now
 * (sim/politics/elections.ts), strike cards since Phase 3 (sim/society/strikes.ts). Disaster, crash and
 * invention cards stay dormant until a later phase calls `triggerCard` with their trigger: city cards
 * need the town passed in, so a disaster with no town (cityId null) skips them.
 */
import { city, DAYS_PER_MONTH, demand, haltNearestWorks, mayorIs, nation, strikeResolution } from './helpers';
import { cityOf, type CardDef } from './types';

const ANY: [number, number] = [1901, 2000];

export const ELECTION_CARDS: readonly CardDef[] = [
  {
    id: 'mayor_workers',
    title: '{faction} Take {city}',
    body: "The new {faction} mayor of {city} arrived at the swearing-in in work boots, promising 'a fair shake for the shop floor'. Next stop: a tour of your works.",
    trigger: 'election',
    years: ANY,
    weight: 3,
    cooldownYears: 0,
    needsCity: true,
    condition: mayorIs('workers'),
    choices: [
      { label: 'Give him the grand tour', cost: 1500, effects: [city('workers', 6), city('oldmoney', -3)] },
      { label: 'Cut the tour short', cost: 0, effects: [city('workers', -2), city('oldmoney', 1)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'mayor_oldmoney',
    title: 'Top Hats at City Hall',
    body: "{city}'s new mayor, of the oldest family in the county, has hung six ancestral portraits in the council chamber and asked local industry for 'a little decorum'.",
    trigger: 'election',
    years: ANY,
    weight: 3,
    cooldownYears: 0,
    needsCity: true,
    condition: mayorIs('oldmoney'),
    choices: [
      { label: 'Join his club', cost: 3000, effects: [city('oldmoney', 8), city('workers', -3)] },
      { label: 'Decline politely', cost: 0, effects: [city('oldmoney', -2), city('workers', 1)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'mayor_reformers',
    title: 'A New Broom for {city}',
    body: 'The {faction} mayor of {city} has promised to sweep the streets, the air and the council chamber, in that order. Your chimneys are on the list.',
    trigger: 'election',
    years: ANY,
    weight: 3,
    cooldownYears: 0,
    needsCity: true,
    condition: mayorIs('reformers'),
    choices: [
      { label: 'Pledge cleaner chimneys', cost: 3000, effects: [city('reformers', 8), city('oldmoney', -2)] },
      { label: 'Lobby the council against it', cost: 2000, effects: [city('reformers', -6), city('oldmoney', 5)] },
      { label: 'Send flowers', cost: 0, effects: [], note: 'No effect' },
    ],
    defaultChoice: 2,
  },
  {
    id: 'mayor_church',
    title: 'Sabbath Comes to {city}',
    body: "The new mayor of {city} opened the first council session with a forty-minute prayer and a list of things that will now close on Sundays, possibly including your works.",
    trigger: 'election',
    years: ANY,
    weight: 3,
    cooldownYears: 0,
    needsCity: true,
    condition: mayorIs('church'),
    choices: [
      {
        label: 'Close on Sundays',
        cost: 0,
        effects: [city('church', 8), city('workers', 2)],
        apply: (ctx, cityId) => haltNearestWorks(ctx, cityId, 7),
        note: 'Your nearest works here halts for 7 days',
      },
      { label: 'Pay overtime and stay open', cost: 2000, effects: [city('workers', 4), city('church', -6)] },
      { label: 'Endow the Sunday school', cost: 3000, effects: [city('church', 6), city('oldmoney', 2)] },
    ],
    defaultChoice: 0,
  },
  {
    id: 'mayor_baron',
    title: "The Baron's Man Wins",
    body: "The Baron's Circle has put its own man in the mayor's chair in {city}. The first act of the new administration renamed the high street after the Baron; the second sent you a bill.",
    trigger: 'election',
    years: ANY,
    weight: 3,
    cooldownYears: 0,
    needsCity: true,
    condition: mayorIs('baron'),
    choices: [
      { label: "Pay the 'civic levy'", cost: 3000, effects: [city('baron', 8), city('church', -3)] },
      { label: 'Fight it in the courts', cost: 2000, effects: [city('baron', -6), city('reformers', 4)] },
      { label: 'Lose the bill', cost: 0, effects: [city('baron', -4)] },
    ],
    defaultChoice: 2,
  },
  {
    id: 'recount',
    title: 'Recount in {city}',
    body: 'The {city} election was decided by eleven votes and a ballot box found in a coal scuttle. The losers demand a recount; the winners demand you keep out of it.',
    trigger: 'election',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      { label: 'Fund an honest recount', cost: 2000, effects: [city('reformers', 6), city('church', 2)] },
      { label: 'Keep out of it', cost: 0, effects: [], note: 'No effect' },
    ],
    defaultChoice: 1,
  },
];

export const SCANDAL_CARDS: readonly CardDef[] = [
  {
    id: 'second_ledger',
    title: 'The Second Ledger',
    body: 'A clerk has walked out of your {city} office with the second set of books, the one with the interesting columns. He is said to be heading for the Gazette.',
    trigger: 'scandal',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      {
        label: 'Pay him to forget',
        cost: 5000,
        effects: [city('reformers', -3)],
        apply: (ctx, cityId) => {
          const c = cityOf(ctx.state, cityId);
          if (c) c.politics.scandalRisk += 0.1;
        },
        note: 'Scandal risk rises here',
      },
      { label: 'Fire the accountant', cost: 0, effects: [city('reformers', 3), city('workers', -4), city('oldmoney', 2)] },
      { label: 'Publish the books yourself', cost: 0, effects: [city('reformers', 8), city('church', 3), city('oldmoney', -8)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'lobster_dinner',
    title: 'Dinner With the Mayor',
    body: 'A photograph of your chairman and the {city} mayor sharing a lobster the size of a dog is on every front page. The mayor says it was a crayfish.',
    trigger: 'scandal',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      { label: 'Donate to the orphanage', cost: 3000, effects: [city('church', 6), city('reformers', 2)] },
      { label: 'Insist it was a crayfish', cost: 0, effects: [city('reformers', -4), city('church', -2), city('oldmoney', 2)] },
      { label: "Blame the Baron's photographer", cost: 0, effects: [city('baron', -6), city('reformers', -2)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'scapegoat',
    title: 'Heads Must Roll',
    body: "The {city} affair needs a scapegoat and the board has three candidates: the treasurer, the chairman's nephew and a junior clerk named Smith. Smith is very nervous.",
    trigger: 'scandal',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      { label: "Sack the chairman's nephew", cost: 0, effects: [city('reformers', 6), city('oldmoney', -6)] },
      { label: 'Sack poor Smith', cost: 0, effects: [city('workers', -6), city('church', -4), city('oldmoney', 2)] },
      { label: 'The chairman takes the blame', cost: 4000, effects: [city('reformers', 8), city('church', 5), city('oldmoney', -4)] },
    ],
    defaultChoice: 0,
  },
];

/** Dormant until a later phase triggers 'disaster' with a town. */
export const DISASTER_CARDS: readonly CardDef[] = [
  {
    id: 'flood',
    title: '{city} Under Water',
    body: 'The river has burst its banks and {city} is wading to work. Your warehouse is floating downstream in a dignified manner.',
    trigger: 'disaster',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      { label: 'Fund the relief effort', cost: 20000, effects: [city('workers', 10), city('church', 8)] },
      { label: 'Rebuild your own works first', cost: 8000, effects: [city('oldmoney', 3), city('workers', -5)] },
      {
        label: 'Wait for the waters to fall',
        cost: 0,
        effects: [city('workers', -6), city('church', -4)],
        apply: (ctx, cityId) => haltNearestWorks(ctx, cityId, 20),
        note: 'Your nearest works here halts for 20 days',
      },
    ],
    defaultChoice: 2,
  },
  {
    id: 'great_fire',
    title: 'The Great {city} Fire',
    body: 'Half of {city} burned last night and the fire brigade, all six of them, are asleep on the courthouse steps. The town wants someone to help and someone to blame.',
    trigger: 'disaster',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      {
        label: 'Rebuild the town hall',
        cost: 40000,
        effects: [city('workers', 10), city('church', 6), city('oldmoney', 5)],
        apply: (ctx, cityId) => demand(ctx, 'rebuild', '*', cityId, 1.2, 6 * DAYS_PER_MONTH),
        note: 'Rebuilding boom: trade in town +20% for six months',
      },
      { label: 'Sell timber at cost', cost: 0, effects: [city('workers', 4), city('church', 2), city('oldmoney', -3)] },
      { label: 'Sell timber at boom prices', cost: -10000, effects: [city('workers', -8), city('church', -6), city('oldmoney', 4)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'pit_collapse',
    title: 'Disaster at the Pit',
    body: 'A shaft has collapsed near {city} and the whole town is at the pithead. The rescuers need timber, lamps and money; the reporters need a quote.',
    trigger: 'disaster',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      { label: 'Pay for rescue and widows', cost: 25000, effects: [city('workers', 12), city('church', 8)] },
      { label: 'Send a wreath', cost: 0, effects: [city('church', 2), city('workers', -4)] },
      { label: "Cite the inspector's report", cost: 0, effects: [city('workers', -12), city('church', -8), city('oldmoney', 3)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'twister',
    title: 'Twister!',
    body: 'A tornado has picked up a {city} barn and set it down, quite neatly, on the bandstand. The roof of your works is somewhere over the next county.',
    trigger: 'disaster',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      { label: 'Re-roof and help the town', cost: 15000, effects: [city('workers', 6), city('church', 4)] },
      {
        label: 'Claim on the insurance',
        cost: -5000,
        effects: [city('oldmoney', 2), city('church', -2)],
        apply: (ctx, cityId) => haltNearestWorks(ctx, cityId, 10),
        note: 'Your nearest works halts 10 days while the adjusters argue',
      },
      { label: 'Patch it with tarpaulin', cost: 0, effects: [city('workers', -4)] },
    ],
    defaultChoice: 2,
  },
];

/** Dormant until a later phase triggers 'crash' (national: no town needed). */
export const CRASH_CARDS: readonly CardDef[] = [
  {
    id: 'run_on_bank',
    title: 'Run on the Bank',
    body: 'Depositors are queueing round the block at the County Savings Bank, and your payroll is in its vault. So, for safety, is the manager.',
    trigger: 'crash',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      { label: 'Prop the bank up', cost: 30000, effects: [nation('oldmoney', 8), nation('workers', 6), nation('church', 3)] },
      { label: 'Pull your money out first', cost: -10000, effects: [nation('oldmoney', -6), nation('workers', -8), nation('church', -4)] },
      { label: 'Pay wages in company scrip', cost: 0, effects: [nation('workers', -10), nation('oldmoney', 3)] },
    ],
    defaultChoice: 2,
  },
  {
    id: 'exchange_panic',
    title: 'Panic on the Exchange',
    body: 'Your shares fell forty percent before luncheon and the brokers are taking the stairs to save time. The shareholders want reassurance, or blood.',
    trigger: 'crash',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      { label: 'Buy back your shares', cost: 25000, effects: [nation('oldmoney', 10)] },
      { label: 'Slash the payroll', cost: -8000, effects: [nation('oldmoney', 6), nation('workers', -12)] },
      { label: 'Issue a calm statement', cost: 0, effects: [nation('oldmoney', -4)] },
    ],
    defaultChoice: 2,
  },
  {
    id: 'bailout',
    title: 'Bailout or Bust',
    body: 'The government will lend to struggling firms on two conditions: they hire the jobless, and they stop paying bonuses to anyone named Rupert. The purists are already calling it a handout.',
    trigger: 'crash',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      {
        label: 'Take the bailout',
        cost: -15000,
        effects: [nation('workers', 6), nation('oldmoney', -6), nation('reformers', -6)],
        apply: (ctx) => {
          for (const c of ctx.state.cities) c.politics.scandalRisk += 0.05;
        },
        note: 'Scandal risk rises in every town',
      },
      { label: 'Refuse the strings', cost: 0, effects: [nation('oldmoney', 5), nation('workers', -4)] },
    ],
    defaultChoice: 1,
  },
  {
    id: 'fire_sale',
    title: 'Fire Sale',
    body: "Rival firms are going under and their works are going for a song, and a sad one at that. The Baron is already at the auction with his cheque book.",
    trigger: 'crash',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      { label: 'Outbid the Baron', cost: 40000, effects: [nation('baron', -10), nation('oldmoney', 6), nation('workers', 4)] },
      { label: 'Hire their sacked men', cost: 5000, effects: [nation('workers', 8), nation('church', 3)] },
      { label: 'Sit on your cash', cost: 0, effects: [nation('baron', 4)] },
    ],
    defaultChoice: 2,
  },
];

/**
 * Opened by sim/society/strikes.ts when a works strikes, with the struck works' town. Each card
 * resolves the town's oldest open strike (`strikeResolution`, cards/helpers.ts): Concede ends it now,
 * Wait it out (free, the default) lets it run, Break it ends it in 7 days and raises scandal risk.
 */
export const STRIKE_CARDS: readonly CardDef[] = [
  {
    id: 'walkout',
    title: 'Walkout at {city}!',
    body: 'Your {city} works has downed tools: the men want more pay, shorter hours and a canteen that serves something identifiable. Pickets are singing at the gate.',
    trigger: 'strike',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      {
        label: 'Concede: meet their demands',
        cost: 10000,
        effects: [city('workers', 8)],
        apply: strikeResolution.concede,
        note: 'The strike ends now',
      },
      { label: 'Wait it out', cost: 0, effects: [], apply: strikeResolution.wait, note: 'The strike runs its course' },
      {
        label: 'Break it: bring in strikebreakers',
        cost: 5000,
        effects: [city('workers', -12), city('oldmoney', 4)],
        apply: strikeResolution.break,
        note: 'The strike ends in 7 days; scandal risk +10%',
      },
    ],
    defaultChoice: 1,
  },
  {
    id: 'sympathy_strike',
    title: 'Sympathy Strike',
    body: 'The dockers have come out for the railwaymen, the railwaymen for the miners, and your {city} men for all of them, on principle. Nobody is sure who started it.',
    trigger: 'strike',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: true,
    choices: [
      {
        label: 'Concede: pay a solidarity bonus',
        cost: 6000,
        effects: [city('workers', 8)],
        apply: strikeResolution.concede,
        note: 'The strike ends now',
      },
      { label: 'Wait it out', cost: 0, effects: [], apply: strikeResolution.wait, note: 'The strike runs its course' },
      {
        label: 'Break it: lock them out',
        cost: 3000,
        effects: [city('workers', -12), city('oldmoney', 4)],
        apply: strikeResolution.break,
        note: 'The strike ends in 7 days; scandal risk +10%',
      },
    ],
    defaultChoice: 1,
  },
];

/** Dormant until Phase 5 triggers 'invention' (national). */
export const INVENTION_CARDS: readonly CardDef[] = [
  {
    id: 'patent_offer',
    title: 'A Patent Worth Having',
    body: "A young inventor offers you the patent to a machine that does something marvellous, he says, once he finds the right spanner. The Baron's lawyers are already at his door.",
    trigger: 'invention',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      { label: 'Buy the patent outright', cost: 10000, effects: [nation('oldmoney', 4), nation('baron', -6), nation('reformers', 2)] },
      { label: 'Fund his workshop', cost: 4000, effects: [nation('reformers', 5), nation('workers', 2)] },
      { label: 'Let the Baron have it', cost: 0, effects: [nation('baron', 4)] },
    ],
    defaultChoice: 2,
  },
  {
    id: 'new_machine',
    title: 'The New Machine',
    body: 'Your engineers have built a machine that does the work of forty men. The forty men have seen it, and are looking at it the way a cat looks at a bath.',
    trigger: 'invention',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      { label: 'Install it at once', cost: 5000, effects: [nation('workers', -10), nation('oldmoney', 6)] },
      { label: 'Install it and retrain', cost: 9000, effects: [nation('workers', 3), nation('oldmoney', 3)] },
      { label: 'Lock it in a shed', cost: 0, effects: [nation('workers', 4), nation('oldmoney', -5)] },
    ],
    defaultChoice: 2,
  },
];

export const TRIGGERED_CARDS: readonly CardDef[] = [
  ...ELECTION_CARDS,
  ...SCANDAL_CARDS,
  ...DISASTER_CARDS,
  ...CRASH_CARDS,
  ...STRIKE_CARDS,
  ...INVENTION_CARDS,
];
