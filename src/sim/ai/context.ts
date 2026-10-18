import { PLAYER_ID } from '../companies';
import { laborPool } from '../politics/workforce';
import { priceIndex } from '../society/economy';
import { assetValue } from '../state';
import { smogTier } from '../society/tiers';
import type { GameState } from '../types';
import { LAW_IDS } from '../../data/laws';

/** The scale of a starting company's net worth (matches BASE_NET_WORTH in politics/cards.ts). */
const START_WORTH = 300_000;
export const MAX_CONTEXT_BYTES = 12 * 1024;
const MAX_TOWNS = 40;
const MAX_STRIKES = 20;

export type MoneyBand = 'struggling' | 'steady' | 'rich';

/** The player's real (1900 dollar) net worth against the starting company: under half, up to 5x, above. */
export function moneyBand(state: GameState): MoneyBand {
  const c = state.companies[PLAYER_ID];
  const real = (c.money - c.loan + assetValue(state, PLAYER_ID)) / priceIndex(state);
  if (real < START_WORTH * 0.5) return 'struggling';
  return real > START_WORTH * 5 ? 'rich' : 'steady';
}

/**
 * A small plain-JSON summary of the world for JEV when a spring card is due. Read-only, no rng,
 * and kept under MAX_CONTEXT_BYTES whatever the state.
 */
export function cardContext(state: GameState): Record<string, unknown> {
  const towns = state.cities.slice(0, MAX_TOWNS).map((c) => ({
    name: c.name.slice(0, 40),
    smogTier: smogTier(c),
    workers: Math.round(laborPool(c)),
    oldmoney: Math.round(c.opinion.oldmoney),
    reformers: Math.round(c.opinion.reformers),
    mayor: c.politics.mayor.faction,
  }));
  const strikes: { works: string; town: string; reason: string }[] = [];
  for (const b of Object.values(state.buildings)) {
    if (!b.strike || b.ownerId !== PLAYER_ID) continue;
    if (strikes.length >= MAX_STRIKES) break;
    strikes.push({
      works: b.typeId,
      town: (state.cities.find((c) => c.id === b.strike!.cityId)?.name ?? '').slice(0, 40),
      reason: b.strike.reason.slice(0, 80),
    });
  }
  const laws = LAW_IDS.filter((id) => state.society.laws[id]?.passed != null);
  const headlines = state.news.slice(-6).map((n) => n.headline.slice(0, 100));
  const ctx = { year: state.date.year, money: moneyBand(state), towns, strikes, laws, headlines };
  return JSON.stringify(ctx).length <= MAX_CONTEXT_BYTES ? ctx : { ...ctx, towns: towns.slice(0, 10), strikes: strikes.slice(0, 5) };
}
