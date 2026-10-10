import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { netWorth } from '../sim/rival';
import type { GameState, SimContext } from '../sim/types';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  test(state: GameState): boolean;
}

const STORAGE_KEY = 'smokestack:achievements';

function flagNum(state: GameState, key: string): number {
  const v = state.flags?.[key];
  return typeof v === 'number' ? v : 0;
}

const playerVehicles = (s: GameState) => Object.values(s.vehicles).filter((v) => v.ownerId === 'player');

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_sale', name: 'First Sale', icon: '🛎️', desc: 'Sell your first goods.',
    test: (s) => Object.keys(s.flags ?? {}).some((k) => k.startsWith('sold:') && flagNum(s, k) > 0),
  },
  {
    // approximation: owns an extractor and has sold a tier-2 good (no per-good provenance is tracked)
    id: 'chain_gang', name: 'Chain Gang', icon: '⛓️', desc: 'Sell a finished good made from your own extractor.',
    test: (s) =>
      Object.values(s.buildings).some((b) => b.ownerId === 'player' && BUILDINGS[b.typeId]?.category === 'extractor') &&
      Object.keys(s.flags ?? {}).some((k) => k.startsWith('sold:') && GOODS[k.slice(5)]?.tier === 2 && flagNum(s, k) > 0),
  },
  { id: 'millionaire', name: 'Millionaire', icon: '💰', desc: 'Reach a net worth of $1,000,000.', test: (s) => netWorth(s, 'player') >= 1_000_000 },
  { id: 'motor_mogul', name: 'Motor Mogul', icon: '🚗', desc: 'Sell 100 automobiles.', test: (s) => flagNum(s, 'sold:cars') >= 100 },
  { id: 'fleet_50', name: 'Fleet of Fifty', icon: '🚚', desc: 'Run 50 vehicles at once.', test: (s) => playerVehicles(s).length >= 50 },
  { id: 'rail_baron', name: 'Rail Baron', icon: '🚂', desc: 'Run 10 trains at once.', test: (s) => playerVehicles(s).filter((v) => v.kind === 'train').length >= 10 },
  {
    // approximation: checked from 1950 on, not continuously
    id: 'clean_hands', name: 'Clean Hands', icon: '🧼', desc: 'Be worth $1M in 1950 without a single heavy polluter.',
    test: (s) =>
      s.date.year >= 1950 &&
      netWorth(s, 'player') > 1_000_000 &&
      !Object.values(s.buildings).some((b) => b.ownerId === 'player' && (BUILDINGS[b.typeId]?.pollution ?? 0) > 2),
  },
  { id: 'contract_killer', name: 'Contract Killer', icon: '📜', desc: 'Complete 10 mayor\'s contracts.', test: (s) => flagNum(s, 'contractsDone') >= 10 },
  {
    id: 'crash_survivor', name: 'Crash Survivor', icon: '📉', desc: 'Keep your cash positive through 1929-1931.',
    test: (s) => flagNum(s, 'crashMonths') >= 36 && s.flags?.crashBroke !== true, // months tracked by goalsMonth
  },
  { id: 'baron_busted', name: 'Baron Busted', icon: '🎩', desc: 'Take over Smogsworth Industries.', test: (s) => s.flags?.takeover === true },
  { id: 'centennial', name: 'Centennial', icon: '🎆', desc: 'Reach the year 2000.', test: (s) => s.date.year >= 2000 },
  {
    id: 'monopoly', name: 'Monopoly', icon: '👑', desc: 'Be the only seller of a good in every city.',
    test: (s) => s.flags?.monopoly === true, // set (sticky) by goalsMonth from this month's seller flags
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
      ctx.bus.emit({ type: 'toast', message: `Achievement unlocked: ${def.icon} ${def.name}`, tone: 'good' });
    }
  };
  const offs = [
    ctx.bus.on('dayStart', run),
    ctx.bus.on('sale', () => {
      if (!unlocked.has('first_sale')) run();
    }),
    // ids announced elsewhere (the rival's takeover) count as unlocked; no second fanfare
    ctx.bus.on('achievement', (e) => {
      if (!unlocked.has(e.id)) {
        unlocked.add(e.id);
        persist(unlocked);
        const def = ACHIEVEMENTS.find((a) => a.id === e.id);
        if (def) ctx.bus.emit({ type: 'toast', message: `Achievement unlocked: ${def.icon} ${def.name}`, tone: 'good' });
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}
