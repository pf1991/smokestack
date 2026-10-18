// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import type { GameController } from '../../game/controller';
import { legacyScore } from '../../sim/legacy';
import { createGame } from '../../sim/state';
import { closeModal, showEndScreen } from '../menu';
import { PANELS } from './index';

afterEach(() => {
  closeModal();
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  document.body.replaceChildren();
});

const PARTS = ['Fortune', 'Landmarks', 'Reputation', 'Dynasty'];

describe('legacy panel and end screen', () => {
  it('is registered and lists the four parts with the total', () => {
    expect(PANELS.legacy.id).toBe('legacy');
    const state = createGame({ seed: 7, companyName: 'Acme', rival: true });
    PANELS.legacy.open({ state, ctx: { state, bus: new EventBus() } } as unknown as GameController);
    const rows = [...document.querySelectorAll('.legacy-row')].map((r) => r.querySelector('b')?.textContent);
    expect(rows).toEqual(PARTS);
    expect(document.querySelector('.legacy-total')?.textContent).toContain(String(legacyScore(state).total));
  });

  it('the end screen lists all four parts on victory and on game over', () => {
    const state = createGame({ seed: 7, companyName: 'Acme', rival: true });
    for (const kind of ['victory', 'gameOver'] as const) {
      showEndScreen(kind, 'reason', { quitToMenu: () => {} }, () => {}, state);
      const modal = document.querySelector('.mn-modal')!;
      expect([...modal.querySelectorAll('.legacy-row b')].map((b) => b.textContent)).toEqual(PARTS);
      expect(modal.querySelector('.legacy-total')?.textContent).toContain(String(legacyScore(state).total));
      closeModal();
    }
  });
});
