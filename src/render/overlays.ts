import type { GameState } from '../sim/types';
import type { Camera } from './constants';

/** A toggleable map overlay drawn by the WorldRenderer after the ghost, before atmosphere. */
export interface Overlay {
  id: string;
  enabled: boolean;
  draw(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void;
}

/**
 * Overlay registry. Append-only: later tasks push their overlay here
 * (e.g. Task 24's pollution heat map). On merge conflicts keep both sides.
 */
export const OVERLAYS: Overlay[] = [];

/** Enables or disables the overlay with `id`; unknown ids are ignored. */
export function setOverlay(id: string, enabled: boolean): void {
  const o = OVERLAYS.find((x) => x.id === id);
  if (o) o.enabled = enabled;
}
