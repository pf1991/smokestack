// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flatMap } from '../sim/testkit';
import { Input, type InputHost } from '../game/input';
import { closeHelp, isHelpOpen } from './help';
import { SHORTCUTS, shortcutFor, withShortcut } from './shortcuts';

function key(k: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

const live: (() => void)[] = [];
afterEach(() => {
  closeHelp();
  for (const d of live.splice(0)) d();
});

function setup() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const host = {
    camera: { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 },
    map: flatMap(50, 50),
    tools: { pointerDown: vi.fn(), pointerMove: vi.fn(), pointerUp: vi.fn(), leave: vi.fn(), cancel: vi.fn() },
    setSpeed: vi.fn(),
    togglePause: vi.fn(),
    setTool: vi.fn(),
    toggleToolbar: vi.fn(),
    closeDrawer: vi.fn(),
    escape: vi.fn(),
    togglePhotoMode: vi.fn(),
    toggleOverlay: vi.fn(),
    tryOpenPanel: vi.fn(() => true),
    toggleAlerts: vi.fn(),
  } satisfies InputHost;
  const input = new Input(canvas, host);
  live.push(() => {
    input.destroy();
    canvas.remove();
  });
  return host;
}

describe('shortcut registry', () => {
  it('no two shortcuts share a key', () => {
    const keys = SHORTCUTS.map((s) => s.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('formats titles', () => {
    expect(withShortcut('Finance', 'panel', 'finance')).toBe('Finance (F)');
    expect(withShortcut('Pause', 'pause')).toBe('Pause (Space)');
    expect(shortcutFor('speed', '8')).toBe('4');
    expect(shortcutFor('panel', 'nope')).toBeNull();
    expect(withShortcut('Nope', 'panel', 'nope')).toBe('Nope');
  });
});

describe('shortcut keys through Input', () => {
  it('G opens goals, C contracts, 3 sets speed 4', () => {
    const host = setup();
    key('g');
    expect(host.tryOpenPanel).toHaveBeenCalledWith('goals');
    key('c');
    expect(host.tryOpenPanel).toHaveBeenCalledWith('contracts');
    key('3');
    expect(host.setSpeed).toHaveBeenCalledWith(4);
  });

  it('T toggles the alerts tray through the host and A still pans', () => {
    const host = setup();
    key('t');
    expect(host.toggleAlerts).toHaveBeenCalledTimes(1);
    expect(withShortcut('Alerts', 'alerts')).toBe('Alerts (T)');
    key('a');
    expect(host.toggleAlerts).toHaveBeenCalledTimes(1);
  });

  it('M and K toggle the overlays through the host', () => {
    const host = setup();
    key('m');
    key('k');
    expect(host.toggleOverlay).toHaveBeenNthCalledWith(1, 'pollution');
    expect(host.toggleOverlay).toHaveBeenNthCalledWith(2, 'factions');
  });

  it('? opens the help overlay at z 4500 and Esc closes it without reaching the host', () => {
    const host = setup();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    key('?');
    expect(isHelpOpen()).toBe(true);
    const modal = document.querySelector<HTMLElement>('.help-modal');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Finance');
    expect(modal?.textContent).toContain('Left-drag');
    expect(document.activeElement?.classList.contains('help-card')).toBe(true);
    key('f');
    expect(host.tryOpenPanel).not.toHaveBeenCalled();
    key('Escape');
    expect(isHelpOpen()).toBe(false);
    expect(host.escape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });

  it('H toggles help and a click outside the card closes it', () => {
    setup();
    key('h');
    expect(isHelpOpen()).toBe(true);
    const modal = document.querySelector<HTMLElement>('.help-modal') as HTMLElement;
    modal.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(isHelpOpen()).toBe(false);
  });

  it('never fires while typing in an input', () => {
    const host = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    for (const k of ['g', '?', 'm', ' ', '2']) key(k, input);
    expect(host.tryOpenPanel).not.toHaveBeenCalled();
    expect(host.toggleOverlay).not.toHaveBeenCalled();
    expect(host.togglePause).not.toHaveBeenCalled();
    expect(isHelpOpen()).toBe(false);
    input.remove();
  });
});

describe('Hud titles', () => {
  it('buttons carry shortcut titles and toggleOverlay presses the Smog button', async () => {
    const { Hud } = await import('./hud');
    const root = document.createElement('div');
    const hud = new Hud(root, { onSpeed: vi.fn(), onOpenPanel: vi.fn() });
    expect(root.querySelector('[data-panel="finance"]')?.getAttribute('title')).toBe('Finance (F)');
    expect(root.querySelector('[data-speed="8"]')?.getAttribute('title')).toBe('Fastest (4)');
    const smog = root.querySelector('.hud-smog') as HTMLElement;
    hud.toggleOverlay('pollution');
    expect(smog.getAttribute('aria-pressed')).toBe('true');
    hud.toggleOverlay('pollution');
    expect(smog.getAttribute('aria-pressed')).toBe('false');
  });
});
