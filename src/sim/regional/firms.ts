/**
 * Regional firms (Phase 4): three small local companies founded on a schedule, each running one
 * supply chain into its home town's store. They play by the player's rules: every building, road,
 * route and truck goes through the public sim API (sim/chainBuilder.ts) and is paid with the firm's
 * own money. Each month a firm tops up trucks on backed-up legs, renews worn assets and borrows or
 * repays like the Baron (rival/projects.ts, parameterised by owner); six months in the red and it
 * closes, selling its assets through demolishBuilding and sellVehicle. Each December it pays its
 * owners a dividend (DIVIDEND_SHARE of its cash above DIVIDEND_KEEP), so its cash does not pile up. Finance closes their books
 * with every other company's (companyIds). Town politics ignores their sales (politics/factions.ts).
 *
 * Founding happens in January's hook. At most one firm is founded a year: the earliest due firm whose
 * chain can be built, in the largest town without a regional firm, passing over towns where its good
 * is already sold (a local firm sets up where its trade is not yet served). A failed attempt leaves no trace
 * (the chain is dry-run on a copy of the state first) and is retried the next January. A game that
 * starts late, or an old save loaded after 1935, catches up one firm a year: each founding is a
 * town-changing event with its own news, and spreading them keeps a loaded save from changing
 * all at once.
 */
import { EventBus } from '../../core/events';
import { REGIONAL_FIRM_NAMES } from '../../data/names';
import { BUILDINGS } from '../../data/buildings';
import { RECIPES } from '../../data/recipes';
import { buildChain, CHAINS, type ChainId } from '../chainBuilder';
import { abandonInfrastructure, addCompany, companyIds } from '../companies';
import { delist, listCompany } from '../exchange/shares';
import { BANKRUPT_MONTHS, spend } from '../finance';
import { publishNews } from '../news';
import { manageLoans, renewOldAssets, repayLoans, topUpTrucks } from '../rival/projects';
import { atPrices } from '../society/economy';
import { demolishBuilding } from '../state';
import type { City, Company, GameState, GoodId, OwnerId, SimContext } from '../types';
import { deleteRoute, sellVehicle } from '../vehicles';

export interface RegionalFirmDef {
  id: OwnerId;
  /** first January the firm may be founded */
  year: number;
  chain: ChainId;
}

export const REGIONAL_FIRMS: RegionalFirmDef[] = [
  { id: 'regional_1', year: 1905, chain: 'furniture' },
  { id: 'regional_2', year: 1920, chain: 'clothes' },
  { id: 'regional_3', year: 1935, chain: 'cheese' },
];

/** A firm's founding capital, in 1900 dollars (× price index). */
export const REGIONAL_START_MONEY = 150_000;
/** Cash a firm keeps back before buying trucks or renewing assets, in 1900 dollars (× price index). */
export const REGIONAL_RESERVE = 20_000;

/**
 * Trucks per leg a firm starts with: one, and topUpTrucks adds more (up to 4) where a leg backs up.
 * Two per leg from the start doubled the firms' fleets for little trade and cost the soak ~7% in time.
 */
export const FOUNDING_TRUCKS = 1;

/** Cash a firm keeps through December, in 1900 dollars (× price index). */
export const DIVIDEND_KEEP = 200_000;
/** Share of the cash above DIVIDEND_KEEP a firm pays its owners each December. */
export const DIVIDEND_SHARE = 0.6;

const isRegional = (c: Company | undefined): c is Company => c?.kind === 'regional';

/** Towns where some company's route already unloads `good` at a store. */
function townsSelling(state: GameState, good: GoodId): Set<number> {
  const out = new Set<number>();
  for (const r of Object.values(state.routes)) {
    for (const s of r.stops) {
      const b = state.buildings[s.buildingId];
      if (b && b.cityId !== null && s.unload.includes(good) && BUILDINGS[b.typeId]?.category === 'retail') out.add(b.cityId);
    }
  }
  return out;
}

/**
 * Home town for a firm making `good`: the largest town (population, then lowest id) that is no
 * regional firm's home and where nobody sells `good` yet; the largest free town when every one is served.
 */
export function regionalHomeCity(state: GameState, good: GoodId): City | undefined {
  const taken = new Set(Object.values(state.companies).filter(isRegional).map((c) => c.homeCityId));
  const free = [...state.cities].filter((c) => !taken.has(c.id)).sort((a, b) => b.population - a.population || a.id - b.id);
  const selling = townsSelling(state, good);
  return free.find((c) => !selling.has(c.id)) ?? free[0];
}

/** The consumer good a chain sells (its last stage's output). */
export function chainGood(chain: ChainId): GoodId {
  const stages = CHAINS[chain];
  return Object.keys(RECIPES[stages[stages.length - 1].recipeId].outputs)[0];
}

