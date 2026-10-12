import { describe, expect, it } from 'vitest';
import { flatMap } from '../sim/testkit';
import { CHUNK } from './terrain';
import { cityLabelFont, paintSurveyChunk } from './survey';

/** A 2D context stand-in that counts every method call and accepts any property write. */
function mockCtx(): { g: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get(target, key) {
      if (key in target) return target[key];
      return (..._args: unknown[]) => {
        calls.set(String(key), (calls.get(String(key)) ?? 0) + 1);
        if (key === 'getLineDash') return [];
        return undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, calls };
}

describe('paintSurveyChunk', () => {
  it('hatches hills with lines and never blits an image', () => {
    const map = flatMap(CHUNK, CHUNK, 'grass');
    for (let y = 4; y < 10; y++) for (let x = 3; x < 9; x++) map.tiles[y * map.width + x].terrain = 'hills';
    const { g, calls } = mockCtx();
    paintSurveyChunk(g, map, 0, 0, 7);
    expect(calls.get('lineTo') ?? 0).toBeGreaterThanOrEqual(10);
    expect(calls.get('drawImage') ?? 0).toBe(0);
  });

  it('is deterministic: the same chunk paints the same call sequence twice', () => {
    const map = flatMap(CHUNK, CHUNK, 'forest');
    map.tiles[5].terrain = 'water';
    const a = mockCtx();
    const b = mockCtx();
    paintSurveyChunk(a.g, map, 0, 0, 3);
    paintSurveyChunk(b.g, map, 0, 0, 3);
    expect([...a.calls]).toEqual([...b.calls]);
  });
});

describe('cityLabelFont', () => {
  it('is an italic serif sized by population', () => {
    expect(cityLabelFont(60000)).toContain('24px');
    expect(cityLabelFont(60000)).toContain('italic');
    expect(cityLabelFont(60000)).toContain("Georgia, 'Times New Roman', serif");
    expect(cityLabelFont(0)).toContain('12px');
    expect(cityLabelFont(4999)).toContain('12px');
    expect(cityLabelFont(5000)).toContain('15px');
    expect(cityLabelFont(20000)).toContain('19px');
    expect(cityLabelFont(50000)).toContain('24px');
  });
});
