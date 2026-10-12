/** Small UI "juice" helpers: rolling numbers, milestone detection and stamps. */

export const MONEY_MILESTONES = [100_000, 1_000_000, 10_000_000, 100_000_000];

const STAMP_MS = 2200;

/** Ease-out cubic interpolation; returns exactly `to` once t >= 1. */
export function rollValue(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const e = 1 - (1 - t) ** 3;
  return from + (to - from) * e;
}

/** Highest milestone that `next` has passed and `prev` had not, or null. */
export function crossedMilestone(prev: number, next: number): number | null {
  let hit: number | null = null;
  for (const m of MONEY_MILESTONES) if (prev < m && next >= m) hit = m;
  return hit;
}

/** Shows a number in `el` that eases towards each new target. Drive it with `tick` from the frame loop. */
export class RollingCounter {
  private shown = 0;
  private from = 0;
  private target = 0;
  private start = 0;
  private rolling = false;
  private text: string | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly format: (n: number) => string,
    private readonly durationMs = 600,
  ) {}

  /** Jumps to `value` with no animation. */
  snap(value: number): void {
    this.shown = this.from = this.target = value;
    this.rolling = false;
    this.render();
  }

  /** Sets a new target; a roll in progress continues from the currently shown value. */
  set(value: number, nowMs: number): void {
    if (value === this.target) return;
    this.from = this.shown;
    this.target = value;
    this.start = nowMs;
    this.rolling = true;
  }

  tick(nowMs: number): void {
    if (this.rolling) {
      const t = (nowMs - this.start) / this.durationMs;
      this.shown = rollValue(this.from, this.target, t);
      if (t >= 1) this.rolling = false;
    }
    this.render();
  }

  private render(): void {
    const text = this.format(this.shown);
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }
  }
}

/** Slams a stamp onto the screen; CSS animates it and it removes itself after 2200 ms. */
export function showStamp(text: string, tone: 'good' | 'bad'): void {
  const root = document.getElementById('ui') ?? document.body;
  const el = document.createElement('div');
  el.className = `stamp ${tone}`;
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), STAMP_MS);
}
