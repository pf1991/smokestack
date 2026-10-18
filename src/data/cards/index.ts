/**
 * The event card table (spec §5). Card definitions live in one file per era or trigger; this module
 * joins them into CARDS and CARDS_BY_ID, so importers keep using `data/cards`.
 *
 * Table order is the draw order (determinism): the seed cards first, then each file in the order
 * below. A new card anywhere but the very end changes which card a given seed draws later on (saves
 * stay valid). Ids are save data: never rename or remove one.
 */
import { ANYTIME_CARDS } from './anytime';
import { EARLY_CARDS } from './early';
import { INTERWAR_CARDS } from './interwar';
import { LATE_CARDS } from './late';
import { POSTWAR_CARDS } from './postwar';
import { SEED_CARDS } from './seed';
import { LAW_CARDS } from './laws';
import { TRIGGERED_CARDS } from './triggered';
import { BID_CARDS } from './bid';
import { CRASH_CARDS } from './crash';
import { MARKET_CARDS } from './market';
import type { CardDef } from './types';

export type { CardChoice, CardDef, CardEffect, CardTrigger } from './types';

export const CARDS: readonly CardDef[] = [
  ...SEED_CARDS,
  ...EARLY_CARDS,
  ...INTERWAR_CARDS,
  ...POSTWAR_CARDS,
  ...LATE_CARDS,
  ...ANYTIME_CARDS,
  ...TRIGGERED_CARDS,
  ...LAW_CARDS,
  ...BID_CARDS,
  ...CRASH_CARDS,
  ...MARKET_CARDS,
];

export const CARDS_BY_ID: Readonly<Record<string, CardDef>> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
