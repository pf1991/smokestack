import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { TILE } from './constants';
import { chimneyOffsets, spriteKey, houseStyle, windowRects, HEADROOM, ownerColor, REGIONAL_COLORS } from './sprites';

describe('sprites pure helpers', () => {
  it('chimneyOffsets and windowRects inside sprite bounds for every building', () => {
    for (const def of Object.values(BUILDINGS)) {
      const w = def.size.w * TILE;
      const h = def.size.h * TILE + 16;
      for (const c of chimneyOffsets(def.id)) {
        expect(c.x - 3).toBeGreaterThanOrEqual(0);
        expect(c.x + 3).toBeLessThanOrEqual(w);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThan(HEADROOM);
      }
      for (const r of windowRects(def.id)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
      }
    }
  });
  it('factories have >= 1 chimney; extractors only mine/oil_well', () => {
    for (const def of Object.values(BUILDINGS)) {
      const n = chimneyOffsets(def.id).length;
      if (def.category === 'factory') expect(n).toBeGreaterThanOrEqual(1);
      else if (def.category === 'extractor') {
        if (def.id === 'mine' || def.id === 'oil_well') expect(n).toBeGreaterThanOrEqual(1);
        else expect(n).toBe(0);
      }
    }
  });
  it('spriteKey distinct by owner and variant', () => {
    expect(spriteKey('farm', 'player', '')).not.toBe(spriteKey('farm', 'rival', ''));
    expect(spriteKey('farm', 'player', 'a')).not.toBe(spriteKey('farm', 'player', 'b'));
  });
  it('houseStyle by era', () => {
    expect(houseStyle(1900)).toBe('cottage');
    expect(houseStyle(1930)).toBe('brick');
    expect(houseStyle(1950)).toBe('deco');
    expect(houseStyle(1990)).toBe('modern');
  });
});

describe('ownerColor', () => {
  it('keeps player colour and gives regionals a stable palette colour', () => {
    expect(ownerColor('player')).toBe('#2f6fb5');
    expect(ownerColor('rival')).toBe('#b5302f');
    expect(REGIONAL_COLORS).toContain(ownerColor('r_a'));
    expect(ownerColor('r_a')).toBe(ownerColor('r_a'));
  });
});
