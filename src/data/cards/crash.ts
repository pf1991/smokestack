/**
 * The 1929 crash cards (Phase 4 Task 9), opened by the crash1929 event (sim/events.ts). Kept apart from
 * triggered.ts because two of them act on the exchange: importing sim/exchange from triggered.ts closes
 * an import cycle through sim/politics/elections.ts. Listed in cards/index.ts after the bid card, in
 * the same order as before, which is all a draw among crash cards depends on.
 */
import { PLAYER_ID } from '../../sim/companies';
import { exchangeShock } from '../../sim/exchange/prices';
import { buyQuote, buyShares } from '../../sim/exchange/trading';
import { adjustOpinion } from '../../sim/politics/factions';
import { nation } from './helpers';
import type { CardDef } from './types';

const ANY: [number, number] = [1901, 2000];
const BUY_BACK_SHARES = 50;
/** Old Money's (national) reassurance when the buy-back goes through */
const BUY_BACK_OLD_MONEY = 10;
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Opened by the 1929 crash (sim/events.ts; national: no town needed). Two of them act on the exchange. */
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
      {
        label: 'Prop the bank up',
        cost: 30000,
        effects: [nation('oldmoney', 8), nation('workers', 6), nation('church', 3)],
        apply: (ctx) => exchangeShock(ctx.state, '*', 1.1),
        note: 'Every share price steadies, up 10%',
      },
      { label: 'Pull your money out first', cost: -10000, effects: [nation('oldmoney', -6), nation('workers', -8), nation('church', -4)] },
      { label: 'Pay wages in company scrip', cost: 0, effects: [nation('workers', -10), nation('oldmoney', 3)] },
    ],
    defaultChoice: 2,
  },
  {
    id: 'exchange_panic',
    title: 'Panic on the Exchange',
    body:
      'Your shares fell by half before luncheon and the brokers are taking the stairs to save time. The shareholders want reassurance, or blood. ' +
      'Fifty of your own shares can be had for {quote}.',
    vars: (state) => ({ quote: dollars(buyQuote(state, PLAYER_ID, PLAYER_ID, BUY_BACK_SHARES).total) }),
    trigger: 'crash',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      {
        label: 'Buy back your shares',
        // the purchase books its own price under 'shares' (buyShares), so the card itself costs nothing;
        // Old Money is reassured (through adjustOpinion) only if the purchase goes through
        cost: 0,
        effects: [],
        apply: (ctx) => {
          const r = buyShares(ctx, PLAYER_ID, PLAYER_ID, BUY_BACK_SHARES);
          if (r.ok) adjustOpinion(ctx.state, 'oldmoney', 'national', BUY_BACK_OLD_MONEY, 'Panic on the Exchange');
          else ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
        },
        note: `Buys 50 of your shares at the market price; Old Money +${BUY_BACK_OLD_MONEY} if it goes through`,
      },
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
