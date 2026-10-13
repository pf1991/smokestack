/**
 * National smoke laws (Phase 3 Task 5). Each law may pass early, when the national
 * population-weighted smog level (`city.smog.level`, the Task 3 EMA) stays above `trigger` for
 * LAW_STREAK consecutive months inside its window, and is forced at the start of `latest`.
 * Triggers are on the smog level (controller ruling R-S3): the real scale is about 10x lower than
 * the plan's raw-pollution figures (0.25 / 0.18 / 0.12).
 */
export type LawId = 'smoke_abatement' | 'clean_air' | 'emission_caps';

export interface LawDef {
  id: LawId;
  title: string;
  /** first year the law can pass early */
  earliest: number;
  /** the year it is forced to pass if it has not already (at the start of the year) */
  latest: number;
  /** national mean smog level that must be exceeded for LAW_STREAK months */
  trigger: number;
  /** scrubber tier a polluting works needs to be compliant */
  tier: 1 | 2 | 3;
  /** id of the card opened when it passes */
  cardId: string;
}

export const LAWS: Readonly<Record<LawId, LawDef>> = {
  smoke_abatement: { id: 'smoke_abatement', title: 'Smoke Abatement Act', earliest: 1908, latest: 1925, trigger: 0.035, tier: 1, cardId: 'law_smoke_abatement' },
  clean_air: { id: 'clean_air', title: 'Clean Air Act', earliest: 1950, latest: 1970, trigger: 0.025, tier: 2, cardId: 'law_clean_air' },
  emission_caps: { id: 'emission_caps', title: 'Emission Caps Act', earliest: 1988, latest: 1995, trigger: 0.018, tier: 3, cardId: 'law_emission_caps' },
};
export const LAW_IDS: readonly LawId[] = ['smoke_abatement', 'clean_air', 'emission_caps'];

/** Consecutive months the trigger must hold. */
export const LAW_STREAK = 24;
/** Months lobbying delays enforcement (once per law). */
export const LOBBY_DELAY_MONTHS = 24;
/** Monthly fine per unit of `def.pollution`, in 1900 dollars (times the price index). */
export const FINE_RATE = 400;
/** Fines in a month never exceed this share of last month's sales revenue. */
export const FINE_CAP_SHARE = 0.25;

export interface LawStatus {
  /** year the law passed; null while pending */
  passed: number | null;
  /** month index (year * 12 + month - 1) fines start; null while pending */
  enforcedFrom: number | null;
  lobbied: boolean;
}
export interface SocietyState {
  laws: Record<LawId, LawStatus>;
  /** consecutive months each law's trigger has held inside its window */
  streak: Record<LawId, number>;
}

export function defaultSociety(): SocietyState {
  return {
    laws: {
      smoke_abatement: { passed: null, enforcedFrom: null, lobbied: false },
      clean_air: { passed: null, enforcedFrom: null, lobbied: false },
      emission_caps: { passed: null, enforcedFrom: null, lobbied: false },
    },
    streak: { smoke_abatement: 0, clean_air: 0, emission_caps: 0 },
  };
}
