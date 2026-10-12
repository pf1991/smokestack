import { BUILDINGS } from '../../data/buildings';
import { STATION_TYPE, stationAccess } from '../../sim/rail';
import { accessTiles } from '../../sim/state';
import type { Building, GameState, Vec2 } from '../../sim/types';
import type { Camera } from '../camera';
import { TILE } from '../camera';
import { HEADROOM, VEHICLE_SCALE, getBuildingSprite } from '../sprites';
import type { Ghost, Selection } from './index';
import type { Dir } from './shared';
import { vehiclePose } from './vehicles';

const BRASS = '#c9a13a';

function buildingCentre(b: Building): Vec2 {
  const def = BUILDINGS[b.typeId];
  return { x: (b.pos.x + def.size.w / 2) * TILE, y: (b.pos.y + def.size.h / 2) * TILE };
}

function drawPick(ctx: CanvasRenderingContext2D, state: GameState, pick: { valid: number[]; blocked: number[] }, nowMs: number, px: number): void {
  const outline = (ids: number[], stroke: string, fill: string, alpha: number, dash: boolean) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3 * px;
    ctx.setLineDash(dash ? [6 * px, 4 * px] : []);
    for (const id of ids) {
      const b = state.buildings[id];
      if (!b) continue;
      const def = BUILDINGS[b.typeId];
      ctx.fillRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE, def.size.h * TILE);
      ctx.strokeRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE, def.size.h * TILE);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };
  outline(pick.blocked, '#9a9a9a', 'rgba(120,120,120,0.35)', 0.8, true);
  outline(pick.valid, '#3fd05a', 'rgba(63,208,90,0.18)', 0.7 + 0.3 * Math.sin(nowMs / 200), false);
}

export function drawSelection(ctx: CanvasRenderingContext2D, state: GameState, sel: Selection | null, vehicleDir: Map<number, Dir>, alpha: number, nowMs: number, z: number): void {
  if (!sel) return;
  const px = 1 / z;
  if (sel.pick) drawPick(ctx, state, sel.pick, nowMs, px);
  if (sel.routeId !== undefined || sel.draftRoute) {
    const route = sel.draftRoute ?? state.routes[sel.routeId!];
    if (route) {
      const pts: Vec2[] = [];
      for (const s of route.stops) {
        const b = state.buildings[s.buildingId];
        if (b) pts.push(buildingCentre(b));
      }
      if (pts.length >= 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.strokeStyle = 'rgba(20,14,6,0.7)';
        ctx.lineWidth = 7 * px;
        ctx.stroke();
        ctx.strokeStyle = route.color;
        ctx.lineWidth = 4 * px;
        ctx.setLineDash([12 * px, 6 * px]);
        ctx.lineDashOffset = -nowMs / 40 * px;
        ctx.stroke();
        // return leg
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(pts[0].x, pts[0].y);
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([4 * px, 8 * px]);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }
      route.stops.forEach((s, i) => {
        const b = state.buildings[s.buildingId];
        if (!b) return;
        const c = buildingCentre(b);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 10 * px, 0, Math.PI * 2);
        ctx.fillStyle = route.color;
        ctx.fill();
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = '#f5ecd2';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${12 * px}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), c.x, c.y + px);
      });
    }
  }
  if (sel.buildingId !== undefined) {
    const b = state.buildings[sel.buildingId];
    if (b) {
      const def = BUILDINGS[b.typeId];
      const pulse = 0.65 + 0.35 * Math.sin(nowMs / 250);
      ctx.strokeStyle = 'rgba(20,14,6,0.6)';
      ctx.lineWidth = 4 * px;
      ctx.strokeRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE, def.size.h * TILE);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(b.pos.x * TILE, b.pos.y * TILE, def.size.w * TILE, def.size.h * TILE);
      ctx.globalAlpha = 1;
      // access tiles hint
      ctx.fillStyle = 'rgba(201,161,58,0.25)';
      for (const a of accessTiles(state, b)) ctx.fillRect(a.x * TILE + 2, a.y * TILE + 2, TILE - 4, TILE - 4);
      if (b.typeId === STATION_TYPE) for (const a of stationAccess(state, b)) ctx.fillRect(a.x * TILE + 2, a.y * TILE + 2, TILE - 4, TILE - 4);
    }
  }
  if (sel.vehicleId !== undefined) {
    const v = state.vehicles[sel.vehicleId];
    if (v) {
      const p = vehiclePose(vehicleDir, v, alpha);
      const rr = (14 * VEHICLE_SCALE + Math.sin(nowMs / 200) * 1.5) * px * Math.max(1, z * 0.6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(20,14,6,0.6)';
      ctx.lineWidth = 4 * px;
      ctx.stroke();
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
  }
}

export function ghostBounds(g: Ghost | null): { x: number; y: number; w: number; h: number } | null {
  if (!g) return null;
  if (g.kind === 'building') {
    const def = BUILDINGS[g.typeId];
    if (!def) return null;
    return { x: g.pos.x * TILE, y: g.pos.y * TILE, w: def.size.w * TILE, h: def.size.h * TILE };
  }
  if (g.tiles.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of g.tiles) {
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x);
    y1 = Math.max(y1, t.y);
  }
  return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
}

export function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost | null, z: number): void {
  if (!g) return;
  const fill = g.valid ? 'rgba(80,200,90,0.35)' : 'rgba(220,60,50,0.38)';
  const line = g.valid ? 'rgba(120,240,130,0.95)' : 'rgba(255,90,80,0.95)';
  ctx.lineWidth = 2 / z;
  if (g.kind === 'building') {
    const def = BUILDINGS[g.typeId];
    if (!def) return;
    const x = g.pos.x * TILE;
    const y = g.pos.y * TILE;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(getBuildingSprite(g.typeId, 'player'), x, y - HEADROOM);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, def.size.w * TILE, def.size.h * TILE);
    ctx.strokeStyle = line;
    ctx.strokeRect(x, y, def.size.w * TILE, def.size.h * TILE);
  } else {
    ctx.fillStyle = fill;
    ctx.strokeStyle = line;
    for (const t of g.tiles) {
      ctx.fillRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
      ctx.strokeRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
    }
  }
}

/** Label box in screen space so text stays crisp at any zoom. */
export function drawGhostLabel(ctx: CanvasRenderingContext2D, g: Ghost | null, cam: Camera): void {
  const b = ghostBounds(g);
  if (!g || !b || !g.label) return;
  const sx = (b.x + b.w / 2 - cam.x) * cam.zoom;
  const sy = (b.y - cam.y) * cam.zoom - (g.kind === 'building' ? HEADROOM * cam.zoom : 0) - 10;
  ctx.save();
  ctx.font = 'bold 13px Georgia, "Times New Roman", serif';
  const tw = ctx.measureText(g.label).width;
  const w = tw + 16;
  const h = 22;
  const x = Math.round(Math.min(Math.max(4, sx - w / 2), cam.viewW - w - 4));
  const y = Math.round(Math.max(4, sy - h));
  ctx.fillStyle = 'rgba(26,18,8,0.88)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = g.valid ? BRASS : '#d9534f';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = g.valid ? '#f5ecd2' : '#ffb3ab';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(g.label, x + 8, y + h / 2 + 1);
  ctx.restore();
}
