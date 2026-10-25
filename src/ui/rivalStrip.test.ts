// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { GOODS } from '../data/goods';
import { RETALIATION_LABELS } from '../data/nemesis';
import { publishNews } from '../sim/news';
import { testState } from '../sim/testkit';
import type { GameState } from '../sim/types';
import { mountRivalStrip, type RivalStripHost } from './rivalStrip';

function host(state: GameState): RivalStripHost & { panels: unknown[] } {
  const panels: unknown[] = [];
  return {
    ctx: { state, bus: new EventBus() },
    openPanel: (id, arg) => panels.push([id, arg]),
    panels,
  };
}

describe('mountRivalStrip', () => {
  const slots: HTMLElement[] = [];
  afterEach(() => {
    for (const s of slots.splice(0)) s.remove();
  });

  function mount(state: GameState = testState({ cities: [{ x: 10, y: 10, name: 'Rivermouth' }] })) {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    slots.push(slot);
    const g = host(state);
    const off = mountRivalStrip(slot, g);
    return { slot, g, off, state };
  }

  it('stays empty until a rival beat arrives', () => {
    const { slot } = mount();
    expect(slot.querySelector('.rival-strip')).toBeNull();
  });

  it('shows a baronStrike beat and Jump opens the rival panel', () => {
    const { slot, g } = mount();
    g.ctx.bus.emit({ type: 'baronStrike', kind: 'price_war', cityId: 0 });
    const strip = slot.querySelector<HTMLElement>('.rival-strip')!;
    expect(strip.textContent).toContain(`Smogsworth strikes: ${RETALIATION_LABELS.price_war}`);
    strip.querySelector<HTMLButtonElement>('.rival-strip-jump')!.click();
    expect(g.panels).toEqual([['city', 0]]);
  });

  it('shows an undercut beat with town and good, Jump opens the city', () => {
    const { slot, g } = mount();
    g.ctx.bus.emit({ type: 'undercut', cityId: 0, goodId: 'furniture' });
    const strip = slot.querySelector<HTMLElement>('.rival-strip')!;
    expect(strip.querySelector('.rival-strip-text')!.textContent).toBe(
      `Undercutting you in Rivermouth — ${GOODS.furniture.name}`,
    );
    strip.querySelector<HTMLButtonElement>('.rival-strip-jump')!.click();
    expect(g.panels).toEqual([['city', 0]]);
  });

  it('shows the latest rival news taunt and Jump opens the rival panel', () => {
    const { slot, g, state } = mount();
    publishNews({ state, bus: g.ctx.bus }, 'rival', "Smogsworth: 'Your lorries are so slow'", 'body');
    const strip = slot.querySelector<HTMLElement>('.rival-strip')!;
    expect(strip.querySelector('.rival-strip-text')!.textContent).toContain('Your lorries are so slow');
    strip.querySelector<HTMLButtonElement>('.rival-strip-jump')!.click();
    expect(g.panels).toEqual([['rival', undefined]]);
  });

  it('baronStrike with no city Jump opens the rival panel', () => {
    const { slot, g } = mount();
    g.ctx.bus.emit({ type: 'baronStrike', kind: 'smear', cityId: null });
    slot.querySelector<HTMLButtonElement>('.rival-strip-jump')!.click();
    expect(g.panels).toEqual([['rival', undefined]]);
  });
});
