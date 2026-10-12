import { describe, expect, it } from 'vitest';

// every non-test source file under src, as text
const sources = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('no emoji in source', () => {
  it('scans the source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('no non-test .ts file under src contains emoji', () => {
    const offenders = Object.entries(sources).filter(([, text]) => EMOJI.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
