/**
 * Top-bar chain health strip: Inputs → Works → Shelves. Click a broken segment to jump
 * like the alerts tray (center + open building inspector).
 */
import { BUILDINGS } from '../data/buildings';
import type { EventBus } from '../core/events';
import type { GameState, Vec2 } from '../sim/types';
import {
  CHAIN_SEGMENTS,
  chainHealth,
  segmentTone,
  type ChainHealth,
  type ChainSegmentId,
} from '../game/chainHealth';
import { h } from './dom';
import './chainHealth.css';

export interface ChainHealthHost {
  readonly ctx: { state: GameState; bus: EventBus };
  centerOn(tile: Vec2): void;
  openPanel(id: string, arg?: unknown): void;
  /** Re-score when alerts refresh (same cadence). */
  onAlerts(fn: (alerts: readonly unknown[]) => void): () => void;
}

function footprintCenter(state: GameState, buildingId: number): Vec2 | null {
  const b = state.buildings[buildingId];
  if (!b) return null;
  const size = BUILDINGS[b.typeId]?.size ?? { w: 1, h: 1 };
  return { x: b.pos.x + (size.w - 1) / 2, y: b.pos.y + (size.h - 1) / 2 };
}

function paintSeg(btn: HTMLButtonElement, health: ChainHealth, id: ChainSegmentId): void {
  const seg = health[id];
  const tone = segmentTone(seg);
  const meta = CHAIN_SEGMENTS.find((s) => s.id === id)!;
  btn.dataset.tone = tone;
  btn.disabled = seg.jumpId === null;
  const count = seg.total === 0 ? '—' : `${seg.broken}/${seg.total}`;
  const countEl = btn.querySelector('.chain-seg-count');
  if (countEl) countEl.textContent = count;
  btn.title = seg.total === 0
    ? `${meta.label}: none yet`
    : seg.broken === 0
      ? `${meta.label}: all clear`
      : `${meta.label}: ${seg.broken} of ${seg.total} need attention — click to jump`;
  btn.setAttribute('aria-label', btn.title);
}

/** Mounts the strip into `slot`; returns a disposer. */
export function mountChainHealth(slot: HTMLElement, game: ChainHealthHost): () => void {
  const buttons = new Map<ChainSegmentId, HTMLButtonElement>();
  const root = h('div', { class: 'chain-health', role: 'group', 'aria-label': 'Chain health' });
  for (const s of CHAIN_SEGMENTS) {
    const btn = h('button', {
      class: 'chain-seg',
      type: 'button',
      'data-seg': s.id,
      onClick: () => jump(s.id),
    },
      h('span', { class: 'chain-seg-label' }, s.short),
      h('span', { class: 'chain-seg-count' }, '—'),
    ) as HTMLButtonElement;
    buttons.set(s.id, btn);
    root.appendChild(btn);
  }
  slot.appendChild(root);

  const paint = () => {
    const health = chainHealth(game.ctx.state);
    for (const s of CHAIN_SEGMENTS) paintSeg(buttons.get(s.id)!, health, s.id);
  };

  function jump(id: ChainSegmentId): void {
    const health = chainHealth(game.ctx.state);
    const jumpId = health[id].jumpId;
    if (jumpId === null) return;
    const pos = footprintCenter(game.ctx.state, jumpId);
    if (!pos) {
      game.ctx.bus.emit({ type: 'toast', message: 'That is no longer there', tone: 'info' });
      paint();
      return;
    }
    game.centerOn(pos);
    game.openPanel('building', jumpId);
  }

  paint();
  const off = game.onAlerts(() => paint());
  return () => {
    off();
    root.remove();
  };
}
