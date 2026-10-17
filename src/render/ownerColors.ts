/**
 * Company colours: the player's blue, the Baron's crimson, and for every other company (regional
 * firms) one of REGIONAL_COLORS picked by a hash of its id. Used by sprites, the survey map, sale
 * floaters and the panels' owner badges.
 */
import type { OwnerId } from '../sim/types';

const OWNER_COLOR: Record<string, string> = { player: '#2f6fb5', rival: '#b5302f' };
export const REGIONAL_COLORS = ['#3f8f5a', '#8a5aa8', '#c07a2a'];

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function ownerColor(id: OwnerId): string {
  return OWNER_COLOR[id] ?? REGIONAL_COLORS[strHash(id) % REGIONAL_COLORS.length];
}

/** Whether `id` is neither the player nor the Baron (a regional firm). */
export const isThirdOwner = (id: OwnerId): boolean => id !== 'player' && id !== 'rival';
