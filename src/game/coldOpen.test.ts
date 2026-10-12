// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/state';
import type { GameState, Speed } from '../sim/types';
import { DEFAULT_ZOOM } from '../render/camera';
import { biggestCity } from './autoplay';
import { cameraAt, coldOpenScript, playColdOpen } from './coldOpen';
import type { GameController } from './controller';

describe('coldOpenScript', () => {
  const state = createGame({ seed: 7 });
  const steps = coldOpenScript(state);

  it('has 4 steps with increasing times, ending at 7500 ms', () => {
    expect(steps).toHaveLength(4);
    for (let i = 1; i < steps.length; i++) expect(steps[i].atMs).toBeGreaterThan(steps[i - 1].atMs);
    expect(steps[3].atMs).toBe(7500);
    expect(steps[3].camera).toBeUndefined();
  });

  it('opens wide on the farthest city, then the Baron, then the player at the play zoom', () => {
    const start = biggestCity(state.cities)!;
    expect(steps[0]).toMatchObject({ atMs: 0, camera: { zoom: 0.6 } });
    const far = Math.max(...state.cities.map((c) => Math.hypot(c.center.x - start.center.x, c.center.y - start.center.y)));
    const c0 = steps[0].camera!;
    expect(Math.hypot(c0.x - 0.5 - start.center.x, c0.y - 0.5 - start.center.y)).toBeCloseTo(far);
    expect(steps[1]).toMatchObject({ atMs: 2500, card: 'baron', text: "Smogsworth: 'This valley is mine, upstart.'" });
    expect(steps[2]).toMatchObject({ atMs: 5000, card: 'family', text: state.companies.player.name });
    expect(steps[2].camera).toEqual({ x: start.center.x + 0.5, y: start.center.y + 0.5, zoom: DEFAULT_ZOOM });
  });

  it('every shot is somewhere new, so the camera always travels', () => {
    for (const seed of [1, 7, 42, 123]) {
      const [a, b, c] = coldOpenScript(createGame({ seed })).map((s) => s.camera!);
      expect(b).not.toMatchObject({ x: a.x, y: a.y });
      expect(b).not.toMatchObject({ x: c.x, y: c.y });
    }
  });

  it('reduced motion cuts straight to each shot', () => {
    expect(cameraAt(steps, 2501, true)).toEqual(steps[1].camera);
    expect(cameraAt(steps, 5001, true)).toEqual(steps[2].camera);
    expect(cameraAt(steps, 2000, true)).toEqual(steps[0].camera);
  });

  it('the camera eases between keyframes and lands exactly on each', () => {
    const at = (t: number) => cameraAt(steps, t);
    expect(at(0).zoom).toBeCloseTo(0.6);
    expect(at(7500)).toEqual(steps[2].camera);
    expect(at(4600)).toEqual(steps[1].camera);
    // ease-in-out: slow at the ends of a move, fast in the middle
    const d = (a: number, b: number) => Math.hypot(at(b).x - at(a).x, at(b).y - at(a).y);
    expect(d(5000, 5100)).toBeLessThan(d(5900, 6000));
    expect(d(6800, 6900)).toBeLessThan(d(5900, 6000));
  });
});

/** The parts of GameController the cold open drives. */
function stubGame(state: GameState) {
  const hooks = new Set<(now: number) => void>();
  const disposers: (() => void)[] = [];
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const game = {
    ctx: { state, bus: { emit: () => {} } },
    get state() {
      return state;
    },
    get map() {
      return state.map;
    },
    camera: { x: 0, y: 0, zoom: DEFAULT_ZOOM, viewW: 1280, viewH: 720 },
    uiRoot,
    setSpeed(s: Speed) {
      state.speed = s;
    },
    addFrameHook(fn: (now: number) => void) {
      hooks.add(fn);
      return () => hooks.delete(fn);
    },
    addDisposer: (fn: () => void) => disposers.push(fn),
  };
  return { game: game as unknown as GameController, hooks, uiRoot };
}

describe('playColdOpen', () => {
  it('a stalled frame slows the camera down instead of jumping it', () => {
    const state = createGame({ seed: 7 });
    const { game, hooks } = stubGame(state);
    const cancel = playColdOpen(game, () => {});
    const tick = (now: number) => [...hooks].forEach((fn) => fn(now));
    for (let now = 0; now <= 3000; now += 16) tick(now);
    const before = game.camera.zoom;
    tick(3500); // a 500 ms frame mid-pan
    const steps = coldOpenScript(state);
    expect(Math.abs(game.camera.zoom - before)).toBeLessThan(Math.abs(cameraAt(steps, 3500).zoom - cameraAt(steps, 3000).zoom) / 4);
    cancel();
  });

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Escape skips at once: onDone exactly once, speed restored, everything removed', () => {
    const state = createGame({ seed: 7 });
    state.speed = 2;
    const { game, hooks, uiRoot } = stubGame(state);
    const onDone = vi.fn();
    const cancel = playColdOpen(game, onDone);
    expect(state.speed).toBe(0);
    expect(uiRoot.querySelector('.coldopen')).not.toBeNull();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(state.speed).toBe(2);
    expect(ev.defaultPrevented).toBe(true);
    expect(uiRoot.querySelector('.coldopen')).toBeNull();
    expect(hooks.size).toBe(0);
    // the camera ends where play begins
    expect(game.camera.zoom).toBe(DEFAULT_ZOOM);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    cancel();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the skipping key never reaches the game input (Space must not toggle pause)', () => {
    const state = createGame({ seed: 7 });
    const { game } = stubGame(state);
    const later = vi.fn();
    window.addEventListener('keydown', later);
    playColdOpen(game, () => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(later).not.toHaveBeenCalled();
    window.removeEventListener('keydown', later);
  });

  it('a click skips and is swallowed', () => {
    const state = createGame({ seed: 7 });
    const { game, uiRoot } = stubGame(state);
    const onDone = vi.fn();
    playColdOpen(game, onDone);
    const layer = uiRoot.querySelector<HTMLElement>('.coldopen')!;
    const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    layer.dispatchEvent(ev);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('cancel removes the card, listeners and frame hook without calling onDone', () => {
    const state = createGame({ seed: 7 });
    state.speed = 4;
    const { game, hooks, uiRoot } = stubGame(state);
    const onDone = vi.fn();
    const cancel = playColdOpen(game, onDone);
    cancel();
    expect(onDone).not.toHaveBeenCalled();
    expect(uiRoot.querySelector('.coldopen')).toBeNull();
    expect(hooks.size).toBe(0);
    expect(state.speed).toBe(4);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('runs to the end on its own and finishes once', () => {
    const state = createGame({ seed: 7 });
    state.speed = 1;
    const { game, hooks, uiRoot } = stubGame(state);
    const onDone = vi.fn();
    playColdOpen(game, onDone);
    // 60 fps frames from now = 1000 (the intro's clock starts at its first frame)
    let now = 1000;
    const runTo = (until: number) => {
      for (; now <= until; now += 16) [...hooks].forEach((fn) => fn(now));
    };
    runTo(3600);
    expect(uiRoot.querySelector('.coldopen-card')?.textContent).toContain('Smogsworth');
    runTo(6100);
    expect(uiRoot.querySelector('.coldopen-card')?.textContent).toContain(state.companies.player.name);
    runTo(9000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(state.speed).toBe(1);
    expect(game.camera.zoom).toBe(DEFAULT_ZOOM);
  });
});
