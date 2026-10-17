import { COMPANY_NAMES } from '../data/names';
import { ACHIEVEMENTS, loadUnlocked } from '../game/achievements';
import type { GameController, NewGameOpts } from '../game/controller';
import { listSaves, loadFrom, saveTo, SLOTS, unreadableSlots, type SaveInfo, type SaveSlot } from '../game/saves';
import { loadSettings, saveSettings } from '../game/settings';
import { goalProgress, SCENARIOS, type Goal } from '../sim/scenarios';
import type { GameState } from '../sim/types';
import { h } from './dom';
import { iconEl } from './icon';
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
  const state = { flags: {}, companies: { player: { money: 0 } }, cities: [], economy: { priceIndex: 1, history: [] } } as unknown as GameState;
  return `${goalProgress(state, g).label} by ${g.byYear}`;
}

/** Slot list used by the Load screen (mode 'load') and the pause menu's Save screen (mode 'save'). */
function slotList(mode: 'load' | 'save', onPick: (slot: SaveSlot) => string | void): HTMLElement {
  const status = h('div', { class: 'mn-status' });
  const list = h('div', { class: 'mn-slots' });
  const fill = () => {
    const infos = new Map<SaveSlot, SaveInfo>(listSaves().map((i) => [i.slot, i]));
    const bad = new Map<SaveSlot, string>(unreadableSlots().map((u) => [u.slot, u.error]));
    list.replaceChildren(
      ...SLOTS.filter((s) => mode === 'load' || s !== 'auto').map((slot) => {
        const info = infos.get(slot);
        const meta = info
          ? h('span', { class: 'mn-slot-meta' }, h('b', null, info.company), ` - ${info.date} - ${formatMoney(info.money)}`)
          : bad.has(slot)
            ? h('span', { class: 'mn-slot-meta mn-empty mn-bad' }, `Unreadable save - ${bad.get(slot)}`)
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
  const intro = h('input', {
    type: 'checkbox', checked: s.skipIntro,
    onChange: (e: Event) => {
      s.skipIntro = (e.target as HTMLInputElement).checked;
      apply();
    },
  });
  return h('div', { class: 'mn-form' },
    h('label', { class: 'mn-row' }, h('span', null, 'Master volume'), vol),
    h('label', { class: 'mn-row' }, h('span', null, 'Mute all sound'), mute),
    h('label', { class: 'mn-row' }, h('span', null, 'Open the newspaper automatically'), news),
    h('label', { class: 'mn-row' }, h('span', null, 'Skip intro'), intro));
}

function achievementsView(): HTMLElement {
  const got = loadUnlocked();
  return h('div', null,
    h('div', { class: 'mn-status' }, `${got.size} of ${ACHIEVEMENTS.length} unlocked`),
    h('div', { class: 'mn-ach' }, ACHIEVEMENTS.map((a) =>
      h('div', { class: `mn-ach-item ${got.has(a.id) ? 'got' : ''}` },
        h('span', { class: 'mn-ach-icon' }, iconEl(got.has(a.id) ? a.icon : 'lock', 28, got.has(a.id) ? a.name : 'Locked')),
        h('span', null, h('b', null, a.name), h('br'), a.desc)))));
}

// ---------------------------------------------------------------------------

type Screen = 'home' | 'new' | 'load' | 'achievements' | 'settings';

export class MainMenu {
  private readonly backdrop: MenuBackdrop | null;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private screen: Screen = 'home';
  private status: HTMLElement = h('div');
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

  /** Shows a message in the home screen's status line (e.g. a save that failed to start). */
  showError(message: string): void {
    this.show('home');
    this.status.textContent = message;
  }

  private home(): HTMLElement {
    const auto = listSaves().find((s) => s.slot === 'auto');
    const badAuto = unreadableSlots().find((u) => u.slot === 'auto');
    this.status = h('div', { class: 'mn-status' }, badAuto ? `Autosave cannot be loaded - ${badAuto.error}` : '');
    return h('div', null, h('div', { class: 'mn-home' },
      button('New Game', () => this.show('new'), { cls: 'mn-primary' }),
      button(auto ? `Continue - ${auto.company}, ${auto.date}` : 'Continue', () => {
        const r = loadFrom('auto');
        if (r.ok) this.host.startLoaded(r.value);
        else this.status.textContent = r.error;
      }, { disabled: !auto }),
      button('Load Game', () => this.show('load')),
      button('Achievements', () => this.show('achievements')),
      button('Settings', () => this.show('settings'))), this.status);
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
    }, 'Random');
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

interface ModalHandle {
  close(): void;
  kind: string;
}
/** The one open in-game overlay (pause menu or end card), if any. */
let current: ModalHandle | null = null;

/** Closes whatever overlay is open, releasing its key listener (safe to call anytime). */
export function closeModal(): void {
  current?.close();
}

function modal(kind: string, content: HTMLElement[], onEsc: (() => void) | null): ModalHandle {
  closeModal();
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
  const handle: ModalHandle = {
    kind,
    close() {
      window.removeEventListener('keydown', key, true);
      root.remove();
      if (current === handle) current = null;
    },
  };
  current = handle;
  return handle;
}

/** A pause-menu screen the HUD's More menu can open directly. */
export type PauseScreen = 'save' | 'load' | 'settings';

/**
 * Esc menu: Resume, Save to slot, Load, Settings, Quit to menu. Pauses the game while open.
 * `screen` opens straight onto Save, Load or Settings (Back still leads to the home screen).
 */
export function openPauseMenu(game: GameController, host: PauseHost, screen?: PauseScreen): void {
  if (current) return;
  const resumeSpeed = game.state.speed;
  game.setSpeed(0);
  let m: ModalHandle;
  const close = () => m.close();
  const resume = () => {
    close();
    if (resumeSpeed > 0) game.setSpeed(resumeSpeed);
  };
  const body = h('div', { class: 'mn-pause' });
  const screens: Record<PauseScreen, () => void> = {
    save: () => sub('Save Game', slotList('save', (slot) => {
      const r = saveTo(slot, game.state);
      return r.ok ? `Saved to ${SLOT_LABEL[slot]}.` : `Could not save: ${r.error}`;
    })),
    load: () => sub('Load Game', slotList('load', (slot) => {
      const r = loadFrom(slot);
      if (!r.ok) return r.error;
      close();
      host.startLoaded(r.value);
    })),
    settings: () => sub('Settings', settingsView((s) => {
      game.sfx.setVolume(s.volume);
      game.sfx.setMuted(s.muted);
    })),
  };
  const home = () => {
    body.replaceChildren(
      h('h2', null, 'Paused'),
      h('div', { class: 'mn-home' },
        button('Resume', resume, { cls: 'mn-primary' }),
        button('Save to slot', screens.save),
        button('Load', screens.load),
        button('Settings', screens.settings),
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
  if (screen) screens[screen]();
  else home();
  m = modal('pause', [body], resume);
}

/** Victory / game-over card. */
export function showEndScreen(kind: 'victory' | 'gameOver', reason: string, host: { quitToMenu(): void }, onKeepLooking: () => void): void {
  if (current?.kind === 'end') return; // victory and bankruptcy can land in the same tick: first one wins
  const m: ModalHandle = modal('end', [
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
