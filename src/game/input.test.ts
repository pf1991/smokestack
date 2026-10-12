// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flatMap } from '../sim/testkit';
import { Input, type InputHost } from './input';

function pointer(target: HTMLElement, type: string, button: number, x = 100, y = 100): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

function key(k: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

function setup(photoActive: boolean) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const host = {
    camera: { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 },
    map: flatMap(200, 200),
    tools: { pointerDown: vi.fn(), pointerMove: vi.fn(), pointerUp: vi.fn(), leave: vi.fn(), cancel: vi.fn() },
    setSpeed: vi.fn(),
    togglePause: vi.fn(),
    setTool: vi.fn(),
    toggleToolbar: vi.fn(),
    closeDrawer: vi.fn(),
    escape: vi.fn(),
    togglePhotoMode: vi.fn(),
    tryOpenPanel: vi.fn(() => true),
    photoActive,
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
    const { canvas, host } = setup(true);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }));
    expect(host.camera.zoom).toBeGreaterThan(1);
    const z = host.camera.zoom;
    pointer(canvas, 'pointerdown', 2, 100, 100);
    pointer(canvas, 'pointermove', 2, 100, 100 - 10 * z);
    pointer(canvas, 'pointerup', 2, 100, 100 - 10 * z);
    expect(host.camera.y).toBeGreaterThan(0);
  });

  it('outside photo mode a left click reaches the tool and Delete picks the bulldozer', () => {
    const { canvas, host } = setup(false);
    key('Delete');
    pointer(canvas, 'pointerdown', 0);
    expect(host.setTool).toHaveBeenCalledWith({ kind: 'bulldoze' });
    expect(host.tools.pointerDown).toHaveBeenCalledTimes(1);
  });
});
