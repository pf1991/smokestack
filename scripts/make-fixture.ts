/**
 * Fixture save: `npm run fixture -- --name phase0 [--seed 7] [--days 720]`
 * createGame, autoplay chain, runDays, then writes packState to src/sim/__fixtures__/<name>.save.json.
 * The days run as the soak runs them (scripts/soak.ts): 30-day months with the autoplay bid defence and
 * logistics (autoplayLogistics) at each month end and the heir named at the start of each 360-day year, so a long fixture (phase4, 50
 * years) is a living game rather than one lost to the Baron's first hostile bid. Exits 1 on game over.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { EventBus } from '../src/core/events';
import { autoplayDefend, autoplayLogistics, autoplayNameHeir, runAutoplay } from '../src/game/autoplay';
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
let over = '';
ctx.bus.on('gameOver', (e) => (over = e.reason));
for (let d = 0; d < days && !over; ) {
  if (d % 360 === 0) autoplayNameHeir(ctx);
  const n = Math.min(30, days - d);
  runDays(ctx, n);
  if (n === 30) {
    autoplayDefend(ctx);
    autoplayLogistics(ctx);
  }
  d += n;
}
if (over) {
  console.error(`game over before the fixture was written: ${over}`);
  process.exit(1);
}
const dir = new URL('../src/sim/__fixtures__/', import.meta.url);
mkdirSync(dir, { recursive: true });
const out = new URL(`${name}.save.json`, dir);
const raw = packState(ctx.state);
writeFileSync(out, raw);
console.log(`wrote ${out.pathname} (${raw.length} bytes)`);
