// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/state';
import { PRICE_NOTE, Toolbar } from './toolbar';
import type { ToolSpec } from './tools';
import { applyUiScale } from './scale';

const made: Toolbar[] = [];
afterEach(() => {
  for (const t of made.splice(0)) t.closeDrawer();
});

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onSelect = vi.fn<(t: ToolSpec) => void>();
  const tb = new Toolbar(root, onSelect);
  made.push(tb);
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

  it('cards show a base price and upkeep and say town politics can change them', () => {
    const { root } = setup();
    tab(root, 'extract');
    const card = root.querySelector('[data-building="lumber_camp"]') as HTMLElement;
    expect(card.querySelector('.tc-cost')!.textContent).toBe('base $12,000');
    expect(card.querySelector('.tc-maint')!.textContent).toMatch(/^base \+\$[\d,]+\/mo$/);
    expect(card.title).toContain(PRICE_NOTE);
    expect(PRICE_NOTE).toContain('Town politics');
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

  it('a category click opens its flyout and a second click closes it', () => {
    const { root, tb } = setup();
    const fly = () => root.querySelector('.tb-flyout') as HTMLElement;
    expect(fly().hidden).toBe(true);
    tab(root, 'extract');
    expect(fly().hidden).toBe(false);
    expect(tb.drawerOpen).toBe(true);
    tab(root, 'extract');
    expect(fly().hidden).toBe(true);
    expect(tb.drawerOpen).toBe(false);
  });

  it('picking a card selects its tool and closes the flyout', () => {
    const { root, onSelect, tb } = setup();
    tab(root, 'extract');
    (root.querySelector('[data-building="lumber_camp"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'build', typeId: 'lumber_camp' });
    expect(tb.drawerOpen).toBe(false);
    expect((root.querySelector('.tb-flyout') as HTMLElement).hidden).toBe(true);
  });

  it('Esc (cancel) closes the flyout; categories show icon and label', () => {
    const { root, tb } = setup();
    tab(root, 'refine');
    tb.cancel();
    expect((root.querySelector('.tb-flyout') as HTMLElement).hidden).toBe(true);
    const btn = root.querySelector('[data-tab="refine"]') as HTMLElement;
    expect(btn.querySelector('img.icon')).not.toBeNull();
    expect(btn.textContent).toContain('Refine');
  });

  it('B (toggle) closes the flyout', () => {
    const { root, tb } = setup();
    tab(root, 'extract');
    tb.toggle();
    expect(tb.drawerOpen).toBe(false);
    tb.toggle();
    expect((root.querySelector('.tb-flyout') as HTMLElement).hidden).toBe(true);
  });

  it('an outside press closes the flyout and is swallowed; a press on the bar is not', () => {
    const { root, tb } = setup();
    tab(root, 'extract');
    const inside = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    root.querySelector('.tb-tabs')!.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    expect(tb.drawerOpen).toBe(true);
    const outside = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(tb.drawerOpen).toBe(false);
    const after = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('the flyout stays clear of the side panel', () => {
    const { root } = setup();
    document.documentElement.style.setProperty('--side-panel-w', '546px');
    Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true });
    const fly = root.querySelector('.tb-flyout') as HTMLElement;
    Object.defineProperty(fly, 'offsetWidth', { value: 900, configurable: true });
    tab(root, 'extract');
    // bar rect is all zeros in jsdom: left = clamp(0 - 450, 8, 1366-546-8-900 -> <8 -> 8) -> 8 - 0 - 2
    expect(parseFloat(fly.style.left)).toBe(6);
    document.documentElement.style.removeProperty('--side-panel-w');
  });

  it('placeFlyout writes left and max-width in zoomed px under a UI scale', () => {
    const { root } = setup();
    applyUiScale(1.25);
    document.documentElement.style.setProperty('--side-panel-w', '500px');
    Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true });
    const bar = root.querySelector('.toolbar') as HTMLElement;
    const body = root.querySelector('.tb-body, .tb-flyout') as HTMLElement;
    bar.getBoundingClientRect = () => ({ left: 400, width: 600, top: 0, right: 1000, bottom: 40, height: 40, x: 400, y: 0, toJSON() {} });
    body.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, right: 300, bottom: 40, height: 40, x: 0, y: 0, toJSON() {} });
    tab(root, 'manufacture');
    // screen px: max = 1366 - 500 - 16 = 850; left = min(400 + 300 - 150, 1366 - 500 - 8 - 300) = 550
    expect(body.style.maxWidth).toBe(`${850 / 1.25}px`);
    expect(body.style.left).toBe(`${Math.round((550 - 400 - 2.5) / 1.25)}px`);
    applyUiScale(1);
    document.documentElement.style.removeProperty('--side-panel-w');
  });
});
