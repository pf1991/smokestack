/**
 * Free Play soft ambitions: one active optional goal with a meter. Completing rolls the next unmet
 * from the pool. Never fails the game. Progress lives in `state.flags` (no save version bump):
 *   - `ambition:active` — id string of the current ambition, or absent when none
 *   - `ambition:done:<id>` — 1 once completed
 */
import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { monthProfit } from './finance';
import { scenarioOf } from './scenarios';
import type { GameState, SimContext } from './types';

export type AmbitionId =
  | 'sell_furniture_100'
  | 'complete_contract_1'
  | 'own_trading_house'
  | 'second_city_store'
  | 'year_profit_50k'
  | 'sell_component_any';

export interface AmbitionDef {
  id: AmbitionId;
  name: string;
  desc: string;
  /** Current value and target for the meter. */
  progress(state: GameState): { value: number; target: number };
  done(state: GameState): boolean;
}

const ACTIVE_KEY = 'ambition:active';
const doneKey = (id: AmbitionId) => `ambition:done:${id}`;

function flagNum(state: GameState, key: string): number {
  const v = state.flags?.[key];
  return typeof v === 'number' ? v : 0;
}

function flagStr(state: GameState, key: string): string | null {
  const v = state.flags?.[key];
  return typeof v === 'string' ? v : null;
}

/** Sum of monthProfit for every closed ledger month in `year` (open month included). */
export function yearProfit(state: GameState, year: number): number {
  const ledger = state.companies.player?.ledger ?? [];
  let sum = 0;
  for (const m of ledger) {
    if (m.year === year) sum += monthProfit(m);
  }
  return sum;
}

/** Distinct cityIds where the player owns a retail store. */
export function playerStoreCities(state: GameState): number[] {
  const cities = new Set<number>();
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'player' || b.cityId == null) continue;
    if (BUILDINGS[b.typeId]?.category !== 'retail') continue;
    cities.add(b.cityId);
  }
  return [...cities].sort((a, b) => a - b);
}

/** Units of any component good the player has sold (retail or Trading House). */
export function componentSold(state: GameState): number {
  let n = 0;
  for (const [k, v] of Object.entries(state.flags ?? {})) {
    if (!k.startsWith('sold:') || typeof v !== 'number') continue;
    const good = GOODS[k.slice(5)];
    if (good?.kind === 'component') n += v;
  }
  return n;
}

export const AMBITIONS: AmbitionDef[] = [
  {
    id: 'sell_furniture_100',
    name: 'Furnish the towns',
    desc: 'Sell 100 furniture.',
    progress: (s) => ({ value: flagNum(s, 'sold:furniture'), target: 100 }),
    done: (s) => flagNum(s, 'sold:furniture') >= 100,
  },
  {
    id: 'complete_contract_1',
    name: 'Mayor’s errand',
    desc: 'Complete one mayor’s contract.',
    progress: (s) => ({ value: Math.min(flagNum(s, 'contractsDone'), 1), target: 1 }),
    done: (s) => flagNum(s, 'contractsDone') >= 1,
  },
  {
    id: 'own_trading_house',
    name: 'National trade',
    desc: 'Own a Trading House.',
    progress: (s) => ({
      value: Object.values(s.buildings).some((b) => b.ownerId === 'player' && b.typeId === 'trading_house') ? 1 : 0,
      target: 1,
    }),
    done: (s) => Object.values(s.buildings).some((b) => b.ownerId === 'player' && b.typeId === 'trading_house'),
  },
  {
    id: 'second_city_store',
    name: 'Two-town merchant',
    desc: 'Own stores in two different cities.',
    progress: (s) => ({ value: Math.min(playerStoreCities(s).length, 2), target: 2 }),
    done: (s) => playerStoreCities(s).length >= 2,
  },
  {
    id: 'year_profit_50k',
    name: 'Fifty-thousand year',
    desc: 'Earn $50,000 profit in a single calendar year.',
    progress: (s) => ({ value: Math.min(Math.max(0, yearProfit(s, s.date.year)), 50_000), target: 50_000 }),
    done: (s) => {
      // any closed year in the ledger, or the open year so far
      const years = new Set((s.companies.player?.ledger ?? []).map((m) => m.year));
      years.add(s.date.year);
      for (const y of years) if (yearProfit(s, y) >= 50_000) return true;
      return false;
    },
  },
  {
    id: 'sell_component_any',
    name: 'Parts dealer',
    desc: 'Sell any component good (store or Trading House).',
    progress: (s) => ({ value: Math.min(componentSold(s), 1), target: 1 }),
    done: (s) => componentSold(s) >= 1,
  },
];

