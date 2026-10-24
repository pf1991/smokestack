/**
 * Chain economics report: `npx tsx scripts/chain-report.ts`
 *
 * For every consumer (tier-2) good, in the year it is invented: the daily cost of its raw inputs at
 * base price, its daily revenue at base price, and its daily profit at full utilisation net of all
 * chain maintenance (fractional upstream buildings, one store, one truck per leg). See
 * src/sim/chainEconomics.ts for the model.
 */
import { BUILDINGS } from '../src/data/buildings';
import { GOODS } from '../src/data/goods';
import { chainEconomics } from '../src/sim/chainEconomics';

const money = (n: number) => `$${n.toFixed(2)}`;
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

const rows = Object.values(GOODS)
  .filter((g) => g.kind === 'consumer')
  .sort((a, b) => a.era - b.era || a.basePrice - b.basePrice);

console.log('SMOKESTACK chain report (per day, one manufacturer at full utilisation, base prices)\n');
console.log(
  `${pad('good', 11)}${lpad('era', 5)}  ${pad('recipe', 16)}${lpad('out/day', 8)}${lpad('raw cost', 11)}` +
    `${lpad('revenue', 11)}${lpad('maint', 10)}${lpad('profit', 11)}${lpad('margin', 8)}  chain`,
);
for (const g of rows) {
  const r = chainEconomics(g.id, g.era);
  if (!r) {
    console.log(`${pad(g.id, 11)}${lpad(String(g.era), 5)}  (no chain available)`);
    continue;
  }
  const chain = Object.entries(r.buildings)
    .map(([t, n]) => `${(n ?? 0) === 1 ? '' : `${(n ?? 0).toFixed(2)}× `}${BUILDINGS[t].name}`)
    .join(', ');
  const margin = r.revenuePerDay > 0 ? (r.profitPerDay / r.revenuePerDay) * 100 : 0;
  console.log(
    `${pad(g.id, 11)}${lpad(String(g.era), 5)}  ${pad(r.recipeId, 16)}${lpad(r.outputPerDay.toFixed(1), 8)}` +
      `${lpad(money(r.rawInputCostPerDay), 11)}${lpad(money(r.revenuePerDay), 11)}${lpad(money(r.maintenancePerDay), 10)}` +
      `${lpad(money(r.profitPerDay), 11)}${lpad(`${margin.toFixed(0)}%`, 8)}  ${chain}; ${r.legs} truck legs`,
  );
}
