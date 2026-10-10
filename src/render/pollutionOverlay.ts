import type { Overlay } from './overlays';
import { TILE, visibleTileRange } from './camera';
import type { Camera } from './constants';
import type { GameState } from '../sim/types';

const MAX_ALPHA = 0.7;

/** Brown (low) to yellow (high) smog colour for pollution 0..100. */
function smogColor(p: number, alpha: number): string {
  const k = Math.min(1, p / 100);
  const r = Math.round(110 + 130 * k);
  const g = Math.round(60 + 140 * k);
  const b = Math.round(20 + 10 * k);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** Translucent brown-to-yellow heat map over polluted tiles in view; alpha is proportional to pollution. */
export const pollutionOverlay: Overlay = {
  id: 'pollution',
  enabled: false,
  draw(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
    const { map } = state;
    const r = visibleTileRange(cam, map);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const p = map.tiles[y * map.width + x].pollution;
        if (p < 0.5) continue;
        ctx.fillStyle = smogColor(p, Math.min(1, p / 100) * MAX_ALPHA + 0.04);
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  },
};

// dev-only hook: `?smog=1` starts with the overlay on
try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('smog') === '1') pollutionOverlay.enabled = true;
} catch {
  /* no location (tests) */
}
