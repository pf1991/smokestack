/** Name parts for mayors, per faction. A mayor is `first + ' ' + last`; the title lives in the first part. */
import type { FactionId } from './factions';

export interface NameParts {
  first: readonly string[];
  last: readonly string[];
}

export const POLITICIANS: Record<FactionId, NameParts> = {
  workers: {
    first: ['Alf', 'Bert', 'Dolly', 'Mabel', 'Stan', 'Ned', 'Ada'],
    last: ['Grimsby', 'Pickering', 'Hobbs', 'Muggeridge', 'Nutley', 'Clogg', 'Bottomley'],
  },
  oldmoney: {
    first: ['Sir Reginald', 'Lord Percival', 'Lady Honoria', 'Sir Aubrey', 'Hon. Cuthbert', 'Dame Marjorie'],
    last: ['Pennyworth', 'Fotheringay', 'Ashcroft-Vane', 'Tuppence', 'Gildersleeve', 'Montague-Bligh'],
  },
  reformers: {
    first: ['Dr. Edith', 'Prof. Cornelius', 'Miss Octavia', 'Dr. Lionel', 'Mrs. Harriet', 'Mr. Thaddeus'],
    last: ['Clearwater', 'Brightwell', 'Fairweather', 'Greenleaf', 'Windermere', 'Lamplighter'],
  },
  church: {
    first: ['Rev. Josiah', 'Canon Ebenezer', 'Rev. Hester', 'Deacon Obadiah', 'Rev. Prudence', 'Father Anselm'],
    last: ['Meek', 'Goodbody', 'Pettifer', 'Hallelujah-Smith', 'Humble', 'Sparrow'],
  },
  baron: {
    first: ['Mr. Crowley', 'Mr. Lucian', 'Mr. Barnaby', 'Mr. Silas', 'Mr. Ignatius', 'Mr. Mortimer'],
    last: ['Smogsworth-Hythe', 'Coffer', 'Grasping', 'Vulture-Jones', 'Ledger', 'Blackwood-Tithe'],
  },
};
