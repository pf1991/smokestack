/**
 * Tilt-shift for the diorama: the top and bottom 18% of the view are blurred, fading to sharp
 * toward the middle, so the zoomed-in world reads as a miniature. The blur grows with the regime
 * blend (0 on the survey map, 3 px at full diorama).
 *
 * Cost: both bands are copied into a reused offscreen canvas at a third of the resolution, blurred
 * from there into a second one (a ninth of the pixels to blur), masked with a gradient, then drawn
 * back scaled up. The canvases are only resized when the viewport changes.
 */

/** Fraction of the viewport height each band covers. */
const BAND = 0.18;
/** Blur at full diorama, in CSS px. */
const MAX_BLUR = 3;
/**
 * Offscreen resolution divisor. A quarter: on a software canvas the blur and the copies are then
 * nearly free (about 0.5 ms at 1920x1080), and the bilinear upscale is lost under the blur anyway.
 */
const DOWN = 4;

/** Screen px hidden at the top (HUD bar) and bottom (toolbar, ticker) of the view. */
export interface ViewInsets {
  top: number;
  bottom: number;
}

/**
 * Band edges in CSS px. With `insets`, the bands are 18% of the visible world area between them
 * and start at the insets (a band hidden under the HUD would be wasted); without, of the whole view.
 */
export function tiltShiftBands(viewH: number, blend: number, insets?: ViewInsets): { top: number; bottom: number; maxBlurPx: number } {
  const t = Math.max(0, insets?.top ?? 0);
  const b = Math.max(0, insets?.bottom ?? 0);
  const band = Math.round(Math.max(0, viewH - t - b) * BAND);
  return { top: t + band, bottom: viewH - b - band, maxBlurPx: MAX_BLUR * blend };
}

/**
 * Insets from measured HUD rects (render/world/survey.ts hudRects): the lowest bottom edge of
 * those in the upper half of the view, and the highest top edge of those in the lower half.
 */
export function insetsFromRects(rects: { y: number; h: number }[], viewH: number): ViewInsets {
  let top = 0;
  let bottom = 0;
  for (const r of rects) {
    if (r.y + r.h / 2 < viewH / 2) top = Math.max(top, r.y + r.h);
    else bottom = Math.max(bottom, viewH - r.y);
  }
  return { top: Math.min(top, viewH / 2), bottom: Math.min(bottom, viewH / 2) };
}

let off: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;
/** unfiltered downscaled copy of the bands, the blur's source (same size as `off`) */
let raw: HTMLCanvasElement | null = null;
let rawCtx: CanvasRenderingContext2D | null = null;
/** mask gradient, rebuilt only when the offscreen band height changes */
let mask: { ob: number; grad: CanvasGradient } | null = null;
/** filter string for the last blur radius, rebuilt only when the radius changes */
let filterPx = -1;
let filterStr = 'none';

/**
 * Blurs the top and bottom bands of `ctx`'s canvas in place. `w`/`h` are the viewport in CSS px;
 * the canvas may be larger (device pixel ratio). No-op when `blend` is 0.
 */
