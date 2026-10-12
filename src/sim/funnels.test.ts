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
  it('scans a non-empty file set that includes subfolders', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => f.rel)).toContain('rival/index.ts');
  });
  it('state.buildings is assigned or deleted only by state.ts', () => {
    expect(writers(/\bstate\.buildings\[[^\]]*\]\s*=(?!=)|delete\s+state\.buildings\[/)).toEqual(['state.ts']);
  });
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
