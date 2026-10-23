import type { GoodId, OwnerId } from '../types';

/** Phase 4b logistics state (sim/logistics): building levels, hubs, managers. Plain JSON. */

export type BuildingLevel = 1 | 2 | 3 | 4;
/** An upgrade in progress; days are `dateToDays` numbers. */
export interface BuildingWorks { toLevel: BuildingLevel; startDay: number; untilDay: number }

export type Skill = 1 | 2 | 3 | 4 | 5;
export interface ManagerSkills { logistics: Skill; production: Skill; frugality: Skill }
export interface Manager {
  id: number; name: string; born: number; skills: ManagerSkills;
  salary: number; // 1900 $ per month
  employer: OwnerId | null; // null while on the market
  post: number | null; // building id
  hiredYear: number | null; lastRaiseYear: number | null;
}

export type HubJobKind = 'collect' | 'deliver' | 'balance' | 'return';
export interface HubJob { kind: HubJobKind; from: number; to: number; good: GoodId | null; qty: number }
export interface HubState {
  autoSize: boolean; maxTrucks: number; nextDispatchDay: number;
  month: { jobs: number; idleTruckDays: number; backlogDays: number };
  yesterday: { jobs: number; idle: number };
}
export interface AutoJob { from: number; to: number; good: GoodId; qty: number; score: number }

export type VehicleModelId = 'steam_lorry' | 'motor_truck' | 'diesel_truck' | 'articulated' | 'train';
export type VehicleKits = { body: boolean; engine: boolean };
export type RouteMode = 'manual' | 'auto';
export type AutoSize = { on: boolean; maxTrucks: number };
/** This month's departures and backlog days; `last` is last month's loaded share in percent (absent with no departures). */
export type RouteStats = { loaded: number; empty: number; backlogDays: number; last?: number };

export interface LogisticsState {
  managers: Manager[]; // employed by some company, ascending id
  market: Manager[]; // candidates, employer null
  marketYear: number;
  nextManagerId: number;
  rngState: number; // the market's own stream
  rev: number; // bumped by every write to managers/posts (post-index cache key)
  raiseAsk: number | null; // manager id with an open raise card
  stats: {
    hubJobs: Record<OwnerId, number>; upgrades: Record<OwnerId, number>;
    hires: Record<OwnerId, number>; retirements: number; autoLoaded: Record<OwnerId, number>;
  };
}

const LOGISTICS_SEED_SALT = 0x4c4f4749; // "LOGI"

/** Fresh logistics state; the market stays empty until the manager market arrives. */
export function newLogistics(seed: number, year: number): LogisticsState {
  return {
    managers: [],
    market: [],
    marketYear: year,
    nextManagerId: 1,
    rngState: (seed ^ LOGISTICS_SEED_SALT) | 0,
    rev: 0,
    raiseAsk: null,
    stats: { hubJobs: {}, upgrades: {}, hires: {}, retirements: 0, autoLoaded: {} },
  };
}
