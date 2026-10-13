/**
 * Century soak: `npm run soak -- --seeds 7,42,1234 --years 100`
 *
 * Per seed: createGame, the autoplay furniture chain for the player, then yearly `runDays(ctx, 360)`
 * until `--years` years have passed, 1 Jan 2001 or game over, checking every invariant each year.
 * Prints `seed | final year | player net worth | baron net worth | ms | national opinion | elections held | cards resolved`,
 * one line per seed. National opinion is each faction's population-weighted opinion of the player in the
 * final year; autoplay never opens the UI, so every event card auto-resolves after 60 days.
 * Exits 1 if any invariant fails (or autoplay cannot set up its chain).
 */
import { EventBus } from '../src/core/events';
import { runAutoplay } from '../src/game/autoplay';
import { FACTION_IDS } from '../src/data/factions';
import { checkInvariants } from '../src/sim/invariants';
import { nationalOpinion } from '../src/sim/politics/factions';
import { netWorth } from '../src/sim/rival/takeover';
import { runDays } from '../src/sim/simulation';
import { createGame } from '../src/sim/state';

const END_YEAR = 2001;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seeds = (arg('seeds') ?? '7')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));
const years = Number(arg('years') ?? '100');
if (seeds.length === 0 || !Number.isInteger(years) || years < 1) {
  console.error('usage: npm run soak -- --seeds 7,42,1234 --years 100');
  process.exit(2);
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
let failed = false;

for (const seed of seeds) {
  const t0 = performance.now();
  const ctx = { state: createGame({ seed }), bus: new EventBus() };
  let over = '';
  let elections = 0;
  ctx.bus.on('election', () => elections++);
  ctx.bus.on('gameOver', (e) => (over = e.reason));
  const r = runAutoplay(ctx);
  if (!r.ok) {
    console.log(`${seed} | autoplay failed: ${r.error}`);
    failed = true;
    continue;
  }
  const endYear = Math.min(END_YEAR, ctx.state.date.year + years);
  let problems: string[] = [];
  while (ctx.state.date.year < endYear && !over) {
    runDays(ctx, 360);
    problems = checkInvariants(ctx.state);
    if (problems.length > 0) break;
  }
  const ms = Math.round(performance.now() - t0);
  const { state } = ctx;
  const note = over ? ` (game over: ${over})` : '';
  const opinion = FACTION_IDS.map((f) => `${f} ${nationalOpinion(state, f).toFixed(1)}`).join(' ');
  console.log(
    `${seed} | ${state.date.year} | ${money(netWorth(state, 'player'))} | ${money(netWorth(state, 'rival'))} | ${ms} | ${opinion} | elections ${elections} | cards ${state.politics.cards.history.length}${note}`,
  );
  if (problems.length > 0) {
    failed = true;
    for (const p of problems) console.log(`  invariant (${state.date.year}-${state.date.month}-${state.date.day}): ${p}`);
  }
}
process.exit(failed ? 1 : 0);
