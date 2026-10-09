/** Pixels per tile at zoom 1. */
export const TILE = 32;

export interface Camera {
  /** world pixels at the top-left of the view */
  x: number;
  y: number;
  zoom: number;
  /** viewport size in screen pixels */
  viewW: number;
  viewH: number;
}
