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

/** Time constant of the eased wheel zoom, ms. */
export const ZOOM_TAU_MS = 80;

/** Multiplies the pending (or current) zoom goal by `factor`, anchored at screen point (sx, sy). */
export function setZoomTarget(cam: Camera, sx: number, sy: number, factor: number): void {
  const live = cam.zoomTarget !== undefined && cam.zoomSeen === cam.zoom;
  const base = live ? cam.zoomTarget! : cam.zoom;
  cam.zoomTarget = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base * factor));
  cam.zoomAnchor = { x: sx, y: sy };
  cam.zoomSeen = cam.zoom;
}

/** Eases the zoom toward its target (exp, tau 80 ms), keeping the world point under the anchor fixed. */
export function stepZoom(cam: Camera, dtMs: number): void {
  if (cam.zoomTarget === undefined) return;
  if (cam.zoomSeen !== cam.zoom) {
    cam.zoomTarget = undefined;
    return;
  }
  const a = cam.zoomAnchor ?? { x: cam.viewW / 2, y: cam.viewH / 2 };
  const diff = cam.zoomTarget - cam.zoom;
  const next = Math.abs(diff) < 1e-4 ? cam.zoomTarget : cam.zoom + diff * (1 - Math.exp(-dtMs / ZOOM_TAU_MS));
  const before = screenToWorld(cam, a.x, a.y);
  cam.zoom = next;
  cam.x = before.x - a.x / cam.zoom;
  cam.y = before.y - a.y / cam.zoom;
  cam.zoomSeen = cam.zoom;
  if (next === cam.zoomTarget) cam.zoomTarget = undefined;
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
