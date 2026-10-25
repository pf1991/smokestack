// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flatMap } from '../sim/testkit';
import { isHelpOpen, openHelp } from '../ui/help';
import { Input, type InputHost } from './input';

function pointer(
  target: HTMLElement,
  type: string,
  button: number,
  x = 100,
  y = 100,
  id = 1,
  pointerType = 'mouse',
): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

function key(k: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

function setup(photoActive: boolean, activeToolKind = 'inspect') {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const host = {
    camera: { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 },
    map: flatMap(200, 200),
    tools: {
      pointerDown: vi.fn(),
      pointerMove: vi.fn(),
      pointerUp: vi.fn(),
      tap: vi.fn(),
      leave: vi.fn(),
      cancel: vi.fn(),
      abortDrag: vi.fn(),
      hasAnchor: false,
    },
    setSpeed: vi.fn(),
    togglePause: vi.fn(),
    setTool: vi.fn(),
    toggleToolbar: vi.fn(),
    closeDrawer: vi.fn(),
    escape: vi.fn(),
    togglePhotoMode: vi.fn(),
    tryOpenPanel: vi.fn(() => true),
    photoActive,
    activeToolKind,
    onManualPan: vi.fn(),
  } satisfies InputHost & { photoActive: boolean };
  const input = new Input(canvas, host);
  live.push(() => {
    input.destroy();
    canvas.remove();
  });
  return { canvas, host, input };
}

const live: (() => void)[] = [];
afterEach(() => {
  for (const d of live.splice(0)) d();
});

describe('Input.destroy', () => {
  it('closes the help overlay', () => {
    const { input } = setup(false);
    openHelp();
    expect(isHelpOpen()).toBe(true);
    input.destroy();
    expect(isHelpOpen()).toBe(false);
  });
});

describe('Input in photo mode', () => {
  it('Delete then a left click reaches no tool (nothing is demolished)', () => {
    const { canvas, host } = setup(true);
    key('Delete');
    pointer(canvas, 'pointerdown', 0);
    pointer(canvas, 'pointerup', 0);
    expect(host.setTool).not.toHaveBeenCalled();
    expect(host.tools.pointerDown).not.toHaveBeenCalled();
    expect(host.tools.pointerUp).not.toHaveBeenCalled();
  });

  it('a left click opens no inspector, hover sets no ghost; left-drag pans instead', () => {
    const { canvas, host } = setup(true);
    pointer(canvas, 'pointermove', -1, 50, 50);
    expect(host.tools.pointerMove).not.toHaveBeenCalled();
    pointer(canvas, 'pointerdown', 0, 100, 100);
    pointer(canvas, 'pointermove', 0, 60, 100);
    pointer(canvas, 'pointerup', 0, 60, 100);
    expect(host.tools.pointerDown).not.toHaveBeenCalled();
    expect(host.camera.x).toBe(40);
  });

  it('swallows panel, speed, toolbar and pause keys', () => {
    const { host } = setup(true);
    for (const k of ['r', 'f', 'n', 'v', 'b', ' ', '2']) key(k);
    expect(host.tryOpenPanel).not.toHaveBeenCalled();
    expect(host.toggleToolbar).not.toHaveBeenCalled();
    expect(host.togglePause).not.toHaveBeenCalled();
    expect(host.setSpeed).not.toHaveBeenCalled();
  });

  it('P, Esc and the arrow keys still work', () => {
    const { host, input } = setup(true);
    key('p');
    expect(host.togglePhotoMode).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(host.escape).toHaveBeenCalledTimes(1);
    key('ArrowRight');
    input.update(100);
    expect(host.camera.x).toBeGreaterThan(0);
  });

  it('wheel zoom and right-drag pan keep working', () => {
    const { canvas, host, input } = setup(true);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }));
    input.update(500);
    expect(host.camera.zoom).toBeGreaterThan(1);
    const z = host.camera.zoom;
    pointer(canvas, 'pointerdown', 2, 100, 100);
    pointer(canvas, 'pointermove', 2, 100, 100 - 10 * z);
    pointer(canvas, 'pointerup', 2, 100, 100 - 10 * z);
    expect(host.camera.y).toBeGreaterThan(0);
  });

  it('outside photo mode a left click reaches the tool and Delete picks the bulldozer', () => {
    const { canvas, host } = setup(false, 'bulldoze');
    key('Delete');
    pointer(canvas, 'pointerdown', 0);
    expect(host.setTool).toHaveBeenCalledWith({ kind: 'bulldoze' });
    expect(host.tools.pointerDown).toHaveBeenCalledTimes(1);
  });
});

