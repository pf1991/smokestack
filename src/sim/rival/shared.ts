import { atPrices } from '../society/economy';
import type { GameState } from '../types';

/** Cash the Baron keeps back, in 1900 dollars (rivalReserve gives today's figure). */
export const RIVAL_RESERVE = 50000;

/** RIVAL_RESERVE at today's prices. */
export const rivalReserve = (state: GameState): number => atPrices(state, RIVAL_RESERVE);
export const FULL_RATIO = 0.8;
// flags used to remember a project's details across months (GameState.flags holds primitives only)
export const F_BLOCKED = 'rivalBlocked';
/** months a project may wait for money before it is finished as-is or abandoned */
export const MAX_STALL_MONTHS = 6;
