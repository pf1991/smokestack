import { describe, expect, it } from 'vitest';

// Vite's glob (no @types/node in this project): every non-test .ts under src/sim, recursively.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const files = Object.entries(modules).map(([path, src]) => ({ rel: path.replace(/^\.\//, ''), src }));

function writers(re: RegExp): string[] {
  return files.filter((f) => re.test(f.src)).map((f) => f.rel).sort();
}

describe('single-writer funnels', () => {
  it('ownerId is reassigned only by companies.ts', () => {
    expect(writers(/\.ownerId\s*[-+*/]?=(?!=)/)).toEqual(['companies.ts']);
  });
  it('roadOwner/railOwner are written only by state.ts, rail.ts, companies.ts', () => {
    expect(writers(/\b(roadOwner|railOwner)\s*=(?!=)/)).toEqual(['companies.ts', 'rail.ts', 'state.ts']);
  });
  it('vehicles are deleted only in vehicles.ts', () => {
    expect(writers(/delete\s+state\.vehicles\[/)).toEqual(['vehicles.ts']);
  });
  it('pollution is written only in pollution.ts', () => {
    expect(writers(/\.pollution\s*[-+*/]?=(?!=)/)).toEqual(['pollution.ts']);
  });
});
