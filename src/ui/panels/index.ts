import type { GameController } from '../../game/controller';
import { contractsPanel } from './contracts';
import { newspaperPanel } from './newspaper';
import { routesPanel } from './routes';

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

PANELS.contracts = contractsPanel;
PANELS.newspaper = newspaperPanel;
import { buildingPanel } from './building';
import { cityPanel } from './city';
import { vehiclePanel } from './vehicle';

PANELS.building = buildingPanel;
PANELS.city = cityPanel;
PANELS.vehicle = vehiclePanel;
PANELS.routes = routesPanel;
