/**
 * Pure aggregation for on-map sale floats: at most one float per building per game-day,
 * summing player revenue (and picking a dominant good for an optional icon).
 */
import { formatMoney } from '../core/money';
import type { GoodId, OwnerId } from '../sim/types';

export interface SaleFloatInput {
  buildingId: number;
  revenue: number;
  goodId: GoodId;
  ownerId: OwnerId;
}

export interface SaleFloat {
  buildingId: number;
  revenue: number;
  goodId: GoodId | null;
  ownerId: OwnerId;
}

/** Highest-revenue good in the map, or null when empty. Ties break by insertion order (first max). */
export function dominantGood(goods: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestRev = -Infinity;
  for (const [id, rev] of goods) {
    if (rev > bestRev) {
      best = id;
      bestRev = rev;
    }
  }
  return best;
}

/** `+$n` label for a floater (formatMoney already includes `$`). */
export function saleFloatLabel(revenue: number): string {
  return `+${formatMoney(revenue)}`;
}

/** Photo mode and zoomed-out survey hide sale floats. */
export function shouldShowSaleFloats(opts: { photo: boolean; zoom: number }): boolean {
  return !opts.photo && opts.zoom >= 1;
}

interface Pending {
  revenue: number;
  goods: Map<string, number>;
  ownerId: OwnerId;
}

/**
 * Batches player sales into ≤1 float per building per game-day (`day` is dateToDays).
 * Call `take` after a short real-time quiet period; later sales the same day stay silent.
 */
export class SaleFloatAggregator {
  private pending = new Map<number, Pending>();
  /** buildingId → day a float was already emitted */
  private emitted = new Map<number, number>();

  record(sale: SaleFloatInput, _day: number): void {
    if (sale.ownerId !== 'player') return;
    const cur = this.pending.get(sale.buildingId);
    if (cur) {
      cur.revenue += sale.revenue;
      cur.goods.set(sale.goodId, (cur.goods.get(sale.goodId) ?? 0) + sale.revenue);
    } else {
      this.pending.set(sale.buildingId, {
        revenue: sale.revenue,
        goods: new Map([[sale.goodId, sale.revenue]]),
        ownerId: sale.ownerId,
      });
    }
  }

  /** Emits pending floats for buildings that have not already floated on `day`. */
  take(day: number): SaleFloat[] {
    const out: SaleFloat[] = [];
    for (const [buildingId, p] of this.pending) {
      if (this.emitted.get(buildingId) === day) continue;
      this.pending.delete(buildingId);
      this.emitted.set(buildingId, day);
      out.push({
        buildingId,
        revenue: p.revenue,
        goodId: dominantGood(p.goods) as GoodId | null,
        ownerId: p.ownerId,
      });
    }
    return out;
  }

  clear(): void {
    this.pending.clear();
    this.emitted.clear();
  }
}
