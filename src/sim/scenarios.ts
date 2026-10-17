import { GOODS } from '../data/goods';
import type { GameState, GoodId, SimContext } from './types';
import { realMoney } from './society/economy';

export type Goal =
  | { kind: 'money'; amount: number; byYear: number }
  | { kind: 'sell'; goodId: GoodId; qty: number; byYear: number }
  | { kind: 'takeover'; byYear: number }
  | { kind: 'population'; amount: number; byYear: number };

export interface ScenarioDef {
  id: string;
  name: string;
  blurb: string;
  startYear: number;
  money: number;
  rival: boolean;
  goals: Goal[];
}

export const SCENARIOS: Record<string, ScenarioDef> = {
  sandbox: {
    id: 'sandbox',
    name: 'Free Play',
    blurb: 'No deadlines, no demands. Build an empire from 1900 to the century\'s end.',
    startYear: 1900,
    money: 300_000,
    rival: true,
    goals: [],
  },
  lumber_baron: {
    id: 'lumber_baron',
    name: 'Lumber Baron',
    blurb: 'Turn $300,000 into a million in cash (in 1900 dollars) before 1920.',
    startYear: 1900,
    money: 300_000,
    rival: true,
    goals: [{ kind: 'money', amount: 1_000_000, byYear: 1920 }],
  },
  motor_city: {
    id: 'motor_city',
    name: 'Motor City',
    blurb: 'It is 1910 and the automobile has arrived. Sell 500 cars by 1940.',
    startYear: 1910,
    money: 400_000,
    rival: true,
    goals: [{ kind: 'sell', goodId: 'cars', qty: 500, byYear: 1940 }],
  },
  beat_the_baron: {
    id: 'beat_the_baron',
    name: 'Beat the Baron',
    blurb: 'Outgrow Baron Smogsworth, then take over his empire by 1950.',
    startYear: 1900,
    money: 300_000,
    rival: true,
    goals: [{ kind: 'takeover', byYear: 1950 }],
  },
  boomtown: {
    id: 'boomtown',
    name: 'Boomtown',
    blurb: 'Feed a city until it holds 50,000 souls, by 1960.',
    startYear: 1900,
    money: 300_000,
    rival: true,
    goals: [{ kind: 'population', amount: 50_000, byYear: 1960 }],
  },
};

/** The scenario of a state; unknown or missing ids (old saves) behave as sandbox. */
export function scenarioOf(state: Pick<GameState, 'scenarioId'>): ScenarioDef {
  return SCENARIOS[state.scenarioId] ?? SCENARIOS.sandbox;
}

function flagNum(state: GameState, key: string): number {
  const v = state.flags?.[key];
  return typeof v === 'number' ? v : 0;
}

function goalDone(state: GameState, g: Goal): boolean {
  switch (g.kind) {
    case 'money':
      // ruling R-S14: money goals are in 1900 dollars (cash / price index)
      return realMoney(state, state.companies.player.money) >= g.amount;
    case 'sell':
      return flagNum(state, `sold:${g.goodId}`) >= g.qty;
    case 'takeover':
      return state.flags?.takeover === true;
    case 'population':
      return state.cities.some((c) => c.population >= g.amount);
  }
}

/** Which goals are met, and whether any unmet goal's deadline (1 Jan of `byYear`) has passed. */
export function evaluateGoals(state: GameState, asOfYear: number = state.date.year): { done: boolean[]; failed: boolean } {
  const goals = scenarioOf(state).goals;
  const done = goals.map((g) => goalDone(state, g));
  const failed = goals.some((g, i) => !done[i] && asOfYear >= g.byYear);
  return { done, failed };
}

/** Human-readable progress for the goals panel. */
export function goalProgress(state: GameState, g: Goal): { label: string; value: number; target: number } {
  switch (g.kind) {
    case 'money':
      return { label: `Hold $${g.amount.toLocaleString('en-US')} in cash (in 1900 dollars)`, value: realMoney(state, state.companies.player.money), target: g.amount };
    case 'sell':
      return { label: `Sell ${g.qty.toLocaleString('en-US')} ${g.goodId}`, value: flagNum(state, `sold:${g.goodId}`), target: g.qty };
    case 'takeover':
      return { label: 'Take over Smogsworth Industries', value: state.flags?.takeover === true ? 1 : 0, target: 1 };
    case 'population':
      return {
        label: `Grow a city to ${g.amount.toLocaleString('en-US')} people`,
        value: Math.max(0, ...state.cities.map((c) => c.population)),
        target: g.amount,
      };
  }
}

