/**
 * City landmarks: civic buildings a town raises once it is big enough and the era allows. Each takes
 * a 2×2 block near the city centre (see sim/landmarks.ts). Table order is build order.
 */
export type LandmarkId = 'church' | 'town_hall' | 'grand_station' | 'library' | 'stadium' | 'skyscraper';

export interface LandmarkDef {
  id: LandmarkId;
  name: string;
  minPop: number;
  minYear: number;
  size: 2;
  /** one-line headline template; `{city}` becomes the city name */
  news: string;
}

export const LANDMARKS: Record<LandmarkId, LandmarkDef> = {
  church: { id: 'church', name: 'Church', minPop: 1500, minYear: 1900, size: 2, news: 'BELLS RING OUT OVER {city} AS NEW CHURCH IS CONSECRATED' },
  town_hall: { id: 'town_hall', name: 'Town Hall', minPop: 5000, minYear: 1900, size: 2, news: '{city} COUNCIL MOVES INTO GRAND NEW TOWN HALL' },
  grand_station: { id: 'grand_station', name: 'Grand Station', minPop: 9000, minYear: 1900, size: 2, news: 'CROWDS CHEER AS {city} OPENS ITS GRAND STATION' },
  library: { id: 'library', name: 'Library', minPop: 14000, minYear: 1905, size: 2, news: '{city} PUBLIC LIBRARY OPENS ITS DOORS TO ALL' },
  stadium: { id: 'stadium', name: 'Stadium', minPop: 25000, minYear: 1920, size: 2, news: 'THOUSANDS PACK THE TERRACES AT {city} STADIUM' },
  skyscraper: { id: 'skyscraper', name: 'Skyscraper', minPop: 45000, minYear: 1930, size: 2, news: '{city} SCRAPES THE SKY: TALLEST TOWER IN THE LAND TOPPED OUT' },
};

/** Landmark ids in table (build) order. */
export const LANDMARK_IDS: readonly LandmarkId[] = Object.freeze(Object.keys(LANDMARKS) as LandmarkId[]);

/** The news headline for `id` in `cityName`. */
export function landmarkHeadline(id: LandmarkId, cityName: string): string {
  return LANDMARKS[id].news.replace('{city}', cityName.toUpperCase());
}
