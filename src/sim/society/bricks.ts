/**
 * Bricks as construction stock (E4): when the player holds enough bricks in a warehouse or Trading
 * House, building / road / upgrade costs drop by BRICK_DISCOUNT and BRICKS_PER_JOB are consumed from
 * those stockpiles. Rivals never get the discount. Stores cannot hold materials, so they do not count.
 */
import { BUILDINGS } from '../../data/buildings';
import { PLAYER_ID } from '../companies';
import type { Building, GameState, OwnerId } from '../types';

/** Share knocked off construction when bricks are stocked (8%). */
export const BRICK_DISCOUNT = 0.08;
/** Bricks consumed from player stockpiles when the discount is taken. */
export const BRICKS_PER_JOB = 20;

const STOCKPILE = new Set(['warehouse', 'trading_house']);

function stockpiles(state: GameState, owner: OwnerId): Building[] {
  return Object.values(state.buildings)
    .filter((b) => b.ownerId === owner && STOCKPILE.has(b.typeId))
    .sort((a, b) => a.id - b.id);
}

/** Bricks the player (or `owner`) holds in warehouse / Trading House inputs. */
export function brickStock(state: GameState, owner: OwnerId = PLAYER_ID): number {
  let n = 0;
  for (const b of stockpiles(state, owner)) n += Math.floor(b.input.bricks ?? 0);
  return n;
}

/** ×(1 − BRICK_DISCOUNT) when `owner` is the player and holds ≥ BRICKS_PER_JOB bricks; else ×1. */
export function brickCostFactor(state: GameState, owner: OwnerId): number {
  if (owner !== PLAYER_ID) return 1;
  return brickStock(state) >= BRICKS_PER_JOB ? 1 - BRICK_DISCOUNT : 1;
}

/**
 * Pulls BRICKS_PER_JOB from the player's warehouse / Trading House inputs (lowest id first).
 * Returns true when the stock was there and was taken — call after confirming brickCostFactor < 1,
 * or when re-checking at spend time.
 */
export function consumeBricksForJob(state: GameState, owner: OwnerId = PLAYER_ID): boolean {
  if (owner !== PLAYER_ID) return false;
  if (brickStock(state, owner) < BRICKS_PER_JOB) return false;
  let left = BRICKS_PER_JOB;
  for (const b of stockpiles(state, owner)) {
    const have = Math.floor(b.input.bricks ?? 0);
    if (have <= 0) continue;
    const take = Math.min(have, left);
    b.input.bricks = have - take;
    if (b.input.bricks <= 0) delete b.input.bricks;
    left -= take;
    if (left <= 0) return true;
  }
  return false;
}

/** True when a building type can store bricks for the discount (codex / UI). */
export function isBrickStockpile(typeId: string): boolean {
  return STOCKPILE.has(typeId) && BUILDINGS[typeId] !== undefined;
}
