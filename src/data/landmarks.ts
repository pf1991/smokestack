/**
 * City landmarks: civic buildings a town raises once it is big enough and the era allows. Each takes
 * a 2×2 block near the city centre (see sim/landmarks.ts). Table order is build order.
 *
 * Philanthropy (Phase 2): the player may endow some landmarks in a town (sim/politics/edicts.ts
 * buyPhilanthropy). `philanthropyOnly` ones (park, hospital) are never raised by the town itself.
 */
import type { FactionId } from './factions';

export type LandmarkId = 'church' | 'town_hall' | 'grand_station' | 'library' | 'stadium' | 'skyscraper' | 'park' | 'hospital';

export interface LandmarkDef {
  id: LandmarkId;
  name: string;
  minPop: number;
  minYear: number;
  size: 2;
  /** one-line headline template; `{city}` becomes the city name */
  news: string;
  /** the player can endow it: its price and the one-off opinion changes in that town */
  philanthropy?: { cost: number; effects: Partial<Record<FactionId, number>> };
  /** only ever built by philanthropy; landmarksMonth skips it */
  philanthropyOnly?: true;
}

export const LANDMARKS: Record<LandmarkId, LandmarkDef> = {
  church: { id: 'church', name: 'Church', minPop: 1500, minYear: 1900, size: 2, news: 'BELLS RING OUT OVER {city} AS NEW CHURCH IS CONSECRATED' },
  town_hall: { id: 'town_hall', name: 'Town Hall', minPop: 5000, minYear: 1900, size: 2, news: '{city} COUNCIL MOVES INTO GRAND NEW TOWN HALL' },
  grand_station: { id: 'grand_station', name: 'Grand Station', minPop: 9000, minYear: 1900, size: 2, news: 'CROWDS CHEER AS {city} OPENS ITS GRAND STATION' },
  library: {
    id: 'library', name: 'Library', minPop: 14000, minYear: 1905, size: 2, news: '{city} PUBLIC LIBRARY OPENS ITS DOORS TO ALL',
    philanthropy: { cost: 60000, effects: { reformers: 8, church: 4 } },
  },
  stadium: { id: 'stadium', name: 'Stadium', minPop: 25000, minYear: 1920, size: 2, news: 'THOUSANDS PACK THE TERRACES AT {city} STADIUM' },
  skyscraper: { id: 'skyscraper', name: 'Skyscraper', minPop: 45000, minYear: 1930, size: 2, news: '{city} SCRAPES THE SKY: TALLEST TOWER IN THE LAND TOPPED OUT' },
  park: {
    id: 'park', name: 'Park', minPop: 0, minYear: 1900, size: 2, news: 'GATES OPEN ON {city} PARK, A GIFT TO THE PEOPLE',
    philanthropy: { cost: 25000, effects: { church: 6, reformers: 6, workers: 2 } }, philanthropyOnly: true,
  },
  hospital: {
    id: 'hospital', name: 'Hospital', minPop: 0, minYear: 1900, size: 2, news: '{city} HOSPITAL ADMITS ITS FIRST PATIENTS',
    philanthropy: { cost: 120000, effects: { workers: 8, church: 6, reformers: 4 } }, philanthropyOnly: true,
  },
};

/** Landmarks the player can endow, in table order. */
export type PhilanthropyId = 'park' | 'library' | 'hospital';
export const PHILANTHROPY_IDS: readonly PhilanthropyId[] = ['park', 'library', 'hospital'];

/** Landmark ids in table (build) order. */
export const LANDMARK_IDS: readonly LandmarkId[] = Object.freeze(Object.keys(LANDMARKS) as LandmarkId[]);

/** The news headline for `id` in `cityName`. */
export function landmarkHeadline(id: LandmarkId, cityName: string): string {
  return LANDMARKS[id].news.replace('{city}', cityName.toUpperCase());
}
