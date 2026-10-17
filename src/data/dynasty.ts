/**
 * Phase 4 player dynasty content: the heir traits (spec §7.2) with what each does to faction opinion,
 * edict upkeep, card money and scandal risk, and the given names the family's children are christened
 * with. See sim/dynasty.
 */
import { FACTION_IDS, type FactionId } from './factions';
import type { HeirTrait } from '../sim/dynasty/types';

/**
 * What a head of the family's character does. Multipliers (`edictCost`, `cardCost`, `scandal`) are
 * combined multiplicatively over the head's traits; `opinion` (national drift per month, per faction)
 * adds up.
 */
export interface DynastyModifiers {
  opinion?: Partial<Record<FactionId, number>>;
  /** × the company edicts' maintenance multiplier (sim/politics/edicts.ts companyEdictFactor) */
  edictCost?: number;
  /** × every event card's money (sim/politics/cards.ts cardScale) */
  cardCost?: number;
  /** × the monthly bribery scandal chance (sim/politics/elections.ts scandalMonth) */
  scandal?: number;
}

export interface HeirTraitDef {
  label: string;
  blurb: string;
  modifiers: DynastyModifiers;
}

export const DYNASTY_TRAITS: Record<HeirTrait, HeirTraitDef> = {
  shrewd: {
    label: 'Shrewd',
    blurb: 'Haggles every bill down to the penny. Event cards cost 15% less; Old Money warms to the family.',
    modifiers: { cardCost: 0.85, opinion: { oldmoney: 0.5 } },
  },
  charming: {
    label: 'Charming',
    blurb: 'Dines with bishops, union men and duchesses alike. Every faction warms a little each month.',
    modifiers: { opinion: Object.fromEntries(FACTION_IDS.map((f) => [f, 0.25])) },
  },
  reckless: {
    label: 'Reckless',
    blurb: 'Signs first, reads later. Event cards cost 10% less, but bribes come to light half again as often.',
    modifiers: { scandal: 1.5, cardCost: 0.9 },
  },
  idealist: {
    label: 'Idealist',
    blurb: 'Believes the works can be a force for good. Reformers and the Church approve; Old Money frets.',
    modifiers: { opinion: { reformers: 0.5, church: 0.5, oldmoney: -0.5 } },
  },
  brute: {
    label: 'Brute',
    blurb: 'Rules the shop floor with a cane. Edict upkeep 20% cheaper; the workers seethe.',
    modifiers: { opinion: { workers: -0.5 }, edictCost: 0.8 },
  },
};

/** Given names for the family's sons (and the husbands of its daughters). */
export const MALE_GIVEN_NAMES: readonly string[] = [
  'Josiah', 'Ambrose', 'Bartholomew', 'Cuthbert', 'Edmund', 'Ezra', 'Fitzroy', 'Gideon', 'Horace',
  'Ignatius', 'Jasper', 'Leopold', 'Montague', 'Nathaniel', 'Oswald', 'Percival', 'Rupert', 'Silas',
  'Thaddeus', 'Wilfred',
];

/** Given names for the family's daughters (and the wives of its sons). */
export const FEMALE_GIVEN_NAMES: readonly string[] = [
  'Adelaide', 'Beatrice', 'Clementine', 'Dorothea', 'Edith', 'Florence', 'Georgiana', 'Harriet',
  'Imogen', 'Josephine', 'Lavinia', 'Mabel', 'Octavia', 'Philippa', 'Rosalind', 'Theodora', 'Ursula',
  'Victoria', 'Winifred', 'Henrietta',
];
