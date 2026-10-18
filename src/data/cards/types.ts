/**
 * Event cards (spec §5): the century's player-caused stories. A card is drawn each spring or
 * triggered by a sim event, waits in `state.politics.cards.pending` and is answered with one of its
 * choices (sim/politics/cards.ts). Definitions hold functions (`condition`, `apply`), so state keeps
 * only `CardInstance` ids and saves stay plain JSON.
 *
 * Adding a card: add it to one of the files joined in cards/index.ts (ids are save data: never rename or remove one). Every
 * card needs a choice with `cost <= 0`, so the player can always answer it, and `needsCity: true`
 * whenever any effect has `scope: 'city'` (the catalog test checks both).
 */
import type { CardInstance } from '../../sim/politics/types';
import type { GameState, SimContext } from '../../sim/types';
import type { FactionId } from '../factions';

export interface CardEffect {
  faction: FactionId;
  scope: 'city' | 'national';
  delta: number;
}

export interface CardChoice {
  label: string;
  /**
   * Money spent (positive) or received (negative), booked under 'events', in 1900 dollars for a
   * starting $300,000 company. The engine scales it at display and resolve time (ruling R-Q8,
   * `cardScale`/`choiceCost` in sim/politics/cards.ts: x the price index (about 2.2 in 1950), x10 at $3M net worth, at most
   * x40) and rounds to $100, so author every cost in those base units.
   */
  cost: number;
  effects: CardEffect[];
  /**
   * extra consequences beyond the effects; describe them in `note`. `inst` is the card instance being
   * answered (strike cards find their strike by its uid); absent only when a test calls it directly.
   */
  apply?: (ctx: SimContext, cityId: number | null, inst?: CardInstance) => void;
  /** extra effect text shown to the player */
  note?: string;
}

export type CardTrigger = 'spring' | 'election' | 'scandal' | 'strike' | 'disaster' | 'invention' | 'crash' | 'law' | 'succession' | 'bid';

/** All money in a card's choices is authored in 1900 dollars for a starting $300,000 company (see CardChoice.cost). */
export interface CardDef {
  id: string;
  title: string;
  /**
   * may contain `{city}` (the card's town) and `{faction}` (the town mayor's faction, else the first
   * effect's), plus any `{key}` that `vars` fills
   */
  body: string;
  /** extra placeholders for the title and body, read from the state when the card is shown */
  vars?: (state: GameState) => Record<string, string>;
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

export const cityOf = (state: GameState, cityId: number | null) => state.cities.find((c) => c.id === cityId);

