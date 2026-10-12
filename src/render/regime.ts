/**
 * Render regimes: zoomed out the world is an engraved survey map (blend 0), zoomed in it is the
 * painted diorama (blend 1). Between SURVEY_MAX_ZOOM and DIORAMA_MIN_ZOOM the two cross-fade.
 */
export const SURVEY_MAX_ZOOM = 1.3;
export const DIORAMA_MIN_ZOOM = 1.7;

/** 0 at zoom ≤ 1.3 (survey), 1 at zoom ≥ 1.7 (diorama), smoothstep in between. */
export function regimeBlend(zoom: number): number {
  // in tenths so the band midpoint (1.5) lands on exactly 0.5
  const t = Math.min(1, Math.max(0, (zoom * 10 - 13) / 4));
  return t * t * (3 - 2 * t);
}