function firmName(def: RegionalFirmDef, city: City): string {
  const n = REGIONAL_FIRMS.indexOf(def);
  return (REGIONAL_FIRM_NAMES[n] ?? REGIONAL_FIRM_NAMES[0]).replace('{city}', city.name);
}

/**
 * Founds `def` in the largest free town if its chain can be built there: first on a copy of the
 * state (so a failure changes nothing), then for real. Returns whether the firm was founded.
 */
function tryFound(ctx: SimContext, def: RegionalFirmDef): boolean {
  const { state } = ctx;
  const city = regionalHomeCity(state, chainGood(def.chain));
  if (!city) return false;
  const firm = { id: def.id, kind: 'regional' as const, name: firmName(def, city), money: atPrices(state, REGIONAL_START_MONEY), loan: 0, homeCityId: city.id };
  const trial: SimContext = { state: structuredClone(state), bus: new EventBus() };
  addCompany(trial.state, firm);
  const trialCity = trial.state.cities.find((c) => c.id === city.id)!;
  if (!buildChain(trial, def.id, trialCity, def.chain, FOUNDING_TRUCKS).ok) return false;
  addCompany(state, firm);
  listCompany(state, def.id);
  // the sim is deterministic, so the real build repeats the trial; should it ever fail, the firm
  // closes at once (and, existing, is not founded again)
  if (!buildChain(ctx, def.id, city, def.chain, FOUNDING_TRUCKS).ok) {
    closeFirm(ctx, def.id, false);
    return false;
  }
  publishNews(
    ctx,
    'market',
    `${firm.name} opens for business`,
    `A new local concern, ${firm.name}, has opened its doors in ${city.name}. ` +
      'Townsfolk welcome a firm that answers to neither the Baron nor the big city.',
  );
  return true;
}

/** January: founds the earliest due firm whose chain can be built (at most one a year). */
function foundDueFirm(ctx: SimContext): void {
  const { year } = ctx.state.date;
  for (const def of REGIONAL_FIRMS) {
    if (def.id in ctx.state.companies || year < def.year) continue;
    if (tryFound(ctx, def)) return;
  }
}

/**
 * Closes a firm: routes deleted and vehicles sold (sellVehicle), buildings demolished (refunds
 * included); the bank takes what cash is left against the loan and writes off the rest, negative
 * cash included, so the firm ends at zero. Its roads and rails stay, abandoned (nobody's).
 */
export function closeFirm(ctx: SimContext, id: OwnerId, news = true): void {
  const { state } = ctx;
  const c = state.companies[id];
  for (const r of Object.values(state.routes)) if (r.ownerId === id) deleteRoute(ctx, r.id);
  for (const v of Object.values(state.vehicles)) if (v.ownerId === id) sellVehicle(ctx, v.id);
  for (const b of Object.values(state.buildings)) if (b.ownerId === id) demolishBuilding(ctx, b.id, id);
  abandonInfrastructure(state, id);
  c.money = 0;
  c.loan = 0;
  c.active = false;
  delist(state, id);
  if (!news) return;
  const town = state.cities.find((x) => x.id === c.homeCityId)?.name ?? 'the provinces';
  publishNews(ctx, 'market', `${c.name} closes its doors`, `After ${BANKRUPT_MONTHS} months in the red, ${c.name} of ${town} has sold off its works and shut up shop.`);
}

/** December payout: DIVIDEND_SHARE of the firm's cash above DIVIDEND_KEEP at today's prices (0 below it). */
export function regionalDividend(state: GameState, c: Company): number {
  return Math.round(DIVIDEND_SHARE * Math.max(0, c.money - atPrices(state, DIVIDEND_KEEP)));
}

/** The regional system's monthly hook. */
export function regionalMonth(ctx: SimContext): void {
  const { state } = ctx;
  if (state.date.month === 1) foundDueFirm(ctx);
  const reserve = atPrices(state, REGIONAL_RESERVE);
  for (const id of companyIds(state)) {
    const c = state.companies[id];
    if (!isRegional(c) || !c.active) continue;
    if (c.monthsInRed >= BANKRUPT_MONTHS) {
      closeFirm(ctx, id);
      continue;
    }
    manageLoans(ctx, id);
    topUpTrucks(ctx, id, reserve);
    renewOldAssets(ctx, id, reserve);
    repayLoans(ctx, id);
    // the firm's (abstract) owners take their dividend; the money leaves the economy
    const dividend = state.date.month === 12 ? regionalDividend(state, c) : 0;
    if (dividend > 0) spend(c, 'dividends', dividend, state.date);
  }
}