describe('Input left-drag in inspect', () => {
  it('a 3px jitter is a click: one pointerDown + pointerUp at the press tile, camera unchanged', () => {
    const { canvas, host } = setup(false);
    pointer(canvas, 'pointerdown', 0, 100, 100);
    pointer(canvas, 'pointermove', 0, 103, 100);
    pointer(canvas, 'pointerup', 0, 103, 100);
    expect(host.tools.pointerDown).toHaveBeenCalledTimes(1);
    expect(host.tools.pointerUp).toHaveBeenCalledTimes(1);
    expect(host.tools.pointerDown.mock.calls[0][0]).toEqual({ x: 3, y: 3 });
    expect(host.tools.pointerUp.mock.calls[0][0]).toEqual({ x: 3, y: 3 });
    expect(host.camera.x).toBe(0);
    expect(host.camera.y).toBe(0);
  });

  it('a 40px drag pans by 40/zoom and calls no tool', () => {
    const { canvas, host } = setup(false);
    host.camera.zoom = 2;
    host.camera.x = 100;
    pointer(canvas, 'pointerdown', 0, 300, 100);
    pointer(canvas, 'pointermove', 0, 260, 100);
    pointer(canvas, 'pointerup', 0, 260, 100);
    expect(host.camera.x).toBe(120);
    expect(host.tools.pointerDown).not.toHaveBeenCalled();
    expect(host.tools.pointerUp).not.toHaveBeenCalled();
    expect(host.onManualPan).toHaveBeenCalled();
  });

  it('cursor is grab on hover and grabbing while panning', () => {
    const { canvas } = setup(false);
    pointer(canvas, 'pointermove', -1, 50, 50);
    expect(canvas.style.cursor).toBe('grab');
    pointer(canvas, 'pointerdown', 0, 100, 100);
    pointer(canvas, 'pointermove', 0, 140, 100);
    expect(canvas.style.cursor).toBe('grabbing');
    pointer(canvas, 'pointerup', 0, 140, 100);
    expect(canvas.style.cursor).toBe('grab');
  });
});

describe('Input with other tools', () => {
  it('a left drag with the road tool reaches the tool as before', () => {
    const { canvas, host } = setup(false, 'road');
    pointer(canvas, 'pointerdown', 0, 100, 100);
    pointer(canvas, 'pointermove', 0, 200, 100);
    pointer(canvas, 'pointerup', 0, 200, 100);
    expect(host.tools.pointerDown).toHaveBeenCalledTimes(1);
    expect(host.tools.pointerMove).toHaveBeenCalledTimes(1);
    expect(host.tools.pointerUp).toHaveBeenCalledTimes(1);
    expect(host.camera.x).toBe(0);
  });

  it('a right drag pans with the road tool', () => {
    const { canvas, host } = setup(false, 'road');
    pointer(canvas, 'pointerdown', 2, 100, 100);
    pointer(canvas, 'pointermove', 2, 60, 100);
    pointer(canvas, 'pointerup', 2, 60, 100);
    expect(host.camera.x).toBe(40);
    expect(host.tools.pointerDown).not.toHaveBeenCalled();
  });

  it('a right click without movement cancels pick mode', () => {
    const { canvas, host } = setup(false, 'pickStop');
    pointer(canvas, 'pointerdown', 2);
    pointer(canvas, 'pointerup', 2);
    expect(host.tools.cancel).toHaveBeenCalledTimes(1);
  });

  it('ctrl+wheel (pinch) zooms by exp(-deltaY*0.01)', () => {
    const { canvas, host, input } = setup(false);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, ctrlKey: true, clientX: 400, clientY: 300, cancelable: true }));
    input.update(2000);
    expect(host.camera.zoom).toBeCloseTo(Math.exp(0.2), 2);
  });
});

describe('Input map-first touch', () => {
  it('a finger drag pans even with the road tool (never draws while dragging)', () => {
    const { canvas, host } = setup(false, 'road');
    pointer(canvas, 'pointerdown', 0, 100, 100, 1, 'touch');
    pointer(canvas, 'pointermove', 0, 40, 100, 1, 'touch');
    pointer(canvas, 'pointerup', 0, 40, 100, 1, 'touch');
    expect(host.camera.x).toBe(60);
    expect(host.tools.tap).not.toHaveBeenCalled();
    expect(host.tools.pointerDown).not.toHaveBeenCalled();
  });

  it('a finger tap calls tools.tap, not pointerDown', () => {
    const { canvas, host } = setup(false, 'build');
    pointer(canvas, 'pointerdown', 0, 100, 100, 1, 'touch');
    pointer(canvas, 'pointerup', 0, 100, 100, 1, 'touch');
    expect(host.tools.tap).toHaveBeenCalledTimes(1);
    expect(host.tools.pointerDown).not.toHaveBeenCalled();
  });

  it('pinch still zooms; a second finger does not need to “own” panning', () => {
    const { canvas, host, input } = setup(false, 'road');
    pointer(canvas, 'pointerdown', 0, 100, 100, 1, 'touch');
    pointer(canvas, 'pointerdown', 0, 200, 100, 2, 'touch');
    pointer(canvas, 'pointermove', 0, 100, 100, 1, 'touch');
    pointer(canvas, 'pointermove', 0, 300, 100, 2, 'touch');
    input.update(500);
    expect(host.camera.zoom).toBeGreaterThan(1);
    pointer(canvas, 'pointerup', 0, 100, 100, 1, 'touch');
    pointer(canvas, 'pointerup', 0, 300, 100, 2, 'touch');
  });
});
