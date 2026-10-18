import { describe, expect, it } from 'vitest';
import { FACTION_IDS } from '../data/factions';
import { landmarkCreditKey, raiseLandmark } from './landmarks';
import { legacyScore } from './legacy';
import { nationalOpinion } from './politics/factions';
import { netWorth } from './rival/takeover';
import { createGame } from './state';
import { testCtx, testState } from './testkit';
import type { GameState } from './types';

/** A fixture with known numbers: net worth $5,000,000 at price index 2, one town of opinion 50. */
function fixture(): GameState {
  const s = testState({ cities: [{ x: 10, y: 10, population: 5000 }], streets: true, money: 5_000_000 });
  s.economy.priceIndex = 2;
  for (const c of s.cities) for (const f of FACTION_IDS) c.opinion[f] = 50;
  s.dynasty.prestige = 0;
  s.dynasty.generation = 1;
  return s;
}

describe('legacyScore', () => {
  it('fortune is the real net worth over $10,000, rounded, never below 0', () => {
    const s = fixture();
    const nw = netWorth(s, 'player');
    expect(legacyScore(s).fortune).toBe(Math.round(nw / 2 / 10_000));
    s.companies.player.money = -9e9;
    expect(legacyScore(s).fortune).toBe(0);
  });

  it('landmarks are 50 for each credited landmark, none for uncredited ones', () => {
    const s = fixture();
    const city = s.cities[0];
    city.landmarks.push({ id: 'church', pos: { x: 1, y: 1 } }, { id: 'town_hall', pos: { x: 5, y: 5 } });
    expect(legacyScore(s).landmarks).toBe(0);
    s.flags[landmarkCreditKey(city.id, 1)] = true;
    expect(legacyScore(s).landmarks).toBe(50);
    s.flags[landmarkCreditKey(city.id, 0)] = true;
    expect(legacyScore(s).landmarks).toBe(100);
  });

  it('reputation is 4 per point of national opinion above 50, summed, and may be negative', () => {
    const s = fixture();
    expect(legacyScore(s).reputation).toBe(0);
    const city = s.cities[0];
    city.opinion.workers = 60;
    city.opinion.church = 40;
    city.opinion.baron = 30;
    expect(legacyScore(s).reputation).toBe(Math.round(FACTION_IDS.reduce((a, f) => a + nationalOpinion(s, f) - 50, 0) * 4));
    expect(legacyScore(s).reputation).toBe(-80);
  });

  it('dynasty is prestige plus 25 per generation after the first, plus 100 for the takeover', () => {
    const s = fixture();
    s.dynasty.prestige = 30;
    s.dynasty.generation = 3;
    expect(legacyScore(s).dynasty).toBe(80);
    s.flags.takeover = true;
    expect(legacyScore(s).dynasty).toBe(180);
  });

  it('the total is the sum, floored at 0', () => {
    const s = fixture();
    s.dynasty.prestige = 10;
    const l = legacyScore(s);
    expect(l.total).toBe(l.fortune + l.landmarks + l.reputation + l.dynasty);
    for (const f of FACTION_IDS) s.cities[0].opinion[f] = 0;
    s.companies.player.money = 0;
    expect(legacyScore(s).total).toBe(0);
  });
});

describe('landmark credit', () => {
  function raise(sales: { player: number; baron: number } | null, idxBefore = 0) {
    const ctx = testCtx(fixture());
    const city = ctx.state.cities[0];
    for (let i = 0; i < idxBefore; i++) city.landmarks.push({ id: 'church', pos: { x: 1 + i * 3, y: 1 } });
    if (sales) ctx.state.politics.track.sales[String(city.id)] = sales;
    raiseLandmark(ctx, city, 'town_hall', { x: 20, y: 20 }, 'x');
    return { ctx, city };
  }

  it('is recorded when the player leads the town', () => {
    const { ctx, city } = raise({ player: 500, baron: 100 });
    expect(ctx.state.flags[landmarkCreditKey(city.id, 0)]).toBe(true);
    expect(legacyScore(ctx.state).landmarks).toBe(50);
  });

  it('uses the landmark index within its city', () => {
    const { ctx, city } = raise({ player: 500, baron: 100 }, 2);
    expect(ctx.state.flags[`landmarkCredit:${city.id}:2`]).toBe(true);
  });

  it('is not recorded for a tie, a trailing player, or no sales', () => {
    for (const sales of [{ player: 100, baron: 100 }, { player: 50, baron: 100 }, null]) {
      const { ctx } = raise(sales);
      expect(Object.keys(ctx.state.flags).filter((k) => k.startsWith('landmarkCredit'))).toEqual([]);
    }
  });

  it('a fresh game scores a small non-negative legacy', () => {
    const l = legacyScore(createGame({ seed: 7 }));
    expect(l.landmarks).toBe(0);
    expect(l.total).toBeGreaterThanOrEqual(0);
  });
});
