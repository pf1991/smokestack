import { BUILDINGS } from '../../data/buildings';
import { GIVEN_NAMES, SURNAMES } from '../../data/managers';
import { err, ok, type Result } from '../../core/result';
import { spend } from '../finance';
import { chance, pick, randInt, random } from '../rng';
import { atPrices } from '../society/economy';
import type { Building, GameState, OwnerId, SimContext } from '../types';
import { clearRaise } from './release';
import type { Manager, ManagerSkills, Skill } from './types';

/** Phase 4b managers (spec section 7): the market, employment, effects, retirement and raises. */

export const SKILL_WEIGHTS: readonly number[] = [35, 30, 20, 10, 5];
export const MARKET_MIN = 4;
export const MARKET_MAX = 6;
export const AGE_MIN = 25;
export const AGE_MAX = 55;
export const SEVERANCE_MONTHS = 3;
export const RETIRE_FROM = 60;
export const RETIRE_AT = 70;
export const RAISE_AFTER_YEARS = 4;
export const RAISE_CHANCE = 0.3;
export const RAISE_FACTOR = 1.2;
export const QUIT_CHANCE = 0.5;
export const PRODUCTION_PER_POINT = 0.04;
export const FRUGALITY_PER_POINT = 0.04;

/** Monthly salary in 1900 dollars: 50 + 20 x (l^2 + p^2 + f^2). */
export function managerSalary(s: ManagerSkills): number {
  return 50 + 20 * (s.logistics ** 2 + s.production ** 2 + s.frugality ** 2);
}

export const managerAge = (m: Manager, year: number): number => year - m.born;

export function severance(state: GameState, m: Manager): number {
  return SEVERANCE_MONTHS * Math.round(atPrices(state, m.salary));
}

function rollSkill(rng: { rngState: number }): Skill {
  let r = random(rng) * 100;
  for (let i = 0; i < SKILL_WEIGHTS.length; i++) {
    r -= SKILL_WEIGHTS[i];
    if (r < 0) return (i + 1) as Skill;
  }
  return 1;
}

/**
 * Replaces the market with 4-6 fresh candidates for `year`. Uses the market's own stream
 * (logistics.rngState), never state.rngState. The first candidate's logistics is at least 2.
 */
export function refreshMarket(state: GameState, year: number): void {
  const L = state.logistics;
  const n = randInt(L, MARKET_MIN, MARKET_MAX);
  const market: Manager[] = [];
  for (let i = 0; i < n; i++) {
    const born = year - randInt(L, AGE_MIN, AGE_MAX);
    const skills: ManagerSkills = { logistics: rollSkill(L), production: rollSkill(L), frugality: rollSkill(L) };
    if (i === 0 && skills.logistics < 2) skills.logistics = 2;
    const name = `${pick(L, GIVEN_NAMES)} ${pick(L, SURNAMES)}`;
    market.push({
      id: L.nextManagerId++, name, born, skills, salary: managerSalary(skills),
      employer: null, post: null, hiredYear: null, lastRaiseYear: null,
    });
  }
  L.market = market;
  L.marketYear = year;
}

// ---------------------------------------------------------------------------
// employment

/** True for a building a manager can run: a works or a warehouse. */
export function takesManager(b: Building): boolean {
  const def = BUILDINGS[b.typeId];
  return def.category === 'extractor' || def.category === 'factory' || b.typeId === 'warehouse';
}

export function hire(ctx: SimContext, owner: OwnerId, managerId: number): Result<Manager> {
  const { state } = ctx;
  const L = state.logistics;
  const at = L.market.findIndex((m) => m.id === managerId);
  if (at < 0) return err(L.managers.some((m) => m.id === managerId) ? 'Not on the market' : 'No such manager');
  if (!state.companies[owner]) return err('No such company');
  const m = L.market[at];
  L.market.splice(at, 1);
  m.employer = owner;
  m.post = null;
  m.hiredYear = state.date.year;
  m.lastRaiseYear = null;
  // keep ascending id order
  let i = L.managers.length;
  while (i > 0 && L.managers[i - 1].id > m.id) i--;
  L.managers.splice(i, 0, m);
  L.rev++;
  L.stats.hires[owner] = (L.stats.hires[owner] ?? 0) + 1;
  ctx.bus.emit({ type: 'managerHired', managerId: m.id, ownerId: owner });
  return ok(m);
}

/** Removes `m` from the payroll at once, post included (the manager leaves the game). */
function dismiss(state: GameState, m: Manager): void {
  const L = state.logistics;
  m.post = null;
  m.employer = null;
  clearRaise(state, m.id);
  L.managers = L.managers.filter((x) => x !== m);
  L.rev++;
}

/** Fires `managerId` with a severance of three months' pay at today's prices (none when `withSeverance` is false). */
export function fire(ctx: SimContext, owner: OwnerId, managerId: number, withSeverance = true): Result {
  const { state } = ctx;
  const m = state.logistics.managers.find((x) => x.id === managerId);
  if (!m) return err('No such manager');
  if (m.employer !== owner) return err('Not your manager');
  if (withSeverance) spend(state.companies[owner], 'salaries', severance(state, m), state.date);
  dismiss(state, m);
  return ok();
}

