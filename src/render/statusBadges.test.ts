// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { badgeFor, drawStatusBadges } from './statusBadges';
import { ICON_IDS } from './icons';
import { dateToDays } from '../sim/clock';
import type { Building, GameState } from '../sim/types';

const b = (o: Partial<Building>): Building =>
  ({ id: 1, typeId: 'farm', ownerId: 'player', pos: { x: 10, y: 10 }, status: 'ok', input: {}, output: {}, ...o }) as Building;

function mockCtx() {
  const arc = vi.fn();
  const target: Record<string, unknown> = { arc };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : (t[k as string] = vi.fn())),
    set: (t, k, v) => ((t[k as string] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  /** badge discs are the only 9 px-radius arcs (icon painters draw in a scaled 16 box) */
  const discs = () => arc.mock.calls.filter((c) => c[2] === 9).length;
  return { ctx, arc, discs };
}
const cam = { x: 0, y: 0, zoom: 1.6, viewW: 4000, viewH: 4000 } as never;
const stateOf = (bs: Building[]) =>
  ({ buildings: Object.fromEntries(bs.map((x, i) => [i + 1, { ...x, id: i + 1 }])), date: { year: 1900, month: 1, day: 1, hour: 0 } }) as unknown as GameState;

describe('badgeFor', () => {
  it('maps each status', () => {
    expect(badgeFor(b({ status: 'no_input' }))).toBe('warning');
    expect(badgeFor(b({ status: 'output_full' }))).toBe('warning');
    expect(badgeFor(b({ status: 'idle' }))).toBe('pause');
    expect(badgeFor(b({ status: 'upgrading' }))).toBe('scaffold');
    expect(badgeFor(b({ status: 'halted', strike: { until: 999999 } as never }))).toBe('strike');
    expect(badgeFor(b({ status: 'ok' }))).toBeNull();
  });
  it('ignores idle stores and logistics', () => {
    expect(badgeFor(b({ typeId: 'warehouse', status: 'idle' }))).toBeNull();
    expect(badgeFor(b({ typeId: 'store', status: 'idle' }))).toBe('warning');
  });
  it('uses icons that exist', () => {
    for (const s of ['warning', 'strike', 'pause', 'scaffold']) expect(ICON_IDS).toContain(s);
  });
});

describe('drawStatusBadges', () => {
  const bs = [b({ status: 'no_input' }), b({ status: 'idle' }), b({ status: 'ok' }), b({ status: 'upgrading' }), b({ status: 'no_input', ownerId: 'rival1' as never })];
  it('draws one badge per troubled player building', () => {
    const { ctx, discs } = mockCtx();
    drawStatusBadges(ctx, stateOf(bs), cam, { photo: false, zoom: 1.6, nowMs: 0 });
    expect(discs()).toBe(3);
  });
  it('draws nothing in photo mode or at zoom 0.8', () => {
    const { ctx, arc } = mockCtx();
    drawStatusBadges(ctx, stateOf(bs), cam, { photo: true, zoom: 1.6, nowMs: 0 });
    drawStatusBadges(ctx, stateOf(bs), cam, { photo: false, zoom: 0.8, nowMs: 0 });
    expect(arc).not.toHaveBeenCalled();
  });
  it('handles 300 buildings quickly', () => {
    const many = Array.from({ length: 300 }, (_, i) => b({ status: 'no_input', pos: { x: i % 50, y: Math.floor(i / 50) * 3 } }));
    const { ctx } = mockCtx();
    const st = stateOf(many);
    const t = performance.now();
    drawStatusBadges(ctx, st, cam, { photo: false, zoom: 1.6, nowMs: 0 });
    expect(performance.now() - t).toBeLessThan(20);
    void dateToDays;
  });
});
