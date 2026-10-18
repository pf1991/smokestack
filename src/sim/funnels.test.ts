import { describe, expect, it } from 'vitest';

// Vite's glob (no @types/node in this project): every non-test .ts under src/sim, recursively.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const files = Object.entries(modules).map(([path, src]) => ({ rel: path.replace(/^\.\//, ''), src }));

// src/ui and src/game, for funnels that also bind the layers above the sim
const outsideModules = import.meta.glob(['../ui/**/*.ts', '../game/**/*.ts', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const outside = Object.entries(outsideModules).map(([path, src]) => ({ rel: path.replace(/^\.\.\//, ''), src }));

function writers(re: RegExp): string[] {
  return files.filter((f) => re.test(f.src)).map((f) => f.rel).sort();
}

describe('single-writer funnels', () => {
  it('scans a non-empty file set that includes subfolders', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => f.rel)).toContain('rival/index.ts');
    expect(outside.map((f) => f.rel)).toContain('ui/panels/city.ts');
    expect(outside.map((f) => f.rel)).toContain('game/controller.ts');
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
  it('pollution is written only in pollution.ts (smogDay and the city figures)', () => {
    const re = /\.pollution\s*[-+*/]?=(?!=)/;
    for (const w of ['tiles[i].pollution += amount;', 't.pollution = p;', 'c.pollution=0']) expect(re.test(w), w).toBe(true);
    for (const w of ['t.pollution === 0', 'const p = t.pollution;', 'if (t.pollution !== 0)']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['pollution.ts']);
  });
  it('terrain is written only by state.ts (callers must report changes through terrainChanged)', () => {
    const re = /\.terrain\s*=(?!=)/;
    for (const w of ["t.terrain = 'grass';", "tile.terrain='forest'", 'map.tiles[i].terrain = t;']) expect(re.test(w), w).toBe(true);
    for (const w of ["t.terrain === 'forest'", "if (t.terrain == 'hills')", 'const ter = tiles[i].terrain;', 'terrain: Terrain']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['state.ts']);
  });
  it('building upgrades are written only by society/upgrades.ts', () => {
    const re = /\.upgrades\s*=(?!=)|\.(?:scrubber|tallChimney)\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['b.upgrades = up;', 'up.scrubber = 2', 'b.upgrades.tallChimney=true', 'u.scrubber++']) expect(re.test(w), w).toBe(true);
    for (const w of ['b.upgrades?.scrubber ?? 0', 'u.tallChimney === true', 'const up = b.upgrades;']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['society/upgrades.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('class mixes are written only by society/classes.ts (and the v6 migration that adds them)', () => {
    const re = /\.classes\s*=(?!=)|\.(?:working|middle|upper)\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['city.classes = next;', 'c.classes = newCityClasses();', 'c.upper -= 0.1', 'k.middle++']) expect(re.test(w), w).toBe(true);
    for (const w of ['city.classes.upper > 0.15', 'c.working === 1', 'const m = city.classes;']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['migrations.ts', 'society/classes.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('the price index is written only by society/economy.ts (plus createGame, which seeds a late start, and the v6 migration)', () => {
    const re = /\.(?:economy|priceIndex)\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['e.priceIndex *= 1.01;', 'state.economy = x', 'o.economy = defaultEconomy();', 's.economy.priceIndex = 2']) expect(re.test(w), w).toBe(true);
    for (const w of ['state.economy.priceIndex * cost', 'e.priceIndex === 1', 'const e = state.economy;']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['migrations.ts', 'society/economy.ts', 'state.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('builtYear is reassigned only by society/aging.ts (renewal) and the v6 migration (state.ts and vehicles.ts set it at creation)', () => {
    const re = /\.builtYear\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['b.builtYear = state.date.year;', 'v.builtYear -= 40', 'x.builtYear++']) expect(re.test(w), w).toBe(true);
    for (const w of ['b.builtYear === 1900', 'builtYear: state.date.year,', 'const y = v.builtYear;']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['migrations.ts', 'society/aging.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('weather is written only by weather.ts (and the v6 migration that adds it)', () => {
    const re = /\.(?:weather|windX|windY|rain|rainDays)\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['w.windX = 1;', 'state.weather = x', 'o.weather = defaultWeather(1);', 'w.rainDays++']) expect(re.test(w), w).toBe(true);
    for (const w of ['if (weather.rain)', 'w.rain === true', 'const wx = weather.windX;']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['migrations.ts', 'weather.ts']);
  });
  it('the Baron grudge ledger is written only by nemesis/grudges.ts (addGrudge, spendHeaviestGrudge, grudgesYear)', () => {
    const re = /\.grudges\s*(?:=(?!=)|\.(?:push|splice|pop|shift|unshift|sort|length\s*=(?!=)))|\bgrudges\s*:(?!\s*(?:\[\]|Grudge\b))|\.weight\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    for (const w of ['n.grudges = kept;', 'state.nemesis.grudges.push(g)', 'n.grudges.splice(i, 1)', 'g.weight *= 0.8', 'g.weight=1', 'grudges: old,']) expect(re.test(w), w).toBe(true);
    for (const w of ['for (const g of n.grudges)', 'grudges: Grudge[];', 'n.grudges.length > 40', 'grudges: [],', 'g.weight === 1', 'n.grudges.reduce((s, g) => s + g.weight, 0)']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['nemesis/grudges.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('the emergency bid loan is drawn only by exchange/trading.ts buyBack, and bidLoan is written only in finance.ts', () => {
    expect(writers(/\btakeBidLoan\(/)).toEqual(['exchange/trading.ts', 'finance.ts']);
    expect(outside.filter((f) => /\btakeBidLoan\b/.test(f.src)).map((f) => f.rel)).toEqual([]);
    const re = /\.bidLoan\s*(?:[-+*/]?=(?!=)|\+\+|--)|delete\s+[\w.$]*\.bidLoan\b/;
    expect(writers(re)).toEqual(['finance.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('share holdings are written only by exchange/shares.ts (moveShares, listing creation)', () => {
    // element writes (`.holders[k] = `, `+=`, `++`), deletes, whole-map assignment, Object.assign, and
    // `holders:` initialisers other than the type annotation
    const re = /\.holders(?:\[[^\]]*\]|\.\w+)?\s*(?:[-+*/]?=(?!=)|\+\+|--)|delete\s+[\w.$\[\]]*\.holders\b|Object\.assign\(\s*[\w.$\[\]]*\.holders\b|\bholders\s*:(?!\s*Record\b)/;
    for (const w of ['l.holders[to] = n;', 'l.holders.public -= 5', 'l.holders[id]++', 'delete l.holders[from];', 'l.holders = {}', 'holders: { public: 600 },', 'Object.assign(l.holders, x)']) expect(re.test(w), w).toBe(true);
    for (const w of ['holders: Record<OwnerId, number>;', 'const n = l.holders[from] ?? 0;', 'l.holders.public === 600', 'for (const k in l.holders)']) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['exchange/shares.ts']);
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('faction opinion is written only by politics/factions.ts', () => {
    // element/field writes (`.opinion[f] = `, `+=`, `++`, `.opinion.workers = `), `Object.assign(x.opinion, …)`,
    // and whole-map `.opinion = …` unless the right-hand side is exactly `defaultOpinion()` (initialisers)
    const re = new RegExp(
      [
        String.raw`\.opinion(?:\[[^\]]*\]|\.\w+)\s*(?:[-+*/]?=(?!=)|\+\+|--)`,
        String.raw`Object\.assign\(\s*[\w.$\[\]]*\.opinion\b`,
        String.raw`\.opinion\s*=(?!=)(?!\s*defaultOpinion\(\)\s*[;,)\n])`,
      ].join('|'),
    );
    for (const w of [
      'c.opinion[f] = 3;',
      'city.opinion[faction] += delta',
      'x.opinion.workers=10',
      'c.opinion[f]++',
      'Object.assign(city.opinion, { workers: 0 });',
      'Object.assign(state.cities[0].opinion, o)',
      'c.opinion = { workers: 0 };',
      'c.opinion = defaultOpinion(); c.opinion = x;',
      'c.opinion = defaultOpinion().workers;',
    ]) expect(re.test(w), w).toBe(true);
    for (const w of [
      'c.opinion[f] === 3',
      'const v = c.opinion[f];',
      'if (c.opinion.church >= 50)',
      'c.opinion = defaultOpinion();',
      'opinion: defaultOpinion(),',
      'Object.assign(c, { pollution: 1 })',
    ]) expect(re.test(w), w).toBe(false);
    expect(writers(re)).toEqual(['politics/factions.ts']);
    // the UI and game layers never write opinion either
    expect(outside.filter((f) => re.test(f.src)).map((f) => f.rel)).toEqual([]);
  });
  it('fresh opinion maps (defaultOpinion()) are created only by the initialisers', () => {
    const re = /\bopinion\s*[:=]\s*defaultOpinion\(\)/;
    expect(writers(re)).toEqual(['mapgen.ts', 'migrations.ts', 'testkit.ts']);
  });
});

describe('layering', () => {
  it('no file in src/sim imports from src/ui or src/render', () => {
    const bad = files
      .filter((f) => /from\s+['"](\.\.\/)+(ui|render)\//.test(f.src))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});
