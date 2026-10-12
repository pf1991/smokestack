/**
 * Fixture save: `npm run fixture -- --name phase0 [--seed 7] [--days 720]`
 * createGame, autoplay chain, runDays, then writes packState to src/sim/__fixtures__/<name>.save.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { EventBus } from '../src/core/events';
import { runAutoplay } from '../src/game/autoplay';
import { packState } from '../src/game/saves';
import { runDays } from '../src/sim/simulation';
import { createGame } from '../src/sim/state';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg('name');
const seed = Number(arg('seed') ?? '7');
const days = Number(arg('days') ?? '720');
if (!name || !/^[\w-]+$/.test(name) || !Number.isInteger(seed) || !Number.isInteger(days) || days < 0) {
  console.error('usage: npm run fixture -- --name phase0 [--seed 7] [--days 720]');
  process.exit(2);
}

const ctx = { state: createGame({ seed }), bus: new EventBus() };
const r = runAutoplay(ctx);
if (!r.ok) {
  console.error(`autoplay failed: ${r.error}`);
  process.exit(1);
}
runDays(ctx, days);
const dir = new URL('../src/sim/__fixtures__/', import.meta.url);
mkdirSync(dir, { recursive: true });
const out = new URL(`${name}.save.json`, dir);
const raw = packState(ctx.state);
writeFileSync(out, raw);
console.log(`wrote ${out.pathname} (${raw.length} bytes)`);
