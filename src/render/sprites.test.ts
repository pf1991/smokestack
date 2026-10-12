import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { TILE } from './constants';
import { chimneyOffsets, spriteKey, houseStyle, houseTier, windowRects, HEADROOM, ownerColor, REGIONAL_COLORS, LOCO_HALF, WAGON_HALF, drawTruck } from './sprites';

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
  it('houseTier by population, year and distance from the centre', () => {
    expect(houseTier(70000, 1960, 0.2)).toBe('tower');
    expect(houseTier(70000, 1960, 0.5)).toBe('house');
    expect(houseTier(45000, 1925, 0.2)).toBe('terrace');
    expect(houseTier(10000, 1990, 0.1)).toBe('house');
    expect(houseTier(45000, 1930, 0.2)).toBe('block');
    expect(houseTier(70000, 1954, 0.2)).toBe('block');
    expect(houseTier(16000, 1900, 0.34)).toBe('terrace');
    expect(houseTier(16000, 1900, 0.35)).toBe('house');
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

describe('vehicles', () => {
  interface Rec { fills: number; xs: number[] }
  function mockCtx(): { g: CanvasRenderingContext2D; rec: Rec } {
    const rec: Rec = { fills: 0, xs: [] };
    const g = {
      fillStyle: '', save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {},
      moveTo() {}, lineTo() {}, closePath() {}, arc() {}, quadraticCurveTo() {},
      fill() { rec.fills++; },
      fillRect(x: number, _y: number, w: number) { rec.fills++; rec.xs.push(x, x + w); },
    } as unknown as CanvasRenderingContext2D;
    return { g, rec };
  }
  it('uses scaled half-lengths', () => {
    expect(LOCO_HALF).toBe(23);
    expect(WAGON_HALF).toBe(14);
  });
  it('headlights add at least 2 fills when lit', () => {
    const a = mockCtx();
    const b = mockCtx();
    drawTruck(a.g, 0, 0, 'E', 'player', null, false);
    drawTruck(b.g, 0, 0, 'E', 'player', null, true);
    expect(b.rec.fills - a.rec.fills).toBeGreaterThanOrEqual(2);
  });
  it('truck spans at least 28px', () => {
    const { g, rec } = mockCtx();
    drawTruck(g, 0, 0, 'E', 'player', null, false);
    expect(Math.max(...rec.xs) - Math.min(...rec.xs)).toBeGreaterThanOrEqual(28);
  });
});

describe('train trail', () => {
  it('TRAIL_MAX covers the last wagon centre (3.0 tiles) plus the rear sample', async () => {
    const { TRAIL_MAX } = await import('./world/vehicles');
    expect(TRAIL_MAX * 0.2).toBeGreaterThanOrEqual(3.25);
  });
});
