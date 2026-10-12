import { serialize } from './simulation';
import type { GameState } from './types';

/**
 * FNV-1a 32-bit hash of the serialized state, as 8 hex digits. `speed` is excluded: it is UI pacing,
 * not simulation. Equal hashes for two runs mean the sim reached the same state.
 */
export function stateHash(state: GameState): string {
  const s = serialize({ ...state, speed: 0 });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
