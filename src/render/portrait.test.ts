import { describe, expect, it } from 'vitest';
import { ageBracket, BARON_MOODS, drawBaronPortrait, drawFamilyPortrait } from './portrait';

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

describe('drawFamilyPortrait', () => {
  const person = (id: number, name: string, born = 1880, alive = true) => ({ id, name, born, alive });

  it('draws every bracket, sex and life state without throwing, with balanced save/restore', () => {
    for (const year of [1885, 1920, 1950]) {
      for (const female of [false, true]) {
        for (const alive of [true, false]) {
          const { g, calls } = mockCtx();
          expect(() => drawFamilyPortrait(g, 96, person(3, 'Edith Gilded', 1880, alive), { year, female })).not.toThrow();
          expect(calls.length).toBeGreaterThan(40);
          expect(calls.filter((c) => c.startsWith('save(')).length).toBe(calls.filter((c) => c.startsWith('restore(')).length);
        }
      }
    }
  });

  it('is stable for one person and varies with the person and the age bracket', () => {
    const draw = (p: ReturnType<typeof person>, year: number, female = false) => {
      const { g, calls } = mockCtx();
      drawFamilyPortrait(g, 100, p, { year, female });
      return calls.join('|');
    };
    expect(draw(person(2, 'Ezra Gilded'), 1920)).toBe(draw(person(2, 'Ezra Gilded'), 1920));
    const looks = new Set([1, 2, 3, 4, 5, 6].map((id) => draw(person(id, `Kid${id} Gilded`), 1920)));
    expect(looks.size).toBeGreaterThan(3);
    expect(draw(person(2, 'Ezra Gilded'), 1885)).not.toBe(draw(person(2, 'Ezra Gilded'), 1920));
    expect(draw(person(2, 'Ezra Gilded'), 1950)).not.toBe(draw(person(2, 'Ezra Gilded'), 1920));
    expect(draw(person(2, 'Ezra Gilded'), 1920, true)).not.toBe(draw(person(2, 'Ezra Gilded'), 1920));
    expect(ageBracket(15)).toBe('child');
    expect(ageBracket(16)).toBe('adult');
    expect(ageBracket(60)).toBe('elder');
  });

  it('is not the Baron: a square frame, no oval cameo', () => {
    const { g, calls } = mockCtx();
    drawFamilyPortrait(g, 100, person(1, 'Josiah Gilded'), { year: 1900 });
    expect(calls.some((c) => c.startsWith('strokeRect('))).toBe(true);
  });
});
