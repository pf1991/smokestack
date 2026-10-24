/**
 * Chain economics report: `npx tsx scripts/chain-report.ts`
 *
 * For every consumer good, in the year it is invented: the daily cost of its raw inputs at base
 * price, its daily revenue at base price, its daily profit at full utilisation net of all chain
 * maintenance (fractional upstream buildings, one store, one truck per leg), the chain's depth
 * (raw = 1), its workers and its profit per worker-month. See src/sim/chainEconomics.ts for the model.
 *
 * The closing per-era lines are the balance gate's figures (src/sim/balance.test.ts, "deep chains
 * pay"): the deep minimum takes each deep good (depth >= 4) invented in the bracket, in its own
 * era year; the shallow median is that of the year the line names, which is the deep-minimum good's
 * era (the gate's own comparison for it), or the bracket's first year when it has no deep good. It is
 * computed over every shallow consumer good invented by that year, evaluated in that year.
 */
import { BUILDINGS } from '../src/data/buildings';
import { GOODS } from '../src/data/goods';
import { chainEconomics, DEEP_DEPTH, shallowMedian } from '../src/sim/chainEconomics';

const money = (n: number) => `$${n.toFixed(2)}`;
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

const rows = Object.values(GOODS)
  .filter((g) => g.kind === 'consumer')
  .sort((a, b) => a.era - b.era || a.basePrice - b.basePrice);

console.log('SMOKESTACK chain report (per day, one manufacturer at full utilisation, base prices)\n');
console.log(
  `${pad('good', 12)}${lpad('era', 5)}  ${pad('recipe', 16)}${lpad('out/day', 8)}${lpad('raw cost', 11)}` +
    `${lpad('revenue', 11)}${lpad('maint', 10)}${lpad('profit', 11)}${lpad('margin', 8)}` +
    `${lpad('depth', 6)}${lpad('workers', 8)}${lpad('$/wk-mo', 9)}  chain`,
);
for (const g of rows) {
  const r = chainEconomics(g.id, g.era);
  if (!r) {
    console.log(`${pad(g.id, 12)}${lpad(String(g.era), 5)}  (no chain available)`);
    continue;
  }
  const chain = Object.entries(r.buildings)
    .map(([t, n]) => `${(n ?? 0) === 1 ? '' : `${(n ?? 0).toFixed(2)}× `}${BUILDINGS[t].name}`)
    .join(', ');
  const margin = r.revenuePerDay > 0 ? (r.profitPerDay / r.revenuePerDay) * 100 : 0;
  console.log(
    `${pad(g.id, 12)}${lpad(String(g.era), 5)}  ${pad(r.recipeId, 16)}${lpad(r.outputPerDay.toFixed(1), 8)}` +
      `${lpad(money(r.rawInputCostPerDay), 11)}${lpad(money(r.revenuePerDay), 11)}${lpad(money(r.maintenancePerDay), 10)}` +
      `${lpad(money(r.profitPerDay), 11)}${lpad(`${margin.toFixed(0)}%`, 8)}` +
      `${lpad(String(r.depth), 6)}${lpad(r.workers.toFixed(0), 8)}${lpad(r.profitPerWorkerMonth.toFixed(1), 9)}` +
      `  ${chain}; ${r.legs} truck legs`,
  );
}

console.log('');
const BRACKETS: [number, number][] = [[1900, 1919], [1920, 1949], [1950, 1979], [1980, 2000]];
for (const [from, to] of BRACKETS) {
  // the deep good of the bracket that earns least per worker-month, each in its own era year
  let deepMin: { id: string; year: number; perWm: number } | null = null;
  for (const g of rows) {
    if (g.era < from || g.era > to) continue;
    const r = chainEconomics(g.id, g.era);
    if (r && r.depth >= DEEP_DEPTH && (!deepMin || r.profitPerWorkerMonth < deepMin.perWm)) deepMin = { id: g.id, year: g.era, perWm: r.profitPerWorkerMonth };
  }
  // the shallow median of the year the gate compares that deep good in (the bracket's first year without one)
  const year = deepMin?.year ?? from;
  const deepText = deepMin ? `$${deepMin.perWm.toFixed(1)}/wk-mo (${deepMin.id})` : 'none';
  console.log(
    `era ${from}-${to}: shallow median $${shallowMedian(year).toFixed(1)}/wk-mo (in ${year}), ` +
      `deep (depth>=${DEEP_DEPTH}) min ${deepText}`,
  );
}
