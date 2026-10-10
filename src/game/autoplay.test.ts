import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { runDays } from '../sim/simulation';
import { createGame } from '../sim/state';
import { runAutoplay } from './autoplay';

describe('autoplay', () => {
  it.each([1, 42, 7777])('scripted furniture chain sells within 20 days (seed %i)', (seed) => {
    const ctx = { state: createGame({ seed }), bus: new EventBus() };
    let sales = 0;
    ctx.bus.on('sale', (e) => {
      if (e.ownerId === 'player') sales += e.revenue;
    });
    const r = runAutoplay(ctx);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    expect(Object.keys(ctx.state.vehicles)).toHaveLength(6);
    runDays(ctx, 20);
    expect(Object.values(ctx.state.vehicles).filter((v) => v.state === 'stuck')).toHaveLength(0);
    expect(sales).toBeGreaterThan(0);
  });
});
