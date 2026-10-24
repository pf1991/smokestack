// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { badgeFor, drawStatusBadges } from './statusBadges';
import { ICON_IDS } from './icons';
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
const cam = { x: 0, y: 0, viewW: 4000, viewH: 4000 } as never;
const stateOf = (bs: Building[]) =>
  ({ buildings: Object.fromEntries(bs.map((x, i) => [i + 1, { ...x, id: i + 1 }])), date: { year: 1900, month: 1, day: 1, hour: 0 } }) as unknown as GameState;

describe('badgeFor', () => {
  it('maps each status', () => {
    expect(badgeFor(b({ status: 'no_input' }), 100)).toBe('warning');
    expect(badgeFor(b({ status: 'output_full' }), 100)).toBe('warning');
    expect(badgeFor(b({ status: 'idle' }), 100)).toBe('pause');
    expect(badgeFor(b({ status: 'upgrading' }), 100)).toBe('scaffold');
    expect(badgeFor(b({ status: 'halted', strike: { since: 90, until: 999999 } as never }), 100)).toBe('strike');
    expect(badgeFor(b({ status: 'ok' }), 100)).toBeNull();
  });
  it('ends a strike by the sim rule (until, capped at since + 120)', () => {
    const st = (since: number, until: number) => b({ status: 'halted', strike: { since, until } as never });
    expect(badgeFor(st(90, 200), 100)).toBe('strike');
    expect(badgeFor(st(90, 100), 100)).toBeNull();
    expect(badgeFor(st(0, 9999), 130)).toBeNull();
  });
  it('badges a store only when its shelves are empty', () => {
    expect(badgeFor(b({ typeId: 'store', status: 'idle', input: { bread: 5 } }), 100)).toBeNull();
    expect(badgeFor(b({ typeId: 'store', status: 'idle', input: {}, output: {} }), 100)).toBe('warning');
  });
  it('ignores idle stores and logistics', () => {
    expect(badgeFor(b({ typeId: 'warehouse', status: 'idle' }), 100)).toBeNull();
    expect(badgeFor(b({ typeId: 'store', status: 'idle' }), 100)).toBe('warning');
  });
  it('uses icons that exist', () => {
    for (const s of ['warning', 'strike', 'pause', 'scaffold']) expect(ICON_IDS).toContain(s);
  });
});

describe('drawStatusBadges', () => {
  const bs = [b({ status: 'no_input' }), b({ status: 'idle' }), b({ status: 'ok' }), b({ status: 'upgrading' }), b({ status: 'no_input', ownerId: 'rival1' as never })];
  it('draws one badge per troubled player building', () => {
    const { ctx, discs } = mockCtx();
    drawStatusBadges(ctx, stateOf(bs), cam, { photo: false, nowMs: 0 });
    expect(discs()).toBe(3);
  });
  it('draws nothing in photo mode or at zoom 0.8', () => {
    const { ctx, arc } = mockCtx();
    drawStatusBadges(ctx, stateOf(bs), cam, { photo: true, nowMs: 0 });
    drawStatusBadges(ctx, stateOf(bs), { x: 0, y: 0, zoom: 0.8, viewW: 4000, viewH: 4000 } as never, { photo: false, nowMs: 0 });
    expect(arc).not.toHaveBeenCalled();
  });
  it('culls off-screen buildings', () => {
    const { ctx, discs } = mockCtx();
    const far = [b({ status: 'no_input', pos: { x: 500, y: 500 } }), b({ status: 'no_input' })];
    drawStatusBadges(ctx, stateOf(far), { x: 0, y: 0, zoom: 1.6, viewW: 800, viewH: 600 } as never, { photo: false, nowMs: 0 });
    expect(discs()).toBe(1);
  });
  it('handles 300 buildings quickly', () => {
    const many = Array.from({ length: 300 }, (_, i) => b({ status: 'no_input', pos: { x: i % 50, y: Math.floor(i / 50) * 3 } }));
    const { ctx } = mockCtx();
    const st = stateOf(many);
    const t = performance.now();
    drawStatusBadges(ctx, st, cam, { photo: false, nowMs: 0 });
    expect(performance.now() - t).toBeLessThan(20);
  });
});
