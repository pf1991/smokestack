// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../sim/state';
import type { GameState } from '../sim/types';

const played: { onDone: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
vi.mock('./coldOpen', () => ({
  playColdOpen: vi.fn((_game: unknown, onDone: () => void) => {
    const cancel = vi.fn();
    played.push({ onDone, cancel });
    return cancel;
  }),
}));

const tutorials: unknown[] = [];
vi.mock('../ui/tutorial', () => ({
  shouldOfferTutorial: () => true,
  Tutorial: class {
    constructor() {
      tutorials.push(this);
    }
    destroy() {}
  },
}));
const tickerOff = vi.fn();
vi.mock('../ui/ticker', () => ({ Ticker: { attach: () => tickerOff } }));
vi.mock('../ui/panels/newspaper', () => ({ attachNewspaper: () => {} }));
vi.mock('../ui/menu', () => ({
  closeModal: () => {},
  MainMenu: class {
    destroy() {}
  },
  openPauseMenu: () => {},
  showEndScreen: () => {},
}));
vi.mock('./controller', () => ({
  GameController: class {
    state!: GameState;
    disposers: (() => void)[] = [];
    uiRoot = document.createElement('div');
    ctx = { bus: { on: () => () => {} } };
    onPause: unknown = null;
    load(s: GameState) {
      this.state = s;
    }
    addDisposer(fn: () => void) {
      this.disposers.push(fn);
    }
    destroy() {
      for (const fn of this.disposers) fn();
    }
  },
}));

const { App } = await import('./app');
const { playColdOpen } = await import('./coldOpen');

describe('App and the cold open', () => {
  beforeEach(() => {
    vi.mocked(playColdOpen).mockClear();
    played.length = 0;
    tutorials.length = 0;
    localStorage.clear();
  });

  const app = () => new App(document.createElement('canvas'), document.createElement('div'));

  it('loading a save never plays the cold open', () => {
    app().startLoaded(createGame({ seed: 7 }));
    expect(playColdOpen).not.toHaveBeenCalled();
  });

  it('a debug start never plays the cold open', () => {
    app().start(createGame({ seed: 7 }));
    expect(playColdOpen).not.toHaveBeenCalled();
  });

  it('New Game plays it and shows the tutorial only after it ends', () => {
    app().startNew({ seed: 7 });
    expect(playColdOpen).toHaveBeenCalledTimes(1);
    expect(tutorials).toHaveLength(0);
    played[0].onDone();
    expect(tutorials).toHaveLength(1);
  });

  it('leaving mid-intro cancels it', () => {
    const a = app();
    a.startNew({ seed: 7 });
    a.quitToMenu();
    expect(played[0].cancel).toHaveBeenCalled();
  });

  it('the ticker subscription is released when the game is torn down', () => {
    tickerOff.mockClear();
    const a = app();
    a.start(createGame({ seed: 7 }));
    expect(tickerOff).not.toHaveBeenCalled();
    a.start(createGame({ seed: 8 })); // a second game tears the first down
    expect(tickerOff).toHaveBeenCalledTimes(1);
  });

  it('"Skip intro" goes straight to the tutorial', () => {
    localStorage.setItem('smokestack:settings', JSON.stringify({ skipIntro: true }));
    app().startNew({ seed: 7 });
    expect(playColdOpen).not.toHaveBeenCalled();
    expect(tutorials).toHaveLength(1);
  });
});
