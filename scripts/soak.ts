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
 * A second line per seed reports smog escalation (Phase 3): the highest tier any town reached, town-months spent
 * at each tier (sampled at every month end), the highest smog level seen and the national Black Lung toll.
 * A third line reports labour unrest (Phase 3 Task 4): strikes started (the `strike` bus event), town-months
 * with workers' opinion below 30 (go-slow) and below 25 (strike risk), and the lowest workers' opinion seen.
 * A fourth line reports the national smoke laws (Task 5): the year each passed and the total fines paid.
 * A fifth line reports social classes (Task 7): the class mix at the last month end sampled in 2000 of
 * the biggest town and of the cleanest town (lowest mean smog level over the run), and the highest
 * upper and middle shares any town reached.
 * A sixth line reports inflation and aging (Task 8): the price index at the last month end sampled in 2000, the
 * final index, each company's net worth in 1900 dollars (nominal / final index), and the average building age.
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
import { nationalBlackLung } from '../src/sim/society/escalation';

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
  let strikes = 0;
  ctx.bus.on('strike', () => strikes++);
  let slowMonths = 0;
  let strikeRiskMonths = 0;
  let minWorkers = 100;
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
  const tierMonths = [0, 0, 0, 0, 0];
  let maxTier = 0;
  let maxLevel = 0;
  const fineByMonth = new Map<number, number>();
  let mix2000 = '';
  let clean2000 = '';
  const levelSum = new Map<number, number>();
  let maxUpper = 0;
  let maxMiddle = 0;
  let index2000 = Number.NaN;
  while (ctx.state.date.year < endYear && !over) {
    // a year as 12 months of 30 days, sampling every town's smog tier at each month end
    for (let m = 0; m < 12 && !over; m++) {
      runDays(ctx, 30);
      for (const l of ctx.state.companies.player.ledger) fineByMonth.set(l.year * 12 + l.month, l.expense.fines ?? 0);
      for (const c of ctx.state.cities) {
        tierMonths[c.smog.tier]++;
        maxTier = Math.max(maxTier, c.smog.tier);
        maxLevel = Math.max(maxLevel, c.smog.level);
        if (c.opinion.workers < 30) slowMonths++;
        if (c.opinion.workers < 25) strikeRiskMonths++;
        minWorkers = Math.min(minWorkers, c.opinion.workers);
        maxUpper = Math.max(maxUpper, c.classes.upper);
        maxMiddle = Math.max(maxMiddle, c.classes.middle);
        levelSum.set(c.id, (levelSum.get(c.id) ?? 0) + c.smog.level);
      }
      if (ctx.state.date.year === 2000) {
        index2000 = ctx.state.economy.priceIndex;
        const big = ctx.state.cities.reduce((a, b) => (b.population > a.population ? b : a));
        const k = big.classes;
        mix2000 = `${big.name} (pop ${big.population}) working ${k.working.toFixed(3)} / middle ${k.middle.toFixed(3)} / upper ${k.upper.toFixed(3)}`;
        const cl = ctx.state.cities.reduce((a, b) => ((levelSum.get(b.id) ?? 0) < (levelSum.get(a.id) ?? 0) ? b : a));
        const q = cl.classes;
        clean2000 = `${cl.name} (pop ${cl.population}) working ${q.working.toFixed(3)} / middle ${q.middle.toFixed(3)} / upper ${q.upper.toFixed(3)}`;
      }
    }
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
  console.log(
    `  smog ${seed}: max tier ${maxTier} | town-months at tier 0..4: ${tierMonths.join(' / ')} | max level ${maxLevel.toFixed(3)} | Black Lung ${nationalBlackLung(state)}`,
  );
  console.log(
    `  unrest ${seed}: strikes ${strikes} | town-months workers < 30: ${slowMonths}, < 25: ${strikeRiskMonths} | min workers ${minWorkers.toFixed(1)}`,
  );
  const laws = ctx.state.society.laws;
  const totalFines = [...fineByMonth.values()].reduce((t, n) => t + n, 0);
  console.log(
    `  laws ${seed}: ${Object.entries(laws).map(([id, l]) => `${id} ${l.passed ?? 'pending'}`).join(', ')} | total fines ${money(totalFines)}`,
  );
  console.log(`  classes ${seed}: 2000 biggest ${mix2000 || 'n/a'} | cleanest ${clean2000 || 'n/a'} | max upper ${maxUpper.toFixed(3)}, max middle ${maxMiddle.toFixed(3)}`);
  const idx = state.economy.priceIndex;
  const ages = (owner: string) => {
    const bs = Object.values(state.buildings).filter((b) => b.ownerId === owner);
    return bs.length > 0 ? (bs.reduce((t, b) => t + (state.date.year - b.builtYear), 0) / bs.length).toFixed(1) : 'n/a';
  };
  console.log(
    `  economy ${seed}: priceIndex 2000 ${Number.isFinite(index2000) ? index2000.toFixed(2) : 'n/a'}, final ${idx.toFixed(2)} | real net worth (1900 $) player ${money(netWorth(state, 'player') / idx)}, baron ${money(netWorth(state, 'rival') / idx)} | avg building age player ${ages('player')}, baron ${ages('rival')}`,
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
