/**
 * Shared names for landmark tiles (a leaf module, so state.ts and rail.ts can refuse to build over
 * landmarks without importing the landmark system, which itself depends on state.ts).
 */

/** Per-tile layer: `index + 1` of the landmark in its city's `landmarks` list, 0 elsewhere. */
export const LANDMARK_LAYER = 'landmark';

/** Error returned by every builder (buildings, road, rail) asked to build over a landmark. */
export const LANDMARK_BLOCKED = 'A landmark stands here';