export function ambitionById(id: string): AmbitionDef | undefined {
  return AMBITIONS.find((a) => a.id === id);
}

export function isAmbitionDone(state: GameState, id: AmbitionId): boolean {
  return flagNum(state, doneKey(id)) >= 1 || (ambitionById(id)?.done(state) ?? false);
}

export function activeAmbitionId(state: GameState): AmbitionId | null {
  const id = flagStr(state, ACTIVE_KEY);
  return id && AMBITIONS.some((a) => a.id === id) ? (id as AmbitionId) : null;
}

/** First unmet ambition in catalogue order, or null when the pool is exhausted. */
export function nextUnmetAmbition(state: GameState): AmbitionDef | null {
  for (const a of AMBITIONS) {
    if (flagNum(state, doneKey(a.id)) >= 1) continue;
    if (a.done(state)) continue;
    return a;
  }
  return null;
}

/** True when this state should run soft ambitions (Free Play only). */
export function ambitionsEnabled(state: GameState): boolean {
  return scenarioOf(state).goals.length === 0;
}

/**
 * Ensures an active ambition exists for Free Play. Marks already-met pool entries done without
 * toasting (catch-up on load). Returns the ambition newly completed this tick, if any.
 */
export function tickAmbitions(state: GameState): AmbitionDef | null {
  if (!ambitionsEnabled(state)) return null;
  state.flags ??= {};

  const activeBefore = activeAmbitionId(state);
  const activeWasDone = activeBefore !== null && flagNum(state, doneKey(activeBefore)) >= 1;

  // catch up: anything already true gets a done flag so we never re-offer it
  for (const a of AMBITIONS) {
    if (flagNum(state, doneKey(a.id)) >= 1) continue;
    if (a.done(state)) state.flags[doneKey(a.id)] = 1;
  }

  const active = activeAmbitionId(state);
  if (active && flagNum(state, doneKey(active)) >= 1) {
    const next = nextUnmetAmbition(state);
    if (next) state.flags[ACTIVE_KEY] = next.id;
    else delete state.flags[ACTIVE_KEY];
    // toast only when this tick newly marked the active ambition done
    if (!activeWasDone) return ambitionById(active)!;
    return null;
  }

  if (!active) {
    const next = nextUnmetAmbition(state);
    if (next) state.flags[ACTIVE_KEY] = next.id;
  }
  return null;
}

/** Completed ambition ids in catalogue order. */
export function completedAmbitions(state: GameState): AmbitionDef[] {
  return AMBITIONS.filter((a) => flagNum(state, doneKey(a.id)) >= 1);
}

/**
 * Runs on dayStart: advances Free Play ambitions and toasts completions. Deterministic (no rng).
 */
export function attachAmbitions(ctx: SimContext): () => void {
  const run = () => {
    const completed = tickAmbitions(ctx.state);
    if (!completed) return;
    ctx.bus.emit({ type: 'toast', message: `Ambition complete: ${completed.name}`, tone: 'good' });
  };
  // seed active on attach so the Goals panel has something before the first day
  tickAmbitions(ctx.state);
  const offs = [ctx.bus.on('dayStart', run), ctx.bus.on('sale', run)];
  return () => offs.forEach((off) => off());
}
