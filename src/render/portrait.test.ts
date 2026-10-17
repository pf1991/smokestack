import { describe, expect, it } from 'vitest';
import { BARON_MOODS, drawBaronPortrait } from './portrait';

/** A context that records every method call (with its arguments) and accepts any property write. */
function mockCtx(): { g: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get: (t, k) =>
      k in t
        ? t[k]
        : (...args: unknown[]) => {
          calls.push(`${String(k)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`);
          return { addColorStop: () => {}, width: 10 };
        },
    set: (t, k, v) => {
      calls.push(`${String(k)}=${String(v)}`);
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

describe('drawBaronPortrait', () => {
  it('has four moods', () => {
    expect([...BARON_MOODS]).toEqual(['smug', 'furious', 'scheming', 'gloating']);
  });

  it.each(BARON_MOODS.flatMap((m) => [[m, 1], [m, 2]] as const))('draws %s, generation %i, without throwing', (mood, gen) => {
    const { g, calls } = mockCtx();
    expect(() => drawBaronPortrait(g, 128, mood, gen)).not.toThrow();
    expect(calls.length).toBeGreaterThan(50);
    // balanced save/restore
    expect(calls.filter((c) => c.startsWith('save(')).length).toBe(calls.filter((c) => c.startsWith('restore(')).length);
  });

  it('every mood and generation draws a distinct picture; generation defaults to 1', () => {
    const seen = new Set<string>();
    for (const mood of BARON_MOODS) {
      for (const gen of [1, 2] as const) {
        const { g, calls } = mockCtx();
        drawBaronPortrait(g, 100, mood, gen);
        seen.add(calls.join('|'));
      }
      const a = mockCtx();
      const b = mockCtx();
      drawBaronPortrait(a.g, 100, mood);
      drawBaronPortrait(b.g, 100, mood, 1);
      expect(a.calls).toEqual(b.calls);
    }
    expect(seen.size).toBe(8);
  });
});
