// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ZOOM, TILE } from '../render/camera';
import { createGame } from '../sim/state';
import type { GameState, Speed } from '../sim/types';
import type { GameController } from './controller';
import { enterPhotoMode, photoCaption } from './photoMode';

function stateAt(month: number, year = 1925): GameState {
  const s = createGame({ seed: 7 });
  s.date.year = year;
  s.date.month = month;
  s.cities[0].name = 'Ashford';
  return s;
}

function stub(state: GameState) {
  const toasts: { message: string }[] = [];
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const disposers: (() => void)[] = [];
  const hooks = new Set<(now: number) => void>();
  const renderer = {
    uiHidden: false,
    selection: { buildingId: 1 } as unknown,
    setSelection: vi.fn((sel: unknown) => {
      renderer.selection = sel;
    }),
    setUiHidden: vi.fn((v: boolean) => {
      renderer.uiHidden = v;
    }),
  };
  const tools = { cancel: vi.fn() };
  const closeDrawer = vi.fn();
  const game = {
    renderer,
    tools,
    closeDrawer,
    state,
    camera: { x: 0, y: 0, zoom: DEFAULT_ZOOM, viewW: 1280, viewH: 720 },
    uiRoot,
    canvas: document.createElement('canvas'),
    overlay: document.createElement('canvas'),
    ctx: { state, bus: { emit: (e: { message: string }) => toasts.push(e) } },
    setSpeed(s: Speed) {
      state.speed = s;
    },
    addDisposer: (fn: () => void) => {
      disposers.push(fn);
      live.push(fn);
    },
    addFrameHook: (fn: (now: number) => void) => {
      hooks.add(fn);
      return () => hooks.delete(fn);
    },
  } as unknown as GameController;
  return { game, toasts, uiRoot, disposers, hooks, renderer, tools, closeDrawer };
}

const live: (() => void)[] = [];

afterEach(() => {
  for (const d of live.splice(0)) d();
  document.body.className = '';
  document.body.replaceChildren();
});

describe('photoCaption', () => {
  it('names the nearest city, season, year and era', () => {
    const s = stateAt(6);
    expect(photoCaption(s, s.cities[0].center)).toBe('Ashford, Summer 1925 — Roaring Age');
  });
  it('falls back to The Valley far from any city', () => {
    const s = stateAt(12);
    const far = { x: s.cities[0].center.x + 500, y: s.cities[0].center.y + 500 };
    expect(photoCaption(s, far).startsWith('The Valley, Winter')).toBe(true);
  });
  it('maps months to seasons', () => {
    const s = stateAt(3);
    const c = s.cities[0].center;
    const want: Record<number, string> = { 2: 'Winter', 3: 'Spring', 5: 'Spring', 6: 'Summer', 9: 'Autumn', 11: 'Autumn', 12: 'Winter' };
    for (const [m, season] of Object.entries(want)) {
      s.date.month = Number(m);
      expect(photoCaption(s, c)).toContain(season);
    }
  });
});

