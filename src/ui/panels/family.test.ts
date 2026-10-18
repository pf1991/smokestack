// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DYNASTY_TRAITS } from '../../data/dynasty';
import type { GameController } from '../../game/controller';
import { EventBus } from '../../core/events';
import { createGame } from '../../sim/state';
import { marry } from '../../sim/dynasty/types';
import type { SimContext } from '../../sim/types';
import { PANELS } from './index';

function game(ctx: SimContext) {
  return { ctx, state: ctx.state, renderer: { setSelection: () => {} }, openPanel: () => {} } as unknown as GameController;
}

const panel = () => document.querySelector('.family-panel') as HTMLElement;

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  document.body.replaceChildren();
});

function familyCtx(): SimContext {
  const state = createGame({ seed: 7, companyName: 'Gilded Gear & Co.', rival: true });
  state.date = { year: 1930, month: 6, day: 1, hour: 9 };
  const d = state.dynasty;
  d.head.traits = ['shrewd'];
  marry(state);
  d.children.push(
    { id: d.nextPersonId++, name: 'Edith Gilded', born: 1906, traits: ['charming', 'reckless'], alive: true },
    { id: d.nextPersonId++, name: 'Rupert Gilded', born: 1915, traits: ['brute'], alive: true },
  );
  return { state, bus: new EventBus() };
}

describe('family panel', () => {
  it('is registered as PANELS.family', () => {
    expect(PANELS.family.id).toBe('family');
  });

  it('shows the head, the spouse and each child with portraits, ages and traits with blurbs', () => {
    const ctx = familyCtx();
    PANELS.family.open(game(ctx));
    const p = panel();
    const head = p.querySelector('.family-head')!;
    expect(head.textContent).toContain('Josiah Gilded');
    expect(head.textContent).toContain('aged 58');
    expect(head.textContent).toContain(DYNASTY_TRAITS.shrewd.label);
    expect(head.textContent).toContain(DYNASTY_TRAITS.shrewd.blurb);
    expect(p.querySelector('.family-spouse')!.textContent).toContain(ctx.state.dynasty.spouse!.name);
    const kids = [...p.querySelectorAll<HTMLElement>('.family-child')];
    expect(kids).toHaveLength(2);
    expect(kids[0].textContent).toContain('Edith Gilded');
    expect(kids[0].textContent).toContain('aged 24');
    expect(kids[0].textContent).toContain(DYNASTY_TRAITS.reckless.blurb);
    expect(kids[1].textContent).toContain('aged 15');
    // a portrait per person: head, spouse, two children
    expect(p.querySelectorAll('canvas')).toHaveLength(4);
    expect(p.querySelector('.family-generation')!.textContent).toContain('1');
    expect(p.querySelector('.family-prestige')!.textContent).toContain(String(ctx.state.dynasty.prestige));
  });

  it('marks the eldest as heir by default, and "Name heir" names another child', () => {
    const ctx = familyCtx();
    PANELS.family.open(game(ctx));
    let kids = [...panel().querySelectorAll<HTMLElement>('.family-child')];
    expect(kids[0].querySelector('.family-heir-badge')).not.toBeNull();
    expect(kids[1].querySelector('.family-heir-badge')).toBeNull();
    const btn = kids[1].querySelector<HTMLButtonElement>('.family-name-heir')!;
    expect(btn.textContent).toBe('Name heir');
    btn.click();
    expect(ctx.state.dynasty.heirId).toBe(ctx.state.dynasty.children[1].id);
    kids = [...panel().querySelectorAll<HTMLElement>('.family-child')];
    expect(kids[1].querySelector('.family-heir-badge')).not.toBeNull();
    expect(kids[0].querySelector('.family-heir-badge')).toBeNull();
    expect(kids[1].querySelector<HTMLButtonElement>('.family-name-heir')!.disabled).toBe(true);
    // a minor heir is flagged: the head will hold on until they come of age
    expect(kids[1].textContent).toContain('under 18');
  });

  it('the dead stop ageing: "died <year>, aged <age at death>"', () => {
    const ctx = familyCtx();
    const kid = ctx.state.dynasty.children[1];
    kid.alive = false;
    kid.died = 1920;
    PANELS.family.open(game(ctx));
    const row = [...panel().querySelectorAll<HTMLElement>('.family-child')][1];
    expect(row.textContent).toContain('died 1920, aged 5');
  });

  it('a single, childless head reads as such', () => {
    const state = createGame({ seed: 3, companyName: 'Acme Works' });
    const ctx = { state, bus: new EventBus() };
    PANELS.family.open(game(ctx));
    expect(panel().querySelector('.family-spouse')!.textContent).toContain('Unmarried');
    expect(panel().querySelector('.family-children')!.textContent).toContain('No children');
    expect(panel().querySelector('.family-head')!.textContent).toContain('Josiah Acme');
  });
});
