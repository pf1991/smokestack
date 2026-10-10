import type { Camera } from './constants';

/** Render-only particle effects. Positions are world pixels. */

const MAX_PARTICLES = 2000;
const SMOKE_LIFE = 4000;
const SMOKE_RATE = 6; // puffs per second at density 1
const MAX_STEP_MS = 100;
const SMOKE_HIGHLIGHT = '#9a948a';
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

  emitSmoke(wx: number, wy: number, density: number, dtMs: number): void {
    const d = Math.min(1, Math.max(0, density));
    const dt = Math.min(Math.max(0, dtMs), MAX_STEP_MS);
    // Expected puffs per call = SMOKE_RATE * density * dt, so the emission rate
    // is independent of how often the caller runs.
    const n = Math.floor((SMOKE_RATE * d * dt) / 1000 + Math.random());
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'smoke',
        x: wx + (Math.random() - 0.5) * 6,
        y: wy,
        vx: 0,
        vy: -SMOKE_RISE,
        age: 0,
        life: SMOKE_LIFE,
        color: '#3a332b',
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
    const step = Math.min(Math.max(0, dtMs), MAX_STEP_MS);
    this.t += step;
    const dt = step / 1000;
    const wind = windAt(this.t);
    const parts = this.parts;
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.age += step;
      if (p.age >= p.life) continue;
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
      parts[w++] = p;
    }
    parts.length = w;
    this.trim();
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    this.trim();
    ctx.save();
    for (const p of this.parts) {
      const sx = (p.x - cam.x) * cam.zoom;
      const sy = (p.y - cam.y) * cam.zoom;
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const t = p.age / p.life;
      const alpha = 1 - t;
      if (p.kind === 'smoke') {
        // dark sooty body plus a lighter offset puff for volume
        const r = (4 + 12 * t) * cam.zoom;
        const fade = Math.pow(1 - t, 0.7);
        ctx.globalAlpha = 0.75 * fade;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = SMOKE_HIGHLIGHT;
        ctx.beginPath();
        ctx.arc(sx - 2 * cam.zoom, sy - 2 * cam.zoom, r * 0.7, 0, Math.PI * 2);
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
    this.trim();
    return this.parts.length;
  }

  private add(p: Particle): void {
    this.parts.push(p);
  }

  /** Drops the oldest particles in one splice once over the cap. */
  private trim(): void {
    const excess = this.parts.length - MAX_PARTICLES;
    if (excess > 0) this.parts.splice(0, excess);
  }
}
