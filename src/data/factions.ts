/**
 * The five factions of every town (spec §5). Each holds an opinion of the player's company, 0..100,
 * stored on `City.opinion` and written only by `adjustOpinion` (sim/politics/factions.ts).
 */
export type FactionId = 'workers' | 'oldmoney' | 'reformers' | 'church' | 'baron';

export interface FactionDef {
  id: FactionId;
  name: string;
  /** the name the faction goes by from GREENS_YEAR on */
  greenName?: string;
  /** bar and chip colour, picked to sit on the walnut/brass palette */
  color: string;
  likes: string;
  hates: string;
  /** base share of a town that the faction speaks for; the weights sum to 1 */
  weight: number;
}

/** Display and iteration order. */
export const FACTION_IDS: readonly FactionId[] = ['workers', 'oldmoney', 'reformers', 'church', 'baron'];

export const FACTIONS: Record<FactionId, FactionDef> = {
  workers: {
    id: 'workers', name: 'Workers', color: '#c4632f',
    likes: 'Jobs, fair wages and safe shop floors', hates: 'Layoffs, wage cuts and smoke in their lungs', weight: 0.4,
  },
  oldmoney: {
    id: 'oldmoney', name: 'Old Money', color: '#c9a43a',
    likes: 'Low wages, order and steady dividends', hates: 'Unions and generous payrolls', weight: 0.18,
  },
  reformers: {
    id: 'reformers', name: 'Reformers', greenName: 'Greens', color: '#5c9a5a',
    likes: 'Clean air, libraries and parks', hates: 'Smog and dirty industry', weight: 0.17,
  },
  church: {
    id: 'church', name: 'Church', color: '#8a6bb0',
    likes: 'Charity, kept promises and quiet streets', hates: 'Broken contracts and godless greed', weight: 0.2,
  },
  baron: {
    id: 'baron', name: "Baron's Circle", color: '#9e3040',
    likes: "The Baron's stores doing well", hates: 'Anyone outselling the Baron', weight: 0.05,
  },
};

/** The year the Reformers start calling themselves the Greens. */
export const GREENS_YEAR = 1960;

export function factionName(id: FactionId, year: number): string {
  const f = FACTIONS[id];
  return year >= GREENS_YEAR && f.greenName ? f.greenName : f.name;
}

/** A fresh town's opinion of the player's company: 50 everywhere, the Baron's Circle 35. */
export function defaultOpinion(): Record<FactionId, number> {
  return { workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 };
}
