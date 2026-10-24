// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOODS } from '../data/goods';
import { createGame } from '../sim/state';
import { goodIcon, goodTip, goodTooltip } from './goodTooltip';
import { Toolbar } from './toolbar';

/* The project has no node typings, hence the untyped dynamic import (see cssGate.test.ts). */
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(p: string, enc: string): string };
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('goodTooltip module', () => {
  it('goodIcon is the atlas icon for a painted good', () => {
    expect(goodIcon('bread', 16).matches('img.icon')).toBe(true);
  });

  it('goodIcon falls back to one colour chip class, sized and labelled', () => {
    const g = GOODS as Record<string, unknown>;
    g.zz_test = { ...GOODS.bread, id: 'zz_test', name: 'Test Good', color: '#123456' };
    try {
      const chip = goodIcon('zz_test', 20, 'Test Good');
      expect(chip.className).toBe('good-chip');
      expect(chip.style.width).toBe('20px');
      expect(chip.style.getPropertyValue('--chip')).toBe('#123456');
      expect(chip.getAttribute('aria-label')).toBe('Test Good');
      expect(goodIcon('zz_test').getAttribute('aria-hidden')).toBe('true');
    } finally {
      delete g.zz_test;
    }
  });

  it('goodTooltip names the good and what it is made from', () => {
    expect(goodTooltip('bread').textContent).toContain('Made from Flour + Milk in Bakery');
  });

  it("goodTip parks the host's native title while the pointer is on the good, then restores it", () => {
    const host = document.createElement('button');
    host.title = 'Sawmill: makes lumber';
    const good = document.createElement('span');
    host.append(good);
    document.body.append(host);
    const off = goodTip(good, 'lumber');
    good.dispatchEvent(new Event('pointerenter'));
    expect(host.hasAttribute('title')).toBe(false);
    good.dispatchEvent(new Event('pointerleave'));
    expect(host.title).toBe('Sawmill: makes lumber');
    good.dispatchEvent(new Event('pointerenter'));
    off();
    expect(host.title).toBe('Sawmill: makes lumber');
  });

  it('a build-bar recipe icon hides the tool card title while its good tooltip shows', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const tb = new Toolbar(root, () => {});
    tb.update(createGame({ seed: 1 }));
    (root.querySelector('[data-tab="refine"]') as HTMLElement).click();
    const card = root.querySelector<HTMLElement>('.tool-card[data-building="sawmill"]')!;
    const title = card.title;
    const lumber = card.querySelector<HTMLElement>('.tc-out [data-good="lumber"]')!;
    lumber.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(document.querySelector('.kit-tip--on')).not.toBeNull();
    expect(card.hasAttribute('title')).toBe(false);
    lumber.dispatchEvent(new Event('pointerleave'));
    expect(card.title).toBe(title);
    tb.closeDrawer();
  });

  it('the toolbar does not import the codex panel', () => {
    expect(readFileSync(`${cwd}/src/ui/toolbar.ts`, 'utf8')).not.toMatch(/panels\/codex/);
  });
});
