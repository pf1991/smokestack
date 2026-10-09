import type { BuildingTypeId } from '../sim/types';

export type ToolSpec =
  | { kind: 'inspect' }
  | { kind: 'build'; typeId: BuildingTypeId }
  | { kind: 'road' }
  | { kind: 'rail' }
  | { kind: 'bulldoze' }
  | { kind: 'pickStop'; routeId: number | null };
