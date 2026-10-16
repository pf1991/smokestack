import type { BuildingTypeId } from '../sim/types';

export type ToolSpec =
  | { kind: 'inspect' }
  | { kind: 'build'; typeId: BuildingTypeId }
  | { kind: 'road' }
  | { kind: 'rail' }
  | { kind: 'bulldoze' }
  /** drag a rectangle of grass to plant forest (sim/state.ts plantForest) */
  | { kind: 'trees' }
  | { kind: 'pickStop'; routeId: number | null };
