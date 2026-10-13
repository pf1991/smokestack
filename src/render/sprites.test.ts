import { describe, it, expect, vi, afterEach } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { TILE } from './constants';
import { chimneyOffsets, spriteKey, houseStyle, houseTier, windowRects, HEADROOM, ownerColor, REGIONAL_COLORS, LOCO_HALF, WAGON_HALF, drawTruck, BUILDING_HEIGHT, HOUSE_TIER_HEIGHT, HOUSE_TIERS, getBuildingSprite, buildingCasters, houseCaster, TALL_STACK, upgradeHeadroom, upgradeKey, upgradedChimneyOffsets } from './sprites';
import { MAX_CASTER_Z } from './shadows';
import { LANDMARK_CASTERS, LANDMARK_HEADROOM, LANDMARK_HEIGHT } from './landmarks';
import { LANDMARK_IDS } from '../data/landmarks';

describe('sprites pure helpers', () => {
  it('chimneyOffsets and windowRects inside sprite bounds for every building', () => {
    for (const def of Object.values(BUILDINGS)) {
      const w = def.size.w * TILE;
      const h = def.size.h * TILE + HEADROOM;
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

describe('diorama heights', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('every building type has a BUILDING_HEIGHT in its category band', () => {
    for (const def of Object.values(BUILDINGS)) {
      const hgt = BUILDING_HEIGHT[def.id as keyof typeof BUILDING_HEIGHT];
      expect(hgt, def.id).toBeTypeOf('number');
      const [lo, hi] = def.category === 'extractor' ? [6, 10] : def.category === 'factory' ? [14, 22] : def.category === 'retail' ? [8, 12] : [6, 22];
      expect(hgt, def.id).toBeGreaterThanOrEqual(lo);
      expect(hgt, def.id).toBeLessThanOrEqual(hi);
    }
  });
  it('HEADROOM fits the tallest building above the old 16 px of chimney room', () => {
    expect(HEADROOM).toBeGreaterThanOrEqual(16 + Math.max(...Object.values(BUILDING_HEIGHT)));
  });
  it('HOUSE_TIER_HEIGHT has one entry per tier, rising with density; towers are 28', () => {
    expect(Object.keys(HOUSE_TIER_HEIGHT).sort()).toEqual([...HOUSE_TIERS].sort());
    expect(HOUSE_TIER_HEIGHT.tower).toBe(28);
    for (let i = 1; i < HOUSE_TIERS.length; i++) expect(HOUSE_TIER_HEIGHT[HOUSE_TIERS[i]]).toBeGreaterThan(HOUSE_TIER_HEIGHT[HOUSE_TIERS[i - 1]]);
  });
  it('LANDMARK_HEIGHT covers every landmark; the skyscraper is 40 and the tallest, within the headroom', () => {
    expect(Object.keys(LANDMARK_HEIGHT).sort()).toEqual([...LANDMARK_IDS].sort());
    expect(LANDMARK_HEIGHT.skyscraper).toBe(40);
    for (const id of LANDMARK_IDS) {
      expect(LANDMARK_HEIGHT[id]).toBeGreaterThan(0);
      expect(LANDMARK_HEIGHT[id]).toBeLessThanOrEqual(LANDMARK_HEIGHT.skyscraper);
    }
    expect(LANDMARK_HEADROOM).toBeGreaterThan(LANDMARK_HEIGHT.skyscraper);
  });
  it('the steel mill sprite canvas is taller than wide', () => {
    const fake = () => ({ width: 0, height: 0, getContext: () => null });
    vi.stubGlobal('document', { createElement: fake });
    const c = getBuildingSprite('steel_mill', 'player');
    expect(c.height).toBeGreaterThan(c.width);
    expect(c.height).toBe(BUILDINGS.steel_mill.size.h * TILE + HEADROOM);
  });
  it('upgraded sprites are per-building variants: taller by the upgrade headroom, smoke from the raised tops', () => {
    const fake = () => ({ width: 0, height: 0, getContext: () => null });
    vi.stubGlobal('document', { createElement: fake });
    const up = { scrubber: 2 as const, tallChimney: true };
    const plain = getBuildingSprite('steel_mill', 'player');
    const tall = getBuildingSprite('steel_mill', 'player', '', up);
    expect(tall).not.toBe(plain);
    expect(getBuildingSprite('steel_mill', 'player', '', { scrubber: 2, tallChimney: true })).toBe(tall);
    expect(getBuildingSprite('steel_mill', 'player', '', { scrubber: 0, tallChimney: false })).toBe(plain);
    expect(upgradeKey(up)).toBe('s2t');
    expect(upgradeHeadroom(up)).toBeGreaterThanOrEqual(TALL_STACK);
    expect(tall.height).toBe(plain.height + upgradeHeadroom(up));
    const base = chimneyOffsets('steel_mill');
    const raisedTops = upgradedChimneyOffsets('steel_mill', up);
    raisedTops.forEach((c, i) => {
      expect(c.x).toBe(base[i].x);
      expect(c.y).toBe(base[i].y - upgradeHeadroom(up));
      // still inside the upgraded sprite, which is drawn upgradeHeadroom rows higher
      expect(c.y + upgradeHeadroom(up)).toBeGreaterThanOrEqual(0);
    });
    const zs = (cs: { z: number }[]) => Math.max(...cs.map((c) => c.z));
    expect(zs(buildingCasters('textile_mill', up))).toBeGreaterThan(zs(buildingCasters('textile_mill')));
  });
  it('every building casts a shadow from its raised body, no taller than MAX_CASTER_Z', () => {
    for (const def of Object.values(BUILDINGS)) {
      const cs = buildingCasters(def.id);
      expect(cs.length, def.id).toBeGreaterThan(0);
      expect(Math.max(...cs.map((c) => c.z)), def.id).toBeGreaterThanOrEqual(BUILDING_HEIGHT[def.id]);
      for (const c of cs) {
        expect(c.z, def.id).toBeLessThanOrEqual(MAX_CASTER_Z);
        expect(c.x, def.id).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w, def.id).toBeLessThanOrEqual(def.size.w * TILE);
        expect(c.y + c.d, def.id).toBeLessThanOrEqual(def.size.h * TILE);
      }
    }
  });
  it('house and landmark casters follow their heights and fit their headroom', () => {
    for (const t of HOUSE_TIERS) expect(houseCaster(t).z).toBe(HOUSE_TIER_HEIGHT[t]);
    for (const id of LANDMARK_IDS) {
      const zs = LANDMARK_CASTERS[id].map((c) => c.z);
      expect(Math.max(...zs), id).toBeGreaterThanOrEqual(LANDMARK_HEIGHT[id]);
      expect(Math.max(...zs), id).toBeLessThanOrEqual(Math.min(MAX_CASTER_Z, LANDMARK_HEADROOM + 16));
    }
  });
  it('raised factories get extra rows of facade windows', () => {
    const rows = new Set(windowRects('steel_mill').map((r) => r.y));
    expect(rows.size).toBeGreaterThanOrEqual(3);
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
