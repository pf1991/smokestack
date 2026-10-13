/**
 * Century soak: `npm run soak -- --seeds 7,42,1234 --years 100 [--edicts harsh|kind]`
 *
 * `--edicts harsh` (low wages, minimal safety, crush the union) or `--edicts kind` (generous, high,
 * recognise) sets the player's company edicts right after autoplay and holds them for the run.
 *
 * Per seed: createGame, the autoplay furniture chain for the player, then yearly `runDays(ctx, 360)`
 * until `--years` years have passed, 1 Jan 2001 or game over, checking every invariant each year.
 * Prints `seed | final year | player net worth | baron net worth | ms | national opinion | elections held | cards resolved`,
 * one line per seed (cards resolved counts every answered card, split by trigger, through the
 * `cardResolved` bus event: `cards.history` is capped). National opinion is each faction's population-weighted opinion of the player in the
 * final year; autoplay never opens the UI, so every event card auto-resolves after 60 days.
 * Exits 1 if any invariant fails (or autoplay cannot set up its chain), and on the Phase 2 gate assertions when the
 * run covers a full century (years >= 100): player not bankrupt, >= 99 cards resolved, >= 100 elections, no faction
 * pinned at <= 2 or >= 98 for 10+ consecutive years in any city (sampled yearly), and the Baron owns a building.
 */
import { EventBus } from '../src/core/events';
import { runAutoplay } from '../src/game/autoplay';
import { CARDS_BY_ID } from '../src/data/cards';
import { FACTION_IDS } from '../src/data/factions';
import { checkInvariants } from '../src/sim/invariants';
import { nationalOpinion } from '../src/sim/politics/factions';
import type { CompanyEdicts } from '../src/sim/politics/types';
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
const EDICT_SETS: Record<string, CompanyEdicts> = {
  harsh: { wage: 'low', safety: 'minimal', union: 'crush' },
  kind: { wage: 'generous', safety: 'high', union: 'recognise' },
};
const edictsArg = arg('edicts');
if (seeds.length === 0 || !Number.isInteger(years) || years < 1 || (edictsArg !== undefined && !EDICT_SETS[edictsArg])) {
  console.error('usage: npm run soak -- --seeds 7,42,1234 --years 100 [--edicts harsh|kind]');
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
  const cards: Record<string, number> = {};
  let cardTotal = 0;
  ctx.bus.on('cardResolved', (e) => {
    const t = CARDS_BY_ID[e.cardId]?.trigger ?? 'unknown';
    cards[t] = (cards[t] ?? 0) + 1;
    cardTotal++;
  });
  ctx.bus.on('gameOver', (e) => (over = e.reason));
  const r = runAutoplay(ctx);
  if (!r.ok) {
    console.log(`${seed} | autoplay failed: ${r.error}`);
    failed = true;
    continue;
  }
  if (edictsArg) ctx.state.politics.edicts = { ...EDICT_SETS[edictsArg] };
  const pinned: Record<string, number> = {};
  const pinFails = new Set<string>();
  let baronBuilt = false;
  const endYear = Math.min(END_YEAR, ctx.state.date.year + years);
  let problems: string[] = [];
  while (ctx.state.date.year < endYear && !over) {
    runDays(ctx, 360);
    problems = checkInvariants(ctx.state);
    for (const c of ctx.state.cities) {
      for (const f of FACTION_IDS) {
        const k = `${c.name}/${f}`;
        const v = c.opinion[f];
        pinned[k] = v <= 2 || v >= 98 ? (pinned[k] ?? 0) + 1 : 0;
        if (pinned[k] >= 10) pinFails.add(k);
      }
    }
    if (!baronBuilt) baronBuilt = Object.values(ctx.state.buildings).some((b) => b.ownerId === 'rival');
    if (problems.length > 0) break;
  }
  const ms = Math.round(performance.now() - t0);
  const { state } = ctx;
  const note = over ? ` (game over: ${over})` : '';
  const opinion = FACTION_IDS.map((f) => `${f} ${nationalOpinion(state, f).toFixed(1)}`).join(' ');
  console.log(
    `${seed} | ${state.date.year} | ${money(netWorth(state, 'player'))} | ${money(netWorth(state, 'rival'))} | ${ms} | ${opinion} | elections ${elections} | cards ${cardTotal} (${Object.entries(cards).map(([t, n]) => `${t} ${n}`).join(', ')})${note}`,
  );
  if (years >= 100) {
    const gate: string[] = [];
    if (over === 'Bankrupt') gate.push('player went bankrupt');
    if (cardTotal < 99) gate.push(`only ${cardTotal} cards resolved (need 99)`);
    if (elections < 100) gate.push(`only ${elections} elections (need 100)`);
    if (pinFails.size > 0) gate.push(`opinion pinned 10+ years: ${[...pinFails].join(', ')}`);
    if (!baronBuilt) gate.push('the Baron never built anything');
    if (gate.length > 0) {
      failed = true;
      for (const g of gate) console.log(`  GATE FAIL (${seed}): ${g}`);
    }
  }
  if (problems.length > 0) {
    failed = true;
    for (const p of problems) console.log(`  invariant (${state.date.year}-${state.date.month}-${state.date.day}): ${p}`);
  }
}
process.exit(failed ? 1 : 0);
