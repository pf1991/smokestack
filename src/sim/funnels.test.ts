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
  it('tiles gain road, rail or a building only in state.ts and rail.ts', () => {
    // `.road = true`, `.rail = true`, `.buildingId = <anything but null>` (not `==`/`===` comparisons)
    const re = /\.(?:road|rail)\s*=\s*true\b|\.buildingId\s*=(?!=)(?!\s*null\b)/;
    // the pattern catches real writes and ignores clears and comparisons, so the guard cannot pass vacuously
    for (const w of ['t.road = true;', 'map.tiles[i].rail=true', 'tile.buildingId = building.id;']) expect(re.test(w), w).toBe(true);
    for (const w of ['t.road = false;', 't.buildingId = null;', 'if (t.buildingId === id)', 't.rail == true']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['rail.ts', 'state.ts']);
  });
  it('pollution is written only in pollution.ts', () => {
    expect(writers(/\.pollution\s*[-+*/]?=(?!=)/)).toEqual(['pollution.ts']);
  });
  it('faction opinion is written only by politics/factions.ts', () => {
    // `.opinion[f] = ...`, `.opinion[f] += ...`, `.opinion.workers = ...` (not comparisons, not reads)
    const re = /\.opinion(?:\[[^\]]*\]|\.\w+)\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['c.opinion[f] = 3;', 'city.opinion[faction] += delta', 'x.opinion.workers=10', 'c.opinion[f]++']) expect(re.test(w), w).toBe(true);
    for (const w of ['c.opinion[f] === 3', 'const v = c.opinion[f];', 'if (c.opinion.church >= 50)', 'c.opinion = defaultOpinion();']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['politics/factions.ts']);
  });
});
