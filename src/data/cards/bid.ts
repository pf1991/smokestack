/**
 * The Baron's hostile bid (Phase 4 Task 8): opened by sim/nemesis/bid.ts startBid the moment he holds
 * a majority of the player's shares, never drawn. The body shows the buy-back price of the moment (the
 * fundamental: exchange/trading.ts buyBackQuote). "Buy them back" costs nothing on the card itself:
 * buyBack books the price under 'shares' and borrows any shortfall, above the loan limit if need be,
 * so it always succeeds. The card is withdrawn when the bid ends some other way.
 */
import { buyBack, buyBackNeed, buyBackQuote } from '../../sim/exchange/trading';
import { BID_GRACE_MONTHS, bidMonthsLeft } from '../../sim/nemesis/bid';
import type { CardDef } from './types';

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export const BID_CARDS: readonly CardDef[] = [
  {
    // a literal, not HOSTILE_BID_CARD_ID: this table can be evaluated before sim/nemesis/bid.ts (import
    // cycle through sim/state.ts), and the two are pinned equal in exchange/trading.test.ts
    id: 'hostile_bid_warning',
    title: 'Smogsworth Bids for Your Company',
    body:
      'The Baron has quietly bought up a majority of your shares and sent round a man to measure your office for new curtains. ' +
      'You have {months} to buy back {need} shares and break his hold. At today\'s fair price that costs {quote}.',
    vars: (state) => {
      const need = buyBackNeed(state);
      const months = need > 0 ? bidMonthsLeft(state) : BID_GRACE_MONTHS;
      return {
        need: String(need),
        months: `${months} month${months === 1 ? '' : 's'}`,
        quote: dollars(buyBackQuote(state, need).total),
      };
    },
    trigger: 'bid',
    years: [1901, 2000],
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      {
        label: 'Buy them back now',
        cost: 0,
        effects: [],
        apply: (ctx) => {
          const r = buyBack(ctx);
          if (!r.ok) ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
        },
        note: 'Pays the fair price, borrowing any shortfall',
      },
      { label: 'Wait and raise the money', cost: 0, effects: [], note: 'The grace period keeps running' },
    ],
    defaultChoice: 1,
  },
];
