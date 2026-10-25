import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import type { IconId } from '../render/icons';
import { wealth } from '../sim/state';
import { realMoney } from '../sim/society/economy';
import type { GameState, SimContext } from '../sim/types';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Atlas glyph (src/render/icons.ts). */
  icon: IconId;
  test(state: GameState): boolean;
  /**
   * Optional numeric progress for the chase chip (`Next: Name · a/b`). Binary achievements omit this.
   */
  progress?(state: GameState): { value: number; target: number };
}

const STORAGE_KEY = 'smokestack:achievements';
/** Ten calendar years of black months for the decade achievement. */
export const DECADE_BLACK_MONTHS = 120;
const APPLIANCES = ['phonographs', 'refrigerators', 'washing_machines'] as const;

function flagNum(state: GameState, key: string): number {
  const v = state.flags?.[key];
  return typeof v === 'number' ? v : 0;
}

const playerVehicles = (s: GameState) => Object.values(s.vehicles).filter((v) => v.ownerId === 'player');

function consumerLinesSold(state: GameState): number {
  let n = 0;
  for (const [k, v] of Object.entries(state.flags ?? {})) {
    if (!k.startsWith('sold:') || typeof v !== 'number' || v <= 0) continue;
    if (GOODS[k.slice(5)]?.kind === 'consumer') n++;
  }
  return n;
}

function componentUnitsSold(state: GameState): number {
  let n = 0;
  for (const [k, v] of Object.entries(state.flags ?? {})) {
    if (!k.startsWith('sold:') || typeof v !== 'number') continue;
    if (GOODS[k.slice(5)]?.kind === 'component') n += v;
  }
  return n;
}

function applianceUnitsSold(state: GameState): number {
  return APPLIANCES.reduce((a, id) => a + flagNum(state, `sold:${id}`), 0);
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_sale', name: 'First Sale', icon: 'bell', desc: 'Sell your first goods.',
    test: (s) => Object.keys(s.flags ?? {}).some((k) => k.startsWith('sold:') && flagNum(s, k) > 0),
  },
  {
    // approximation: owns an extractor and has sold a consumer good (no per-good provenance is tracked)
    id: 'chain_gang', name: 'Chain Gang', icon: 'chain', desc: 'Sell a finished good made from your own extractor.',
    test: (s) =>
      Object.values(s.buildings).some((b) => b.ownerId === 'player' && BUILDINGS[b.typeId]?.category === 'extractor') &&
      Object.keys(s.flags ?? {}).some((k) => k.startsWith('sold:') && GOODS[k.slice(5)]?.kind === 'consumer' && flagNum(s, k) > 0),
  },
  // ruling R-S14: money achievements count real money (nominal / price index, sim/society/economy.ts)
  { id: 'millionaire', name: 'Millionaire', icon: 'money', desc: 'Reach a net worth of $1,000,000, shares included (in 1900 dollars).', test: (s) => realMoney(s, wealth(s, 'player')) >= 1_000_000 },
  { id: 'motor_mogul', name: 'Motor Mogul', icon: 'cars', desc: 'Sell 100 automobiles.', test: (s) => flagNum(s, 'sold:cars') >= 100, progress: (s) => ({ value: Math.min(flagNum(s, 'sold:cars'), 100), target: 100 }) },
  { id: 'fleet_50', name: 'Fleet of Fifty', icon: 'truck', desc: 'Run 50 vehicles at once.', test: (s) => playerVehicles(s).length >= 50, progress: (s) => ({ value: Math.min(playerVehicles(s).length, 50), target: 50 }) },
  { id: 'rail_baron', name: 'Rail Baron', icon: 'train', desc: 'Run 10 trains at once.', test: (s) => playerVehicles(s).filter((v) => v.kind === 'train').length >= 10, progress: (s) => ({ value: Math.min(playerVehicles(s).filter((v) => v.kind === 'train').length, 10), target: 10 }) },
  {
    // approximation: checked from 1950 on, not continuously
    id: 'clean_hands', name: 'Clean Hands', icon: 'soap', desc: 'Be worth $1M (in 1900 dollars) in 1950 without a single heavy polluter.',
    test: (s) =>
      s.date.year >= 1950 &&
      realMoney(s, wealth(s, 'player')) > 1_000_000 &&
      !Object.values(s.buildings).some((b) => b.ownerId === 'player' && (BUILDINGS[b.typeId]?.pollution ?? 0) > 2),
  },
  { id: 'contract_killer', name: 'Contract Killer', icon: 'scroll', desc: 'Complete 10 mayor\'s contracts.', test: (s) => flagNum(s, 'contractsDone') >= 10, progress: (s) => ({ value: Math.min(flagNum(s, 'contractsDone'), 10), target: 10 }) },
  {
    id: 'crash_survivor', name: 'Crash Survivor', icon: 'chart_down', desc: 'Keep your cash positive through 1929-1931.',
    test: (s) => flagNum(s, 'crashMonths') >= 36 && s.flags?.crashBroke !== true, // months tracked by goalsMonth
    progress: (s) => ({ value: Math.min(flagNum(s, 'crashMonths'), 36), target: 36 }),
  },
  { id: 'baron_busted', name: 'Baron Busted', icon: 'top_hat', desc: 'Take over Smogsworth Industries.', test: (s) => s.flags?.takeover === true },
  { id: 'centennial', name: 'Centennial', icon: 'fireworks', desc: 'Reach the year 2000.', test: (s) => s.date.year >= 2000 },
  {
    id: 'monopoly', name: 'Monopoly', icon: 'crown', desc: 'Be the only seller of a good in every city.',
    test: (s) => s.flags?.monopoly === true, // set (sticky) by goalsMonth from this month's seller flags
  },
  // --- mid-game chaseable achievements (E1.3) ---
  {
    id: 'first_th_sale', name: 'Trading Desk', icon: 'money', desc: 'Make your first Trading House sale.',
    test: (s) => flagNum(s, 'thSales') > 0,
  },
  {
    id: 'first_component', name: 'Parts Merchant', icon: 'chain', desc: 'Sell a component good (nationally or in town).',
    test: (s) => componentUnitsSold(s) > 0,
  },
  {
    id: 'first_hub', name: 'Hub Master', icon: 'hub', desc: 'Open a logistics hub on a warehouse.',
    test: (s) => Object.values(s.buildings).some((b) => b.ownerId === 'player' && b.hub),
  },
  {
    id: 'first_appliance', name: 'Modern Comforts', icon: 'shop', desc: 'Sell a phonograph, refrigerator, or washing machine.',
    test: (s) => applianceUnitsSold(s) > 0,
  },
  {
    id: 'survive_price_war', name: 'Price War Survivor', icon: 'chart_down', desc: 'Outlast one of the Baron\'s price wars while solvent.',
    test: (s) => s.flags?.priceWarSurvived === true,
  },
  {
    id: 'first_scrubber', name: 'Clean Stack', icon: 'scrubber', desc: 'Fit a scrubber on one of your works.',
    test: (s) => Object.values(s.buildings).some((b) => b.ownerId === 'player' && (b.upgrades?.scrubber ?? 0) >= 1),
  },
  {
    id: 'second_line', name: 'Second Line', icon: 'factory', desc: 'Sell two different consumer goods.',
    test: (s) => consumerLinesSold(s) >= 2,
    progress: (s) => ({ value: Math.min(consumerLinesSold(s), 2), target: 2 }),
  },
  {
    id: 'decade_black', name: 'Black Decade', icon: 'star', desc: 'Keep cash non-negative for ten consecutive years.',
    test: (s) => flagNum(s, 'blackMonths') >= DECADE_BLACK_MONTHS,
    progress: (s) => ({ value: Math.min(flagNum(s, 'blackMonths'), DECADE_BLACK_MONTHS), target: DECADE_BLACK_MONTHS }),
  },
];

