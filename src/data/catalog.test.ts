import { describe, it, expect } from 'vitest';
import { GOODS, DEMAND_PER_1000 } from './goods';
import { RECIPES, recipeEra } from './recipes';
import { BUILDINGS } from './buildings';
import { LANDMARK_IDS, LANDMARKS } from './landmarks';
import { defaultOpinion, FACTION_IDS, FACTIONS, factionName } from './factions';
import { ICON_IDS } from '../render/icons';
import { CARDS } from './cards';
import { LANDMARK_PAINTERS } from '../render/landmarks';

describe('content catalog', () => {
  it('every recipe good exists', () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const id of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]) {
        expect(GOODS[id], `recipe ${recipe.id} uses unknown good ${id}`).toBeDefined();
      }
    }
  });

  it('every building recipe exists', () => {
    for (const building of Object.values(BUILDINGS)) {
      for (const recipeId of building.recipes) {
        expect(RECIPES[recipeId], `building ${building.id} uses unknown recipe ${recipeId}`).toBeDefined();
      }
    }
  });

  it('every consumer good is producible from raw goods', () => {
    const reachable = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const recipe of Object.values(RECIPES)) {
        if (!Object.keys(recipe.inputs).every((g) => reachable.has(g))) continue;
        for (const out of Object.keys(recipe.outputs)) {
          if (!reachable.has(out)) {
            reachable.add(out);
            changed = true;
          }
        }
      }
    }
    const consumer = Object.values(GOODS).filter((g) => g.tier === 2);
    expect(consumer).toHaveLength(11);
    for (const good of consumer) {
      expect(reachable.has(good.id), `${good.id} not producible`).toBe(true);
    }
  });

  it('recipe era', () => {
    expect(recipeEra('r_toys_plastic')).toBe(1935);
    expect(recipeEra('r_cars')).toBe(1910);
    expect(recipeEra('r_fuel')).toBe(1910);
  });

  it('every building def employs workers (company housing only houses them)', () => {
    for (const def of Object.values(BUILDINGS)) {
      if (def.id === 'company_housing') {
        expect(def.workers).toBe(0);
        continue;
      }
      expect(Number.isFinite(def.workers) && def.workers > 0, `${def.id} workers ${def.workers}`).toBe(true);
    }
    const byCat = (cat: string) => Object.values(BUILDINGS).filter((d) => d.category === cat);
    for (const d of byCat('extractor')) expect(d.workers, d.id).toBe(20);
    for (const d of byCat('factory')) expect(d.workers, d.id).toBe(d.id === 'steel_mill' || d.id === 'car_plant' ? 120 : 60);
    for (const d of byCat('retail')) expect(d.workers, d.id).toBe(12);
    for (const d of byCat('logistics')) expect(d.workers, d.id).toBe(d.id === 'company_housing' ? 0 : 6);
  });

  it('exact values', () => {
    expect(GOODS.cars.basePrice).toBe(630);
    expect(GOODS.radios.fadeYear).toBe(1965);
    expect(BUILDINGS.car_plant.size).toEqual({ w: 4, h: 4 });
    expect(BUILDINGS.store.requiresCity).toBe(true);
    expect(DEMAND_PER_1000.bread).toBe(60);
  });

  it('every manufacturing recipe is profitable at base price', () => {
    const value = (inv: Record<string, number>) =>
      Object.entries(inv).reduce((sum, [id, qty]) => sum + qty * GOODS[id].basePrice, 0);
    const manufacturing = Object.values(RECIPES).filter((r) =>
      Object.keys(r.outputs).some((g) => GOODS[g].tier === 2),
    );
    expect(manufacturing.length).toBeGreaterThan(0);
    for (const recipe of manufacturing) {
      expect(value(recipe.outputs), `${recipe.id} not profitable`).toBeGreaterThan(value(recipe.inputs));
    }
  });

  it('requiresDeposit and requiresCity flags', () => {
    for (const b of Object.values(BUILDINGS)) {
      expect(b.requiresDeposit, b.id).toBe(b.id === 'mine' || b.id === 'oil_well');
      expect(b.requiresCity, b.id).toBe(b.id === 'store');
    }
  });

  it('every good and building has a distinct colour and a description', () => {
    const goodColors = Object.values(GOODS).map((g) => g.color);
    expect(new Set(goodColors).size).toBe(goodColors.length);
    for (const b of Object.values(BUILDINGS)) {
      expect(b.description.length).toBeGreaterThan(0);
    }
  });

  it('every landmark has a painter and an icon', () => {
    expect(LANDMARK_IDS).toEqual(Object.keys(LANDMARKS));
    for (const id of LANDMARK_IDS) {
      expect(typeof LANDMARK_PAINTERS[id], id).toBe('function');
      expect(ICON_IDS, id).toContain(id);
    }
  });
  it('factions: five, keyed by id, weights summing to 1, distinct colours, Reformers become Greens in 1960', () => {
    expect([...FACTION_IDS].sort()).toEqual(Object.keys(FACTIONS).sort());
    expect(FACTION_IDS).toEqual(['workers', 'oldmoney', 'reformers', 'church', 'baron']);
    expect(Object.fromEntries(FACTION_IDS.map((f) => [f, FACTIONS[f].weight]))).toEqual({ workers: 0.4, oldmoney: 0.18, reformers: 0.17, church: 0.2, baron: 0.05 });
    expect(FACTION_IDS.reduce((s, f) => s + FACTIONS[f].weight, 0)).toBeCloseTo(1, 10);
    for (const f of FACTION_IDS) {
      const d = FACTIONS[f];
      expect(d.id).toBe(f);
      expect(d.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(d.name.length && d.likes.length && d.hates.length).toBeGreaterThan(0);
    }
    expect(new Set(FACTION_IDS.map((f) => FACTIONS[f].color)).size).toBe(5);
    expect(FACTIONS.reformers.greenName).toBe('Greens');
    expect(factionName('reformers', 1959)).toBe('Reformers');
    expect(factionName('reformers', 1960)).toBe('Greens');
    expect(factionName('workers', 1990)).toBe('Workers');
    expect(defaultOpinion()).toEqual({ workers: 50, oldmoney: 50, reformers: 50, church: 50, baron: 35 });
  });

  it('event cards: unique ids, sane fields, always answerable, city effects only on city cards', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.id, c.id).toMatch(/^[a-z0-9_]+$/);
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(c.body.length, c.id).toBeGreaterThan(0);
      expect(c.years[0], c.id).toBeLessThanOrEqual(c.years[1]);
      expect(c.weight, c.id).toBeGreaterThan(0);
      expect(c.cooldownYears, c.id).toBeGreaterThanOrEqual(0);
      expect(c.choices.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.choices[c.defaultChoice], `${c.id} defaultChoice`).toBeDefined();
      // never trap the player: some choice costs nothing (or pays)
      expect(c.choices.some((ch) => ch.cost <= 0), `${c.id} has no free choice`).toBe(true);
      for (const ch of c.choices) {
        expect(Number.isFinite(ch.cost), `${c.id}: ${ch.label}`).toBe(true);
        for (const e of ch.effects) {
          expect(FACTIONS[e.faction], `${c.id}: ${e.faction}`).toBeDefined();
          if (e.scope === 'city') expect(c.needsCity, `${c.id} has a city effect but needsCity false`).toBe(true);
        }
        if (ch.apply) expect(ch.note, `${c.id}: ${ch.label} has apply but no note`).toBeTruthy();
      }
      if (!c.needsCity) expect(c.body + c.title, `${c.id} uses {city} without a city`).not.toContain('{city}');
    }
  });
});
