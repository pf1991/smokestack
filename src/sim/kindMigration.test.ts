import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { runAutoplay } from '../game/autoplay';
import { stateHash } from './hash';
import { runDays } from './simulation';
import { createGame } from './state';

// Temporary (R4 Task 1): pins that moving good-tier call sites onto GoodDef.kind changes no behaviour. Task 3 deletes it.
describe('kind migration', () => {
  it('seed 42 after autoplay and 720 days hashes as before the migration', () => {
    const ctx = { state: createGame({ seed: 42 }), bus: new EventBus() };
    expect(runAutoplay(ctx).ok).toBe(true);
    runDays(ctx, 720);
    expect(stateHash(ctx.state)).toMatchInlineSnapshot(`"849b931e"`);
  });
});
