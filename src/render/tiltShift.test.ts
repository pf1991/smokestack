// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TiltShiftBudget, applyTiltShift, insetsFromRects, tiltShiftBands } from './tiltShift';

describe('tiltShiftBands', () => {
  it('18% bands top and bottom, blur scaled by the regime blend', () => {
    expect(tiltShiftBands(1000, 1)).toEqual({ top: 180, bottom: 820, maxBlurPx: 3 });
    expect(tiltShiftBands(1000, 0.5).maxBlurPx).toBe(1.5);
    expect(tiltShiftBands(1000, 0).maxBlurPx).toBe(0);
  });

  it('with insets, the bands are 18% of the visible area and start at the insets', () => {
    // 768 view, 105 px HUD bar, 80 px toolbar + ticker: 583 px of world, bands of 105 px
    expect(tiltShiftBands(768, 1, { top: 105, bottom: 80 })).toEqual({ top: 210, bottom: 583, maxBlurPx: 3 });
    expect(tiltShiftBands(1000, 1, { top: 0, bottom: 0 })).toEqual({ top: 180, bottom: 820, maxBlurPx: 3 });
  });

  it('insets come from the HUD rects in each half of the view', () => {
    const rects = [
      { x: 0, y: 0, w: 1366, h: 105 }, // HUD bar
      { x: 145, y: 688, w: 1076, h: 46 }, // toolbar
      { x: 0, y: 742, w: 1366, h: 26 }, // ticker
    ];
    expect(insetsFromRects(rects, 768)).toEqual({ top: 105, bottom: 80 });
    expect(insetsFromRects([], 768)).toEqual({ top: 0, bottom: 0 });
  });
});

/** A 2D context stub that records calls; `canvas` reports device pixels. */
function stubCtx(w: number, h: number) {
  const calls: string[] = [];
  const args: unknown[][] = [];
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy(
    { canvas: { width: w, height: h }, filter: 'none', globalCompositeOperation: 'source-over', imageSmoothingEnabled: false },
    {
      get(t, k) {
        if (k in t) return (t as Record<string | symbol, unknown>)[k];
        if (k === 'createLinearGradient') return () => grad;
        return (...a: unknown[]) => {
          calls.push(String(k));
          args.push([String(k), ...a]);
        };
      },
      set(t, k, v) {
        (t as Record<string | symbol, unknown>)[k] = v;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, args };
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

  it('reuses its two offscreen canvases across frames and draws both bands back', () => {
    const off = stubCtx(0, 0);
    const real = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag === 'canvas') (el as HTMLCanvasElement).getContext = (() => off.ctx) as never;
      return el;
    });
    const { ctx, calls } = stubCtx(800, 600);
    applyTiltShift(ctx, 800, 600, 1);
    applyTiltShift(ctx, 800, 600, 0.7, { top: 60, bottom: 40 });
    expect(spy.mock.calls.filter(([t]) => t === 'canvas').length).toBe(2);
    expect(calls.filter((c) => c === 'drawImage').length).toBe(4);
    // the world canvas's filter is left as it was
    expect(ctx.filter).toBe('none');
    // one destination-in mask fill per frame over both stacked bands: a second fill would clear the
    // first band (destination-in wipes everything outside the filled shape)
    const fills = off.args.filter((a) => a[0] === 'fillRect');
    const clears = off.args.filter((a) => a[0] === 'clearRect');
    expect(fills).toHaveLength(2);
    fills.forEach((f, i) => expect(f.slice(1)).toEqual(clears[i].slice(1)));
  });
});

describe('TiltShiftBudget', () => {
  it('runs at a healthy frame rate and shrugs off a single hitch', () => {
    const b = new TiltShiftBudget();
    let now = 0;
    for (let i = 0; i < 300; i++) expect(b.allow((now += 16), 16)).toBe(true);
    expect(b.allow((now += 100), 100)).toBe(true);
  });

  it('drops the effect on sustained slow frames, retries after 15 s, then backs off longer', () => {
    const b = new TiltShiftBudget();
    let now = 0;
    const run = (ms: number, dt: number) => {
      let on = 0;
      for (const end = now + ms; now < end; ) if (b.allow((now += dt), dt)) on++;
      return on;
    };
    run(3000, 16);
    expect(run(3000, 100)).toBeLessThan(15); // switched off within a second or so
    expect(run(10_000, 16)).toBe(0); // still waiting out the 15 s
    expect(run(6000, 16)).toBeGreaterThan(0); // retried once fast again
    run(3000, 100); // slow again: off, now for 30 s
    expect(run(25_000, 16)).toBe(0);
  });

  it('ignores the first second after creation or reset (load hitches do not switch it off)', () => {
    const b = new TiltShiftBudget();
    let now = 5000;
    // 900 ms of awful frames right after creation: ignored, the effect stays on
    for (let t = 0; t < 900; t += 100) expect(b.allow((now += 100), 100)).toBe(true);
    for (let i = 0; i < 100; i++) expect(b.allow((now += 16), 16)).toBe(true);
    // the same after a reset
    b.reset();
    for (let t = 0; t < 900; t += 100) expect(b.allow((now += 100), 100)).toBe(true);
    // past the warm-up, sustained slow frames still switch it off
    let on = 0;
    for (let t = 0; t < 3000; t += 100) if (b.allow((now += 100), 100)) on++;
    expect(on).toBeLessThan(30);
  });

  it('ignores samples while the page is hidden (background-tab gaps are not slow frames)', () => {
    let hidden = false;
    const b = new TiltShiftBudget(() => hidden);
    let now = 0;
    for (let i = 0; i < 100; i++) b.allow((now += 16), 16);
    hidden = true;
    for (let i = 0; i < 100; i++) b.allow((now += 250), 250);
    hidden = false;
    expect(b.allow((now += 16), 16)).toBe(true);
  });
});

