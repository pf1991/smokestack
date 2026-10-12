import { TILE } from '../camera';
import { type Ctx, E, N, S, W, bitCount, h01 } from './shared';

/** Rail gauge: each rail sits this many px either side of the track centreline. */
const GAUGE = 4;
const RAIL_STEEL = '#8e949b';
const RAIL_SHINE = '#c9ced3';

/** Rail arms of a tile mask as drawn: a lone or empty mask becomes a straight run. */
function railArms(mask: number): number {
  return mask === 0 ? E | W : mask === N || mask === S ? N | S : mask === E || mask === W ? E | W : mask;
}

/**
 * True when a road really crosses the track on this tile: the road leaves it through a side the
 * rail does not use. Track laid lengthwise along a street (road arms ⊆ rail arms) is not a crossing.
 */
export function isLevelCrossing(railMask: number, roadMask: number): boolean {
  return (roadMask & ~railArms(railMask) & (N | E | S | W)) !== 0;
}

/**
 * Paints one rail tile at (0,0): a ballast bed, sleepers ("ties") and two steel rails. Two
 * perpendicular arms are drawn as a quarter-circle curve; anything else as straight arms from the
 * centre. On a level crossing (`road` true) the ballast is replaced by timber decking set into the
 * road; striped crossbuck posts stand on the corners only where the road crosses the track
 * (`isLevelCrossing` with `roadMask`), not along a stretch laid lengthwise in the street.
 */
export function paintRailTile(g: Ctx, mask: number, road: boolean, winter: boolean, x: number, y: number, seed: number, roadMask = 0): void {
  const C = TILE / 2;
  const m = railArms(mask);
  const curve = bitCount(m) === 2 && (m & (N | S)) !== 0 && (m & (E | W)) !== 0;
  const ballast = winter ? '#b9b7b2' : '#857a6c';
  const tie = road ? '#6b5236' : '#4a3626';

  if (curve) {
    // arc centred on the tile corner shared by the two arms
    const cx = m & E ? TILE : 0;
    const cy = m & S ? TILE : 0;
    const a0 = m & E ? (m & S ? Math.PI : Math.PI / 2) : m & S ? -Math.PI / 2 : 0;
    const a1 = a0 + Math.PI / 2;
    const arc = (r: number, w: number, color: string): void => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.arc(cx, cy, r, a0, a1);
      g.stroke();
    };
    g.lineCap = 'butt';
    if (!road) {
      arc(C, 14, 'rgba(40,30,20,0.25)');
      arc(C, 12, ballast);
    }
    g.strokeStyle = tie;
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = a0 + ((k + 0.5) / 5) * (Math.PI / 2);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.moveTo(cx + ca * (C - 6), cy + sa * (C - 6));
      g.lineTo(cx + ca * (C + 6), cy + sa * (C + 6));
    }
    g.stroke();
    for (const r of [C - GAUGE, C + GAUGE]) {
      arc(r, 1.6, RAIL_STEEL);
      arc(r - 0.4, 0.6, RAIL_SHINE);
    }
  } else {
    const arms: [number, number, number, number][] = [];
    // [x0, y0, x1, y1] from the centre out to each connected edge
    if (m & N) arms.push([C, C, C, 0]);
    if (m & S) arms.push([C, C, C, TILE]);
    if (m & W) arms.push([C, C, 0, C]);
    if (m & E) arms.push([C, C, TILE, C]);
    const band = (hw: number, color: string): void => {
      g.fillStyle = color;
      for (const [x0, y0, x1, y1] of arms) {
        if (x0 === x1) g.fillRect(C - hw, Math.min(y0, y1), hw * 2, Math.abs(y1 - y0));
        else g.fillRect(Math.min(x0, x1), C - hw, Math.abs(x1 - x0), hw * 2);
      }
      g.fillRect(C - hw, C - hw, hw * 2, hw * 2);
    };
    if (!road) {
      band(7, 'rgba(40,30,20,0.25)');
      band(6, ballast);
      // ballast grit
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
        const vertical = (m & (N | S)) !== 0 && (m & (E | W)) === 0;
        const along = h01(x, y, seed, 960 + i) * TILE;
        const across = C - 5 + h01(x, y, seed, 970 + i) * 10;
        g.fillRect(vertical ? across : along, vertical ? along : across, 1, 1);
      }
    } else {
      band(6, 'rgba(70,52,30,0.85)'); // timber decking between and beside the rails
    }
    // sleepers every 4 px along each arm
    g.fillStyle = tie;
    for (const [x0, y0, x1, y1] of arms) {
      const vertical = x0 === x1;
      const len = Math.abs(vertical ? y1 - y0 : x1 - x0);
      const dir = Math.sign(vertical ? y1 - y0 : x1 - x0);
      for (let d = 2; d < len; d += 4) {
        const p = C + dir * d;
        if (vertical) g.fillRect(C - 6, p - 1, 12, 2);
        else g.fillRect(p - 1, C - 6, 2, 12);
      }
    }
    // rails
    for (const [x0, y0, x1, y1] of arms) {
      const vertical = x0 === x1;
      for (const off of [-GAUGE, GAUGE]) {
        g.fillStyle = RAIL_STEEL;
        if (vertical) g.fillRect(C + off - 0.8, Math.min(y0, y1), 1.6, Math.abs(y1 - y0));
        else g.fillRect(Math.min(x0, x1), C + off - 0.8, Math.abs(x1 - x0), 1.6);
        g.fillStyle = RAIL_SHINE;
        if (vertical) g.fillRect(C + off - 0.8, Math.min(y0, y1), 0.6, Math.abs(y1 - y0));
        else g.fillRect(Math.min(x0, x1), C + off - 0.8, Math.abs(x1 - x0), 0.6);
      }
    }
  }

  if (road && isLevelCrossing(mask, roadMask)) {
    // crossbuck posts on two opposite corners: white with red stripes
    g.lineCap = 'butt';
    for (const [px, py] of [[5, 5], [TILE - 5, TILE - 5]]) {
      const cross = (w: number, color: string, dx: number, dy: number): void => {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(px - 3.5 + dx, py - 3.5 + dy);
        g.lineTo(px + 3.5 + dx, py + 3.5 + dy);
        g.moveTo(px + 3.5 + dx, py - 3.5 + dy);
        g.lineTo(px - 3.5 + dx, py + 3.5 + dy);
        g.stroke();
      };
      cross(2.5, 'rgba(0,0,0,0.35)', 1, 1);
      cross(2.5, '#b8322a', 0, 0);
      cross(1.1, '#f4efe2', 0, 0);
      g.fillStyle = '#2b2b2e';
      g.fillRect(px - 1, py - 1, 2, 2);
    }
  }
}
