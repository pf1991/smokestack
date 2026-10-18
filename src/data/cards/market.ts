/**
 * Spring cards about the exchange (Phase 4 Task 9). Each choice shocks one company's share sentiment
 * (sim/exchange/prices.ts exchangeShock, clamped there). "Some firm" is drawn from the main state rng
 * when the choice is resolved, from the listed companies in id order. Valid 1920-1999.
 */
import { PLAYER_ID } from '../../sim/companies';
import { exchangeShock } from '../../sim/exchange/prices';
import { pick } from '../../sim/rng';
import type { GameState, SimContext } from '../../sim/types';
import { nation } from './helpers';
import type { CardDef } from './types';

/** Listed companies in id order, the player's excluded when `rivalsOnly`. */
function listedIds(state: GameState, rivalsOnly: boolean): string[] {
  const out: string[] = [];
  for (const id in state.exchange.listings) if (state.exchange.listings[id].listed && !(rivalsOnly && id === PLAYER_ID)) out.push(id);
  return out;
}

/** Shocks one drawn listed company; nothing (and no draw) when none is listed. */
const shockSome = (ctx: SimContext, factor: number, rivalsOnly: boolean): void => {
  const ids = listedIds(ctx.state, rivalsOnly);
  if (ids.length > 0) exchangeShock(ctx.state, pick(ctx.state, ids), factor);
};

export const MARKET_CARDS: readonly CardDef[] = [
  {
    id: 'market_rumour',
    title: 'A Rumour on the Exchange',
    body: 'A whisper is running down the brokers\' row that one of the big firms has cooked its books. Nobody knows which, and nobody is willing to wait to find out.',
    trigger: 'spring',
    years: [1920, 1999],
    weight: 1,
    cooldownYears: 6,
    needsCity: false,
    choices: [
      {
        label: 'Feed the rumour',
        cost: 1000,
        effects: [nation('oldmoney', -3), nation('reformers', -2)],
        apply: (ctx) => shockSome(ctx, 0.85, true),
        note: 'One rival listed firm loses 15% of its share sentiment',
      },
      {
        label: 'Vouch for your own books',
        cost: 2000,
        effects: [nation('oldmoney', 3)],
        apply: (ctx) => exchangeShock(ctx.state, PLAYER_ID, 1.1),
        note: 'Your share sentiment rises 10%',
      },
      { label: 'Say nothing', cost: 0, effects: [], note: 'No effect' },
    ],
    defaultChoice: 2,
  },
  {
    id: 'bull_market',
    title: 'Bull Market',
    body: 'Cabbies are giving stock tips and the office boy has bought a motor car on margin. Every share on the exchange is rising, some more than others.',
    trigger: 'spring',
    years: [1920, 1999],
    weight: 1,
    cooldownYears: 6,
    needsCity: false,
    choices: [
      {
        label: 'Talk up your shares',
        cost: 3000,
        effects: [nation('oldmoney', 3), nation('reformers', -2)],
        apply: (ctx) => exchangeShock(ctx.state, PLAYER_ID, 1.15),
        note: 'Your share sentiment rises 15%',
      },
      {
        label: 'Back a favourite',
        cost: 0,
        effects: [nation('oldmoney', 2)],
        apply: (ctx) => shockSome(ctx, 1.15, false),
        note: 'One listed firm gains 15% share sentiment',
      },
      { label: 'Stay out of the casino', cost: 0, effects: [nation('church', 3)], note: 'The churches approve' },
    ],
    defaultChoice: 2,
  },
];
