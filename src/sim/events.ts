import { BUILDINGS } from '../data/buildings';
import { getGood } from '../data/goods';
import { RECIPES, recipeEra } from '../data/recipes';
import { addDays, compareDates, dateToDays } from './clock';
import { currentLedger } from './finance';
import { publishNews } from './news';
import { exchangeShock } from './exchange/prices';
import { pushModifier } from './modifiers';
import { triggerCard } from './politics/cards';
import { chance, pick, random } from './rng';
import type { Building, GoodId, NewsItem, SimContext } from './types';

const DAYS_PER_MONTH = 30;

// re-exported: callers import it from here (the card helpers use the leaf module directly)
export { pushModifier };

// ---------------------------------------------------------------------------
// Historic events

export interface HistoricEvent {
  id: string;
  year: number;
  month: number;
  headline: string;
  body: string;
  apply(ctx: SimContext): void;
}

export const HISTORIC_EVENTS: HistoricEvent[] = [
  {
    id: 'greatwar', year: 1914, month: 8,
    headline: 'EUROPE IN ARMS! STEEL AND TOOLS SOUGHT BY THE CARLOAD',
    body: 'The Great War has begun and the foundries cannot cast fast enough. Prudent industrialists are advised to keep the furnaces lit until, say, November of 1918.',
    apply(ctx) {
      // 1914-08 to 1918-11 = 51 months
      for (const g of ['steel', 'tools']) pushModifier(ctx, 'greatwar', g, null, 1.5, 51 * DAYS_PER_MONTH);
    },
  },
  {
    id: 'crash1929', year: 1929, month: 10,
    headline: 'WALL STREET IN WRECKAGE! FORTUNES VANISH BEFORE LUNCH',
    body: 'Ticker tapes ran out of paper and brokers ran out of windows at ground level. Shoppers are tightening their belts; the wise are tightening theirs one notch further.',
    apply(ctx) {
      pushModifier(ctx, 'crash', '*', null, 0.6, 18 * DAYS_PER_MONTH);
      // the exchange falls with it: sentiment recovers by its own mean reversion
      exchangeShock(ctx.state, '*', 0.45);
      ctx.state.flags.crashYear = 1929;
      triggerCard(ctx, 'crash', null);
    },
  },
  {
    id: 'postwar1945', year: 1945, month: 9,
    headline: 'PEACE AT LAST! THE NATION GOES SHOPPING',
    body: 'Soldiers home, rationing done, and every household wants a new everything. Merchants report queues around the block and cheerful tempers within it.',
    apply(ctx) { pushModifier(ctx, 'boom', '*', null, 1.2, 24 * DAYS_PER_MONTH); },
  },
  {
    id: 'moon1969', year: 1969, month: 7,
    headline: 'MAN WALKS ON MOON! CHILDREN DEMAND ROCKET TOYS',
    body: 'One small step for man, one giant leap for the toy aisle. Every nursery in the land now requires at least one astronaut, preferably plastic.',
    apply(ctx) { pushModifier(ctx, 'moon', 'toys', null, 2, 6 * DAYS_PER_MONTH); },
  },
  {
    id: 'oil1973', year: 1973, month: 10,
    headline: 'PETROL PUMPS RUN DRY! MOTORISTS TAKE UP WALKING',
    body: 'Fuel prices have soared faster than a Saturday rocket and showrooms sit empty. Automobile sales are expected to idle for a twelvemonth.',
    apply(ctx) { pushModifier(ctx, 'oil', 'cars', null, 0.6, 12 * DAYS_PER_MONTH); },
  },
  {
    id: 'computers1983', year: 1983, month: 1,
    headline: 'HOME COMPUTER CRAZE! FATHERS HOG THE KEYBOARD',
    body: 'Families across the country are buying beige boxes that do almost nothing very quickly. Demand for computers is up by half and the games, we are told, are marvellous.',
    apply(ctx) { pushModifier(ctx, 'computers', 'computers', null, 1.5, 24 * DAYS_PER_MONTH); },
  },
];

export function historicFlag(id: string): string {
  return `hist:${id}`;
}

