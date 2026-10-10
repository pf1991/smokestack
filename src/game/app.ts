import type { GameState } from '../sim/types';
import { Ticker } from '../ui/ticker';
import { attachNewspaper } from '../ui/panels/newspaper';
import { closePauseMenu, MainMenu, openPauseMenu, showEndScreen, type PauseHost } from '../ui/menu';
import { GameController, type NewGameOpts } from './controller';
import { createGame } from '../sim/state';

/**
 * Application shell: owns the canvas and UI root and switches between the main menu and a running
 * game. Every switch destroys the previous GameController (loop, input listeners, windows, audio)
 * before the next one is built, so nothing keeps ticking or listening behind the new screen.
 */
export class App implements PauseHost {
  private game: GameController | null = null;
  private menu: MainMenu | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: HTMLElement,
  ) {}

  get current(): GameController | null {
    return this.game;
  }

  private teardown(): void {
    closePauseMenu();
    document.querySelectorAll('.mn-modal').forEach((el) => el.remove());
    this.menu?.destroy();
    this.menu = null;
    this.game?.destroy();
    this.game = null;
  }

  showMenu(): MainMenu {
    this.teardown();
    this.menu = new MainMenu(this.canvas, this.ui, this);
    return this.menu;
  }

  quitToMenu(): void {
    this.showMenu();
  }

  startNew(opts: NewGameOpts): void {
    this.start(createGame(opts));
  }

  startLoaded(state: GameState): void {
    this.start(state);
  }

  /** Builds a fresh controller around `state`; `setup` runs after it is loaded (debug hooks). */
  start(state: GameState, setup?: (game: GameController) => void): GameController {
    this.teardown();
    const game = new GameController(this.canvas, this.ui);
    this.game = game;
    game.onPause = () => openPauseMenu(game, this);
    game.load(state);
    Ticker.attach(document.getElementById('ticker')!, game.ctx.bus, game.state.news);
    attachNewspaper(game);
    game.ctx.bus.on('victory', (e) => showEndScreen('victory', e.reason, this, () => {}));
    game.ctx.bus.on('gameOver', (e) => showEndScreen('gameOver', e.reason, this, () => {}));
    if (import.meta.env.DEV) (window as unknown as { game: GameController }).game = game;
    setup?.(game);
    return game;
  }
}
