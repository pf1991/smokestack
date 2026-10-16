// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods';
import { ACHIEVEMENTS } from '../game/achievements';
import { iconEl } from '../ui/icon';
import { drawIcon, ICON_IDS, iconDataUrl } from './icons';

const UI_GLYPHS = [
  'close', 'lock', 'truck', 'train', 'money', 'warning', 'star', 'route',
  'factory', 'city', 'news', 'smog', 'play', 'pause', 'fast', 'permit', 'toll', 'wage', 'protest', 'strike',
];

/** A context that records every method call and accepts any property write. */
function mockCtx(): { g: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get: (t, k) => (k in t ? t[k] : (..._args: unknown[]) => { calls.push(String(k)); }),
    set: (t, k, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

describe('icon atlas', () => {
  it('covers every good, achievement icon and UI glyph', () => {
    const ids = new Set(ICON_IDS);
    for (const id of Object.keys(GOODS)) expect(ids, id).toContain(id);
    for (const a of ACHIEVEMENTS) expect(ids, a.id).toContain(a.icon);
    for (const id of UI_GLYPHS) expect(ids, id).toContain(id);
  });

  it.each([...ICON_IDS])('%s paints shapes and never text', (id) => {
    const { g, calls } = mockCtx();
    drawIcon(g, id, 0, 0, 16);
    expect(calls.some((c) => c === 'fill' || c === 'stroke' || c === 'fillRect' || c === 'strokeRect')).toBe(true);
    expect(calls).not.toContain('fillText');
    expect(calls).not.toContain('strokeText');
  });

  it('an unknown id still paints (a brass ? disc) without text', () => {
    const { g, calls } = mockCtx();
    drawIcon(g, 'no_such_icon', 4, 4, 24);
    expect(calls).toContain('fill');
    expect(calls).not.toContain('fillText');
  });

  it('iconDataUrl is empty under jsdom', () => {
    expect(iconDataUrl('wood', 16)).toBe('');
  });

  it('iconEl builds a labelled img', () => {
    const el = iconEl('wood', 20, 'Wood');
    expect(el.tagName).toBe('IMG');
    expect(el.getAttribute('alt')).toBe('Wood');
    expect(el.getAttribute('width')).toBe('20');
    expect(el.getAttribute('height')).toBe('20');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.classList.contains('icon')).toBe(true);
  });
});
