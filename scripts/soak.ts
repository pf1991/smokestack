/**
 * Century soak: `npm run soak -- --seeds 7,42,1234 --years 100 [--edicts harsh|kind] [--renew]`
 *
 * `--renew` (ruling R-S15) renews every player building aged 30 or more once a year, at each year end
 * (society/aging.ts renewBuilding), and reports how many renewals were made. Off by default.
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
 * Phase 3 gate (years >= 100, ruling R-S12): smog tier >= 2 somewhere, a law passed, priceIndex 2000 in [14, 22], no NaN
 * in the smog field (Tile.pollution scanned yearly), player solvent.
 * A seventh line reports the Baron's retaliation (Phase 4 Task 2): moves made (the `baronStrike` bus event) in
 * all and by kind, his traits, his grudge ledger at the end (count and total weight) and his final net worth.
 * An eighth line reports the player's dynasty (Phase 4 Task 5): the generation reached and each head with
 * the year they took the chair. Autoplay names an heir each year (autoplayNameHeir). Century gate: no
 * game over of any kind (the family line must not end) and generation >= 2.
 * A ninth line reports the regional firms (Phase 4 Task 6): each firm's founding year, home town, net worth at
 * the last month end sampled in 1950 and in 2000, and whether it is still active (Phase 4 gate below).
 * An exchange line (Phase 4 Task 8, printed before the dynasty line) counts the Baron's hostile bids started,
 * repelled and lost, his final stake in the player and the player's loan. Autoplay answers a bid at every month
 * end (autoplayDefend: buy back, borrowing the shortfall); a lost bid is a game over and fails the century gate.
 * Phase 4 gate (years >= 100): >= 5 retaliations, the Baron's succession done, dynasty generation >= 2,
 * >= 2 regional firms active at the last month end sampled in 2000, every listing price finite and > 0
 * at every month end, a crash card (trigger 'crash', opened by the crash1929 event) resolved in 1929,
 * victory emitted (no game over) and a finite Legacy score. A `phase4` line prints the measurements:
 * the crash card resolutions with their dates, workers' national opinion in 2000, the player's loan
 * at the end and the emergency bid loans autoplay drew (finance.ts takeBidLoan, seen as a rise in
 * `bidLoan` across autoplayDefend), both companies' wealth (state.ts), the first month end the player's wealth
 * reached 1.5x the Baron's (the takeover gate), the first month end it could also pay for control (the
 * lot and its control premium) and the year, if ever, the Baron was taken over.
 * A sixth line reports inflation and aging (Task 8): the price index at the last month end sampled in 2000, the
 * final index, each company's net worth in 1900 dollars (nominal / final index), and the average building age.
 */