/** Posts `managerId` to `buildingId`, or unposts with null. */
export function assign(ctx: SimContext, owner: OwnerId, managerId: number, buildingId: number | null): Result {
  const { state } = ctx;
  const L = state.logistics;
  const m = L.managers.find((x) => x.id === managerId);
  if (!m) return err(L.market.some((x) => x.id === managerId) ? 'Not your manager' : 'No such manager');
  if (m.employer !== owner) return err('Not your manager');
  if (buildingId !== null) {
    const b = state.buildings[buildingId];
    if (!b || b.ownerId !== owner) return err('Not your building');
    if (!takesManager(b)) return err('This building takes no manager');
    if (L.managers.some((x) => x !== m && x.post === buildingId)) return err('Post already filled');
  }
  if (m.post !== buildingId) {
    m.post = buildingId;
    L.rev++;
  }
  return ok();
}

// ---------------------------------------------------------------------------
// effects

const postIndex = new WeakMap<object, { rev: number; size: number; map: Map<number, Manager> }>();

/** The manager posted at building `buildingId`, or null. O(1) through an index cached on `logistics.rev`. */
export function managerAt(state: GameState, buildingId: number): Manager | null {
  const L = state.logistics;
  if (L.managers.length === 0) return null;
  let c = postIndex.get(L);
  if (!c || c.rev !== L.rev || c.size !== L.managers.length) {
    const map = new Map<number, Manager>();
    for (const m of L.managers) if (m.post !== null) map.set(m.post, m);
    c = { rev: L.rev, size: L.managers.length, map };
    postIndex.set(L, c);
  }
  return c.map.get(buildingId) ?? null;
}

/** Output rate factor: 1 + 0.04 x production; 1 at a warehouse or with no manager. */
export function managerRate(state: GameState, b: Building): number {
  const m = managerAt(state, b.id);
  return m && b.typeId !== 'warehouse' ? 1 + PRODUCTION_PER_POINT * m.skills.production : 1;
}

/** Upkeep factor: 1 - 0.04 x frugality; 1 with no manager. */
export function managerUpkeep(state: GameState, b: Building): number {
  const m = managerAt(state, b.id);
  return m ? 1 - FRUGALITY_PER_POINT * m.skills.frugality : 1;
}

// ---------------------------------------------------------------------------
// monthly pay, retirement, raises

/** Charges each employed manager's salary at today's prices, in id order, under 'salaries'. */
export function salariesMonth(ctx: SimContext): void {
  const { state } = ctx;
  for (const m of state.logistics.managers) {
    const c = m.employer === null ? undefined : state.companies[m.employer];
    if (c) spend(c, 'salaries', atPrices(state, m.salary), state.date);
  }
}

/** December: managers of 60 or more retire with chance (age - 59) / 10, always at 70. State rng, id order. */
export function retireYear(ctx: SimContext): void {
  const { state } = ctx;
  const L = state.logistics;
  if (L.managers.length === 0) return;
  for (const m of [...L.managers]) {
    const age = managerAge(m, state.date.year);
    if (age < RETIRE_FROM) continue;
    if (age < RETIRE_AT && !chance(state, (age - (RETIRE_FROM - 1)) / (RETIRE_AT - RETIRE_FROM))) continue;
    const owner = m.employer as OwnerId;
    dismiss(state, m);
    L.stats.retirements++;
    ctx.bus.emit({ type: 'managerLeft', managerId: m.id, name: m.name, ownerId: owner, reason: 'retired' });
  }
}

/** The employed player manager `raiseAsk` names, or null. */
export function raiseManager(state: GameState): Manager | null {
  const id = state.logistics.raiseAsk;
  if (id === null) return null;
  const m = state.logistics.managers.find((x) => x.id === id);
  return m && m.employer === 'player' ? m : null;
}

/** The player manager who has gone longest without a raise (from hiring), if 4 years or more. */
export function raiseCandidate(state: GameState): Manager | null {
  let best: Manager | null = null;
  let bestYear = 0;
  for (const m of state.logistics.managers) {
    if (m.employer !== 'player') continue;
    const since = m.lastRaiseYear ?? m.hiredYear ?? state.date.year;
    if (state.date.year - since < RAISE_AFTER_YEARS) continue;
    if (best === null || since < bestYear) (best = m), (bestYear = since);
  }
  return best;
}

/** Card answer: grant (salary x1.2), bonus (clock restarts) or refuse (half quit, unpaid). Always clears the ask. */
export function answerRaise(ctx: SimContext, answer: 'grant' | 'bonus' | 'refuse'): void {
  const { state } = ctx;
  const m = raiseManager(state);
  state.logistics.raiseAsk = null;
  if (!m) return;
  if (answer === 'grant') {
    m.salary = Math.round(m.salary * RAISE_FACTOR * 100) / 100;
    m.lastRaiseYear = state.date.year;
  } else if (answer === 'bonus') {
    m.lastRaiseYear = state.date.year;
  } else if (chance(state, QUIT_CHANCE)) {
    const owner = m.employer as OwnerId;
    dismiss(state, m);
    ctx.bus.emit({ type: 'managerLeft', managerId: m.id, name: m.name, ownerId: owner, reason: 'quit' });
  }
}
