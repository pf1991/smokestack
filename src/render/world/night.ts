import type { Building, GameState } from '../../sim/types';
import { type Camera, TILE } from '../camera';
import { HEADROOM, houseStyle } from '../sprites';
import { CHUNK } from '../terrain';
import { getHouseGlow, getLampGlow, getWindowGlow } from './glows';
import type { ChunkMeta, Dir, TileRange } from './shared';
import { vehiclePose } from './vehicles';


export function drawNightLights(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  r: TileRange,
  buildings: Building[],
  state: GameState,
  chunks: Map<number, { meta: ChunkMeta | null }>,
  chunkCols: number,
  vehicleDir: Map<number, Dir>,
  alpha: number,
  k: number,
): void {
  const z = cam.zoom;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  const toSX = (wx: number): number => (wx - cam.x) * z;
  const toSY = (wy: number): number => (wy - cam.y) * z;
  const style = houseStyle(state.date.year);
  const lamp = getLampGlow();

  const cx0 = Math.floor(Math.max(0, r.x0 - 1) / CHUNK);
  const cy0 = Math.floor(Math.max(0, r.y0 - 1) / CHUNK);
  const cx1 = Math.floor(Math.min(state.map.width - 1, r.x1 + 1) / CHUNK);
  const cy1 = Math.floor(Math.min(state.map.height - 1, r.y1 + 1) / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = chunks.get(cy * chunkCols + cx);
      const m = c?.meta;
      if (!m || m.empty) continue;
      // lit house windows
      ctx.globalAlpha = k * 0.9;
      const hs = m.houses;
      for (let i = 0; i < hs.length; i += 4) {
        if (!hs[i + 3]) continue;
        const x = hs[i];
        const y = hs[i + 1];
        if (x < r.x0 - 1 || x > r.x1 + 1 || y < r.y0 - 1 || y > r.y1 + 1) continue;
        // a building directly south is drawn over this house, so its windows must not glow through
        if (y + 1 < state.map.height && state.map.tiles[(y + 1) * state.map.width + x].buildingId !== null) continue;
        const glow = getHouseGlow(style, hs[i + 2], state.date.year);
        ctx.drawImage(glow as CanvasImageSource, toSX(x * TILE - 6), toSY(y * TILE - 6), (TILE + 12) * z, (TILE + 12) * z);
      }
      // street lamps
      ctx.globalAlpha = k;
      const ls = m.lamps;
      const R = 22 * z;
      for (let i = 0; i < ls.length; i += 2) {
        const sx = toSX(ls[i]);
        const sy = toSY(ls[i + 1]);
        if (sx < -R || sy < -R || sx > cam.viewW + R || sy > cam.viewH + R) continue;
        ctx.drawImage(lamp as CanvasImageSource, sx - R, sy - R, R * 2, R * 2);
      }
    }
  }

  // factory windows
  ctx.globalAlpha = k;
  for (const b of buildings) {
    const glow = getWindowGlow(b.typeId);
    if (!glow) continue;
    const working = b.status === 'ok' || b.status === 'no_input' || b.status === 'output_full';
    ctx.globalAlpha = k * (working ? 1 : 0.35);
    const gx = b.pos.x * TILE + glow.ox;
    const gy = b.pos.y * TILE - HEADROOM + glow.oy;
    ctx.drawImage(glow.surf as CanvasImageSource, toSX(gx), toSY(gy), glow.surf.width * z, glow.surf.height * z);
  }

  // truck headlights
  ctx.globalAlpha = k * 0.8;
  const HR = 9 * z;
  for (const id in state.vehicles) {
    const v = state.vehicles[id];
    if (v.pos.x < r.x0 - 1 || v.pos.x > r.x1 + 1 || v.pos.y < r.y0 - 1 || v.pos.y > r.y1 + 1) continue;
    const p = vehiclePose(vehicleDir, v, alpha);
    const f = v.kind === 'train' ? 14 : 11;
    const fx = p.dir === 'E' ? f : p.dir === 'W' ? -f : 0;
    const fy = p.dir === 'S' ? f : p.dir === 'N' ? -f : 0;
    ctx.drawImage(lamp as CanvasImageSource, toSX(p.x + fx) - HR, toSY(p.y + fy) - HR, HR * 2, HR * 2);
  }
  ctx.restore();
}
