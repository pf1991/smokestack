// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../../sim/state';

const sel = vi.hoisted(() => ({ drawSelection: vi.fn(), drawGhost: vi.fn(), drawGhostLabel: vi.fn() }));
vi.mock('./selection', () => sel);

const { WorldRenderer } = await import('./index');

function fakeCtx(): CanvasRenderingContext2D {
  return new Proxy({}, { get: (t, p) => (p in t ? (t as Record<string | symbol, unknown>)[p] : () => {}) }) as CanvasRenderingContext2D;
}

describe('WorldRenderer tool UI', () => {
  it('draws no selection, ghost or ghost label while the UI is hidden (photo mode)', () => {
    const state = createGame({ seed: 7 });
    const canvas = { getContext: () => fakeCtx(), style: {} } as unknown as HTMLCanvasElement;
    const r = new WorldRenderer(canvas, state);
    r.setSelection({ buildingId: 1 });
    r.setGhost({ kind: 'tiles', tiles: [{ x: 1, y: 1 }], valid: true, label: 'Road $1' });
    const cam = { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 };
    const drawUi = (r as unknown as { drawUi(...a: unknown[]): void }).drawUi.bind(r);
    drawUi(fakeCtx(), state, cam, 1, 0);
    expect(sel.drawSelection).toHaveBeenCalledTimes(1);
    expect(sel.drawGhost).toHaveBeenCalledTimes(1);
    r.setUiHidden(true);
    drawUi(fakeCtx(), state, cam, 1, 0);
    expect(sel.drawSelection).toHaveBeenCalledTimes(1);
    expect(sel.drawGhost).toHaveBeenCalledTimes(1);
    expect(sel.drawGhostLabel).toHaveBeenCalledTimes(1);
  });
});
