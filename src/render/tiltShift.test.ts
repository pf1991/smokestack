// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTiltShift, tiltShiftBands } from './tiltShift';

describe('tiltShiftBands', () => {
  it('18% bands top and bottom, blur scaled by the regime blend', () => {
    expect(tiltShiftBands(1000, 1)).toEqual({ top: 180, bottom: 820, maxBlurPx: 3 });
    expect(tiltShiftBands(1000, 0.5).maxBlurPx).toBe(1.5);
    expect(tiltShiftBands(1000, 0).maxBlurPx).toBe(0);
  });
});

/** A 2D context stub that records calls; `canvas` reports device pixels. */
function stubCtx(w: number, h: number) {
  const calls: string[] = [];
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy(
    { canvas: { width: w, height: h }, filter: 'none', globalCompositeOperation: 'source-over', imageSmoothingEnabled: false },
    {
      get(t, k) {
        if (k in t) return (t as Record<string | symbol, unknown>)[k];
        if (k === 'createLinearGradient') return () => grad;
        return (..._a: unknown[]) => {
          calls.push(String(k));
        };
      },
      set(t, k, v) {
        (t as Record<string | symbol, unknown>)[k] = v;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('applyTiltShift', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does nothing in the survey regime (blend 0)', () => {
    const { ctx, calls } = stubCtx(800, 600);
    const spy = vi.spyOn(document, 'createElement');
    applyTiltShift(ctx, 800, 600, 0);
    expect(calls).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reuses one offscreen canvas across frames and draws both bands back', () => {
    const off = stubCtx(0, 0);
    const real = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag === 'canvas') (el as HTMLCanvasElement).getContext = (() => off.ctx) as never;
      return el;
    });
    const { ctx, calls } = stubCtx(800, 600);
    applyTiltShift(ctx, 800, 600, 1);
    applyTiltShift(ctx, 800, 600, 0.7);
    expect(spy.mock.calls.filter(([t]) => t === 'canvas').length).toBeLessThanOrEqual(1);
    expect(calls.filter((c) => c === 'drawImage').length).toBe(4);
    // the world canvas's filter is left as it was
    expect(ctx.filter).toBe('none');
  });
});
