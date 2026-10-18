import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import { BARON_LINES } from '../../data/baronLines';
import { createGame } from '../state';
import type { SimContext } from '../types';
import { BARON_TRAIT_IDS, RETALIATION_KINDS, type BaronTrait } from '../nemesis/types';
import { rivalTaunt, TAUNTS } from './taunts';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function ctxWith(traits: BaronTrait[], generation: 1 | 2, seed = 11): SimContext {
  const state = createGame({ seed, companyName: 'Acme Works', rival: true });
  state.nemesis.traits = traits;
  state.nemesis.head = generation === 2 ? { name: 'Cornelius Smogsworth Jr.', born: 1890, generation: 2 } : state.nemesis.head;
  return { state, bus: new EventBus() };
}

/** Every way `lines` can read once filled in, as the taunt headlines print them. */
function filled(ctx: SimContext, lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  const player = ctx.state.companies.player.name;
  for (const line of lines) {
    for (const c of ctx.state.cities) {
      out.add(`Smogsworth: '${line.split('{player}').join(player).split('{city}').join(c.name).replace(/\.\./g, '.')}'`);
    }
  }
  return out;
}

function taunts(ctx: SimContext, months = 600): string[] {
  for (let i = 0; i < months; i++) rivalTaunt(ctx);
  return ctx.state.news.filter((n) => n.kind === 'rival').map((n) => n.headline);
}

describe('BARON_LINES', () => {
  const sets: [string, readonly string[]][] = [
    ...BARON_TRAIT_IDS.map((t) => [`trait ${t}`, BARON_LINES.trait[t]] as [string, readonly string[]]),
    ...RETALIATION_KINDS.map((k) => [`retaliation ${k}`, BARON_LINES.retaliation[k]] as [string, readonly string[]]),
    ['junior', BARON_LINES.junior],
  ];
  it.each(sets)('%s has at least 4 lines, no emoji and only {player}/{city} placeholders', (_name, lines) => {
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) {
      expect(l.trim().length).toBeGreaterThan(0);
      expect(l).not.toMatch(EMOJI);
      expect(l.replace(/\{player\}|\{city\}/g, '')).not.toMatch(/[{}]/);
    }
  });
  it.each([...RETALIATION_KINDS])('retaliation %s has a line naming no town (for moves with none)', (k) => {
    expect(BARON_LINES.retaliation[k].some((l) => !l.includes('{city}'))).toBe(true);
  });
});

describe('rivalTaunt voice', () => {
  it('about half the taunts come from the head\'s traits; other traits and junior lines never appear in generation 1', () => {
    const ctx = ctxWith(['greedy', 'cunning'], 1);
    const all = taunts(ctx);
    const own = filled(ctx, [...BARON_LINES.trait.greedy, ...BARON_LINES.trait.cunning]);
    const others = filled(ctx, [...BARON_LINES.trait.vindictive, ...BARON_LINES.trait.showman]);
    const junior = filled(ctx, BARON_LINES.junior);
    const generic = filled(ctx, TAUNTS);
    const fromTraits = all.filter((h) => own.has(h)).length;
    expect(all.length).toBeGreaterThan(120);
    expect(fromTraits / all.length).toBeGreaterThan(0.35);
    expect(fromTraits / all.length).toBeLessThan(0.65);
    expect(all.filter((h) => others.has(h))).toEqual([]);
    expect(all.filter((h) => junior.has(h))).toEqual([]);
    // every taunt is either a trait line or one of the classic quips
    expect(all.filter((h) => !own.has(h) && !generic.has(h))).toEqual([]);
  });

  it('Junior (generation 2) also uses the junior lines', () => {
    const ctx = ctxWith(['showman', 'vindictive', 'greedy'], 2);
    const all = taunts(ctx);
    const junior = filled(ctx, BARON_LINES.junior);
    expect(all.filter((h) => junior.has(h)).length).toBeGreaterThan(5);
    const bodies = ctx.state.news.filter((n) => n.kind === 'rival').map((n) => n.body).join('\n');
    expect(bodies).not.toContain('Baron Cornelius Smogsworth said');
  });

  it('is deterministic for a seed', () => {
    expect(taunts(ctxWith(['greedy', 'showman'], 1, 3), 100)).toEqual(taunts(ctxWith(['greedy', 'showman'], 1, 3), 100));
  });
});