describe('enterPhotoMode', () => {
  it('pauses, restores the speed, and exit is idempotent', () => {
    const { game } = stub(stateAt(6));
    game.state.speed = 4;
    const exit = enterPhotoMode(game);
    expect(document.body.classList.contains('photo-mode')).toBe(true);
    expect(game.state.speed).toBe(0);
    expect(document.querySelector('.photo-bar')).not.toBeNull();
    exit();
    expect(document.body.classList.contains('photo-mode')).toBe(false);
    expect(game.state.speed).toBe(4);
    game.state.speed = 1;
    exit();
    expect(game.state.speed).toBe(1);
    expect(document.querySelector('.photo-bar')).toBeNull();
  });

  it('Esc exits and is swallowed before other handlers', () => {
    const { game } = stub(stateAt(6));
    const later = vi.fn();
    window.addEventListener('keydown', later);
    enterPhotoMode(game);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.classList.contains('photo-mode')).toBe(false);
    expect(later).not.toHaveBeenCalled();
    window.removeEventListener('keydown', later);
  });

  it('a failed export toasts and stays in photo mode', () => {
    const { game, toasts } = stub(stateAt(6));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    enterPhotoMode(game);
    document.querySelector<HTMLButtonElement>('.photo-export')!.click();
    expect(toasts.some((t) => t.message === 'Export failed')).toBe(true);
    expect(document.body.classList.contains('photo-mode')).toBe(true);
    vi.restoreAllMocks();
  });

  it('Esc after exit reaches later handlers', () => {
    const { game } = stub(stateAt(6));
    const later = vi.fn();
    window.addEventListener('keydown', later);
    enterPhotoMode(game)();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(later).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', later);
  });

  it('swallows Space and speed keys so the sim stays paused', () => {
    const { game } = stub(stateAt(6));
    const later = vi.fn();
    window.addEventListener('keydown', later);
    enterPhotoMode(game);
    for (const key of [' ', '2']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    expect(later).not.toHaveBeenCalled();
    window.removeEventListener('keydown', later);
  });

  it('the caption follows the camera', () => {
    const s = stateAt(6);
    const { game, hooks } = stub(s);
    const c = s.cities[0].center;
    const cam = game.camera;
    cam.x = (c.x + 0.5) * TILE - cam.viewW / cam.zoom / 2;
    cam.y = (c.y + 0.5) * TILE - cam.viewH / cam.zoom / 2;
    enterPhotoMode(game);
    expect(document.querySelector('.photo-caption')!.textContent).toContain('Ashford');
    cam.x += 100000;
    for (const fn of hooks) fn(1000);
    expect(document.querySelector('.photo-caption')!.textContent).toContain('The Valley');
  });

  it('destroy-time exit does not touch the speed', () => {
    const { game, disposers } = stub(stateAt(6));
    game.state.speed = 4;
    enterPhotoMode(game);
    game.state.speed = 0;
    const spy = vi.spyOn(game, 'setSpeed');
    for (const d of disposers) d();
    expect(spy).not.toHaveBeenCalled();
    expect(document.body.classList.contains('photo-mode')).toBe(false);
  });

  it('a successful export downloads the sanitised file and revokes the URL', () => {
    const { game, toasts } = stub(stateAt(6));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'])));
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = create;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revoke;
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    game.state.cities[0].name = "St. Ann's Ford";
    const cam = game.camera;
    const c = game.state.cities[0].center;
    cam.x = (c.x + 0.5) * TILE - cam.viewW / cam.zoom / 2;
    cam.y = (c.y + 0.5) * TILE - cam.viewH / cam.zoom / 2;
    enterPhotoMode(game);
    document.querySelector<HTMLButtonElement>('.photo-export')!.click();
    expect(create).toHaveBeenCalledTimes(1);
    expect(name).toBe('smokestack-1925-st-ann-s-ford.png');
    expect(revoke).toHaveBeenCalledWith('blob:x');
    expect(toasts.some((t) => t.message === 'Photo saved')).toBe(true);
    vi.restoreAllMocks();
  });

  it('entering cancels the tool, clears the selection, closes the drawer and hides the tool UI', () => {
    const { game, renderer, tools, closeDrawer } = stub(stateAt(6));
    const exit = enterPhotoMode(game);
    expect(tools.cancel).toHaveBeenCalledTimes(1);
    expect(renderer.selection).toBeNull();
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(renderer.uiHidden).toBe(true);
    exit();
    expect(renderer.uiHidden).toBe(false);
  });

  it('swallows every key except Esc, P and the pan keys', () => {
    const { game } = stub(stateAt(6));
    const later = vi.fn();
    window.addEventListener('keydown', later);
    enterPhotoMode(game);
    for (const key of ['Delete', 'r', 'n', 'b', 'f', 'v', 'x']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    expect(later).not.toHaveBeenCalled();
    const passed = ['p', 'P', 'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    for (const key of passed) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    expect(later.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual(passed);
    window.removeEventListener('keydown', later);
  });

  it('the export composites the world and overlay with the tool UI hidden, then the frame', () => {
    const { game, renderer } = stub(stateAt(6));
    const calls: string[] = [];
    const g = new Proxy({} as Record<string, unknown>, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (prop === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (prop === 'drawImage') {
          return (src: unknown) => {
            const name = src === game.canvas ? 'world' : src === game.overlay ? 'overlay' : 'other';
            calls.push(`${name}:${renderer.uiHidden ? 'clean' : 'ui'}:${renderer.selection === null ? 'nosel' : 'sel'}`);
          };
        }
        return () => {};
      },
      set(target, prop, v) {
        target[prop as string] = v;
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(g as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {});
    enterPhotoMode(game);
    document.querySelector<HTMLButtonElement>('.photo-export')!.click();
    expect(calls).toEqual(['world:clean:nosel', 'overlay:clean:nosel']);
    vi.restoreAllMocks();
  });
});
