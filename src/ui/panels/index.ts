import type { GameController } from '../../game/controller';

/** A window the game can open by id (Task 19+ register building, city, vehicle, routes, finance, ...). */
export interface PanelDef {
  id: string;
  open(game: GameController, arg?: unknown): void;
}

/**
 * Panel registry. Append-only: later tasks add their entries here
 * (e.g. `PANELS.building = buildingPanel`). On merge conflicts keep both sides.
 */
export const PANELS: Record<string, PanelDef> = {};
