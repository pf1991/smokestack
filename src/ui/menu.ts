import { COMPANY_NAMES } from '../data/names';
import { ACHIEVEMENTS, loadUnlocked } from '../game/achievements';
import type { GameController, NewGameOpts } from '../game/controller';
import { listSaves, loadFrom, saveTo, SLOTS, type SaveInfo, type SaveSlot } from '../game/saves';
import { loadSettings, saveSettings } from '../game/settings';
import { goalProgress, SCENARIOS, type Goal } from '../sim/scenarios';
import type { GameState } from '../sim/types';
import { h } from './dom';
import { formatMoney } from './format';
import './menu.css';
import { MenuBackdrop } from './menuBackdrop';

/** What the menus need from the application shell. */
export interface MenuHost {
  startNew(opts: NewGameOpts): void;
  startLoaded(state: GameState): void;
}

export interface PauseHost extends MenuHost {
  quitToMenu(): void;
}

const SLOT_LABEL: Record<SaveSlot, string> = { auto: 'Autosave', slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3' };

const randomSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;
const randomName = () => COMPANY_NAMES[Math.floor(Math.random() * COMPANY_NAMES.length)];

function button(label: string, onClick: () => void, opts: { disabled?: boolean; cls?: string } = {}): HTMLElement {
  return h('button', { class: `btn mn-btn ${opts.cls ?? ''}`, disabled: opts.disabled, onClick }, label);
}

function goalText(g: Goal): string {
  const state = { flags: {}, companies: { player: { money: 0 } }, cities: [] } as unknown as GameState;
  return `${goalProgress(state, g).label} by ${g.byYear}`;
}

/** Slot list used by the Load screen (mode 'load') and the pause menu's Save screen (mode 'save'). */
function slotList(mode: 'load' | 'save', onPick: (slot: SaveSlot) => string | void): HTMLElement {
  const status = h('div', { class: 'mn-status' });
  const list = h('div', { class: 'mn-slots' });
  const fill = () => {
    const infos = new Map<SaveSlot, SaveInfo>(listSaves().map((i) => [i.slot, i]));
    list.replaceChildren(
      ...SLOTS.filter((s) => mode === 'load' || s !== 'auto').map((slot) => {
        const info = infos.get(slot);
        const meta = info
          ? h('span', { class: 'mn-slot-meta' }, h('b', null, info.company), ` - ${info.date} - ${formatMoney(info.money)}`)
          : h('span', { class: 'mn-slot-meta mn-empty' }, 'Empty slot');
        return h('div', { class: 'mn-slot' },
          h('span', { class: 'mn-slot-name' }, SLOT_LABEL[slot]),
          meta,
          button(mode === 'load' ? 'Load' : 'Save', () => {
            const msg = onPick(slot);
            if (typeof msg === 'string') status.textContent = msg;
            fill();
          }, { disabled: mode === 'load' && !info }));
      }),
    );
  };
  fill();
  return h('div', null, list, status);
}

function settingsView(onChange: (s: ReturnType<typeof loadSettings>) => void): HTMLElement {
  const s = loadSettings();
  const apply = () => {
    saveSettings(s);
    onChange(s);
  };
  const vol = h('input', {
    type: 'range', min: 0, max: 100, value: Math.round(s.volume * 100), 'aria-label': 'Master volume',
    onInput: (e: Event) => {
      s.volume = Number((e.target as HTMLInputElement).value) / 100;
      apply();
    },
  });
  const mute = h('input', {
    type: 'checkbox', checked: s.muted,
    onChange: (e: Event) => {
      s.muted = (e.target as HTMLInputElement).checked;
      apply();
    },
  });
  const news = h('input', {
    type: 'checkbox', checked: s.autoNews,
    onChange: (e: Event) => {
      s.autoNews = (e.target as HTMLInputElement).checked;
      apply();
    },
  });
  return h('div', { class: 'mn-form' },
    h('label', { class: 'mn-row' }, h('span', null, 'Master volume'), vol),
    h('label', { class: 'mn-row' }, h('span', null, 'Mute all sound'), mute),
    h('label', { class: 'mn-row' }, h('span', null, 'Open the newspaper automatically'), news));
}

function achievementsView(): HTMLElement {
  const got = loadUnlocked();
  return h('div', null,
    h('div', { class: 'mn-status' }, `${got.size} of ${ACHIEVEMENTS.length} unlocked`),
    h('div', { class: 'mn-ach' }, ACHIEVEMENTS.map((a) =>
      h('div', { class: `mn-ach-item ${got.has(a.id) ? 'got' : ''}` },
        h('span', { class: 'mn-ach-icon' }, got.has(a.id) ? a.icon : '🔒'),
        h('span', null, h('b', null, a.name), h('br'), a.desc)))));
}

// ---------------------------------------------------------------------------

type Screen = 'home' | 'new' | 'load' | 'achievements' | 'settings';

export class MainMenu {
  private readonly backdrop: MenuBackdrop | null;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private screen: Screen = 'home';
  private form = { name: randomName(), seed: randomSeed(), scenario: 'sandbox', rival: true };

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly host: MenuHost,
    opts: { backdrop?: boolean } = {},
  ) {
    this.backdrop = opts.backdrop === false ? null : new MenuBackdrop(canvas);
    this.body = h('div', { class: 'mn-body' });
    this.root = h('div', { class: 'mn-root' },
      h('div', { class: 'mn-vignette' }),
      h('div', { class: 'mn-center' },
        h('div', { class: 'mn-title-wrap' },
          h('div', { class: 'mn-rule' }, h('i'), h('b', null, '◆'), h('i')),
          h('h1', { class: 'mn-title' }, 'SMOKESTACK'),
          h('div', { class: 'mn-sub' }, 'An Industry Tycoon, 1900 - 2000'),
          h('div', { class: 'mn-rule' }, h('i'), h('b', null, '◆'), h('i'))),
        this.body));
    uiRoot.appendChild(this.root);
    this.show('home');
  }

  /** Switches to a sub-screen (also used by dev screenshot parameters). */
  show(screen: Screen): void {
    this.screen = screen;
    this.root.classList.toggle('mn-compact', screen !== 'home');
    const back = button('Back', () => this.show('home'), { cls: 'mn-back' });
    switch (screen) {
      case 'home':
        this.body.replaceChildren(this.home());
        break;
      case 'new':
        this.body.replaceChildren(this.newGame());
        break;
      case 'load':
        this.body.replaceChildren(
          h('h2', null, 'Load Game'),
          slotList('load', (slot) => {
            const r = loadFrom(slot);
            if (!r.ok) return r.error;
            this.host.startLoaded(r.value);
          }),
          back);
        break;
      case 'achievements':
        this.body.replaceChildren(h('h2', null, 'Achievements'), achievementsView(), back);
        break;
      case 'settings':
        this.body.replaceChildren(h('h2', null, 'Settings'), settingsView(() => {}), back);
        break;
    }
  }

  private home(): HTMLElement {
    const auto = listSaves().find((s) => s.slot === 'auto');
    return h('div', { class: 'mn-home' },
      button('New Game', () => this.show('new'), { cls: 'mn-primary' }),
      button(auto ? `Continue - ${auto.company}, ${auto.date}` : 'Continue', () => {
        const r = loadFrom('auto');
        if (r.ok) this.host.startLoaded(r.value);
      }, { disabled: !auto }),
      button('Load Game', () => this.show('load')),
      button('Achievements', () => this.show('achievements')),
      button('Settings', () => this.show('settings')));
  }

  private newGame(): HTMLElement {
    const f = this.form;
    const name = h('input', {
      type: 'text', value: f.name, maxlength: 32, 'aria-label': 'Company name',
      onInput: (e: Event) => (f.name = (e.target as HTMLInputElement).value),
    }) as HTMLInputElement;
    const seed = h('input', {
      type: 'text', value: String(f.seed), inputmode: 'numeric', 'aria-label': 'Map seed',
      onInput: (e: Event) => (f.seed = parseSeed((e.target as HTMLInputElement).value)),
    }) as HTMLInputElement;
    const dice = h('button', {
      class: 'btn mn-dice', title: 'Random seed', 'aria-label': 'Random seed',
      onClick: () => {
        f.seed = randomSeed();
        seed.value = String(f.seed);
      },
    }, '🎲');
    const rival = h('input', {
      type: 'checkbox', checked: f.rival,
      onChange: (e: Event) => (f.rival = (e.target as HTMLInputElement).checked),
    }) as HTMLInputElement;

    const cards = h('div', { class: 'mn-cards' });
    const paintCards = () => {
      const forced = SCENARIOS[f.scenario].goals.some((g) => g.kind === 'takeover');
      if (forced) {
        f.rival = true;
        rival.checked = true;
      }
      rival.disabled = forced;
      cards.replaceChildren(...Object.values(SCENARIOS).map((sc) =>
        h('button', {
          class: `mn-card ${sc.id === f.scenario ? 'sel' : ''}`,
          onClick: () => {
            f.scenario = sc.id;
            paintCards();
          },
        },
        h('b', null, sc.name),
        h('span', null, sc.blurb),
        h('em', null, `${sc.startYear} - ${formatMoney(sc.money)}`),
        ...sc.goals.map((g) => h('em', { class: 'mn-goal' }, `Goal: ${goalText(g)}`)))));
    };
    paintCards();

    return h('div', { class: 'mn-form' },
      h('h2', null, 'New Game'),
      h('label', { class: 'mn-row' }, h('span', null, 'Company'), name),
      h('label', { class: 'mn-row' }, h('span', null, 'Map seed'), h('span', { class: 'mn-seed' }, seed, dice)),
      cards,
      h('label', { class: 'mn-row' }, h('span', null, 'Baron Smogsworth competes'), rival),
      h('div', { class: 'mn-actions' },
        button('Back', () => this.show('home'), { cls: 'mn-back' }),
        button('Start', () => {
          const sc = SCENARIOS[f.scenario];
          this.host.startNew({
            seed: f.seed,
            companyName: f.name.trim() || randomName(),
            scenarioId: sc.id,
            rival: f.rival,
          });
        }, { cls: 'mn-primary' })));
  }

  get currentScreen(): Screen {
    return this.screen;
  }

  destroy(): void {
    this.backdrop?.destroy();
    this.root.remove();
  }
}

