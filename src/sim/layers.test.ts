import { describe, expect, it } from 'vitest';
import { layer, layerAt, packLayer, unpackLayer } from './layers';
import { testState } from './testkit';

describe('layers', () => {
  it('pack/unpack round-trips a sparse 12288 array and compresses it', () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const a = Array.from({ length: 12288 }, (_, i) => (Math.floor(i / 64) % 10 === 0 ? rnd() * 10 : 0)); // clustered, like smog: 10% non-zero in runs
    const p = packLayer(a);
    expect(unpackLayer(p, a.length)).toEqual(a.map((v) => Math.round(v * 1000) / 1000));
    expect(p.length).toBeLessThan(a.length * 0.2);
  });

  it('layer() creates once; layerAt is safe', () => {
    const st = testState({ width: 4, height: 3 });
    const l = layer(st, 'smog');
    expect(l).toHaveLength(12);
    expect(layer(st, 'smog')).toBe(l);
    expect(layerAt(st, 'smog', 4, 0)).toBe(0);
    expect(layerAt(st, 'smog', -1, 0)).toBe(0);
    expect(layerAt(st, 'nope', 0, 0)).toBe(0);
    expect(st.layers.nope).toBeUndefined();
    l[5] = 2;
    expect(layerAt(st, 'smog', 1, 1)).toBe(2);
  });

  it('unpackLayer rejects bad data', () => {
    expect(() => unpackLayer([-1, 5], 4)).toThrow('bad layer');
    expect(() => unpackLayer([1, -2], 2)).toThrow('bad layer');
    expect(() => unpackLayer([1, 2], 3)).toThrow('bad layer');
  });

  it('packLayer rejects values unpackLayer would refuse', () => {
    expect(() => packLayer([0.5, -0.2])).toThrow('bad layer value');
    expect(() => packLayer([NaN])).toThrow('bad layer value');
    expect(() => packLayer([1, Infinity])).toThrow('bad layer value');
    expect(() => packLayer([-1])).toThrow('bad layer value');
  });
});
