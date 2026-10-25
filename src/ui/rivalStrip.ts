/**
 * Compact top-bar rival challenge strip: latest taunt / undercut / baronStrike.
 * Jump opens the city panel when a town is known, otherwise the Rival panel.
 */
import type { EventBus } from '../core/events';
import { GOODS } from '../data/goods';
import { RETALIATION_LABELS } from '../data/nemesis';
import type { GameState, GoodId } from '../sim/types';
import { h } from './dom';
import './rivalStrip.css';

export interface RivalStripHost {
  /** Absent on GameController until load(); mount returns a no-op disposer then. */
  readonly ctx?: { state: GameState; bus: EventBus };
  openPanel(id: string, arg?: unknown): void;
}

interface RivalBeat {
  text: string;
  cityId: number | null;
}

function townName(state: GameState, cityId: number | null): string {
  if (cityId === null) return 'town';
  return state.cities.find((c) => c.id === cityId)?.name ?? 'town';
}

function undercutText(state: GameState, cityId: number, goodId: GoodId): string {
  const good = GOODS[goodId]?.name ?? goodId;
  return `Undercutting you in ${townName(state, cityId)} — ${good}`;
}

/** Mounts the strip into `slot` (hidden until the first beat); returns a disposer. */
export function mountRivalStrip(slot: HTMLElement, game: RivalStripHost): () => void {
  let beat: RivalBeat | null = null;
  let root: HTMLElement | null = null;
  const textEl = h('span', { class: 'rival-strip-text' }, '');
  const jumpBtn = h('button', {
    class: 'rival-strip-jump',
    type: 'button',
    title: 'Jump to the fight',
    onClick: () => jump(),
  }, 'Jump') as HTMLButtonElement;

  function ensureRoot(): HTMLElement {
    if (root) return root;
    root = h('div', {
      class: 'rival-strip',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Rival challenge',
    }, textEl, jumpBtn);
    slot.appendChild(root);
    return root;
  }

  function paint(): void {
    if (!beat) {
      root?.remove();
      root = null;
      return;
    }
    ensureRoot();
    textEl.textContent = beat.text;
    jumpBtn.title = beat.cityId !== null ? 'Open city' : 'Open Rival';
  }

  function setBeat(next: RivalBeat): void {
    beat = next;
    paint();
  }

  function jump(): void {
    if (!beat) return;
    if (beat.cityId !== null) game.openPanel('city', beat.cityId);
    else game.openPanel('rival');
  }

  const ctx = game.ctx;
  if (!ctx) return () => {};

  const offs = [
    ctx.bus.on('baronStrike', (e) => {
      setBeat({
        text: `Smogsworth strikes: ${RETALIATION_LABELS[e.kind]}`,
        cityId: e.cityId,
      });
    }),
    ctx.bus.on('undercut', (e) => {
      setBeat({
        text: undercutText(ctx.state, e.cityId, e.goodId),
        cityId: e.cityId,
      });
    }),
    ctx.bus.on('news', (e) => {
      if (e.item.kind !== 'rival') return;
      // taunts and desk copy; strikes already painted by baronStrike
      let text = e.item.headline;
      if (text.startsWith("Smogsworth: '") && text.endsWith("'")) {
        text = text.slice("Smogsworth: '".length, -1);
      } else if (text.startsWith('Smogsworth: ')) {
        text = text.slice('Smogsworth: '.length);
      }
      setBeat({ text, cityId: null });
    }),
  ];

  return () => {
    for (const off of offs) off();
    root?.remove();
    root = null;
  };
}