function parseSeed(text: string): number {
  const n = Number(text.trim());
  if (text.trim() !== '' && Number.isFinite(n)) return Math.abs(Math.floor(n)) >>> 0;
  // any other text still gives a stable seed
  let hash = 2166136261;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// in-game overlays

function modal(content: HTMLElement[], onEsc: (() => void) | null): { close(): void } {
  const root = h('div', { class: 'mn-root mn-modal' }, h('div', { class: 'mn-vignette' }), h('div', { class: 'mn-center' }, h('div', { class: 'mn-body' }, ...content)));
  const key = (e: KeyboardEvent) => {
    // the game's own hotkeys must not fire underneath the menu
    if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.key === 'Escape' && onEsc) {
      e.preventDefault();
      onEsc();
    }
  };
  window.addEventListener('keydown', key, true);
  document.body.appendChild(root);
  return {
    close() {
      window.removeEventListener('keydown', key, true);
      root.remove();
    },
  };
}

let pauseOpen: { close(): void } | null = null;

/** Esc menu: Resume, Save to slot, Load, Settings, Quit to menu. Pauses the game while open. */
export function openPauseMenu(game: GameController, host: PauseHost): void {
  if (pauseOpen) return;
  const resumeSpeed = game.state.speed;
  game.setSpeed(0);
  let m: { close(): void };
  const close = () => {
    m.close();
    pauseOpen = null;
  };
  const resume = () => {
    close();
    if (resumeSpeed > 0) game.setSpeed(resumeSpeed);
  };
  const body = h('div', { class: 'mn-pause' });
  const home = () => {
    body.replaceChildren(
      h('h2', null, 'Paused'),
      h('div', { class: 'mn-home' },
        button('Resume', resume, { cls: 'mn-primary' }),
        button('Save to slot', () => sub('Save Game', slotList('save', (slot) => {
          const r = saveTo(slot, game.state);
          return r.ok ? `Saved to ${SLOT_LABEL[slot]}.` : `Could not save: ${r.error}`;
        }))),
        button('Load', () => sub('Load Game', slotList('load', (slot) => {
          const r = loadFrom(slot);
          if (!r.ok) return r.error;
          close();
          host.startLoaded(r.value);
        }))),
        button('Settings', () => sub('Settings', settingsView((s) => {
          game.sfx.setVolume(s.volume);
          game.sfx.setMuted(s.muted);
        }))),
        quitButton()));
  };
  const sub = (title: string, view: HTMLElement) =>
    body.replaceChildren(h('h2', null, title), view, button('Back', home, { cls: 'mn-back' }));
  const quitButton = () => {
    const b = button('Quit to menu', () => {
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.textContent = 'Unsaved progress is lost - click again';
        return;
      }
      close();
      host.quitToMenu();
    }, { cls: 'mn-danger' });
    return b;
  };
  home();
  m = modal([body], resume);
  pauseOpen = m;
}

/** Closes the pause menu if open (used when the game is torn down). */
export function closePauseMenu(): void {
  pauseOpen?.close();
  pauseOpen = null;
}

/** Victory / game-over card. */
export function showEndScreen(kind: 'victory' | 'gameOver', reason: string, host: { quitToMenu(): void }, onKeepLooking: () => void): void {
  let m: { close(): void };
  m = modal([
    h('h2', { class: kind === 'victory' ? 'mn-won' : 'mn-lost' }, kind === 'victory' ? 'Victory!' : 'Game Over'),
    h('p', { class: 'mn-reason' }, reason),
    h('div', { class: 'mn-actions' },
      button('Look around', () => {
        m.close();
        onKeepLooking();
      }),
      button('Main menu', () => {
        m.close();
        host.quitToMenu();
      }, { cls: 'mn-primary' })),
  ], null);
}