/** Ids of achievements newly satisfied by `state`; they are added to `unlocked`, so each fires once. */
export function checkAchievements(state: GameState, unlocked: Set<string>): string[] {
  const fresh = ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && a.test(state)).map((a) => a.id);
  for (const id of fresh) unlocked.add(id);
  return fresh;
}

export function loadUnlocked(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) return new Set(list.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* blocked or corrupt storage: start fresh */
  }
  return new Set();
}

function persist(unlocked: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...unlocked]));
  } catch {
    /* quota or blocked storage: the unlock still shows this session */
  }
}

export interface ChaseTarget {
  def: AchievementDef;
  /** Present when the achievement exposes numeric progress. */
  progress: { value: number; target: number } | null;
}

/**
 * Nearest incomplete achievement for the chase chip: prefer ones with numeric progress closest to
 * completion; otherwise the next by catalogue order.
 */
export function nextChase(state: GameState, unlocked: Set<string>): ChaseTarget | null {
  const open = ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && !a.test(state));
  if (open.length === 0) return null;
  const withProgress = open
    .map((def) => {
      const progress = def.progress?.(state) ?? null;
      return { def, progress };
    })
    .filter((t): t is ChaseTarget & { progress: { value: number; target: number } } => t.progress !== null && t.progress.target > 0);
  if (withProgress.length > 0) {
    withProgress.sort((a, b) => b.progress.value / b.progress.target - a.progress.value / a.progress.target);
    return withProgress[0];
  }
  return { def: open[0], progress: null };
}

/** `Next: Contract Killer · 3/10` (or `Next: Name` when binary). */
export function chaseChipText(state: GameState, unlocked: Set<string> = loadUnlocked()): string | null {
  const t = nextChase(state, unlocked);
  if (!t) return null;
  if (t.progress) return `Next: ${t.def.name} · ${t.progress.value}/${t.progress.target}`;
  return `Next: ${t.def.name}`;
}

/**
 * Checks achievements on every in-game day (and right after the first sale), persists new ones and
 * emits a toast plus an `achievement` event (which the audio layer answers with a fanfare).
 */
export function attachAchievements(ctx: SimContext): () => void {
  const unlocked = loadUnlocked();
  const run = () => {
    const fresh = checkAchievements(ctx.state, unlocked);
    if (fresh.length === 0) return;
    persist(unlocked);
    for (const id of fresh) {
      const def = ACHIEVEMENTS.find((a) => a.id === id)!;
      ctx.bus.emit({ type: 'achievement', id });
      ctx.bus.emit({ type: 'toast', message: `Achievement unlocked: ${def.name}`, tone: 'good' });
    }
  };
  const offs = [
    ctx.bus.on('dayStart', run),
    ctx.bus.on('sale', () => {
      if (!unlocked.has('first_sale') || !unlocked.has('first_th_sale') || !unlocked.has('first_component') || !unlocked.has('first_appliance') || !unlocked.has('second_line')) run();
    }),
    // ids announced elsewhere (the rival's takeover) count as unlocked; no second fanfare
    ctx.bus.on('achievement', (e) => {
      if (!unlocked.has(e.id)) {
        unlocked.add(e.id);
        persist(unlocked);
        const def = ACHIEVEMENTS.find((a) => a.id === e.id);
        if (def) ctx.bus.emit({ type: 'toast', message: `Achievement unlocked: ${def.name}`, tone: 'good' });
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}