/**
 * Sim-side bookkeeping, called where the sale happens (production.ts retailDay) so headless runs count
 * too: units the player sold (`flags['sold:<good>']`) and which companies sold each good in each city
 * this month (`flags['seller:<city>:<good>']`, reset monthly by goalsMonth; see sellerFlag).
 */
export function recordSale(state: GameState, e: { ownerId: string; cityId: number; goodId: GoodId; qty: number }): void {
  if (e.qty <= 0) return;
  state.flags ??= {};
  if (e.ownerId === 'player') {
    const k = `sold:${e.goodId}`;
    state.flags[k] = flagNum(state, k) + e.qty;
  }
  const sk = `seller:${e.cityId}:${e.goodId}`;
  const prev = state.flags[sk];
  if (prev === e.ownerId) return;
  if (prev === undefined) {
    state.flags[sk] = e.ownerId;
    return;
  }
  const list = sellerList(prev);
  if (list.includes(e.ownerId)) return;
  state.flags[sk] = sellerFlag([...list, e.ownerId]);
}

/**
 * A seller flag's value: the one owner who sold, `'both'` when exactly the player and the Baron sold
 * (the two-company value older code and saves know), else every seller's id, sorted and comma-joined.
 */
function sellerFlag(ids: string[]): string {
  if (ids.length === 1) return ids[0];
  if (ids.length === 2 && ids.includes('player') && ids.includes('rival')) return 'both';
  return [...ids].sort().join(',');
}

function sellerList(v: unknown): string[] {
  if (typeof v !== 'string' || v === '') return [];
  return v === 'both' ? ['player', 'rival'] : v.split(',');
}

/** Whether every one of `owners` sold `goodId` in town `cityId` this month (seller flags; others may have too). */
export function sellersInclude(state: GameState, cityId: number, goodId: GoodId, ...owners: string[]): boolean {
  const list = sellerList(state.flags[`seller:${cityId}:${goodId}`]);
  return owners.every((o) => list.includes(o));
}

/** Called by contracts.ts when a contract completes. */
export function recordContractDone(state: GameState): void {
  state.flags ??= {};
  state.flags.contractsDone = flagNum(state, 'contractsDone') + 1;
}

/** Monthly: milestone bookkeeping for achievements, then victory / game-over for the scenario. */
export function goalsMonth(ctx: SimContext): void {
  const { state, bus } = ctx;
  state.flags ??= {};
  const { year, month } = state.date;
  if (year >= 1929 && year <= 1931) {
    state.flags.crashMonths = flagNum(state, 'crashMonths') + 1;
    if (state.companies.player.money < 0) state.flags.crashBroke = true;
  }
  // monopoly: sole seller of some good in every city this month (sticky once earned), then start afresh
  if (state.cities.length > 0 && Object.keys(GOODS).some((g) => state.cities.every((c) => state.flags[`seller:${c.id}:${g}`] === 'player'))) {
    state.flags.monopoly = true;
  }
  for (const k of Object.keys(state.flags)) if (k.startsWith('seller:')) delete state.flags[k];

  const scenario = scenarioOf(state);
  if (scenario.goals.length === 0 || state.flags.scenarioOver) return;
  // hooks run while the date is still inside the closing month: December already counts as next year
  const { done, failed } = evaluateGoals(state, year + (month === 12 ? 1 : 0));
  if (done.every(Boolean)) {
    state.flags.scenarioOver = true;
    bus.emit({ type: 'victory', reason: `${scenario.name} complete` });
    state.speed = 0;
  } else if (failed) {
    state.flags.scenarioOver = true;
    bus.emit({ type: 'gameOver', reason: `${scenario.name}: the deadline has passed` });
    state.speed = 0;
  }
}
