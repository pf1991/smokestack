import type { BuildingDef } from '../data/buildings';
import type { IconId } from '../render/icons';

/** Atlas icon per building category: the build bar's fallback and the route editor's stop icon. */
export const CATEGORY_ICON: Record<BuildingDef['category'], IconId> = {
  extractor: 'pick',
  factory: 'factory',
  retail: 'shop',
  trade: 'money',
  logistics: 'crate',
};