export function applyTiltShift(ctx: CanvasRenderingContext2D, w: number, h: number, blend: number, insets?: ViewInsets): void {
  if (!(blend > 0) || w <= 0 || h <= 0) return;

  const { top, bottom, maxBlurPx } = tiltShiftBands(h, blend, insets);
  const canvas = ctx.canvas;
  const scale = canvas.height / h;
  const W = canvas.width;
  // device-pixel band rows: [y0, y0 + bandPx) on top, [y1, y1 + bandPx) at the bottom
  const y0 = Math.round((insets?.top ?? 0) * scale);
  const bandPx = Math.round(top * scale) - y0;
  const y1 = Math.round(bottom * scale);
  if (bandPx <= 0 || W <= 0) return;
  // reduced resolution: both bands stacked in one canvas
  const ow = Math.max(1, Math.ceil(W / DOWN));
  const ob = Math.max(1, Math.ceil(bandPx / DOWN));
  if (!off || !raw) {
    off = document.createElement('canvas');
    offCtx = off.getContext('2d');
    raw = document.createElement('canvas');
    rawCtx = raw.getContext('2d');
  }
  const o = offCtx;
  const rc = rawCtx;
  if (!o || !rc) return;
  if (off.width !== ow || off.height !== ob * 2) {
    off.width = raw.width = ow;
    off.height = raw.height = ob * 2;
  }
  if (!mask || mask.ob !== ob) {
    // one alpha mask over both stacked bands (destination-in clears everything a fill does not
    // cover, so the bands cannot be masked by two separate fills): opaque at the edge of the
    // visible area, clear toward the middle of the view
    const m = o.createLinearGradient(0, 0, 0, ob * 2);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(0.175, 'rgba(0,0,0,0.85)');
    m.addColorStop(0.5, 'rgba(0,0,0,0)');
    m.addColorStop(0.825, 'rgba(0,0,0,0.85)');
    m.addColorStop(1, 'rgba(0,0,0,1)');
    mask = { ob, grad: m };
  }
  // 1. unfiltered downscaled copy of both bands. The blur is not applied here: Chrome filters the
  //    whole source image before cropping and scaling, which on a software canvas cost more than
  //    the rest of the frame.
  rc.setTransform(1, 0, 0, 1, 0, 0);
  rc.imageSmoothingEnabled = true;
  rc.drawImage(canvas as CanvasImageSource, 0, y0, W, bandPx, 0, 0, ow, ob);
  rc.drawImage(canvas as CanvasImageSource, 0, y1, W, bandPx, 0, ob, ow, ob);
  // 2. blur the small copy into `off`
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, ow, ob * 2);
  o.imageSmoothingEnabled = true;
  // the blur is applied at reduced resolution, so a reduced radius
  const px = Math.round(((maxBlurPx * scale) / DOWN) * 100) / 100;
  if (px !== filterPx) {
    filterPx = px;
    filterStr = `blur(${px}px)`;
  }
  o.filter = filterStr;
  o.drawImage(raw as CanvasImageSource, 0, 0);
  o.filter = 'none';
  // 3. mask
  o.globalCompositeOperation = 'destination-in';
  o.fillStyle = mask.grad;
  o.fillRect(0, 0, ow, ob * 2);
  o.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // weak near the survey side of the blend, where the reduced-resolution copy would show before the blur does
  ctx.globalAlpha = Math.min(1, blend);
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off as CanvasImageSource, 0, 0, ow, ob, 0, y0, W, bandPx);
  ctx.drawImage(off as CanvasImageSource, 0, ob, ow, ob, 0, y1, W, bandPx);
  ctx.restore();
}


/** Frames slower than this on average (about 22 fps) switch the tilt-shift off. */
export const SLOW_FRAME_MS = 45;
const FIRST_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;

/**
 * Keeps the tilt-shift from costing frames on machines that are already struggling. Reading the
 * world canvas back mid-frame and compositing the bands costs a few ms; at full speed that is
 * invisible, but on a slow (software) canvas it costs a quarter of the frame rate. When the average
 * frame time goes over SLOW_FRAME_MS the effect is dropped for 15 s, then retried; each retry that
 * is still slow doubles the wait, up to 2 minutes.
 */
export class TiltShiftBudget {
  private ema = 16;
  private offUntil = -Infinity;
  private backoff = FIRST_BACKOFF_MS;

  /** Feed each frame's real duration; true when the effect may run this frame. */
  allow(nowMs: number, dtMs: number): boolean {
    this.ema += (Math.min(250, Math.max(0, dtMs)) - this.ema) * 0.05;
    if (nowMs < this.offUntil) return false;
    if (this.ema > SLOW_FRAME_MS) {
      this.offUntil = nowMs + this.backoff;
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
      return false;
    }
    return true;
  }
}
