import type { Company, CompanyKind, GameState, OwnerId } from './types';

export type { CompanyKind };

export const PLAYER_ID: OwnerId = 'player';
export const BARON_ID: OwnerId = 'rival';

export function playerCompany(state: GameState): Company {
  return state.companies[PLAYER_ID];
}

export function baronCompany(state: GameState): Company {
  return state.companies[BARON_ID];
}

/** Player first, then the Baron, then every other company sorted by id. */
export function companyIds(state: GameState): OwnerId[] {
  const rest = Object.keys(state.companies)
    .filter((id) => id !== PLAYER_ID && id !== BARON_ID)
    .sort();
  return [PLAYER_ID, BARON_ID, ...rest].filter((id) => id in state.companies);
}

export function addCompany(
  state: GameState,
  c: Omit<Company, 'ledger' | 'monthsInRed' | 'roadTiles' | 'railTiles' | 'active'>,
): Company {
  if (c.id in state.companies) throw new Error(`Company ${c.id} already exists`);
  const company: Company = { ...c, ledger: [], monthsInRed: 0, roadTiles: 0, railTiles: 0, active: true };
  state.companies[c.id] = company;
  return company;
}
