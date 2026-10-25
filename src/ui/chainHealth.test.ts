// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { testState } from '../sim/testkit';
import type { Building, BuildingStatus, GameState } from '../sim/types';
import { mountChainHealth, type ChainHealthHost } from './chainHealth';

function mk(state: GameState, id: number, status: BuildingStatus, typeId: string): Building {
  const b = {
    id, typeId, ownerId: 'player', pos: { x: 4, y: 6 }, recipeId: null, input: {}, output: {}, progress: 0, status,
    cityId: null, haltedUntil: null, producedThisMonth: {}, staffing: 1, builtYear: 1900, level: 1,
  } as unknown as Building;
  state.buildings[id] = b;
  return b;
}

function host(state: GameState): ChainHealthHost & { notify: () => void; centers: { x: number; y: number }[]; panels: unknown[] } {
  const listeners = new Set<(a: readonly unknown[]) => void>();
  const centers: { x: number; y: number }[] = [];
  const panels: unknown[] = [];
  return {
    ctx: { state, bus: new EventBus() },
    centerOn: (t) => centers.push(t),
    openPanel: (id, arg) => panels.push([id, arg]),
    onAlerts: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify: () => { for (const fn of listeners) fn([]); },
    centers,
    panels,
  };
}

describe('mountChainHealth', () => {
  const slots: HTMLElement[] = [];
  afterEach(() => {
    for (const s of slots.splice(0)) s.remove();
  });

  it('renders three segments and jumps to the starved works on Inputs click', () => {
    const state = testState();
    mk(state, 7, 'no_input', 'sawmill');
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    slots.push(slot);
    const g = host(state);
    const off = mountChainHealth(slot, g);
    const segs = [...slot.querySelectorAll<HTMLButtonElement>('.chain-seg')];
    expect(segs.map((b) => b.dataset.seg)).toEqual(['inputs', 'works', 'shelves']);
    expect(segs[0].querySelector('.chain-seg-count')!.textContent).toBe('1/1');
    expect(segs[0].dataset.tone).toBe('negative');
    segs[0].click();
    expect(g.centers).toEqual([{ x: 5, y: 7 }]); // sawmill 3×3 footprint centre
    expect(g.panels).toEqual([['building', 7]]);
    off();
  });

  it('repaints when alerts refresh', () => {
    const state = testState();
    const b = mk(state, 1, 'ok', 'sawmill');
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    slots.push(slot);
    const g = host(state);
    mountChainHealth(slot, g);
    const inputs = slot.querySelector<HTMLElement>('[data-seg="inputs"] .chain-seg-count')!;
    expect(inputs.textContent).toBe('0/1');
    b.status = 'no_input';
    g.notify();
    expect(inputs.textContent).toBe('1/1');
  });

  it('disables healthy segments', () => {
    const state = testState();
    mk(state, 1, 'ok', 'sawmill');
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    slots.push(slot);
    mountChainHealth(slot, host(state));
    expect(slot.querySelector<HTMLButtonElement>('[data-seg="inputs"]')!.disabled).toBe(true);
  });

  it('survives a host with no ctx yet (GameController before load)', () => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    slots.push(slot);
    const g: ChainHealthHost = {
      centerOn: () => {},
      openPanel: () => {},
      onAlerts: () => () => {},
    };
    expect(() => mountChainHealth(slot, g)()).not.toThrow();
    expect(slot.querySelectorAll('.chain-seg')).toHaveLength(3);
  });
});
