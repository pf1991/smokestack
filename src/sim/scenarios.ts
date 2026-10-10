import type { EventBus } from '../core/events';
import type { GameState, GoodId, SimContext } from './types';

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
    blurb: 'Turn $300,000 into a million in cash before 1920.',
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
      return state.companies.player.money >= g.amount;
    case 'sell':
      return flagNum(state, `sold:${g.goodId}`) >= g.qty;
    case 'takeover':
      return state.flags?.takeover === true;
    case 'population':
      return state.cities.some((c) => c.population >= g.amount);
  }
}

/** Which goals are met, and whether any unmet goal's deadline (1 Jan of `byYear`) has passed. */
export function evaluateGoals(state: GameState): { done: boolean[]; failed: boolean } {
  const goals = scenarioOf(state).goals;
  const done = goals.map((g) => goalDone(state, g));
  const failed = goals.some((g, i) => !done[i] && state.date.year >= g.byYear);
  return { done, failed };
}

/** Human-readable progress for the goals panel. */
export function goalProgress(state: GameState, g: Goal): { label: string; value: number; target: number } {
  switch (g.kind) {
    case 'money':
      return { label: `Hold $${g.amount.toLocaleString('en-US')} in cash`, value: state.companies.player.money, target: g.amount };
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
 * Subscribes the sim bookkeeping that needs events: units sold (`flags['sold:<good>']`, player only),
 * which companies sell each good in each city (`flags['seller:<city>:<good>']`) and finished contracts.
 * The controller calls this for every new bus; tests call it directly. Returns an unsubscribe.
 */
export function attachGoalTracking(bus: EventBus, state: GameState): () => void {
  const offSale = bus.on('sale', (e) => {
    state.flags ??= {};
    if (e.ownerId === 'player') {
      const k = `sold:${e.goodId}`;
      state.flags[k] = flagNum(state, k) + e.qty;
    }
    const sk = `seller:${e.cityId}:${e.goodId}`;
    const prev = state.flags[sk];
    state.flags[sk] = prev === undefined || prev === e.ownerId ? e.ownerId : 'both';
  });
  const offContract = bus.on('contract', (e) => {
    if (e.status === 'done') state.flags.contractsDone = flagNum(state, 'contractsDone') + 1;
  });
  return () => {
    offSale();
    offContract();
  };
}

/** Monthly: milestone bookkeeping for achievements, then victory / game-over for the scenario. */
export function goalsMonth(ctx: SimContext): void {
  const { state, bus } = ctx;
  state.flags ??= {};
  const { year } = state.date;
  if (year >= 1929 && year <= 1931 && state.companies.player.money < 0) state.flags.crashBroke = true;

  const scenario = scenarioOf(state);
  if (scenario.goals.length === 0 || state.flags.scenarioOver) return;
  const { done, failed } = evaluateGoals(state);
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