/** Fires each historic event once, on the first day of its year-month (or the first day seen after it). */
export function historicDay(ctx: SimContext): void {
  const { state } = ctx;
  for (const ev of HISTORIC_EVENTS) {
    const key = historicFlag(ev.id);
    if (state.flags[key]) continue;
    if (state.date.year !== ev.year || state.date.month !== ev.month) continue;
    state.flags[key] = true;
    ev.apply(ctx);
    publishNews(ctx, 'historic', ev.headline, ev.body);
  }
}

// ---------------------------------------------------------------------------
// Random events

export interface RandomEvent {
  id: string;
  weight: number;
  minYear: number;
  apply(ctx: SimContext): NewsItem | null;
}

function playerFactories(ctx: SimContext): Building[] {
  return Object.values(ctx.state.buildings).filter((b) => b.ownerId === 'player' && BUILDINGS[b.typeId].category === 'factory');
}

export const RANDOM_EVENTS: RandomEvent[] = [
  {
    id: 'strike', weight: 3, minYear: 1900,
    apply(ctx) {
      const f = playerFactories(ctx);
      if (f.length === 0) return null;
      const b = pick(ctx.state, f);
      b.haltedUntil = addDays(ctx.state.date, 10);
      const name = BUILDINGS[b.typeId].name;
      return publishNews(ctx, 'random', `${name.toUpperCase()} WORKERS DOWN TOOLS OVER TEA BREAK`,
        `Labour has laid down its spanners for ten days, demanding a longer interval and a better biscuit. The management is said to be "reviewing the biscuit situation".`);
    },
  },
  {
    id: 'fire', weight: 1.5, minYear: 1900,
    apply(ctx) {
      const f = playerFactories(ctx);
      if (f.length === 0) return null;
      const b = pick(ctx.state, f);
      b.output = {};
      return publishNews(ctx, 'random', `FIRE AT THE ${BUILDINGS[b.typeId].name.toUpperCase()}! STOCKROOM IN ASHES`,
        `The brigade arrived promptly and the bucket line was heroic, but the finished goods are now a fine grey powder. Insurance men are sharpening their pencils.`);
    },
  },
  {
    id: 'bumper_harvest', weight: 2, minYear: 1900,
    apply(ctx) {
      const farms = Object.values(ctx.state.buildings).filter((b) => b.ownerId === 'player' && b.typeId === 'farm');
      if (farms.length === 0) return null;
      for (const b of farms) {
        const good = b.recipeId ? Object.keys(RECIPES[b.recipeId]?.outputs ?? {})[0] ?? 'grain' : 'grain';
        const cap = BUILDINGS[b.typeId].storage;
        b.output[good] = Math.min(cap, (b.output[good] ?? 0) + 30);
      }
      return publishNews(ctx, 'random', `LOCAL BAKER'S DOUGH RISES TO OCCASION`,
        `Bumper harvest floods the mills! Farmers report fields so fruitful that even the scarecrows look well fed.`);
    },
  },
  {
    id: 'festival', weight: 2, minYear: 1900,
    apply(ctx) {
      const { state } = ctx;
      if (state.cities.length === 0) return null;
      const city = pick(state, state.cities);
      pushModifier(ctx, 'festival', '*', city.id, 1.3, 30);
      return publishNews(ctx, 'random', `${city.name.toUpperCase()} FESTIVAL: BUNTING, BRASS BANDS AND BRISK TRADE`,
        `Pockets are open and purses are loose as the town makes merry for a month. Shopkeepers are advised to stock up and sleep later.`);
    },
  },
  {
    id: 'gold_rush', weight: 1, minYear: 1900,
    apply(ctx) {
      const { state } = ctx;
      if (state.cities.length === 0) return null;
      const city = pick(state, state.cities);
      city.population = Math.round(city.population * 1.15);
      return publishNews(ctx, 'random', `GOLD FEVER GRIPS ${city.name.toUpperCase()}! THOUSANDS ARRIVE WITH SHOVELS`,
        `A glint in a creek bed has swelled the town by a good fifteen percent. Landlords smile; the creek, it is rumoured, has hired a lawyer.`);
    },
  },
  {
    id: 'inventor', weight: 1.5, minYear: 1900,
    apply(ctx) {
      const { state, bus } = ctx;
      const locked = Object.keys(RECIPES)
        .filter((id) => !state.unlocked.includes(id) && recipeEra(id) <= state.date.year + 2)
        .sort((a, b) => recipeEra(a) - recipeEra(b));
      if (locked.length === 0) return null;
      const id = locked[0];
      const r = RECIPES[id];
      for (const g of [...Object.keys(r.inputs), ...Object.keys(r.outputs)]) {
        if (!state.unlocked.includes(g)) {
          state.unlocked.push(g);
          bus.emit({ type: 'unlock', defId: g, kind: 'good' });
        }
      }
      state.unlocked.push(id);
      bus.emit({ type: 'unlock', defId: id, kind: 'recipe' });
      const out = getGood(Object.keys(r.outputs)[0]).name;
      return publishNews(ctx, 'invention', `ECCENTRIC INVENTOR PERFECTS ${out.toUpperCase()}, TWO YEARS AHEAD OF SCHEDULE`,
        `A gentleman in a cellar has solved what the universities could not, mostly by accident and partly with a kettle. The recipe is yours to use, free of charge.`);
    },
  },
  {
    id: 'heatwave', weight: 2, minYear: 1900,
    apply(ctx) {
      const m = ctx.state.date.month;
      if (m < 7 || m > 8) return null;
      pushModifier(ctx, 'heatwave', 'juice', null, 2, 30);
      return publishNews(ctx, 'random', `SWELTERING SUMMER! CITIZENS FAINT, JUICE SELLS BY THE BARREL`,
        `The mercury has climbed past all reason and the nation craves something cold. Juice merchants are said to be "insufferably cheerful".`);
    },
  },
  {
    id: 'rail_strike', weight: 1.5, minYear: 1930,
    apply(ctx) {
      const { state } = ctx;
      if (!Object.values(state.vehicles).some((v) => v.kind === 'train')) return null;
      state.flags.railStrikeUntil = dateToDays(state.date) + 7;
      return publishNews(ctx, 'random', `RAIL MEN DOWN TOOLS: TRAINS STAND IDLE FOR A WEEK`,
        `Locomotives sulk in their sheds while the union and the company exchange stern letters. Passengers are urged to take up cycling.`);
    },
  },
];

