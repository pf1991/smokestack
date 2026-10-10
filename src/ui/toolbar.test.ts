// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/state';
import { Toolbar } from './toolbar';
import type { ToolSpec } from './tools';

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onSelect = vi.fn<(t: ToolSpec) => void>();
  const tb = new Toolbar(root, onSelect);
  const state = createGame({ seed: 1 });
  tb.update(state);
  return { root, onSelect, tb, state };
}

const tab = (root: HTMLElement, id: string) => (root.querySelector(`[data-tab="${id}"]`) as HTMLElement).click();

describe('Toolbar', () => {
  it('locked building disabled with invention year', () => {
    const { root } = setup();
    tab(root, 'manufacture');
    const card = root.querySelector('[data-building="electronics_plant"]') as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(card.textContent).toContain('Invented in 1925');
    expect(root.querySelectorAll('.tool-card:not(.locked)').length).toBeGreaterThan(0);
  });

  it('selecting building emits build ToolSpec', () => {
    const { root, onSelect } = setup();
    tab(root, 'extract');
    (root.querySelector('[data-building="lumber_camp"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'build', typeId: 'lumber_camp' });
  });

  it('unlocks when state.unlocked gains the building', () => {
    const { root, tb, state } = setup();
    tab(root, 'manufacture');
    state.unlocked.push('electronics_plant');
    tb.update(state);
    expect((root.querySelector('[data-building="electronics_plant"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('transport tab, bulldoze, keyboard helpers', () => {
    const { root, onSelect, tb } = setup();
    tab(root, 'transport');
    expect((root.querySelector('[data-tool="rail"]') as HTMLButtonElement).disabled).toBe(false);
    (root.querySelector('[data-tool="rail"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'rail' });
    (root.querySelector('[data-tool="road"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'road' });
    tb.selectBulldoze();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'bulldoze' });
    tb.cancel();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'inspect' });
    tb.toggle();
    expect(root.querySelector('.toolbar')!.classList.contains('collapsed')).toBe(true);
  });

  it('train station is buildable from the logistics tab', () => {
    const { root, onSelect, tb, state } = setup();
    tab(root, 'retail');
    tb.update(state);
    const card = root.querySelector('[data-building="train_station"]') as HTMLButtonElement;
    expect(card.disabled).toBe(false);
    card.click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'train_station' });
  });

  it('cancel closes the open build drawer', () => {
    const { root, tb } = setup();
    tab(root, 'refine');
    expect((root.querySelector('[data-panel-tab="refine"]') as HTMLElement).hidden).toBe(false);
    tb.cancel();
    expect((root.querySelector('[data-panel-tab="refine"]') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('.toolbar')!.classList.contains('open')).toBe(false);
    tb.closeDrawer(); // no-op when already closed
    expect((root.querySelector('[data-panel-tab="refine"]') as HTMLElement).hidden).toBe(true);
  });
});
