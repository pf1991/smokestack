/**
 * Phase 4 Legacy score (spec §7): what the century leaves behind, in four parts shown on the Legacy
 * panel, the goals panel and the end screen. Pure reads of the state; nothing here runs per day.
 *
 * - fortune: the player's net worth in 1900 dollars, one point per $10,000
 * - landmarks: 50 per landmark built while the player led its town's retail sales (flags.landmarkCredit)
 * - reputation: 4 per point of national opinion above 50, summed over the factions (negative below)
 * - dynasty: prestige, 25 per generation after the founder, 100 for taking over the Baron
 */
import { FACTION_IDS } from '../data/factions';
import { landmarkCreditKey } from './landmarks';
import { nationalOpinion } from './politics/factions';
import { netWorth } from './rival/takeover';
import { realMoney } from './society/economy';
import type { GameState } from './types';

export interface Legacy {
  fortune: number;
  landmarks: number;
  reputation: number;
  dynasty: number;
  total: number;
}

export const FORTUNE_UNIT = 10_000;
export const LANDMARK_POINTS = 50;
export const REPUTATION_WEIGHT = 4;
export const GENERATION_POINTS = 25;
export const TAKEOVER_POINTS = 100;

/** Landmarks credited to the player (credit is recorded when the landmark is raised). */
export function creditedLandmarks(state: GameState): number {
  let n = 0;
  for (const city of state.cities) {
    for (let i = 0; i < city.landmarks.length; i++) if (state.flags?.[landmarkCreditKey(city.id, i)] === true) n++;
  }
  return n;
}

export function legacyScore(state: GameState): Legacy {
  const fortune = Math.max(0, Math.round(realMoney(state, netWorth(state, 'player')) / FORTUNE_UNIT));
  const landmarks = LANDMARK_POINTS * creditedLandmarks(state);
  let spread = 0;
  for (const f of FACTION_IDS) spread += nationalOpinion(state, f) - 50;
  const reputation = Math.round(spread * REPUTATION_WEIGHT);
  const d = state.dynasty;
  const dynasty = Math.round(d.prestige + GENERATION_POINTS * (d.generation - 1) + (state.flags?.takeover === true ? TAKEOVER_POINTS : 0));
  const total = Math.max(0, fortune + landmarks + reputation + dynasty);
  return { fortune, landmarks, reputation, dynasty, total };
}

/** The four parts with a one-line explanation each, in display order. */
export const LEGACY_PARTS: { key: Exclude<keyof Legacy, 'total'>; label: string; blurb: string }[] = [
  { key: 'fortune', label: 'Fortune', blurb: 'One point per $10,000 of net worth, in 1900 dollars.' },
  { key: 'landmarks', label: 'Landmarks', blurb: '50 for each landmark raised in a town where you led the retail trade.' },
  { key: 'reputation', label: 'Reputation', blurb: '4 per point of national opinion above 50, summed over the factions.' },
  { key: 'dynasty', label: 'Dynasty', blurb: 'Family prestige, 25 per generation, and 100 for taking over the Baron.' },
];
