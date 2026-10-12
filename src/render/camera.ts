import { TILE, type Camera } from './constants';
import type { GameMap, Vec2 } from '../sim/types';

export { TILE };
export type { Camera };

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
/** Zoom a new or loaded game opens at: the diorama (render/regime.ts blends to it from 1.7). */
export const DEFAULT_ZOOM = 1.75;

export function screenToWorld(cam: Camera, sx: number, sy: number): Vec2 {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}

export function screenToTile(cam: Camera, sx: number, sy: number): Vec2 {
  const w = screenToWorld(cam, sx, sy);
  return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
}

export function tileToScreen(cam: Camera, tx: number, ty: number): Vec2 {
  return { x: (tx * TILE - cam.x) * cam.zoom, y: (ty * TILE - cam.y) * cam.zoom };
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  cam.x = before.x - sx / cam.zoom;
  cam.y = before.y - sy / cam.zoom;
}

function clampAxis(pos: number, view: number, mapSize: number): number {
  if (mapSize <= view) return (mapSize - view) / 2;
  return Math.min(Math.max(pos, 0), mapSize - view);
}

/** Keep the view inside the map, or centre the map when it is smaller than the view. */
export function clampCamera(cam: Camera, map: GameMap): void {
  cam.x = clampAxis(cam.x, cam.viewW / cam.zoom, map.width * TILE);
  cam.y = clampAxis(cam.y, cam.viewH / cam.zoom, map.height * TILE);
}

/** Inclusive tile range overlapping the view, clipped to the map. */
export function visibleTileRange(
  cam: Camera,
  map: GameMap,
): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.max(0, Math.floor(cam.x / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE));
  const x1 = Math.min(map.width - 1, Math.floor((cam.x + cam.viewW / cam.zoom) / TILE));
  const y1 = Math.min(map.height - 1, Math.floor((cam.y + cam.viewH / cam.zoom) / TILE));
  return { x0, y0, x1, y1 };
}
