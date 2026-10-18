import type { Company, CompanyKind, GameState, OwnerId, SimContext } from './types';

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

/**
 * The single funnel for moving assets between companies (takeovers, heirs).
 * Moves buildings, routes, vehicles and road/rail tile ownership plus tile counts.
 * Does not touch money, loans or `active`: the caller decides those.
 */
export function transferOwnership(
  ctx: SimContext,
  from: OwnerId,
  to: OwnerId,
): { buildings: number; routes: number; vehicles: number; roadTiles: number; railTiles: number } {
  const { state } = ctx;
  if (from === to) return { buildings: 0, routes: 0, vehicles: 0, roadTiles: 0, railTiles: 0 };
  const src = state.companies[from];
  const dst = state.companies[to];
  if (!src || !dst) throw new Error(`transferOwnership: unknown company ${!src ? from : to}`);
  let buildings = 0;
  let routes = 0;
  let vehicles = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== from) continue;
    b.ownerId = to;
    buildings++;
    // the Baron's insolvency bookkeeping (rival/insolvency.ts) does not travel with the building
    delete b.salesThisMonth;
    delete b.earnings12;
  }
  for (const m of state.logistics.managers) {
    if (m.employer !== from) continue;
    m.employer = to;
    state.logistics.rev++;
  }
  for (const r of Object.values(state.routes)) if (r.ownerId === from) (r.ownerId = to), routes++;
  for (const v of Object.values(state.vehicles)) if (v.ownerId === from) (v.ownerId = to), vehicles++;
  for (const t of state.map.tiles) {
    if (t.roadOwner === from) t.roadOwner = to;
    if (t.railOwner === from) t.railOwner = to;
  }
  const roadTiles = src.roadTiles;
  const railTiles = src.railTiles;
  dst.roadTiles += roadTiles;
  dst.railTiles += railTiles;
  src.roadTiles = 0;
  src.railTiles = 0;
  ctx.bus.emit({ type: 'ownershipChanged', from, to });
  return { buildings, routes, vehicles, roadTiles, railTiles };
}

/**
 * A closing company walks away from its roads and rails: they stay on the map, owned by nobody, and
 * its tile counts (which drive upkeep) drop to zero. Returns how many road and rail tiles it left.
 */
export function abandonInfrastructure(state: GameState, owner: OwnerId): { roadTiles: number; railTiles: number } {
  const c = state.companies[owner];
  if (!c) throw new Error(`abandonInfrastructure: unknown company ${owner}`);
  for (const t of state.map.tiles) {
    if (t.roadOwner === owner) t.roadOwner = null;
    if (t.railOwner === owner) t.railOwner = null;
  }
  const left = { roadTiles: c.roadTiles, railTiles: c.railTiles };
  c.roadTiles = 0;
  c.railTiles = 0;
  return left;
}
