import type { Result } from '../../core/result';
import { err, ok } from '../../core/result';
import { KITS, TRAIN_MODEL, TRUCK_MODEL_ORDER, TRUCK_MODELS, type ModelRow, type TruckModelId } from '../../data/vehicleModels';
import { canAfford, spend } from '../finance';
import { atPrices } from '../society/economy';
import type { GameState, OwnerId, SimContext, Vehicle } from '../types';
import type { VehicleModelId } from './types';

export type KitId = keyof typeof KITS;

/** The latest truck model on sale: the newest whose `year` is not after the current year. */
export function newestModel(state: GameState): VehicleModelId {
  let best: VehicleModelId = TRUCK_MODEL_ORDER[0];
  for (const id of TRUCK_MODEL_ORDER) if (TRUCK_MODELS[id].year <= state.date.year) best = id;
  return best;
}

export function modelRow(model: VehicleModelId): ModelRow {
  return model === 'train' ? TRAIN_MODEL : TRUCK_MODELS[model];
}

export function modelSpec(model: VehicleModelId): { capacity: number; speed: number; cost: number; maintenance: number } {
  const { capacity, speed, cost, maintenance } = modelRow(model);
  return { capacity, speed, cost, maintenance };
}

/** True when a truck model newer than `model` is on sale. */
export function hasNewerModel(state: GameState, model: VehicleModelId): boolean {
  return model !== 'train' && TRUCK_MODEL_ORDER.indexOf(newestModel(state) as TruckModelId) > TRUCK_MODEL_ORDER.indexOf(model);
}

export function kitCost(state: GameState, veh: Pick<Vehicle, 'model'>, kit: KitId): number {
  return Math.round(atPrices(state, modelSpec(veh.model).cost * KITS[kit].costShare));
}

export function kitRefusal(state: GameState, veh: Vehicle, kit: KitId, owner?: OwnerId): string | null {
  if (owner !== undefined && veh.ownerId !== owner) return 'Not your vehicle';
  if (veh.kind !== 'truck') return 'Trucks only';
  if (veh.kits?.[kit]) return 'Already fitted';
  if (!canAfford(state.companies[veh.ownerId], kitCost(state, veh, kit))) return 'Not enough money';
  return null;
}

/** Fits a kit at once: the one place besides purchase and migration that changes a truck's capacity or speed. */
export function fitKit(ctx: SimContext, vehicleId: number, kit: KitId, owner?: OwnerId): Result {
  const { state } = ctx;
  const veh = state.vehicles[vehicleId];
  if (!veh) return err('No such vehicle');
  const bad = kitRefusal(state, veh, kit, owner);
  if (bad) return err(bad);
  spend(state.companies[veh.ownerId], 'vehicles', kitCost(state, veh, kit), state.date);
  const base = modelSpec(veh.model);
  if (kit === 'body') veh.capacity = Math.round(base.capacity * KITS.body.capacity);
  else veh.speed = base.speed * KITS.engine.speed;
  veh.kits = { body: false, engine: false, ...veh.kits, [kit]: true };
  return ok();
}
