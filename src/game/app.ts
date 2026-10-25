import type { GameState } from '../sim/types';
import { Ticker } from '../ui/ticker';
import { attachNewspaper } from '../ui/panels/newspaper';
import { closeModal, MainMenu, openPauseMenu, showEndScreen, type PauseHost } from '../ui/menu';
import { GameController, type NewGameOpts } from './controller';
import { createGame } from '../sim/state';
import { AmbitionsCard, shouldOfferAmbitionsCard } from '../ui/ambitionsCard';
import { shouldOfferTutorial, tutorialStatus, Tutorial } from '../ui/tutorial';
import { playColdOpen } from './coldOpen';
import { loadSettings } from './settings';

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
    closeModal();
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

  /**
   * New Game: plays the cold open (unless "Skip intro" is set), then offers the tutorial, so the
   * tutorial card never sits on top of the intro. Loads and debug starts go through start() and
   * never play the intro.
   */
  startNew(opts: NewGameOpts): void {
    const game = this.start(createGame(opts));
    // new Free Play games get the tutorial until it has been skipped or finished once
    const tutorial = shouldOfferTutorial(game.state.scenarioId);
    const then = () => {
      if (tutorial) this.showTutorial(game);
      else this.offerAmbitionsCard(game);
    };
    if (loadSettings().skipIntro) then();
    else this.playIntro(game, then);
  }

  /** Plays the cold open on `game`, then `onDone`; leaving the game mid-intro cancels it. */
  playIntro(game: GameController, onDone: () => void = () => {}): void {
    game.addDisposer(playColdOpen(game, onDone));
  }

  /** Shows the tutorial card for `game`; ambitions card follows when it ends. */
  showTutorial(game: GameController): Tutorial {
    const tutorial = new Tutorial(game.uiRoot, () => game.state, {
      onEnd: () => this.offerAmbitionsCard(game),
    });
    game.addDisposer(() => tutorial.destroy());
    return tutorial;
  }

  /**
   * Soft "Next ambitions" brass card once per browser after Free Play tutorial is done/skipped.
   * Torn down with the game.
   */
  offerAmbitionsCard(game: GameController): AmbitionsCard | null {
    const tutDone = tutorialStatus() === 'done' || tutorialStatus() === 'skipped';
    if (!shouldOfferAmbitionsCard(game.state.scenarioId, tutDone)) return null;
    const card = new AmbitionsCard(game.uiRoot);
    game.addDisposer(() => card.destroy());
    return card;
  }

  /** Starts a loaded save; if it still breaks the game while starting, falls back to the menu with a message. */
  startLoaded(state: GameState): void {
    try {
      this.start(state);
    } catch {
      this.showMenu().showError('Save file is corrupted');
    }
  }

  /** Builds a fresh controller around `state`; `setup` runs after it is loaded (debug hooks). */
  start(state: GameState, setup?: (game: GameController) => void): GameController {
    this.teardown();
    const game = new GameController(this.canvas, this.ui);
    this.game = game;
    game.onPause = (screen) => openPauseMenu(game, this, screen);
    game.load(state);
    game.addDisposer(Ticker.attach(document.getElementById('ticker')!, game.ctx.bus, game.state.news, () => game.openPanel('newspaper')));
    attachNewspaper(game);
    game.ctx.bus.on('victory', (e) => showEndScreen('victory', e.reason, this, () => {}, game.state));
    game.ctx.bus.on('gameOver', (e) => showEndScreen('gameOver', e.reason, this, () => {}, game.state));
    if (import.meta.env.DEV) (window as unknown as { game: GameController }).game = game;
    setup?.(game);
    return game;
  }
}
