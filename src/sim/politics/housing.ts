/**
 * Company housing bookkeeping: housing whose factory is gone (demolished, sold or taken over)
 * stands empty. Checked monthly from the state, like the other politics drivers (ruling R-Q3);
 * each newly orphaned block publishes one politics headline.
 */
import { PLAYER_ID } from '../companies';
import { publishNews } from '../news';
import type { SimContext } from '../types';
import { housingFactory, workCity } from './workforce';

/** Monthly: announces the player's company housing that lost its factory since the last check. */
export function housingMonth(ctx: SimContext): void {
  const { state } = ctx;
  const track = state.politics.track;
  const before = new Set(track.orphans ?? []);
  const orphans: number[] = [];
  for (const id of Object.keys(state.buildings).map(Number).sort((a, b) => a - b)) {
    const b = state.buildings[id];
    if (b.typeId !== 'company_housing' || b.ownerId !== PLAYER_ID) continue;
    if (housingFactory(state, b.ownerId, b.typeId, b.pos)) continue;
    orphans.push(id);
    if (before.has(id)) continue;
    const town = workCity(state, b);
    publishNews(
      ctx,
      'politics',
      `COMPANY HOUSING${town ? ` NEAR ${town.name.toUpperCase()}` : ''} STANDS EMPTY`,
      'Its factory is gone, and the terraces house no hands for anyone.',
    );
  }
  track.orphans = orphans;
}