import { EventBus } from '../src/core/events';
import { autoplayDefend, autoplayNameHeir, runAutoplay } from '../src/game/autoplay';
import { CARDS_BY_ID } from '../src/data/cards';
import { FACTION_IDS } from '../src/data/factions';
import { checkInvariants } from '../src/sim/invariants';
import { nationalOpinion } from '../src/sim/politics/factions';
import type { CompanyEdicts } from '../src/sim/politics/types';
import { netWorth } from '../src/sim/rival/takeover';
import { runDays } from '../src/sim/simulation';
import { createGame, wealth } from '../src/sim/state';
import { holding, quote, TRADE_LOT } from '../src/sim/exchange/trading';
import { CONTROL_SHARES } from '../src/sim/exchange/types';
import { nationalBlackLung } from '../src/sim/society/escalation';
import { assetAge, renewBuilding } from '../src/sim/society/aging';
import { grudgeTotal } from '../src/sim/nemesis/grudges';
import { companyIds } from '../src/sim/companies';
import { legacyScore } from '../src/sim/legacy';
import { insolvencyDemolitions } from '../src/sim/rival/insolvency';

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
const renew = process.argv.includes('--renew');
const RENEW_AGE = 30;
if (seeds.length === 0 || !Number.isInteger(years) || years < 1 || (edictsArg !== undefined && !EDICT_SETS[edictsArg])) {
  console.error('usage: npm run soak -- --seeds 7,42,1234 --years 100 [--edicts harsh|kind] [--renew]');
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
  let victory = '';
  ctx.bus.on('victory', (e) => (victory = e.reason));
  const crashCards: string[] = [];
  let crashIn1929 = false;
  ctx.bus.on('cardResolved', (e) => {
    if (CARDS_BY_ID[e.cardId]?.trigger !== 'crash') return;
    const d = ctx.state.date;
    crashCards.push(`${e.cardId} ${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`);
    if (d.year === 1929) crashIn1929 = true;
  });
  let strikes = 0;
  ctx.bus.on('strike', () => strikes++);
  const retaliations: Record<string, number> = {};
  let retaliationTotal = 0;
  ctx.bus.on('baronStrike', (e) => {
    retaliations[e.kind] = (retaliations[e.kind] ?? 0) + 1;
    retaliationTotal++;
  });
  const bids = { started: 0, repelled: 0, lost: 0 };
  ctx.bus.on('hostileBid', (e) => bids[e.stage]++);
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
  const demolitions0 = insolvencyDemolitions();
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
  let renewals = 0;
  let smogNaN = false;
  // regional firms: founding year and net worth sampled at month ends in 1950 and 2000
  const founded: Record<string, number> = {};
  const worth1950: Record<string, number> = {};
  const worth2000: Record<string, number> = {};
  let firms2000 = Number.NaN;
  let workers2000 = Number.NaN;
  let badPrice = '';
  let bidLoans = 0;
  let bidLoanTotal = 0;
  // the takeover gate (exchange/trading.ts takeoverRefusal): the first month end the player is worth
  // 1.5x the Baron, and the year (if ever) the Baron is taken over
  let gateOpen = '';
  let takenOver = '';
  // the first month end the player could pay for control of the Baron (gate open, cash for the lot that
  // takes control and its control premium), whether or not autoplay buys
  let affordable = '';
  const heads: string[] = [`${ctx.state.dynasty.head.name} ${ctx.state.date.year}`];
  while (ctx.state.date.year < endYear && !over) {
    // the heir is (re)named once a year, before December's births and deaths
    autoplayNameHeir(ctx);
    const headId = ctx.state.dynasty.head.id;
    // a year as 12 months of 30 days, sampling every town's smog tier at each month end
    for (let m = 0; m < 12 && !over; m++) {
      runDays(ctx, 30);
      // a hostile bid is answered at each month end, through the public API
      const bidLoanBefore = ctx.state.companies.player.bidLoan ?? 0;
      autoplayDefend(ctx);
      const drawn = (ctx.state.companies.player.bidLoan ?? 0) - bidLoanBefore;
      if (drawn > 0) {
        bidLoans++;
        bidLoanTotal += drawn;
      }
      if (!gateOpen && ctx.state.companies.rival.active && wealth(ctx.state, 'player') >= 1.5 * wealth(ctx.state, 'rival')) gateOpen = `${ctx.state.date.year}-${String(ctx.state.date.month).padStart(2, '0')}`;
      if (gateOpen && !affordable && ctx.state.companies.rival.active) {
        const need = Math.ceil((CONTROL_SHARES - holding(ctx.state, 'player', 'rival')) / TRADE_LOT) * TRADE_LOT;
        if (ctx.state.companies.player.money >= quote(ctx.state, 'player', 'rival', need).total && wealth(ctx.state, 'player') >= 1.5 * wealth(ctx.state, 'rival')) affordable = `${ctx.state.date.year}-${String(ctx.state.date.month).padStart(2, '0')}`;
      }
      if (!takenOver && ctx.state.flags.takeover === true) takenOver = String(ctx.state.date.year);
      for (const [id, l] of Object.entries(ctx.state.exchange.listings)) {
        if (!badPrice && !(Number.isFinite(l.price) && l.price > 0)) badPrice = `${id} ${l.price} in ${ctx.state.date.year}-${ctx.state.date.month}`;
      }
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
      for (const id of companyIds(ctx.state)) {
        if (ctx.state.companies[id].kind !== 'regional') continue;
        founded[id] ??= ctx.state.date.year;
        if (ctx.state.date.year === 1950) worth1950[id] = netWorth(ctx.state, id);
        if (ctx.state.date.year === 2000) worth2000[id] = netWorth(ctx.state, id);
      }
      if (ctx.state.date.year === 2000) {
        firms2000 = companyIds(ctx.state).filter((id) => ctx.state.companies[id].kind === 'regional' && ctx.state.companies[id].active).length;
        workers2000 = nationalOpinion(ctx.state, 'workers');
        index2000 = ctx.state.economy.priceIndex;
        const big = ctx.state.cities.reduce((a, b) => (b.population > a.population ? b : a));
        const k = big.classes;
        mix2000 = `${big.name} (pop ${big.population}) working ${k.working.toFixed(3)} / middle ${k.middle.toFixed(3)} / upper ${k.upper.toFixed(3)}`;
        const cl = ctx.state.cities.reduce((a, b) => ((levelSum.get(b.id) ?? 0) < (levelSum.get(a.id) ?? 0) ? b : a));
        const q = cl.classes;
        clean2000 = `${cl.name} (pop ${cl.population}) working ${q.working.toFixed(3)} / middle ${q.middle.toFixed(3)} / upper ${q.upper.toFixed(3)}`;
      }
    }
    if (ctx.state.dynasty.head.id !== headId) heads.push(`${ctx.state.dynasty.head.name} ${ctx.state.date.year - 1}`);
    if (renew) {
      for (const b of Object.values(ctx.state.buildings)) {
        if (b.ownerId === 'player' && assetAge(ctx.state, b) >= RENEW_AGE && renewBuilding(ctx, b.id, 'player').ok) renewals++;
      }
    }
    if (ctx.state.cities.some((c) => !Number.isFinite(c.smog.level) || !Number.isFinite(c.pollution)) || ctx.state.map.tiles.some((t) => Number.isNaN(t.pollution))) smogNaN = true;
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
    `  economy ${seed}: priceIndex 2000 ${Number.isFinite(index2000) ? index2000.toFixed(2) : 'n/a'}, final ${idx.toFixed(2)} | real net worth (1900 $) player ${money(netWorth(state, 'player') / idx)}, baron ${money(netWorth(state, 'rival') / idx)} | avg building age player ${ages('player')}, baron ${ages('rival')}${renew ? ` | renewals ${renewals}` : ''}`,
  );
  console.log(
    `  nemesis ${seed}: retaliations ${retaliationTotal} | ${Object.entries(retaliations).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'} | succession ${state.nemesis.succession.year ?? 'none'} | traits ${state.nemesis.traits.join(', ')} | grudges ${state.nemesis.grudges.length} (weight ${grudgeTotal(state).toFixed(1)}) | baron net worth ${money(netWorth(state, 'rival'))}`,
  );
  const stake = (holder: string, id: string) => state.exchange.listings[id]?.holders[holder] ?? 0;
  console.log(
    `  exchange ${seed}: bids started ${bids.started}, repelled ${bids.repelled}, lost ${bids.lost} | baron holds ${stake('rival', 'player')} of the player, player ${stake('player', 'player')} own | player loan ${money(state.companies.player.loan)} | baron ${state.companies.rival.active ? 'active' : 'taken over'}`,
  );
  console.log(`  dynasty ${seed}: generation ${state.dynasty.generation} | heads ${heads.join(', ')} | prestige ${state.dynasty.prestige} | children ${state.dynasty.children.length}`);
  const lg = legacyScore(state);
  console.log(`  legacy ${seed}: ${lg.total} = fortune ${lg.fortune} + landmarks ${lg.landmarks} + reputation ${lg.reputation} + dynasty ${lg.dynasty}`);
  const firms = companyIds(state).filter((id) => state.companies[id].kind === 'regional');
  const firmText = firms.map((id) => {
    const c = state.companies[id];
    const town = state.cities.find((x) => x.id === c.homeCityId)?.name ?? '?';
    const w = (v: number | undefined) => (v === undefined ? 'n/a' : money(v));
    return `${c.name} (${town}) founded ${founded[id]}, 1950 ${w(worth1950[id])}, 2000 ${w(worth2000[id])}, ${c.active ? 'active' : 'closed'}`;
  });
  const activeFirms = firms.filter((id) => state.companies[id].active).length;
  console.log(`  regional ${seed}: ${firmText.join(' | ') || 'none'} | active ${activeFirms}`);
  console.log(
    `  phase4 ${seed}: crash cards ${crashCards.join(', ') || 'none'} | workers 2000 ${Number.isFinite(workers2000) ? workers2000.toFixed(1) : 'n/a'} | regional active 2000 ${Number.isFinite(firms2000) ? firms2000 : 'n/a'} | player loan ${money(state.companies.player.loan)} (bid loan ${money(state.companies.player.bidLoan ?? 0)}) | emergency bid loans ${bidLoans} (${money(bidLoanTotal)}) | wealth player ${money(wealth(state, 'player'))}, baron ${money(wealth(state, 'rival'))} | 1.5x gate first open ${gateOpen || 'never'} | control first affordable ${affordable || 'never'} | baron taken over ${takenOver || 'never'} | ${victory ? `victory: ${victory}` : 'no victory'}`,
  );
  if (years >= 100) {
    const gate: string[] = [];
    if (!(firms2000 >= 2)) gate.push(`only ${firms2000} regional firms active in 2000 (need 2)`);
    if (retaliationTotal < 5) gate.push(`only ${retaliationTotal} retaliations (need 5)`);
    if (!state.nemesis.succession.done) gate.push('the Baron\'s succession never happened');
    if (badPrice) gate.push(`listing price not finite and > 0: ${badPrice}`);
    if (!crashIn1929) gate.push(`no crash card resolved in 1929 (${crashCards.join(', ') || 'none resolved'})`);
    if (!victory) gate.push('no victory emitted');
    if (!Number.isFinite(lg.total)) gate.push(`Legacy score not finite: ${lg.total}`);
    if (over === 'Bankrupt') gate.push('player went bankrupt');
    else if (over) gate.push(`game over: ${over}`);
    if (state.dynasty.generation < 2) gate.push(`dynasty generation ${state.dynasty.generation} (need 2)`);
    if (cardTotal < 99) gate.push(`only ${cardTotal} cards resolved (need 99)`);
    if (elections < 100) gate.push(`only ${elections} elections (need 100)`);
    if (pinFails.size > 0) gate.push(`opinion pinned 10+ years: ${[...pinFails].join(', ')}`);
    if (!baronBuilt) gate.push('the Baron never built anything');
    // Phase 4b: the Baron's economy must survive the truck models (real 1900 $, and never forced to sell off)
    if (!(netWorth(state, 'rival') / state.economy.priceIndex > 0)) gate.push(`the Baron's real net worth is ${money(netWorth(state, 'rival') / state.economy.priceIndex)} (need > 0)`);
    if (insolvencyDemolitions() > demolitions0) gate.push(`the Baron was forced to demolish ${insolvencyDemolitions() - demolitions0} buildings for insolvency`);
    if (maxTier < 2) gate.push(`smog never reached tier 2 (max ${maxTier})`);
    if (!Object.values(laws).some((l) => l.passed != null)) gate.push('no regulation law passed');
    if (!(index2000 >= 14 && index2000 <= 22)) gate.push(`priceIndex 2000 ${index2000} outside [14, 22] (R-S12)`);
    if (smogNaN) gate.push('NaN in the smog field');
    if (netWorth(state, 'player') <= 0) gate.push('player not solvent at the end');
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
