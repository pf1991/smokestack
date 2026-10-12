// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ZOOM } from '../render/camera';
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
  const game = {
    state,
    camera: { x: 0, y: 0, zoom: DEFAULT_ZOOM, viewW: 1280, viewH: 720 },
    uiRoot,
    canvas: document.createElement('canvas'),
    overlay: document.createElement('canvas'),
    ctx: { state, bus: { emit: (e: { message: string }) => toasts.push(e) } },
    setSpeed(s: Speed) {
      state.speed = s;
    },
    addDisposer: (fn: () => void) => disposers.push(fn),
  } as unknown as GameController;
  return { game, toasts, uiRoot, disposers };
}

afterEach(() => {
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
});
