/**
 * Debug autoplay (`?autoplay=1`): scripts a furniture chain next to the biggest city through the
 * public sim API so screenshots show trucks, sales and money moving without manual play.
 */
import type { Result } from '../core/result';
import { err, ok } from '../core/result';
import { buildChain, legRoute } from '../sim/chainBuilder';
import type { Building, City, SimContext } from '../sim/types';
import { runTicks } from '../sim/simulation';
import { buyTruck } from '../sim/vehicles';
import { nameHeir } from '../sim/dynasty/family';
import { livingChildren } from '../sim/dynasty/types';
import { buyBack } from '../sim/exchange/trading';
import { bidOpen } from '../sim/nemesis/bid';

export function biggestCity(cities: City[]): City | undefined {
  return [...cities].sort((a, b) => b.population - a.population)[0];
}

const STAGGER_TICKS = 12;

/**
 * lumber camp → sawmill → furniture factory → store in the biggest city (sim/chainBuilder.ts), each
 * leg with two trucks, the second bought half a day later so they do not drive in lockstep.
 * Returns the chain's buildings (for camera framing) or the first error.
 */
export function runAutoplay(ctx: SimContext): Result<Building[]> {
  const city = biggestCity(ctx.state.cities);
  if (!city) return err('No city');
  const chain = buildChain(ctx, 'player', city, 'furniture', 1);
  if (!chain.ok) return chain;
  runTicks(ctx, STAGGER_TICKS);
  const built = chain.value;
  for (let i = 0; i + 1 < built.length; i++) {
    const id = legRoute(ctx, 'player', built[i], built[i + 1]);
    if (id === null) return err('A leg lost its route');
    const t = buyTruck(ctx, 'player', id);
    if (!t.ok) return t;
  }
  return ok(built);
}

/**
 * Headless heir choice (the soak calls it yearly): the eldest living child with the most of
 * `shrewd`/`charming`, else the eldest. Only through the public API (nameHeir); no-op when childless.
 */
export function autoplayNameHeir(ctx: SimContext): void {
  const d = ctx.state.dynasty;
  const kids = livingChildren(d);
  if (kids.length === 0) return;
  const good = (p: (typeof kids)[number]) => p.traits.filter((t) => t === 'shrewd' || t === 'charming').length;
  let best = kids[0];
  for (const k of kids) if (good(k) > good(best)) best = k;
  if (d.heirId !== best.id) nameHeir(ctx.state, best.id);
}

/**
 * Headless defence against the Baron's hostile bid (the soak calls it monthly): while a bid is open,
 * buys back just enough shares to break his majority, borrowing the shortfall when cash is short.
 * Only through the public API (exchange/trading.ts buyBack: takeLoan, then buyShares). No-op with no
 * bid; when even the loan limit cannot cover it, it tries again next month.
 */
export function autoplayDefend(ctx: SimContext): void {
  if (!bidOpen(ctx.state)) return;
  buyBack(ctx);
}
