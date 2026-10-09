import type { Camera } from './constants';

/** Render-only particle effects. Positions are world pixels. */

const MAX_PARTICLES = 2000;
const SMOKE_LIFE = 3000;
const SMOKE_RISE = 12; // px/s
const TEXT_LIFE = 1200;
const TEXT_RISE = 24 / 1.2; // 24 px over 1.2 s, px/s
const SPARK_LIFE = 600;
const SPARK_COUNT = 8;
const GRAVITY = 600; // px/s^2

type Kind = 'smoke' | 'text' | 'spark';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  text?: string;
}

/** Slowly varying global wind in px/s, derived from internal time. */
function windAt(t: number): number {
  return 4 * Math.sin(t / 6000) + 2 * Math.sin(t / 2300 + 1);
}

export class ParticleSystem {
  private parts: Particle[] = [];
  private t = 0;

  emitSmoke(wx: number, wy: number, density: number): void {
    const d = Math.min(1, Math.max(0, density));
    // Expected puffs per call = 2 * density, always an integer count.
    const n = Math.floor(d * 2 + Math.random());
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'smoke',
        x: wx + (Math.random() - 0.5) * 6,
        y: wy,
        vx: 0,
        vy: -SMOKE_RISE,
        age: 0,
        life: SMOKE_LIFE,
        color: '#808080',
      });
    }
  }

  emitFloatText(wx: number, wy: number, text: string, color: string): void {
    this.add({
      kind: 'text',
      x: wx,
      y: wy,
      vx: 0,
      vy: -TEXT_RISE,
      age: 0,
      life: TEXT_LIFE,
      color,
      text,
    });
  }

  emitSparks(wx: number, wy: number): void {
    for (let i = 0; i < SPARK_COUNT; i++) {
      this.add({
        kind: 'spark',
        x: wx,
        y: wy,
        vx: (Math.random() - 0.5) * 160,
        vy: -(60 + Math.random() * 120),
        age: 0,
        life: SPARK_LIFE,
        color: '#ff8c1a',
      });
    }
  }

  update(dtMs: number): void {
    const step = Math.max(0, dtMs);
    this.t += step;
    const dt = step / 1000;
    const wind = windAt(this.t);
    for (const p of this.parts) {
      p.age += step;
      if (p.kind === 'smoke') {
        p.x += wind * dt;
        p.y += p.vy * dt;
      } else if (p.kind === 'spark') {
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else {
        p.y += p.vy * dt;
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.save();
    for (const p of this.parts) {
      const sx = (p.x - cam.x) * cam.zoom;
      const sy = (p.y - cam.y) * cam.zoom;
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const t = p.age / p.life;
      const alpha = 1 - t;
      if (p.kind === 'smoke') {
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, (3 + 7 * t) * cam.zoom, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5 * cam.zoom, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 12px serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1a1208';
        ctx.strokeText(p.text ?? '', sx, sy);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text ?? '', sx, sy);
      }
    }
    ctx.restore();
  }

  count(): number {
    return this.parts.length;
  }

  private add(p: Particle): void {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push(p);
  }
}
