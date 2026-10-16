/**
 * A per-map counter bumped whenever sim code changes tile terrain (a leaf module, so state.ts can
 * report changes without importing the systems that cache terrain). Caches derived from terrain
 * (the smog field's decay classes in pollution.ts) compare the epoch and rebuild when it moved, so
 * cached results always equal a fresh scan and determinism and save/load replays are unaffected.
 */
import type { GameMap } from './types';

const epochs = new WeakMap<GameMap, number>();

/** Must be called by every sim writer of `Tile.terrain`, after the change. */
export function terrainChanged(map: GameMap): void {
  epochs.set(map, (epochs.get(map) ?? 0) + 1);
}

export function terrainEpoch(map: GameMap): number {
  return epochs.get(map) ?? 0;
}
