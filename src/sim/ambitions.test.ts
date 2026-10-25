import { describe, expect, it } from 'vitest';
import {
  AMBITIONS,
  activeAmbitionId,
  ambitionsEnabled,
  attachAmbitions,
  completedAmbitions,
  componentSold,
  nextUnmetAmbition,
  playerStoreCities,
  tickAmbitions,
  yearProfit,
} from './ambitions';
import { testCtx, testState } from './testkit';
import type { Building } from './types';

const store = (id: number, cityId: number, typeId = 'store'): Building =>
  ({ id, typeId, ownerId: 'player', cityId } as Building);

describe('ambitions (Free Play soft goals)', () => {
  it('pool has the six v1 ambitions', () => {
    expect(AMBITIONS.map((a) => a.id)).toEqual([
      'sell_furniture_100',
      'complete_contract_1',
      'own_trading_house',
      'second_city_store',
      'year_profit_50k',
      'sell_component_any',
    ]);
  });

  it('only Free Play (no scenario goals) enables ambitions', () => {
    const free = testState();
    free.scenarioId = 'sandbox';
    expect(ambitionsEnabled(free)).toBe(true);
    const scenario = testState();
    scenario.scenarioId = 'lumber_baron';
    expect(ambitionsEnabled(scenario)).toBe(false);
    expect(tickAmbitions(scenario)).toBeNull();
    expect(activeAmbitionId(scenario)).toBeNull();
  });

  it('picks the first unmet as active and completes into the next', () => {
    const s = testState();
    s.scenarioId = 'sandbox';
    expect(tickAmbitions(s)).toBeNull();
    expect(activeAmbitionId(s)).toBe('sell_furniture_100');

    s.flags['sold:furniture'] = 100;
    const done = tickAmbitions(s);
    expect(done?.id).toBe('sell_furniture_100');
    expect(s.flags['ambition:done:sell_furniture_100']).toBe(1);
    expect(activeAmbitionId(s)).toBe('complete_contract_1');
  });

  it('skips already-met ambitions when seeding without toasting twice', () => {
    const s = testState();
    s.scenarioId = 'sandbox';
    s.flags.contractsDone = 2;
    s.buildings[1] = store(1, null as unknown as number, 'trading_house');
    s.buildings[1].cityId = null;
    tickAmbitions(s);
    expect(s.flags['ambition:done:complete_contract_1']).toBe(1);
    expect(s.flags['ambition:done:own_trading_house']).toBe(1);
    expect(activeAmbitionId(s)).toBe('sell_furniture_100');
    // stale active pointing at a done id does not re-toast
    s.flags['ambition:active'] = 'complete_contract_1';
    expect(tickAmbitions(s)).toBeNull();
    expect(activeAmbitionId(s)).toBe('sell_furniture_100');
  });

  it('never fails: completing the last clears active', () => {
    const s = testState();
    s.scenarioId = 'sandbox';
    for (const a of AMBITIONS) s.flags[`ambition:done:${a.id}`] = 1;
    tickAmbitions(s);
    expect(activeAmbitionId(s)).toBeNull();
    expect(nextUnmetAmbition(s)).toBeNull();
    expect(completedAmbitions(s)).toHaveLength(6);
  });

  it('year_profit_50k reads the company ledger', () => {
    const s = testState();
    s.scenarioId = 'sandbox';
    s.date.year = 1901;
    s.companies.player.ledger.push(
      { year: 1901, month: 1, income: { sales: 40_000 }, expense: {}, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 },
      { year: 1901, month: 2, income: { sales: 15_000 }, expense: { maintenance: 4_000 }, salesByGood: {}, cashEnd: 0, netWorthEnd: 0 },
    );
    expect(yearProfit(s, 1901)).toBe(51_000);
    const def = AMBITIONS.find((a) => a.id === 'year_profit_50k')!;
    expect(def.done(s)).toBe(true);
    expect(def.progress(s).value).toBe(50_000);
  });

  it('second_city_store counts distinct cityIds of player retail', () => {
    const s = testState();
    s.buildings[1] = store(1, 0);
    s.buildings[2] = store(2, 0);
    expect(playerStoreCities(s)).toEqual([0]);
    s.buildings[3] = store(3, 1);
    expect(playerStoreCities(s).length).toBe(2);
    expect(AMBITIONS.find((a) => a.id === 'second_city_store')!.done(s)).toBe(true);
  });

  it('sell_component_any counts sold: flags for component goods', () => {
    const s = testState();
    s.flags['sold:furniture'] = 50;
    expect(componentSold(s)).toBe(0);
    s.flags['sold:wire'] = 3;
    expect(componentSold(s)).toBe(3);
    expect(AMBITIONS.find((a) => a.id === 'sell_component_any')!.done(s)).toBe(true);
  });

  it('attachAmbitions toasts on complete and does not fire for scenarios', () => {
    const ctx = testCtx(testState());
    ctx.state.scenarioId = 'sandbox';
    const toasts: string[] = [];
    ctx.bus.on('toast', (e) => toasts.push(e.message));
    const off = attachAmbitions(ctx);
    expect(activeAmbitionId(ctx.state)).toBe('sell_furniture_100');
    ctx.state.flags['sold:furniture'] = 100;
    ctx.bus.emit({ type: 'dayStart', date: ctx.state.date });
    expect(toasts.some((m) => m.includes('Furnish the towns'))).toBe(true);
    off();

    const scenario = testCtx(testState());
    scenario.state.scenarioId = 'lumber_baron';
    const off2 = attachAmbitions(scenario);
    expect(activeAmbitionId(scenario.state)).toBeNull();
    off2();
  });
});
