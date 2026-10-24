/**
 * Factorio-style status badges over the player's troubled works: a small disc with an icon at the top
 * centre of the footprint (warning for starved/backed-up works and empty stores, a placard for strikes,
 * a pause for idle works, a scaffold for upgrades). Screen space, drawn in the overlay pass.
 * Stores and logistics buildings sit at 'idle' permanently, so idle/no_input/output_full count only
 * for extractors and factories; a store badges only when its shelves are empty.
 */
import { BUILDINGS } from '../data/buildings';
import { dateToDays } from '../sim/clock';
import { strikeActive } from '../sim/society/strikeState';
import { storeStocked } from '../sim/inventory';
import type { Building, GameState } from '../sim/types';
import { cssColor } from '../ui/charts';
import { TILE, type Camera } from './camera';
import { drawIcon, type IconId } from './icons';

export const BADGE_SIZE = 18;
export const BADGE_MIN_ZOOM = 0.9;
const ICON_SIZE = 12;

export function badgeFor(b: Building, today: number): IconId | null {
  const category = BUILDINGS[b.typeId]?.category;
  if (b.status === 'halted') return strikeActive(b.strike, today) ? 'strike' : null;
  if (b.status === 'upgrading') return 'scaffold';
  if (category === 'retail') return storeStocked(b) ? null : 'warning';
  if (category !== 'extractor' && category !== 'factory') return null;
  if (b.status === 'no_input' || b.status === 'output_full') return 'warning';
  if (b.status === 'idle') return 'pause';
  return null;
}

export function drawStatusBadges(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  opts: { photo: boolean; nowMs: number },
): void {
  if (opts.photo || cam.zoom < BADGE_MIN_ZOOM) return;
  const today = dateToDays(state.date);
  const z = cam.zoom;
  const r = BADGE_SIZE / 2;
  const bob = Math.sin((opts.nowMs / 1000) * Math.PI * 2);
  let fill: string | null = null;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'player') continue;
    const icon = badgeFor(b, today);
    if (!icon) continue;
    const size = BUILDINGS[b.typeId]?.size;
    if (!size) continue;
    const cx = (b.pos.x * TILE + (size.w * TILE) / 2 - cam.x) * z;
    const cy = (b.pos.y * TILE - cam.y) * z - r - 2 + bob;
    if (cx < -r || cy < -r || cx > cam.viewW + r || cy > cam.viewH + r) continue;
    fill ??= cssColor('--surface-1', '#f3e9d2');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(43,29,20,0.55)';
    ctx.stroke();
    drawIcon(ctx, icon, cx - ICON_SIZE / 2, cy - ICON_SIZE / 2, ICON_SIZE);
  }
}
