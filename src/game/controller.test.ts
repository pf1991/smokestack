// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/state';
import type { SimContext } from '../sim/types';

/** stepTick stub: counts ticks and opens a card at tick `openAt`. */
const sim = vi.hoisted(() => ({ ticks: 0, openAt: -1 }));
vi.mock('../sim/simulation', () => ({
  stepTick: (ctx: SimContext) => {
    sim.ticks++;
    if (sim.ticks === sim.openAt) ctx.state.politics.cards.pending.push({ uid: 1, cardId: 'letter_to_editor', cityId: null, openedDay: 0 });
  },
}));

import { GameController, MAX_TICKS_PER_FRAME, msPerTick } from './controller';

/** Runs GameController.advance against a bare object holding only what it reads. */
function advanceOn(openAt: number, dtMs: number) {
  sim.ticks = 0;
  sim.openAt = openAt;
  const state = createGame({ seed: 1 });
  state.speed = 8;
  const fake = { state, ctx: { state }, acc: 0, alpha: 0 };
  const ran = GameController.prototype.advance.call(fake as unknown as GameController, dtMs);
  return { ran, ticks: sim.ticks, pending: state.politics.cards.pending.length };
}

describe('GameController.advance', () => {
  it('stops the frame catch-up at the tick a card opens', () => {
    const dt = msPerTick(8) * 50.5; // a 50-tick frame
    const r = advanceOn(7, dt);
    expect(r.ticks).toBe(7);
    expect(r.ran).toBe(7);
    expect(r.pending).toBe(1);
  });

  it('runs the whole frame when no card opens', () => {
    const r = advanceOn(-1, msPerTick(8) * 50.5);
    expect(r.ticks).toBe(50);
    expect(r.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
  });
});
