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
  /** eased-zoom goal and the screen anchor it keeps fixed (see camera.ts setZoomTarget/stepZoom) */
  zoomTarget?: number;
  zoomAnchor?: { x: number; y: number };
  /** the zoom stepZoom last wrote; a mismatch means someone else set the zoom, so the target is stale */
  zoomSeen?: number;
}
