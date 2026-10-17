import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../companies';
import { testState } from '../testkit';
import { cardContext, moneyBand } from './context';

describe('cardContext', () => {
  const fixture = () => {
    const s = testState({ seed: 5, year: 1990, cities: Array.from({ length: 12 }, (_, i) => ({ x: 6 + i * 4, y: 8 + (i % 3) * 8, name: `Townsville the ${i}th of Many Names` })) });
    for (let i = 0; i < 40; i++) s.news.push({ id: i, date: s.date, headline: 'H'.repeat(300), body: 'B'.repeat(2000), kind: 'politics' });
    return s;
  };

  it('stays at or under 12 KB on a 1990 fixture and holds the documented fields', () => {
    const s = fixture();
    const c = cardContext(s) as Record<string, any>;
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(12 * 1024);
    expect(c.year).toBe(1990);
    expect(['struggling', 'steady', 'rich']).toContain(c.money);
    expect(c.towns.length).toBe(12);
    expect(Object.keys(c.towns[0]).sort()).toEqual(['mayor', 'name', 'oldmoney', 'reformers', 'smogTier', 'workers']);
    expect(c.headlines.length).toBe(6);
    expect(Array.isArray(c.strikes)).toBe(true);
    expect(Array.isArray(c.laws)).toBe(true);
  });

  it('bands the player money', () => {
    const s = fixture();
    s.companies[PLAYER_ID].money = 1000;
    s.companies[PLAYER_ID].loan = 0;
    expect(moneyBand(s)).toBe('struggling');
    s.companies[PLAYER_ID].money = 1e12;
    expect(moneyBand(s)).toBe('rich');
  });
});