/** Monthly roll: probability 0.35, then a weighted pick among events that are eligible and can apply. */
export function randomMonth(ctx: SimContext): NewsItem | null {
  const { state } = ctx;
  if (!chance(state, 0.35)) return null;
  const pool = RANDOM_EVENTS.filter((e) => e.minYear <= state.date.year);
  while (pool.length > 0) {
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = random(state) * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].weight;
      if (r < 0) break;
    }
    const [ev] = pool.splice(idx, 1);
    const item = ev.apply(ctx);
    if (item) return item;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Market report

const QUIPS = [
  'Smogsworth says: "Let them have the leftovers."',
  'Smogsworth says: "Competition is wonderful, provided one wins it."',
  'Smogsworth says: "My smokestacks are taller than yours, and I have measured."',
];

export function monthlyMarketReport(ctx: SimContext): NewsItem | null {
  const { state } = ctx;
  const sales = currentLedger(state.companies.player, state.date).salesByGood;
  let top: GoodId | null = null;
  let best = 0;
  for (const [g, rev] of Object.entries(sales)) {
    if ((rev ?? 0) > best) { best = rev ?? 0; top = g; }
  }
  if (!top) return null;
  const name = getGood(top).name;
  const quip = state.companies.rival.active ? ` ${QUIPS[Math.floor(random(state) * QUIPS.length)]}` : '';
  return publishNews(ctx, 'market', `${name.toUpperCase()} LEADS THE MARKET THIS MONTH`,
    `Your enterprise took $${Math.round(best).toLocaleString('en-US')} from ${name.toLowerCase()} alone, the best-selling line on the books.${quip}`);
}

export function eventsDay(ctx: SimContext): void {
  historicDay(ctx);
}

/** Drops expired demand modifiers (demandModifier already ignores them) so the list cannot grow forever. */
export function pruneModifiers(ctx: SimContext): void {
  const { state } = ctx;
  if (state.modifiers.some((m) => compareDates(m.until, state.date) <= 0)) {
    state.modifiers = state.modifiers.filter((m) => compareDates(m.until, state.date) > 0);
  }
}

export function eventsMonth(ctx: SimContext): void {
  pruneModifiers(ctx);
  monthlyMarketReport(ctx);
  randomMonth(ctx);
}
