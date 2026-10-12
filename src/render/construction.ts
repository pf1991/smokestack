/** Scaffold-and-reveal construction animation (render-only; driven by real time, never GameState). */

export const BUILD_MS = 1400;

const SCAFFOLD_UP_MS = 600;
const REVEAL_END_MS = 1200;

export interface ConstructionStage {
  scaffold: number;
  reveal: number;
  done: boolean;
}

/** 0-600 scaffold rises, 600-1200 sprite revealed bottom-up, 1200-1400 scaffold falls away. */
export function constructionStage(elapsedMs: number): ConstructionStage {
  const t = Math.max(0, elapsedMs);
  if (t >= BUILD_MS) return { scaffold: 0, reveal: 1, done: true };
  if (t < SCAFFOLD_UP_MS) return { scaffold: t / SCAFFOLD_UP_MS, reveal: 0, done: false };
  if (t < REVEAL_END_MS) return { scaffold: 1, reveal: (t - SCAFFOLD_UP_MS) / (REVEAL_END_MS - SCAFFOLD_UP_MS), done: false };
  return { scaffold: 1 - (t - REVEAL_END_MS) / (BUILD_MS - REVEAL_END_MS), reveal: 1, done: false };
}

const POLE = '#6b4423';
const PLANK = '#9a6b3a';

/** Draws the sprite clipped from the bottom up, plus brown poles and planks sized by `stage.scaffold`. */
export function drawConstruction(
  g: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  stage: ConstructionStage,
): void {
  if (stage.reveal > 0) {
    const vis = Math.round(h * stage.reveal);
    if (vis > 0) g.drawImage(sprite, 0, h - vis, w, vis, x, y + h - vis, w, vis);
  }
  if (stage.scaffold <= 0) return;
  g.save();
  // while the scaffold comes down (reveal complete) it also fades
  g.globalAlpha = stage.reveal >= 1 ? stage.scaffold : 1;
  const sh = Math.round(h * stage.scaffold);
  const top = y + h - sh;
  g.fillStyle = POLE;
  const poles = [0, Math.round(w / 3), Math.round((2 * w) / 3), w - 3];
  for (const px of poles) g.fillRect(x + px, top, 3, sh);
  g.fillStyle = PLANK;
  for (let py = y + h - 8; py >= top; py -= 14) g.fillRect(x, py, w, 3);
  g.restore();
}
