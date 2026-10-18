import type { VehicleModelId } from '../sim/logistics/types';

export type TruckModelId = Exclude<VehicleModelId, 'train'>;
export interface ModelRow { name: string; year: number; capacity: number; speed: number; cost: number; maintenance: number }

/** Truck models by era (spec 5.1), oldest first. Prices and upkeep in 1900 dollars; speed in tiles per tick. */
export const TRUCK_MODELS: Record<TruckModelId, ModelRow> = {
  steam_lorry: { name: 'Steam Lorry', year: 1900, capacity: 20, speed: 0.5, cost: 8000, maintenance: 150 },
  motor_truck: { name: 'Motor Truck', year: 1920, capacity: 28, speed: 0.6, cost: 11000, maintenance: 190 },
  diesel_truck: { name: 'Diesel Truck', year: 1950, capacity: 36, speed: 0.7, cost: 15000, maintenance: 240 },
  articulated: { name: 'Articulated Lorry', year: 1975, capacity: 48, speed: 0.8, cost: 21000, maintenance: 320 },
};

/** Oldest first. */
export const TRUCK_MODEL_ORDER: TruckModelId[] = ['steam_lorry', 'motor_truck', 'diesel_truck', 'articulated'];

/** The one train spec (the same numbers as rail.ts's TRAIN). */
export const TRAIN_MODEL: ModelRow = { name: 'Train', year: 1900, capacity: 120, speed: 1.0, cost: 60000, maintenance: 1200 };

/** Upgrade kits (spec 5.2): bought once per truck; the price is `costShare` of the model's price. */
export const KITS = {
  body: { capacity: 1.25, costShare: 0.3 },
  engine: { speed: 1.15, costShare: 0.25 },
} as const;
