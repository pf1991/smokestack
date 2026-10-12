/**
 * Tilt-shift for the diorama: the top and bottom 18% of the view are blurred, fading to sharp
 * toward the middle, so the zoomed-in world reads as a miniature. The blur grows with the regime
 * blend (0 on the survey map, 3 px at full diorama).
 *
 * Cost: each band is copied once into a reused offscreen canvas at a third of the resolution with a
 * blur filter (a ninth of the pixels to blur), masked with a gradient, then drawn back scaled up.
 * The canvas is only resized when the viewport changes.
 */

/** Fraction of the viewport height each band covers. */
const BAND = 0.18;
/** Blur at full diorama, in CSS px. */
const MAX_BLUR = 3;
/**
 * Offscreen resolution divisor. A third rather than half: on a software canvas the blur filter is
 * the whole cost, and at half resolution it took headless Chrome at 1920x1080 from 30.7 to 26.5 fps
 * at zoom 2, while a third stays at the frame cap (29.6). The upscale's bilinear softening is lost
 * under the blur anyway.
 */
const DOWN = 3;

export function tiltShiftBands(viewH: number, blend: number): { top: number; bottom: number; maxBlurPx: number } {
  const band = Math.round(viewH * BAND);
  return { top: band, bottom: viewH - band, maxBlurPx: MAX_BLUR * blend };
}

let off: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;

/**
 * Blurs the top and bottom bands of `ctx`'s canvas in place. `w`/`h` are the viewport in CSS px;
 * the canvas may be larger (device pixel ratio). No-op when `blend` is 0.
 */
export function applyTiltShift(ctx: CanvasRenderingContext2D, w: number, h: number, blend: number): void {
  if (!(blend > 0) || w <= 0 || h <= 0) return;
  const { top, maxBlurPx } = tiltShiftBands(h, blend);
  const canvas = ctx.canvas;
  const scale = canvas.height / h;
  const W = canvas.width;
  const bandPx = Math.round(top * scale);
  if (bandPx <= 0 || W <= 0) return;
  // reduced resolution: both bands stacked in one canvas
  const ow = Math.max(1, Math.ceil(W / DOWN));
  const ob = Math.max(1, Math.ceil(bandPx / DOWN));
  if (!off) {
    off = document.createElement('canvas');
    offCtx = off.getContext('2d');
  }
  const o = offCtx;
  if (!o) return;
  if (off.width !== ow || off.height !== ob * 2) {
    off.width = ow;
    off.height = ob * 2;
  }
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, ow, ob * 2);
  o.imageSmoothingEnabled = true;
  // the blur is applied at reduced resolution, so a reduced radius
  o.filter = `blur(${((maxBlurPx * scale) / DOWN).toFixed(2)}px)`;
  o.drawImage(canvas as CanvasImageSource, 0, 0, W, bandPx, 0, 0, ow, ob);
  o.drawImage(canvas as CanvasImageSource, 0, canvas.height - bandPx, W, bandPx, 0, ob, ow, ob);
  o.filter = 'none';
  // alpha mask: opaque at the screen edge, clear toward the middle of the view
  o.globalCompositeOperation = 'destination-in';
  const gt = o.createLinearGradient(0, 0, 0, ob);
  gt.addColorStop(0, 'rgba(0,0,0,1)');
  gt.addColorStop(0.35, 'rgba(0,0,0,0.85)');
  gt.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = gt;
  o.fillRect(0, 0, ow, ob);
  const gb = o.createLinearGradient(0, ob, 0, ob * 2);
  gb.addColorStop(0, 'rgba(0,0,0,0)');
  gb.addColorStop(0.65, 'rgba(0,0,0,0.85)');
  gb.addColorStop(1, 'rgba(0,0,0,1)');
  o.fillStyle = gb;
  o.fillRect(0, ob, ow, ob);
  o.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // weak near the survey side of the blend, where the half-resolution copy would show before the blur does
  ctx.globalAlpha = Math.min(1, blend);
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off as CanvasImageSource, 0, 0, ow, ob, 0, 0, W, bandPx);
  ctx.drawImage(off as CanvasImageSource, 0, ob, ow, ob, 0, canvas.height - bandPx, W, bandPx);
  ctx.restore();
}
